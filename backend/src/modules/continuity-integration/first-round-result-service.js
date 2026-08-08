import { isDeepStrictEqual } from 'node:util';

import { ConflictError, ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';
import {
  calculateEnvelopeHash,
  canonicalizeJson,
} from './first-round-hashing.js';
import {
  projectionsHaveSameContent,
  validateFirstRoundEngineEnvelope,
} from './first-round-result-validator.js';
import { createUnconfiguredFirstRoundTransport } from './first-round-transport.js';

function contractTimestamp(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError('Result clock must return a valid Date.');
  }
  return value.toISOString().replace('.000Z', 'Z');
}

function json(value) {
  return canonicalizeJson(value).toString('utf8');
}

function outcome(record) {
  return Object.freeze({
    envelope: structuredClone(record.envelope),
    processingStage: record.processingStage,
    publicationStatus: record.publicationStatus,
    reconciliationStatus: record.reconciliationStatus,
    disposition: record.disposition,
    reasonCode: record.reasonCode,
  });
}

function successAssociationIssue(envelope, request, resultRepository) {
  if (envelope.requestId !== request.requestId) return 'request_id_mismatch';
  if (envelope.requestHash !== request.requestHash) return 'request_hash_mismatch';
  if (envelope.subjectId !== request.identity.subjectId) return 'subject_mismatch';
  if (envelope.bindingId !== request.identity.bindingId) return 'binding_mismatch';
  if (envelope.bindingVersion !== request.identity.bindingVersion) {
    return 'binding_version_mismatch';
  }
  if (envelope.stateProjection.previousRevision !== request.expectedEngineRevision) {
    return 'previous_revision_request_mismatch';
  }
  const expectedObservationIds = request.observations.map(({ observationId }) => observationId);
  if (!isDeepStrictEqual(envelope.consumedObservationIds, expectedObservationIds)) {
    return 'consumed_observation_mismatch';
  }
  const operationOwner = resultRepository.findResultByOperationId(envelope.operationId);
  if (operationOwner && operationOwner.requestId !== request.requestId) {
    return 'operation_id_conflict';
  }
  const responseOwner = resultRepository.findResultByResponseId(envelope.response.responseId);
  if (responseOwner && responseOwner.requestId !== request.requestId) {
    return 'response_id_conflict';
  }
  return null;
}

function projectionConflictReason(envelope, request, resultRepository) {
  const projection = envelope.stateProjection;
  const existing = resultRepository.findProjection(
    projection.subjectId,
    projection.currentRevision,
  );
  if (existing) {
    if (existing.stateHash !== projection.snapshot.stateHash) {
      return 'same_revision_state_hash_conflict';
    }
    if (
      existing.contentHash !== projection.contentHash
      || !isDeepStrictEqual(existing.snapshot, projection.snapshot)
    ) {
      return 'same_revision_projection_content_conflict';
    }
  }

  if (projection.engineUpdateId !== null) {
    const updateOwner = resultRepository.findReceiptByEngineUpdateId(
      projection.engineUpdateId,
    );
    if (
      updateOwner
      && (
        updateOwner.requestId !== request.requestId
        || updateOwner.subjectId !== projection.subjectId
        || updateOwner.currentRevision !== projection.currentRevision
      )
    ) {
      return 'engine_update_id_conflict';
    }
  }

  const head = resultRepository.findHead(projection.subjectId);
  if (!head) {
    const isRevisionZeroInitialization = !projection.changed
      && request.expectedEngineRevision === 0
      && projection.previousRevision === 0
      && projection.currentRevision === 0;
    return isRevisionZeroInitialization
      ? null
      : 'missing_head_requires_revision_zero_initialization';
  }
  if (
    head.bindingId !== projection.bindingId
    || head.bindingVersion !== projection.bindingVersion
  ) {
    return 'projection_head_binding_mismatch';
  }
  if (projection.previousRevision < head.currentRevision) return 'old_revision';
  if (projection.previousRevision > head.currentRevision) return 'revision_gap';
  if (!projection.changed) {
    if (
      head.currentRevision !== projection.currentRevision
      || head.stateHash !== projection.snapshot.stateHash
      || head.contentHash !== projection.contentHash
    ) {
      return 'unchanged_projection_head_conflict';
    }
  }
  return null;
}

export function createFirstRoundContinuityResultService({
  requestService,
  resultRepository,
  runInTransaction,
  transport = createUnconfiguredFirstRoundTransport(),
  clock = () => new Date(),
  faultInjector = null,
}) {
  if (
    transport?.mode !== 'unconfigured'
    && (transport?.testOnly !== true || typeof transport?.submit !== 'function')
  ) {
    throw new ValidationError(
      'Vio V2 accepts only an explicitly test-only first-round transport.',
    );
  }

  function now() {
    return contractTimestamp(clock());
  }

  function fault(stage, record) {
    if (faultInjector) faultInjector(stage, structuredClone(record));
  }

  function recordIncident(requestId, candidateEnvelopeHash, disposition, reasonCode) {
    runInTransaction(() => resultRepository.recordIncident({
      requestId,
      candidateEnvelopeHash,
      disposition,
      reasonCode,
      recordedAt: now(),
    }));
  }

  function transitionToReconciliation(record, disposition, reasonCode) {
    const stage = disposition === 'quarantined' ? 'quarantined' : 'reconciling';
    return runInTransaction(() => resultRepository.transitionResult({
      requestId: record.requestId,
      expectedStage: record.processingStage,
      processingStage: stage,
      reconciliationStatus: disposition,
      disposition,
      reasonCode,
      updatedAt: now(),
    })) ?? resultRepository.findResultByRequestId(record.requestId);
  }

  function persistProjection(record, request) {
    const envelope = record.envelope;
    const projection = envelope.stateProjection;
    const reason = projectionConflictReason(envelope, request, resultRepository);
    if (reason) return transitionToReconciliation(record, 'reconciling', reason);

    try {
      return runInTransaction(() => {
        let storedProjection = resultRepository.findProjection(
          projection.subjectId,
          projection.currentRevision,
        );
        if (!storedProjection) {
          storedProjection = resultRepository.insertProjection({
            subjectId: projection.subjectId,
            currentRevision: projection.currentRevision,
            bindingId: projection.bindingId,
            bindingVersion: projection.bindingVersion,
            schemaVersion: projection.schemaVersion,
            snapshotJson: json(projection.snapshot),
            stateHash: projection.snapshot.stateHash,
            contentHash: projection.contentHash,
            receiveStatus: 'validated',
            firstCompletedAt: envelope.completedAt,
            createdAt: now(),
          });
        }
        if (!projectionsHaveSameContent({
          snapshot: storedProjection.snapshot,
          contentHash: storedProjection.contentHash,
        }, projection)) {
          throw new ConflictError('Stored Engine projection content is different.');
        }
        const receipt = resultRepository.findReceiptByRequestId(request.requestId);
        if (!receipt) {
          resultRepository.insertReceipt({
            requestId: request.requestId,
            operationId: envelope.operationId,
            responseId: envelope.response.responseId,
            subjectId: projection.subjectId,
            currentRevision: projection.currentRevision,
            previousRevision: projection.previousRevision,
            changed: projection.changed,
            engineUpdateId: projection.engineUpdateId,
            completedAt: envelope.completedAt,
            receivedAt: record.receivedAt,
          });
        }
        return resultRepository.transitionResult({
          requestId: request.requestId,
          expectedStage: 'received',
          processingStage: 'projection_saved',
          updatedAt: now(),
        });
      });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      return transitionToReconciliation(
        resultRepository.findResultByRequestId(request.requestId),
        'reconciling',
        'projection_storage_conflict',
      );
    }
  }

  function applyProjectionPointer(record, request) {
    const projection = record.envelope.stateProjection;
    const reason = projectionConflictReason(record.envelope, request, resultRepository);
    if (reason) return transitionToReconciliation(record, 'reconciling', reason);

    try {
      return runInTransaction(() => {
        const head = resultRepository.findHead(projection.subjectId);
        if (!head) {
          resultRepository.insertHead({
            subjectId: projection.subjectId,
            bindingId: projection.bindingId,
            bindingVersion: projection.bindingVersion,
            currentRevision: projection.currentRevision,
            stateHash: projection.snapshot.stateHash,
            contentHash: projection.contentHash,
            currentRequestId: request.requestId,
            updatedAt: now(),
          });
        } else if (projection.changed) {
          const advanced = resultRepository.advanceHead({
            subjectId: projection.subjectId,
            bindingId: projection.bindingId,
            bindingVersion: projection.bindingVersion,
            expectedRevision: projection.previousRevision,
            currentRevision: projection.currentRevision,
            stateHash: projection.snapshot.stateHash,
            contentHash: projection.contentHash,
            currentRequestId: request.requestId,
            updatedAt: now(),
          });
          if (!advanced) throw new ConflictError('Projection head CAS did not match.');
        }
        return resultRepository.transitionResult({
          requestId: request.requestId,
          expectedStage: 'projection_saved',
          processingStage: 'pointer_applied',
          updatedAt: now(),
        });
      });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      return transitionToReconciliation(
        resultRepository.findResultByRequestId(request.requestId),
        'reconciling',
        'projection_pointer_cas_conflict',
      );
    }
  }

  function resumeStoredResult(record, request) {
    let current = record;
    if (
      ['completed', 'terminal_error', 'reconciling', 'quarantined']
        .includes(current.processingStage)
    ) {
      return outcome(current);
    }
    const validated = validateFirstRoundEngineEnvelope(current.envelope);
    if (validated.type !== 'success') {
      throw new ValidationError('Only success results may have a recoverable processing stage.');
    }

    if (current.processingStage === 'received') {
      current = persistProjection(current, request);
      if (current.processingStage !== 'projection_saved') return outcome(current);
      fault('after_projection_saved', current);
    }
    if (current.processingStage === 'projection_saved') {
      current = applyProjectionPointer(current, request);
      if (current.processingStage !== 'pointer_applied') return outcome(current);
      fault('after_pointer_advanced', current);
    }
    if (current.processingStage === 'pointer_applied') {
      current = runInTransaction(() => resultRepository.transitionResult({
        requestId: request.requestId,
        expectedStage: 'pointer_applied',
        processingStage: 'completed',
        updatedAt: now(),
      })) ?? resultRepository.findResultByRequestId(request.requestId);
    }
    return outcome(current);
  }

  function receiveResult(requestId, candidate) {
    const normalizedRequestId = requireString(requestId, 'requestId', { maxLength: 128 });
    const request = requestService.getStoredRequest(normalizedRequestId);
    let candidateEnvelopeHash;
    try {
      candidateEnvelopeHash = calculateEnvelopeHash(candidate);
    } catch (error) {
      throw new ValidationError('Engine result is not valid RFC 8785 JSON.');
    }

    const existing = resultRepository.findResultByRequestId(normalizedRequestId);
    if (existing) {
      if (existing.envelopeHash !== candidateEnvelopeHash) {
        recordIncident(
          normalizedRequestId,
          candidateEnvelopeHash,
          'quarantined',
          'request_result_overwrite_attempt',
        );
        throw new ConflictError('requestId already has a different immutable Engine result.');
      }
      return resumeStoredResult(existing, request);
    }

    let validated;
    try {
      validated = validateFirstRoundEngineEnvelope(candidate);
    } catch (error) {
      recordIncident(
        normalizedRequestId,
        candidateEnvelopeHash,
        'quarantined',
        'engine_envelope_invalid',
      );
      throw error;
    }

    const envelope = validated.envelope;
    let reasonCode = null;
    if (envelope.requestId !== request.requestId) reasonCode = 'request_id_mismatch';
    if (validated.type === 'success' && !reasonCode) {
      reasonCode = successAssociationIssue(envelope, request, resultRepository);
    }
    const quarantined = reasonCode !== null;
    const receivedAt = now();
    const record = runInTransaction(() => resultRepository.insertResult({
      requestId: request.requestId,
      requestHash: request.requestHash,
      envelopeHash: candidateEnvelopeHash,
      envelopeType: validated.type,
      engineRequestId: envelope.requestId,
      engineRequestHash: validated.type === 'success' ? envelope.requestHash : null,
      operationId: validated.type === 'success' && !quarantined ? envelope.operationId : null,
      status: envelope.status,
      responseId: validated.type === 'success' && !quarantined
        ? envelope.response.responseId
        : null,
      envelopeJson: json(envelope),
      responseJson: validated.type === 'success' ? json(envelope.response) : null,
      stateProjectionJson: validated.type === 'success'
        ? json(envelope.stateProjection)
        : null,
      errorJson: validated.type === 'error' ? json(envelope.error) : null,
      consumedObservationIdsJson: validated.type === 'success'
        ? json(envelope.consumedObservationIds)
        : null,
      completedAt: validated.type === 'success' ? envelope.completedAt : null,
      receiveStatus: 'received',
      validationStatus: 'validated',
      saveStatus: 'persisted',
      processingStage: quarantined
        ? 'quarantined'
        : validated.type === 'error' ? 'terminal_error' : 'received',
      publicationStatus: 'not_published',
      reconciliationStatus: quarantined ? 'quarantined' : 'none',
      disposition: quarantined
        ? 'quarantined'
        : validated.type === 'error' ? envelope.error.retryClass : 'none',
      reasonCode,
      receivedAt,
      updatedAt: receivedAt,
    }));

    if (quarantined || validated.type === 'error') return outcome(record);
    fault('after_result_saved', record);
    return resumeStoredResult(record, request);
  }

  function submitStoredRequest(requestId) {
    const normalizedRequestId = requireString(requestId, 'requestId', { maxLength: 128 });
    const request = requestService.getStoredRequest(normalizedRequestId);
    const existing = resultRepository.findResultByRequestId(normalizedRequestId);
    if (existing) return resumeStoredResult(existing, request);
    const response = transport.submit(structuredClone(request));
    if (response && typeof response.then === 'function') {
      throw new ValidationError('First-round test transport must be synchronous.');
    }
    return receiveResult(normalizedRequestId, response);
  }

  return Object.freeze({
    submitStoredRequest,
    receiveResult,
    recoverStoredResult(requestId) {
      const normalized = requireString(requestId, 'requestId', { maxLength: 128 });
      const request = requestService.getStoredRequest(normalized);
      const record = resultRepository.findResultByRequestId(normalized);
      return record ? resumeStoredResult(record, request) : null;
    },
    getStoredResult(requestId) {
      const normalized = requireString(requestId, 'requestId', { maxLength: 128 });
      const record = resultRepository.findResultByRequestId(normalized);
      return record ? outcome(record) : null;
    },
    getProjectionHead(subjectId) {
      return resultRepository.findHead(requireString(subjectId, 'subjectId', { maxLength: 128 }));
    },
    getResultIncidents(requestId) {
      return resultRepository.findIncidents(
        requireString(requestId, 'requestId', { maxLength: 128 }),
      );
    },
  });
}
