import { ConflictError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requireString } from '../../core/validation.js';
import { ContinuityTransportError } from '../../integrations/continuity-engine/http-continuity-integration-transport.js';
import { CONTRACT_VERSION } from './first-round-contract.js';
import {
  calculateBindingFixtureHash,
  calculateRequestHash,
  canonicalizeJson,
} from './first-round-hashing.js';
import { validateFirstRoundRequest } from './first-round-validator.js';

const TERMINAL_TRANSPORT_CODES = new Set([
  'unauthorized',
  'http_error',
  'invalid_json',
  'invalid_utf8',
  'invalid_content_type',
  'response_too_large',
  'invalid_not_found',
]);

function timestamp(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError('Continuity delivery clock must return a valid Date.');
  }
  return value.toISOString();
}

function exactObject(value, fields, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${path} must be an object.`);
  }
  const actual = Object.keys(value);
  const expected = new Set(fields);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = actual.filter((field) => !expected.has(field));
  if (missing.length > 0 || unknown.length > 0) {
    throw new ValidationError(`${path} has invalid fields.`, { missing, unknown });
  }
  return value;
}

function requireHash(value, field) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new ValidationError(`${field} must be a lowercase SHA-256 identifier.`);
  }
  return value;
}

function validateQueryEnvelope(candidate, request) {
  const envelope = exactObject(candidate, [
    'contractVersion',
    'requestId',
    'requestHash',
    'operationId',
    'status',
    'result',
  ], 'Engine query envelope');
  if (envelope.contractVersion !== CONTRACT_VERSION) {
    throw new ValidationError('Engine query contractVersion is unsupported.');
  }
  if (envelope.requestId !== request.requestId) {
    throw new ConflictError('Engine query requestId does not match the V1 request.');
  }
  requireHash(envelope.requestHash, 'query requestHash');
  if (envelope.requestHash !== request.requestHash) {
    throw new ConflictError('Engine query requestHash does not match the V1 request.');
  }
  requireString(envelope.operationId, 'query operationId', { maxLength: 128 });
  if (!['completed', 'recovery_required'].includes(envelope.status)) {
    throw new ValidationError('Engine query status is unsupported.');
  }
  if (envelope.status === 'recovery_required') {
    if (envelope.result !== null) {
      throw new ValidationError('recovery_required query must contain a null result.');
    }
  } else {
    const result = exactObject(envelope.result, [
      'contractVersion',
      'requestId',
      'requestHash',
      'operationId',
      'status',
      'subjectId',
      'bindingId',
      'bindingVersion',
      'response',
      'stateProjection',
      'consumedObservationIds',
      'completedAt',
    ], 'Engine query result');
    if (
      result.requestId !== envelope.requestId
      || result.requestHash !== envelope.requestHash
      || result.operationId !== envelope.operationId
    ) {
      throw new ConflictError('Engine query result identity does not match its envelope.');
    }
  }
  return structuredClone(envelope);
}

function publicOutcome(outbox, result = null) {
  return Object.freeze({
    delivery: structuredClone(outbox),
    result: result ? structuredClone(result) : null,
  });
}

export function createDisabledContinuityDeliveryService() {
  return Object.freeze({
    enabled: false,
    getHealthStatus: () => 'disabled',
    initialize: async () => ({ status: 'disabled', recovered: 0 }),
    async submitStoredRequest() {
      throw new ValidationError('Continuity Engine integration is disabled.');
    },
    async resumeCapability() {
      throw new ValidationError('Continuity Engine integration is disabled.');
    },
    getOutbox: () => null,
    listAttempts: () => [],
  });
}

export function createContinuityDeliveryService({
  requestService,
  resultService,
  deliveryRepository,
  transport,
  capabilityService = null,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
  logger = console,
}) {
  let healthStatus = 'degraded';

  function loadOriginalRequest(requestId) {
    const binding = requestService.loadFixedBindingFixture();
    const request = requestService.getStoredRequest(requestId);
    validateFirstRoundRequest(request);
    if (calculateRequestHash(request) !== request.requestHash) {
      throw new ConflictError('Stored V1 requestHash could not be reproduced.');
    }
    if (calculateBindingFixtureHash(binding.fixture) !== binding.bindingFixtureHash) {
      throw new ConflictError('Stored SubjectBinding hash could not be reproduced.');
    }
    const identity = request.identity;
    if (
      identity.userId !== binding.fixture.userId
      || identity.assistantId !== binding.fixture.assistantId
      || identity.subjectId !== binding.fixture.subjectId
      || identity.bindingId !== binding.fixture.bindingId
      || identity.bindingVersion !== binding.fixture.bindingVersion
    ) {
      throw new ConflictError('Stored V1 request no longer matches its SubjectBinding.');
    }
    return {
      request,
      canonicalBody: canonicalizeJson(request),
    };
  }

  function ensureOutbox(request) {
    return runInTransaction(() => deliveryRepository.ensureOutbox({
      requestId: request.requestId,
      requestHash: request.requestHash,
      createdAt: timestamp(clock),
    }));
  }

  function transition(outbox, status, details = {}) {
    const updated = runInTransaction(() => deliveryRepository.transitionOutbox({
      requestId: outbox.requestId,
      expectedStatus: outbox.status,
      status,
      operationId: details.operationId ?? null,
      attemptStartedAt: details.attemptStartedAt ?? null,
      attemptCompletedAt: details.attemptCompletedAt ?? null,
      httpStatus: details.httpStatus ?? null,
      transportResult: details.transportResult ?? null,
      errorCode: details.errorCode ?? null,
      recoveryReason: details.recoveryReason ?? null,
      updatedAt: timestamp(clock),
    }));
    if (!updated) throw new ConflictError('Continuity delivery outbox changed concurrently.');
    return updated;
  }

  function startAttempt(requestId, operationType) {
    return runInTransaction(() => deliveryRepository.startAttempt({
      attemptId: idFactory(),
      requestId,
      operationType,
      startedAt: timestamp(clock),
    }));
  }

  function finishAttempt(attempt, details) {
    return runInTransaction(() => deliveryRepository.finishAttempt({
      attemptId: attempt.attemptId,
      completedAt: timestamp(clock),
      outcome: details.outcome,
      httpStatus: details.httpStatus ?? null,
      operationId: details.operationId ?? null,
      errorCode: details.errorCode ?? null,
      recoveryReason: details.recoveryReason ?? null,
    }));
  }

  function operationMatches(outbox, operationId) {
    return outbox.operationId === null || outbox.operationId === operationId;
  }

  function quarantine(outbox, reason, details = {}) {
    if (outbox.status === 'completed' || outbox.status === 'quarantined') return outbox;
    return transition(outbox, 'quarantined', {
      operationId: details.operationId ?? null,
      attemptCompletedAt: details.attemptCompletedAt ?? null,
      httpStatus: details.httpStatus ?? null,
      transportResult: details.transportResult ?? 'quarantined',
      errorCode: reason,
      recoveryReason: details.recoveryReason ?? null,
    });
  }

  function completeFromV2(outbox, outcome, details = {}) {
    let current = outbox;
    if (['completed', 'terminal_error'].includes(outcome.processingStage)) {
      if (current.status === 'outcome_unknown') {
        current = transition(current, 'completed', {
          operationId: details.operationId ?? null,
          transportResult: 'local_result_recovered',
          recoveryReason: 'v2_result_already_persisted',
        });
      } else {
        if (current.status !== 'result_received') {
          current = transition(current, 'result_received', {
            operationId: details.operationId ?? null,
            httpStatus: details.httpStatus ?? null,
            transportResult: details.transportResult ?? 'result_received',
          });
        }
        current = transition(current, 'completed', {
          operationId: details.operationId ?? null,
          httpStatus: details.httpStatus ?? null,
          transportResult: 'completed',
        });
      }
      return publicOutcome(current, outcome);
    }
    current = quarantine(current, outcome.reasonCode ?? 'v2_result_not_publishable', {
      operationId: details.operationId ?? null,
      httpStatus: details.httpStatus ?? null,
    });
    return publicOutcome(current, outcome);
  }

  function recoverLocalResult(outbox) {
    const existing = resultService.recoverStoredResult(outbox.requestId);
    if (!existing) return null;
    capabilityService?.reconcileEngineTerminal(outbox.requestId, 'completed');
    return completeFromV2(outbox, existing, { operationId: existing.envelope.operationId });
  }

  async function handleCapabilityRequired(outbox, original, envelope, details = {}) {
    if (!capabilityService) {
      return publicOutcome(quarantine(outbox, 'capability_service_unavailable', {
        operationId: envelope?.operationId ?? null,
        httpStatus: details.httpStatus ?? null,
      }));
    }
    let current = outbox;
    if (current.status !== 'outcome_unknown') {
      current = transition(current, 'outcome_unknown', {
        operationId: envelope.operationId,
        attemptCompletedAt: timestamp(clock),
        httpStatus: details.httpStatus ?? null,
        transportResult: 'capability_required',
        recoveryReason: 'waiting_for_capability_result',
      });
    }
    const capabilityOutcome = await capabilityService.handleCapabilityRequired(
      envelope,
      original.request,
    );
    if (capabilityOutcome.status === 'completed') {
      let result;
      try {
        result = resultService.receiveResult(current.requestId, capabilityOutcome.envelope);
      } catch (error) {
        current = quarantine(current, 'engine_result_rejected', {
          operationId: envelope.operationId,
          httpStatus: details.httpStatus ?? null,
        });
        throw error;
      }
      return completeFromV2(current, result, {
        operationId: envelope.operationId,
        httpStatus: details.httpStatus ?? null,
        transportResult: 'capability_completed',
      });
    }
    if (capabilityOutcome.status === 'capability_failed') {
      current = transition(current, 'completed', {
        operationId: envelope.operationId,
        httpStatus: details.httpStatus ?? null,
        transportResult: 'capability_failed',
        errorCode: capabilityOutcome.envelope.errorCode,
      });
      return publicOutcome(current);
    }
    if (capabilityOutcome.status === 'quarantined') {
      current = quarantine(current, 'capability_flow_quarantined', {
        operationId: envelope.operationId,
        httpStatus: details.httpStatus ?? null,
      });
    }
    return publicOutcome(current);
  }

  async function postOriginal(outbox, original, recoveryReason = null) {
    let current = transition(outbox, 'in_flight', {
      recoveryReason,
      transportResult: 'post_started',
    });
    const attempt = startAttempt(current.requestId, 'post');
    try {
      const response = await transport.submitCanonicalRequest(original.canonicalBody);
      healthStatus = 'ready';
      const envelope = response.payload;
      const operationId = envelope?.operationId ?? null;
      if (operationId !== null && !operationMatches(current, operationId)) {
        finishAttempt(attempt, {
          outcome: 'operation_id_mismatch',
          httpStatus: response.statusCode,
          operationId,
          errorCode: 'operation_id_mismatch',
        });
        current = quarantine(current, 'operation_id_mismatch', {
          httpStatus: response.statusCode,
        });
        return publicOutcome(current);
      }
      finishAttempt(attempt, {
        outcome: 'response_received',
        httpStatus: response.statusCode,
        operationId,
        recoveryReason,
      });
      if (envelope?.status === 'capability_required') {
        return handleCapabilityRequired(current, original, envelope, {
          httpStatus: response.statusCode,
        });
      }
      current = transition(current, 'result_received', {
        operationId,
        attemptCompletedAt: timestamp(clock),
        httpStatus: response.statusCode,
        transportResult: 'response_received',
        recoveryReason,
      });
      let result;
      try {
        result = resultService.receiveResult(current.requestId, envelope);
      } catch (error) {
        current = quarantine(current, 'engine_result_rejected', {
          operationId,
          httpStatus: response.statusCode,
        });
        throw error;
      }
      return completeFromV2(current, result, {
        operationId,
        httpStatus: response.statusCode,
      });
    } catch (error) {
      if (!(error instanceof ContinuityTransportError)) throw error;
      finishAttempt(attempt, {
        outcome: error.transportCode,
        httpStatus: error.httpStatus,
        errorCode: error.transportCode,
        recoveryReason,
      });
      const terminal = TERMINAL_TRANSPORT_CODES.has(error.transportCode);
      const nextStatus = terminal
        ? 'quarantined'
        : error.outcomeUnknown ? 'outcome_unknown' : 'pending';
      current = transition(current, nextStatus, {
        attemptCompletedAt: timestamp(clock),
        httpStatus: error.httpStatus,
        transportResult: 'transport_failure',
        errorCode: error.transportCode,
        recoveryReason,
      });
      healthStatus = 'degraded';
      logger.error?.('[vio-live-backend] continuity transport failed', {
        requestId: current.requestId,
        transportCode: error.transportCode,
      });
      return publicOutcome(current);
    }
  }

  async function queryUnknown(outbox, original) {
    const attempt = startAttempt(outbox.requestId, 'query');
    try {
      const response = await transport.queryRequest(outbox.requestId);
      healthStatus = 'ready';
      if (response.kind === 'not_found') {
        finishAttempt(attempt, {
          outcome: 'query_not_found',
          httpStatus: 404,
          recoveryReason: 'not_found',
        });
        return postOriginal(outbox, original, 'not_found');
      }
      if (response.payload?.status === 'capability_required') {
        const operationId = response.payload.operationId ?? null;
        if (!operationMatches(outbox, operationId)) {
          finishAttempt(attempt, {
            outcome: 'operation_id_mismatch',
            httpStatus: response.statusCode,
            operationId,
            errorCode: 'operation_id_mismatch',
          });
          return publicOutcome(quarantine(outbox, 'operation_id_mismatch', {
            httpStatus: response.statusCode,
          }));
        }
        finishAttempt(attempt, {
          outcome: 'query_capability_required',
          httpStatus: response.statusCode,
          operationId,
          recoveryReason: 'capability_required',
        });
        return handleCapabilityRequired(outbox, original, response.payload, {
          httpStatus: response.statusCode,
        });
      }
      if (response.payload?.status === 'capability_failed') {
        try {
          capabilityService?.reconcileEngineTerminal(outbox.requestId, response.payload);
        } catch (error) {
          finishAttempt(attempt, {
            outcome: 'query_rejected',
            httpStatus: response.statusCode,
            operationId: response.payload.operationId ?? null,
            errorCode: error?.code ?? 'capability_failed_invalid',
          });
          return publicOutcome(quarantine(outbox, 'capability_failed_invalid', {
            operationId: response.payload.operationId ?? null,
            httpStatus: response.statusCode,
          }));
        }
        finishAttempt(attempt, {
          outcome: 'query_capability_failed',
          httpStatus: response.statusCode,
          operationId: response.payload.operationId ?? null,
          recoveryReason: 'capability_failed',
        });
        const current = transition(outbox, 'completed', {
          operationId: response.payload.operationId ?? null,
          httpStatus: response.statusCode,
          transportResult: 'query_capability_failed',
          errorCode: response.payload.errorCode ?? 'capability_failed',
        });
        return publicOutcome(current);
      }
      let query;
      try {
        query = validateQueryEnvelope(response.payload, original.request);
      } catch (error) {
        finishAttempt(attempt, {
          outcome: 'query_rejected',
          httpStatus: response.statusCode,
          errorCode: error instanceof ConflictError
            ? 'query_identity_mismatch'
            : 'query_envelope_invalid',
        });
        const current = quarantine(outbox, error instanceof ConflictError
          ? 'query_identity_mismatch'
          : 'query_envelope_invalid', {
          httpStatus: response.statusCode,
        });
        return publicOutcome(current);
      }
      if (!operationMatches(outbox, query.operationId)) {
        finishAttempt(attempt, {
          outcome: 'operation_id_mismatch',
          httpStatus: response.statusCode,
          operationId: query.operationId,
          errorCode: 'operation_id_mismatch',
        });
        return publicOutcome(quarantine(outbox, 'operation_id_mismatch', {
          httpStatus: response.statusCode,
        }));
      }
      if (query.status === 'recovery_required') {
        finishAttempt(attempt, {
          outcome: 'query_recovery_required',
          httpStatus: response.statusCode,
          operationId: query.operationId,
          recoveryReason: 'recovery_required',
        });
        const current = transition(outbox, 'outcome_unknown', {
          operationId: query.operationId,
          attemptCompletedAt: timestamp(clock),
          httpStatus: response.statusCode,
          transportResult: 'query_recovery_required',
          recoveryReason: 'recovery_required',
        });
        return postOriginal(current, original, 'recovery_required');
      }
      finishAttempt(attempt, {
        outcome: 'query_completed',
        httpStatus: response.statusCode,
        operationId: query.operationId,
        recoveryReason: 'completed',
      });
      capabilityService?.reconcileEngineTerminal(outbox.requestId, 'completed');
      let current = transition(outbox, 'result_received', {
        operationId: query.operationId,
        attemptCompletedAt: timestamp(clock),
        httpStatus: response.statusCode,
        transportResult: 'query_completed',
        recoveryReason: 'completed',
      });
      let result;
      try {
        result = resultService.receiveResult(current.requestId, query.result);
      } catch (error) {
        current = quarantine(current, 'engine_result_rejected', {
          operationId: query.operationId,
          httpStatus: response.statusCode,
        });
        throw error;
      }
      return completeFromV2(current, result, {
        operationId: query.operationId,
        httpStatus: response.statusCode,
        transportResult: 'query_completed',
      });
    } catch (error) {
      if (!(error instanceof ContinuityTransportError)) throw error;
      finishAttempt(attempt, {
        outcome: error.transportCode,
        httpStatus: error.httpStatus,
        errorCode: error.transportCode,
      });
      const current = transition(outbox, 'outcome_unknown', {
        attemptCompletedAt: timestamp(clock),
        httpStatus: error.httpStatus,
        transportResult: 'query_failure',
        errorCode: error.transportCode,
        recoveryReason: 'query_failed',
      });
      healthStatus = 'degraded';
      return publicOutcome(current);
    }
  }

  async function submitStoredRequest(requestId) {
    const normalized = requireString(requestId, 'requestId', { maxLength: 128 });
    const original = loadOriginalRequest(normalized);
    let outbox = ensureOutbox(original.request);
    if (outbox.status === 'completed' || outbox.status === 'quarantined') {
      return publicOutcome(outbox, resultService.getStoredResult(normalized));
    }
    const local = recoverLocalResult(outbox);
    if (local) return local;
    outbox = deliveryRepository.findOutbox(normalized);
    if (outbox.status === 'in_flight') {
      outbox = transition(outbox, 'outcome_unknown', {
        transportResult: 'startup_in_flight_recovery',
        recoveryReason: 'process_restart',
      });
    }
    if (outbox.status === 'outcome_unknown') return queryUnknown(outbox, original);
    if (outbox.status === 'pending') return postOriginal(outbox, original);
    throw new ConflictError('Continuity delivery outbox is not recoverable.');
  }

  async function resumeCapability(capabilityRequestId, resume = {}) {
    if (!capabilityService) throw new ValidationError('Continuity capability service is unavailable.');
    const record = capabilityService.getRequest(capabilityRequestId);
    if (!record) throw new ValidationError('Continuity CapabilityRequest was not found.');
    let outbox = deliveryRepository.findOutbox(record.requestId);
    if (!outbox || !operationMatches(outbox, record.operationId)) {
      throw new ConflictError('Original interaction outbox does not match CapabilityRequest.');
    }
    const outcome = await capabilityService.resumeCapability(capabilityRequestId, resume);
    if (outcome.status === 'completed') {
      const result = resultService.receiveResult(record.requestId, outcome.envelope);
      return completeFromV2(outbox, result, {
        operationId: record.operationId,
        transportResult: 'capability_completed',
      });
    }
    if (outcome.status === 'capability_failed') {
      outbox = transition(outbox, 'completed', {
        operationId: record.operationId,
        transportResult: 'capability_failed',
        errorCode: outcome.envelope.errorCode,
      });
      return publicOutcome(outbox);
    }
    if (outcome.status === 'quarantined') {
      outbox = quarantine(outbox, 'capability_flow_quarantined', {
        operationId: record.operationId,
      });
    }
    return publicOutcome(outbox);
  }

  async function initialize() {
    let recovered = 0;
    for (const outbox of deliveryRepository.listRecoverable()) {
      if (recoverLocalResult(outbox)) recovered += 1;
    }
    let ready = false;
    try {
      ready = await transport.checkReady();
    } catch {
      ready = false;
    }
    healthStatus = ready ? 'ready' : 'degraded';
    if (!ready) return { status: healthStatus, recovered };
    for (const entry of deliveryRepository.listRecoverable()) {
      try {
        await submitStoredRequest(entry.requestId);
        recovered += 1;
      } catch (error) {
        healthStatus = 'degraded';
        logger.error?.('[vio-live-backend] continuity startup recovery failed', {
          requestId: entry.requestId,
          errorCode: error?.code ?? 'internal_error',
        });
      }
    }
    return { status: healthStatus, recovered };
  }

  return Object.freeze({
    enabled: true,
    initialize,
    submitStoredRequest,
    resumeCapability,
    getHealthStatus: () => healthStatus,
    getOutbox(requestId) {
      return deliveryRepository.findOutbox(requireString(requestId, 'requestId', {
        maxLength: 128,
      }));
    },
    listAttempts(requestId) {
      return deliveryRepository.listAttempts(requireString(requestId, 'requestId', {
        maxLength: 128,
      }));
    },
  });
}
