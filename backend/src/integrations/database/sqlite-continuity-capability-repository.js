import { ConflictError } from '../../core/errors.js';

function constraint(operation, message) {
  try { return operation(); } catch (error) {
    if (String(error?.code ?? '').startsWith('ERR_SQLITE_CONSTRAINT')) throw new ConflictError(message);
    throw error;
  }
}

function parse(value) { return value === null || value === undefined ? null : JSON.parse(value); }
function mapRequest(row) {
  if (!row) return null;
  return {
    capabilityRequestId: row.capability_request_id,
    requestId: row.request_id,
    requestHash: row.request_hash,
    operationId: row.operation_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    engineSubjectId: row.engine_subject_id,
    bindingId: row.binding_id,
    bindingVersion: row.binding_version,
    originatingSessionId: row.originating_session_id,
    inputHash: row.input_hash,
    idempotencyKey: row.idempotency_key,
    riskLevel: row.risk_level,
    deadlineAt: row.deadline_at,
    request: parse(row.request_json),
    envelope: parse(row.envelope_json),
    status: row.status,
    createdAt: row.created_at,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
  };
}
function mapExecution(row) {
  if (!row) return null;
  return {
    executionId: row.execution_id,
    capabilityRequestId: row.capability_request_id,
    executionNumber: row.execution_number,
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    providerCallMayHaveStarted: row.provider_call_may_have_started === 1,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
  };
}
function mapUsage(row) {
  if (!row) return null;
  return {
    usageLedgerEntryId: row.usage_ledger_entry_id,
    capabilityRequestId: row.capability_request_id,
    executionId: row.execution_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    budgetSessionId: row.budget_session_id,
    modelId: row.model_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    usageStatus: row.usage_status,
    costStatus: row.cost_status,
    costAmountMicros: row.cost_amount_micros,
    costCurrency: row.cost_currency,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  };
}
function mapResult(row) {
  if (!row) return null;
  return {
    capabilityResultId: row.capability_result_id,
    capabilityRequestId: row.capability_request_id,
    executionId: row.execution_id,
    requestId: row.request_id,
    requestHash: row.request_hash,
    operationId: row.operation_id,
    status: row.status,
    contentHash: row.content_hash,
    resultHash: row.result_hash,
    result: parse(row.result_json),
    usageLedgerEntryId: row.usage_ledger_entry_id,
    createdAt: row.created_at,
  };
}
function mapOutbox(row) {
  if (!row) return null;
  return {
    capabilityResultId: row.capability_result_id,
    requestId: row.request_id,
    status: row.status,
    attemptCount: row.attempt_count,
    lastHttpStatus: row.last_http_status,
    lastErrorCode: row.last_error_code,
    recoveryReason: row.recovery_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSqliteContinuityCapabilityRepository(connection) {
  const requestSelect = 'SELECT * FROM continuity_capability_requests';
  const executionSelect = 'SELECT * FROM continuity_capability_model_executions';
  const usageSelect = 'SELECT * FROM continuity_capability_usage_facts';
  const resultSelect = 'SELECT * FROM continuity_capability_results';
  const outboxSelect = 'SELECT * FROM continuity_capability_result_outbox';
  const findRequest = connection.prepare(`${requestSelect} WHERE capability_request_id = ?`);
  const findRequestByInteraction = connection.prepare(`${requestSelect} WHERE request_id = ?`);
  const insertRequest = connection.prepare(`
    INSERT INTO continuity_capability_requests (
      capability_request_id, request_id, request_hash, operation_id, user_id, assistant_id,
      engine_subject_id, binding_id, binding_version, originating_session_id, input_hash,
      idempotency_key, risk_level, deadline_at, request_json, envelope_json, status,
      created_at, recorded_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)
  `);
  const updateRequestStatus = connection.prepare(`
    UPDATE continuity_capability_requests SET status = ?, updated_at = ?
    WHERE capability_request_id = ? AND status NOT IN ('completed','failed','quarantined')
  `);
  const insertDecision = connection.prepare(`
    INSERT INTO continuity_capability_decisions (
      decision_id, capability_request_id, model_id, provider_id, permission_decision,
      security_decision, budget_decision, estimated_tokens, confirmation_id, audit_ref,
      decision_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertExecution = connection.prepare(`
    INSERT INTO continuity_capability_model_executions (
      execution_id, capability_request_id, execution_number, provider_id, model_id, status,
      provider_call_may_have_started, started_at, completed_at, error_code
    ) VALUES (?, ?, ?, ?, ?, 'prepared', 0, ?, NULL, NULL)
  `);
  const findExecution = connection.prepare(`${executionSelect} WHERE execution_id = ?`);
  const findLatestExecutionByRequest = connection.prepare(`${executionSelect} WHERE capability_request_id = ? ORDER BY execution_number DESC LIMIT 1`);
  const listExecutionsByRequest = connection.prepare(`${executionSelect} WHERE capability_request_id = ? ORDER BY execution_number, execution_id`);
  const nextExecutionNumber = connection.prepare('SELECT COALESCE(MAX(execution_number),0)+1 value FROM continuity_capability_model_executions WHERE capability_request_id = ?');
  const listAmbiguousExecutions = connection.prepare(`
    SELECT execution.* FROM continuity_capability_model_executions execution
    LEFT JOIN continuity_capability_results result
      ON result.execution_id = execution.execution_id
    WHERE execution.status = 'in_flight' AND result.capability_result_id IS NULL
    ORDER BY execution.started_at, execution.execution_id
  `);
  const markExecutionInFlight = connection.prepare(`
    UPDATE continuity_capability_model_executions
    SET status = 'in_flight', provider_call_may_have_started = 1
    WHERE execution_id = ? AND status = 'prepared'
  `);
  const completeExecution = connection.prepare(`
    UPDATE continuity_capability_model_executions
    SET status = ?, completed_at = ?, error_code = ?
    WHERE execution_id = ? AND status IN ('prepared','in_flight')
  `);
  const insertUsage = connection.prepare(`
    INSERT INTO continuity_capability_usage_facts (
      usage_ledger_entry_id, capability_request_id, execution_id, user_id, subject_id, budget_session_id,
      model_id, input_tokens, output_tokens, total_tokens, usage_status, cost_status,
      cost_amount_micros, cost_currency, occurred_at, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findUsage = connection.prepare(`${usageSelect} WHERE execution_id = ?`);
  const listUsageByRequest = connection.prepare(`${usageSelect} WHERE capability_request_id = ? ORDER BY occurred_at, usage_ledger_entry_id`);
  const insertResult = connection.prepare(`
    INSERT INTO continuity_capability_results (
      capability_result_id, capability_request_id, execution_id, request_id, request_hash, operation_id,
      status, content_hash, result_hash, result_json, usage_ledger_entry_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findResult = connection.prepare(`${resultSelect} WHERE capability_result_id = ?`);
  const findResultByRequest = connection.prepare(`
    SELECT result.* FROM continuity_capability_results result
    JOIN continuity_capability_model_executions execution
      ON execution.execution_id = result.execution_id
    WHERE result.capability_request_id = ?
    ORDER BY execution.execution_number DESC LIMIT 1
  `);
  const listResultsByRequest = connection.prepare(`
    SELECT result.* FROM continuity_capability_results result
    JOIN continuity_capability_model_executions execution
      ON execution.execution_id = result.execution_id
    WHERE result.capability_request_id = ?
    ORDER BY execution.execution_number, result.capability_result_id
  `);
  const insertOutbox = connection.prepare(`
    INSERT INTO continuity_capability_result_outbox (
      capability_result_id, request_id, status, attempt_count, created_at, updated_at
    ) VALUES (?, ?, 'pending', 0, ?, ?) ON CONFLICT(capability_result_id) DO NOTHING
  `);
  const findOutbox = connection.prepare(`${outboxSelect} WHERE capability_result_id = ?`);
  const listRecoverable = connection.prepare(`${outboxSelect} WHERE status IN ('pending','in_flight','outcome_unknown') ORDER BY created_at, capability_result_id`);
  const updateOutbox = connection.prepare(`
    UPDATE continuity_capability_result_outbox SET status = ?, last_http_status = ?,
      last_error_code = ?, recovery_reason = ?, updated_at = ?
    WHERE capability_result_id = ? AND status = ?
  `);
  const incrementOutbox = connection.prepare(`UPDATE continuity_capability_result_outbox SET attempt_count=attempt_count+1, updated_at=? WHERE capability_result_id=?`);
  const insertAttempt = connection.prepare(`
    INSERT INTO continuity_capability_result_attempts (
      attempt_id, capability_result_id, attempt_number, operation_type, started_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const finishAttempt = connection.prepare(`UPDATE continuity_capability_result_attempts SET completed_at=?, outcome=?, http_status=?, error_code=? WHERE attempt_id=? AND completed_at IS NULL`);
  const insertIncident = connection.prepare(`
    INSERT INTO continuity_capability_incidents (
      incident_id, capability_request_id, capability_result_id, request_id,
      incident_type, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  return Object.freeze({
    findRequest(id) { return mapRequest(findRequest.get(id)); },
    findRequestByInteraction(id) { return mapRequest(findRequestByInteraction.get(id)); },
    insertRequest(record) {
      return constraint(() => {
        insertRequest.run(
          record.capabilityRequestId, record.requestId, record.requestHash, record.operationId,
          record.userId, record.assistantId, record.engineSubjectId, record.bindingId,
          record.bindingVersion, record.originatingSessionId, record.inputHash,
          record.idempotencyKey, record.riskLevel, record.deadlineAt, record.requestJson,
          record.envelopeJson, record.createdAt, record.recordedAt, record.recordedAt,
        );
        return mapRequest(findRequest.get(record.capabilityRequestId));
      }, 'CapabilityRequest conflicts with an existing immutable inbox fact.');
    },
    updateRequestStatus(id, status, updatedAt) {
      updateRequestStatus.run(status, updatedAt, id);
      return mapRequest(findRequest.get(id));
    },
    insertDecision(record) {
      return constraint(() => insertDecision.run(
        record.decisionId, record.capabilityRequestId, record.modelId, record.providerId,
        record.permissionDecision, record.securityDecision, record.budgetDecision,
        record.estimatedTokens, record.confirmationId, record.auditRef,
        record.decisionJson, record.createdAt,
      ), 'Capability decision fact conflicts with existing history.');
    },
    findExecution(id) { return mapExecution(findExecution.get(id)); },
    findLatestExecutionByRequest(id) { return mapExecution(findLatestExecutionByRequest.get(id)); },
    listExecutionsByRequest(id) { return listExecutionsByRequest.all(id).map(mapExecution); },
    listAmbiguousExecutions() { return listAmbiguousExecutions.all().map(mapExecution); },
    insertExecution(record) {
      constraint(() => insertExecution.run(
        record.executionId, record.capabilityRequestId,
        record.executionNumber ?? nextExecutionNumber.get(record.capabilityRequestId).value,
        record.providerId,
        record.modelId, record.startedAt,
      ), 'CapabilityRequest cannot start this model execution.');
      return mapExecution(findExecution.get(record.executionId));
    },
    markExecutionInFlight(id) {
      markExecutionInFlight.run(id);
      return mapExecution(findExecution.get(id));
    },
    completeExecution(id, status, completedAt, errorCode) {
      completeExecution.run(status, completedAt, errorCode, id);
      return mapExecution(findExecution.get(id));
    },
    findUsage(id) { return mapUsage(findUsage.get(id)); },
    listUsageByRequest(id) { return listUsageByRequest.all(id).map(mapUsage); },
    insertUsage(record) {
      constraint(() => insertUsage.run(
        record.usageLedgerEntryId, record.capabilityRequestId, record.executionId, record.userId,
        record.subjectId, record.budgetSessionId, record.modelId, record.inputTokens,
        record.outputTokens, record.totalTokens, record.usageStatus, record.costStatus,
        record.costAmountMicros, record.costCurrency, record.occurredAt, record.recordedAt,
      ), 'Capability usage fact conflicts with an existing immutable fact.');
      return mapUsage(findUsage.get(record.executionId));
    },
    findResult(id) { return mapResult(findResult.get(id)); },
    findResultByRequest(id) { return mapResult(findResultByRequest.get(id)); },
    listResultsByRequest(id) { return listResultsByRequest.all(id).map(mapResult); },
    insertResult(record) {
      const existingById = mapResult(findResult.get(record.capabilityResultId));
      if (existingById) {
        if (existingById.resultHash !== record.resultHash) throw new ConflictError('capabilityResultId is bound to different content.');
        return existingById;
      }
      return constraint(() => {
        insertResult.run(
          record.capabilityResultId, record.capabilityRequestId, record.executionId, record.requestId,
          record.requestHash, record.operationId, record.status, record.contentHash,
          record.resultHash, record.resultJson, record.usageLedgerEntryId, record.createdAt,
        );
        return mapResult(findResult.get(record.capabilityResultId));
      }, 'CapabilityResult conflicts with existing immutable facts.');
    },
    ensureOutbox(resultId, requestId, createdAt) {
      insertOutbox.run(resultId, requestId, createdAt, createdAt);
      return mapOutbox(findOutbox.get(resultId));
    },
    findOutbox(id) { return mapOutbox(findOutbox.get(id)); },
    listRecoverableOutboxes() { return listRecoverable.all().map(mapOutbox); },
    transitionOutbox(id, expectedStatus, status, details) {
      const result = constraint(() => updateOutbox.run(
        status, details.httpStatus ?? null, details.errorCode ?? null,
        details.recoveryReason ?? null, details.updatedAt, id, expectedStatus,
      ), 'CapabilityResult outbox transition conflicts with persisted state.');
      return result.changes === 1 ? mapOutbox(findOutbox.get(id)) : null;
    },
    startAttempt(record) {
      const outbox = mapOutbox(findOutbox.get(record.capabilityResultId));
      if (!outbox) throw new ConflictError('CapabilityResult outbox was not found.');
      incrementOutbox.run(record.startedAt, record.capabilityResultId);
      insertAttempt.run(record.attemptId, record.capabilityResultId, outbox.attemptCount + 1, record.operationType, record.startedAt);
    },
    finishAttempt(record) {
      finishAttempt.run(record.completedAt, record.outcome, record.httpStatus ?? null, record.errorCode ?? null, record.attemptId);
    },
    insertIncident(record) {
      insertIncident.run(
        record.incidentId, record.capabilityRequestId ?? null,
        record.capabilityResultId ?? null, record.requestId, record.incidentType,
        record.detailsJson, record.createdAt,
      );
    },
  });
}
