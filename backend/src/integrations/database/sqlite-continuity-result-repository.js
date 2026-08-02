import { ConflictError } from '../../core/errors.js';

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

function parseNullableJson(value) {
  return value === null ? null : JSON.parse(value);
}

function mapResult(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    requestHash: row.request_hash,
    envelopeHash: row.envelope_hash,
    envelopeType: row.envelope_type,
    engineRequestId: row.engine_request_id,
    engineRequestHash: row.engine_request_hash,
    operationId: row.operation_id,
    status: row.status,
    responseId: row.response_id,
    envelope: JSON.parse(row.envelope_json),
    response: parseNullableJson(row.response_json),
    stateProjection: parseNullableJson(row.state_projection_json),
    error: parseNullableJson(row.error_json),
    consumedObservationIds: parseNullableJson(row.consumed_observation_ids_json),
    completedAt: row.completed_at,
    receiveStatus: row.receive_status,
    validationStatus: row.validation_status,
    saveStatus: row.save_status,
    processingStage: row.processing_stage,
    publicationStatus: row.publication_status,
    reconciliationStatus: row.reconciliation_status,
    disposition: row.disposition,
    reasonCode: row.reason_code,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
  };
}

function mapProjection(row) {
  if (!row) return null;
  return {
    subjectId: row.subject_id,
    currentRevision: row.current_revision,
    bindingId: row.binding_id,
    bindingVersion: row.binding_version,
    schemaVersion: row.schema_version,
    snapshot: JSON.parse(row.snapshot_json),
    stateHash: row.state_hash,
    contentHash: row.content_hash,
    receiveStatus: row.receive_status,
    firstCompletedAt: row.first_completed_at,
    createdAt: row.created_at,
  };
}

function mapReceipt(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    operationId: row.operation_id,
    responseId: row.response_id,
    subjectId: row.subject_id,
    currentRevision: row.current_revision,
    previousRevision: row.previous_revision,
    changed: row.changed === 1,
    engineUpdateId: row.engine_update_id,
    completedAt: row.completed_at,
    receivedAt: row.received_at,
  };
}

function mapHead(row) {
  if (!row) return null;
  return {
    subjectId: row.subject_id,
    bindingId: row.binding_id,
    bindingVersion: row.binding_version,
    currentRevision: row.current_revision,
    stateHash: row.state_hash,
    contentHash: row.content_hash,
    currentRequestId: row.current_request_id,
    updatedAt: row.updated_at,
  };
}

const resultSelection = `
  SELECT
    request_id,
    request_hash,
    envelope_hash,
    envelope_type,
    engine_request_id,
    engine_request_hash,
    operation_id,
    status,
    response_id,
    envelope_json,
    response_json,
    state_projection_json,
    error_json,
    consumed_observation_ids_json,
    completed_at,
    receive_status,
    validation_status,
    save_status,
    processing_stage,
    publication_status,
    reconciliation_status,
    disposition,
    reason_code,
    received_at,
    updated_at
  FROM continuity_first_round_results
`;

export function createSqliteContinuityResultRepository(connection) {
  const findResultByRequestStatement = connection.prepare(`
    ${resultSelection}
    WHERE request_id = ?
  `);
  const findResultByOperationStatement = connection.prepare(`
    ${resultSelection}
    WHERE operation_id = ?
  `);
  const findResultByResponseStatement = connection.prepare(`
    ${resultSelection}
    WHERE response_id = ?
  `);
  const insertResultStatement = connection.prepare(`
    INSERT INTO continuity_first_round_results (
      request_id,
      request_hash,
      envelope_hash,
      envelope_type,
      engine_request_id,
      engine_request_hash,
      operation_id,
      status,
      response_id,
      envelope_json,
      response_json,
      state_projection_json,
      error_json,
      consumed_observation_ids_json,
      completed_at,
      receive_status,
      validation_status,
      save_status,
      processing_stage,
      publication_status,
      reconciliation_status,
      disposition,
      reason_code,
      received_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateResultStateStatement = connection.prepare(`
    UPDATE continuity_first_round_results
    SET
      processing_stage = ?,
      reconciliation_status = ?,
      disposition = ?,
      reason_code = ?,
      updated_at = ?
    WHERE request_id = ? AND processing_stage = ?
  `);
  const findProjectionStatement = connection.prepare(`
    SELECT
      subject_id,
      current_revision,
      binding_id,
      binding_version,
      schema_version,
      snapshot_json,
      state_hash,
      content_hash,
      receive_status,
      first_completed_at,
      created_at
    FROM continuity_engine_state_projection_versions
    WHERE subject_id = ? AND current_revision = ?
  `);
  const insertProjectionStatement = connection.prepare(`
    INSERT INTO continuity_engine_state_projection_versions (
      subject_id,
      current_revision,
      binding_id,
      binding_version,
      schema_version,
      snapshot_json,
      state_hash,
      content_hash,
      receive_status,
      first_completed_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findReceiptByRequestStatement = connection.prepare(`
    SELECT
      request_id,
      operation_id,
      response_id,
      subject_id,
      current_revision,
      previous_revision,
      changed,
      engine_update_id,
      completed_at,
      received_at
    FROM continuity_engine_state_projection_receipts
    WHERE request_id = ?
  `);
  const findReceiptByEngineUpdateStatement = connection.prepare(`
    SELECT
      request_id,
      operation_id,
      response_id,
      subject_id,
      current_revision,
      previous_revision,
      changed,
      engine_update_id,
      completed_at,
      received_at
    FROM continuity_engine_state_projection_receipts
    WHERE engine_update_id = ?
  `);
  const insertReceiptStatement = connection.prepare(`
    INSERT INTO continuity_engine_state_projection_receipts (
      request_id,
      operation_id,
      response_id,
      subject_id,
      current_revision,
      previous_revision,
      changed,
      engine_update_id,
      completed_at,
      received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findHeadStatement = connection.prepare(`
    SELECT
      subject_id,
      binding_id,
      binding_version,
      current_revision,
      state_hash,
      content_hash,
      current_request_id,
      updated_at
    FROM continuity_engine_state_projection_heads
    WHERE subject_id = ?
  `);
  const insertHeadStatement = connection.prepare(`
    INSERT INTO continuity_engine_state_projection_heads (
      subject_id,
      binding_id,
      binding_version,
      current_revision,
      state_hash,
      content_hash,
      current_request_id,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const advanceHeadStatement = connection.prepare(`
    UPDATE continuity_engine_state_projection_heads
    SET
      current_revision = ?,
      state_hash = ?,
      content_hash = ?,
      current_request_id = ?,
      updated_at = ?
    WHERE subject_id = ?
      AND binding_id = ?
      AND binding_version = ?
      AND current_revision = ?
  `);
  const insertIncidentStatement = connection.prepare(`
    INSERT INTO continuity_first_round_result_incidents (
      request_id,
      candidate_envelope_hash,
      disposition,
      reason_code,
      recorded_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (request_id, candidate_envelope_hash, reason_code) DO NOTHING
  `);
  const findIncidentsStatement = connection.prepare(`
    SELECT
      incident_id,
      request_id,
      candidate_envelope_hash,
      disposition,
      reason_code,
      recorded_at
    FROM continuity_first_round_result_incidents
    WHERE request_id = ?
    ORDER BY incident_id
  `);

  function constraint(operation, message) {
    try {
      return operation();
    } catch (error) {
      if (isConstraintError(error)) throw new ConflictError(message);
      throw error;
    }
  }

  return Object.freeze({
    findResultByRequestId(requestId) {
      return mapResult(findResultByRequestStatement.get(requestId));
    },
    findResultByOperationId(operationId) {
      return mapResult(findResultByOperationStatement.get(operationId));
    },
    findResultByResponseId(responseId) {
      return mapResult(findResultByResponseStatement.get(responseId));
    },
    insertResult(record) {
      constraint(() => insertResultStatement.run(
        record.requestId,
        record.requestHash,
        record.envelopeHash,
        record.envelopeType,
        record.engineRequestId,
        record.engineRequestHash,
        record.operationId,
        record.status,
        record.responseId,
        record.envelopeJson,
        record.responseJson,
        record.stateProjectionJson,
        record.errorJson,
        record.consumedObservationIdsJson,
        record.completedAt,
        record.receiveStatus,
        record.validationStatus,
        record.saveStatus,
        record.processingStage,
        record.publicationStatus,
        record.reconciliationStatus,
        record.disposition,
        record.reasonCode,
        record.receivedAt,
        record.updatedAt,
      ), 'First-round Engine result conflicts with the persisted ledger.');
      return mapResult(findResultByRequestStatement.get(record.requestId));
    },
    transitionResult({
      requestId,
      expectedStage,
      processingStage,
      reconciliationStatus = 'none',
      disposition = 'none',
      reasonCode = null,
      updatedAt,
    }) {
      const update = constraint(() => updateResultStateStatement.run(
        processingStage,
        reconciliationStatus,
        disposition,
        reasonCode,
        updatedAt,
        requestId,
        expectedStage,
      ), 'First-round result stage transition conflicts with persisted state.');
      if (update.changes !== 1) return null;
      return mapResult(findResultByRequestStatement.get(requestId));
    },
    findProjection(subjectId, currentRevision) {
      return mapProjection(findProjectionStatement.get(subjectId, currentRevision));
    },
    insertProjection(record) {
      constraint(() => insertProjectionStatement.run(
        record.subjectId,
        record.currentRevision,
        record.bindingId,
        record.bindingVersion,
        record.schemaVersion,
        record.snapshotJson,
        record.stateHash,
        record.contentHash,
        record.receiveStatus,
        record.firstCompletedAt,
        record.createdAt,
      ), 'Engine projection conflicts with an immutable subject revision.');
      return mapProjection(findProjectionStatement.get(
        record.subjectId,
        record.currentRevision,
      ));
    },
    findReceiptByRequestId(requestId) {
      return mapReceipt(findReceiptByRequestStatement.get(requestId));
    },
    findReceiptByEngineUpdateId(engineUpdateId) {
      return mapReceipt(findReceiptByEngineUpdateStatement.get(engineUpdateId));
    },
    insertReceipt(record) {
      constraint(() => insertReceiptStatement.run(
        record.requestId,
        record.operationId,
        record.responseId,
        record.subjectId,
        record.currentRevision,
        record.previousRevision,
        record.changed ? 1 : 0,
        record.engineUpdateId,
        record.completedAt,
        record.receivedAt,
      ), 'Engine projection receipt conflicts with a persisted result.');
      return mapReceipt(findReceiptByRequestStatement.get(record.requestId));
    },
    findHead(subjectId) {
      return mapHead(findHeadStatement.get(subjectId));
    },
    insertHead(record) {
      constraint(() => insertHeadStatement.run(
        record.subjectId,
        record.bindingId,
        record.bindingVersion,
        record.currentRevision,
        record.stateHash,
        record.contentHash,
        record.currentRequestId,
        record.updatedAt,
      ), 'Engine projection head could not be initialized.');
      return mapHead(findHeadStatement.get(record.subjectId));
    },
    advanceHead(record) {
      const update = constraint(() => advanceHeadStatement.run(
        record.currentRevision,
        record.stateHash,
        record.contentHash,
        record.currentRequestId,
        record.updatedAt,
        record.subjectId,
        record.bindingId,
        record.bindingVersion,
        record.expectedRevision,
      ), 'Engine projection head update violates continuity.');
      if (update.changes !== 1) return null;
      return mapHead(findHeadStatement.get(record.subjectId));
    },
    recordIncident(record) {
      insertIncidentStatement.run(
        record.requestId,
        record.candidateEnvelopeHash,
        record.disposition,
        record.reasonCode,
        record.recordedAt,
      );
    },
    findIncidents(requestId) {
      return findIncidentsStatement.all(requestId).map((row) => ({
        incidentId: row.incident_id,
        requestId: row.request_id,
        candidateEnvelopeHash: row.candidate_envelope_hash,
        disposition: row.disposition,
        reasonCode: row.reason_code,
        recordedAt: row.recorded_at,
      }));
    },
  });
}
