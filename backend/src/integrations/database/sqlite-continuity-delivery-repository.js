import { ConflictError } from '../../core/errors.js';

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

function mapOutbox(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    requestHash: row.request_hash,
    status: row.status,
    operationId: row.operation_id,
    attemptCount: row.attempt_count,
    lastAttemptStartedAt: row.last_attempt_started_at,
    lastAttemptCompletedAt: row.last_attempt_completed_at,
    lastHttpStatus: row.last_http_status,
    lastTransportResult: row.last_transport_result,
    lastErrorCode: row.last_error_code,
    recoveryReason: row.recovery_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttempt(row) {
  if (!row) return null;
  return {
    attemptId: row.attempt_id,
    requestId: row.request_id,
    attemptNumber: row.attempt_number,
    operationType: row.operation_type,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    outcome: row.outcome,
    httpStatus: row.http_status,
    operationId: row.operation_id,
    errorCode: row.error_code,
    recoveryReason: row.recovery_reason,
  };
}

const outboxSelection = `
  SELECT
    request_id,
    request_hash,
    status,
    operation_id,
    attempt_count,
    last_attempt_started_at,
    last_attempt_completed_at,
    last_http_status,
    last_transport_result,
    last_error_code,
    recovery_reason,
    created_at,
    updated_at
  FROM continuity_first_round_delivery_outbox
`;

export function createSqliteContinuityDeliveryRepository(connection) {
  const findOutboxStatement = connection.prepare(`
    ${outboxSelection}
    WHERE request_id = ?
  `);
  const listRecoverableStatement = connection.prepare(`
    ${outboxSelection}
    WHERE status IN ('pending', 'in_flight', 'outcome_unknown', 'result_received')
    ORDER BY created_at, request_id
  `);
  const insertOutboxStatement = connection.prepare(`
    INSERT INTO continuity_first_round_delivery_outbox (
      request_id,
      request_hash,
      status,
      operation_id,
      attempt_count,
      created_at,
      updated_at
    ) VALUES (?, ?, 'pending', NULL, 0, ?, ?)
    ON CONFLICT (request_id) DO NOTHING
  `);
  const transitionOutboxStatement = connection.prepare(`
    UPDATE continuity_first_round_delivery_outbox
    SET
      status = ?,
      operation_id = COALESCE(operation_id, ?),
      last_attempt_started_at = COALESCE(?, last_attempt_started_at),
      last_attempt_completed_at = COALESCE(?, last_attempt_completed_at),
      last_http_status = ?,
      last_transport_result = ?,
      last_error_code = ?,
      recovery_reason = ?,
      updated_at = ?
    WHERE request_id = ? AND status = ?
  `);
  const startAttemptStatement = connection.prepare(`
    INSERT INTO continuity_first_round_delivery_attempts (
      attempt_id,
      request_id,
      attempt_number,
      operation_type,
      started_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const incrementAttemptStatement = connection.prepare(`
    UPDATE continuity_first_round_delivery_outbox
    SET attempt_count = attempt_count + 1,
        last_attempt_started_at = ?,
        updated_at = ?
    WHERE request_id = ?
  `);
  const finishAttemptStatement = connection.prepare(`
    UPDATE continuity_first_round_delivery_attempts
    SET
      completed_at = ?,
      outcome = ?,
      http_status = ?,
      operation_id = ?,
      error_code = ?,
      recovery_reason = ?
    WHERE attempt_id = ? AND completed_at IS NULL
  `);
  const findAttemptStatement = connection.prepare(`
    SELECT
      attempt_id,
      request_id,
      attempt_number,
      operation_type,
      started_at,
      completed_at,
      outcome,
      http_status,
      operation_id,
      error_code,
      recovery_reason
    FROM continuity_first_round_delivery_attempts
    WHERE attempt_id = ?
  `);
  const listAttemptsStatement = connection.prepare(`
    SELECT
      attempt_id,
      request_id,
      attempt_number,
      operation_type,
      started_at,
      completed_at,
      outcome,
      http_status,
      operation_id,
      error_code,
      recovery_reason
    FROM continuity_first_round_delivery_attempts
    WHERE request_id = ?
    ORDER BY attempt_number
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
    findOutbox(requestId) {
      return mapOutbox(findOutboxStatement.get(requestId));
    },
    ensureOutbox({ requestId, requestHash, createdAt }) {
      constraint(
        () => insertOutboxStatement.run(requestId, requestHash, createdAt, createdAt),
        'Continuity delivery outbox conflicts with the immutable V1 request.',
      );
      const outbox = mapOutbox(findOutboxStatement.get(requestId));
      if (!outbox || outbox.requestHash !== requestHash) {
        throw new ConflictError('Continuity delivery outbox requestHash does not match V1.');
      }
      return outbox;
    },
    transitionOutbox({
      requestId,
      expectedStatus,
      status,
      operationId = null,
      attemptStartedAt = null,
      attemptCompletedAt = null,
      httpStatus = null,
      transportResult = null,
      errorCode = null,
      recoveryReason = null,
      updatedAt,
    }) {
      const result = constraint(() => transitionOutboxStatement.run(
        status,
        operationId,
        attemptStartedAt,
        attemptCompletedAt,
        httpStatus,
        transportResult,
        errorCode,
        recoveryReason,
        updatedAt,
        requestId,
        expectedStatus,
      ), 'Continuity delivery outbox transition is invalid.');
      if (result.changes !== 1) return null;
      return mapOutbox(findOutboxStatement.get(requestId));
    },
    startAttempt({ attemptId, requestId, operationType, startedAt }) {
      return constraint(() => {
        const outbox = mapOutbox(findOutboxStatement.get(requestId));
        if (!outbox) throw new ConflictError('Continuity delivery outbox was not found.');
        const attemptNumber = outbox.attemptCount + 1;
        incrementAttemptStatement.run(startedAt, startedAt, requestId);
        startAttemptStatement.run(
          attemptId,
          requestId,
          attemptNumber,
          operationType,
          startedAt,
        );
        return mapAttempt(findAttemptStatement.get(attemptId));
      }, 'Continuity delivery attempt could not be started.');
    },
    finishAttempt({
      attemptId,
      completedAt,
      outcome,
      httpStatus = null,
      operationId = null,
      errorCode = null,
      recoveryReason = null,
    }) {
      const result = constraint(() => finishAttemptStatement.run(
        completedAt,
        outcome,
        httpStatus,
        operationId,
        errorCode,
        recoveryReason,
        attemptId,
      ), 'Continuity delivery attempt completion is invalid.');
      if (result.changes !== 1) return null;
      return mapAttempt(findAttemptStatement.get(attemptId));
    },
    listRecoverable() {
      return listRecoverableStatement.all().map(mapOutbox);
    },
    listAttempts(requestId) {
      return listAttemptsStatement.all(requestId).map(mapAttempt);
    },
  });
}
