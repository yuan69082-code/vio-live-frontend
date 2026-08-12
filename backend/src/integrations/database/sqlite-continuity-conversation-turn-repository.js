import { ConflictError } from '../../core/errors.js';

function isConstraintError(error) {
  return typeof error?.code === 'string'
    && (error.code.startsWith('ERR_SQLITE_CONSTRAINT')
      || error.code.startsWith('SQLITE_CONSTRAINT')
      || /constraint failed/i.test(error.message ?? ''));
}

function mapTurn(row) {
  if (!row) return null;
  return {
    turnId: row.turn_id,
    idempotencyKey: row.idempotency_key,
    inputContentHash: row.input_content_hash,
    userId: row.user_id,
    assistantId: row.assistant_id,
    engineSubjectId: row.engine_subject_id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    userMessageVersionId: row.user_message_version_id,
    sourceEventId: row.source_event_id,
    plannedRequestId: row.planned_request_id,
    requestId: row.request_id,
    observationId: row.observation_id,
    factId: row.fact_id,
    expectedEngineRevision: row.expected_engine_revision,
    capabilityRequestId: row.capability_request_id,
    engineOperationId: row.engine_operation_id,
    engineResponseId: row.engine_response_id,
    subjectMessageId: row.subject_message_id,
    subjectMessageVersionId: row.subject_message_version_id,
    status: row.status,
    confirmationId: row.confirmation_id,
    publicFailureCode: row.public_failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function constraint(operation, message) {
  try {
    return operation();
  } catch (error) {
    if (isConstraintError(error)) throw new ConflictError(message);
    throw error;
  }
}

export function createSqliteContinuityConversationTurnRepository(connection) {
  const selection = 'SELECT * FROM continuity_conversation_turns';
  const findById = connection.prepare(`${selection}
    WHERE user_id = ? AND assistant_id = ? AND conversation_id = ? AND turn_id = ?`);
  const findByIdempotencyKey = connection.prepare(`${selection} WHERE idempotency_key = ?`);
  const findByRequestId = connection.prepare(`${selection} WHERE request_id = ? OR planned_request_id = ?`);
  const listRecoverable = connection.prepare(`${selection}
    WHERE status NOT IN ('completed','failed','quarantined')
    ORDER BY created_at, turn_id`);
  const insert = connection.prepare(`
    INSERT INTO continuity_conversation_turns (
      turn_id, idempotency_key, input_content_hash, user_id, assistant_id,
      engine_subject_id, conversation_id, user_message_id, user_message_version_id,
      source_event_id, planned_request_id, request_id, observation_id, fact_id,
      expected_engine_revision, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'processing', ?, ?)
  `);
  const attachRequest = connection.prepare(`
    UPDATE continuity_conversation_turns
    SET request_id = planned_request_id, updated_at = ?
    WHERE turn_id = ? AND request_id IS NULL
  `);
  const updateState = connection.prepare(`
    UPDATE continuity_conversation_turns
    SET status = ?,
        capability_request_id = COALESCE(capability_request_id, ?),
        engine_operation_id = COALESCE(engine_operation_id, ?),
        confirmation_id = ?,
        public_failure_code = ?,
        updated_at = ?
    WHERE turn_id = ? AND status = ?
  `);
  const attachReply = connection.prepare(`
    UPDATE continuity_conversation_turns
    SET status = 'publishing',
        capability_request_id = COALESCE(capability_request_id, ?),
        engine_operation_id = ?,
        engine_response_id = ?,
        subject_message_id = ?,
        subject_message_version_id = ?,
        confirmation_id = NULL,
        public_failure_code = NULL,
        updated_at = ?
    WHERE turn_id = ?
      AND status NOT IN ('completed','failed','quarantined')
      AND subject_message_id IS NULL
  `);
  const complete = connection.prepare(`
    UPDATE continuity_conversation_turns
    SET status = 'completed', completed_at = ?, updated_at = ?
    WHERE turn_id = ? AND status = 'publishing'
  `);

  return Object.freeze({
    findById(userId, assistantId, conversationId, turnId) {
      return mapTurn(findById.get(userId, assistantId, conversationId, turnId));
    },
    findByIdempotencyKey(value) {
      return mapTurn(findByIdempotencyKey.get(value));
    },
    findByRequestId(value) {
      return mapTurn(findByRequestId.get(value, value));
    },
    listRecoverable() {
      return listRecoverable.all().map(mapTurn);
    },
    insert(record) {
      return constraint(() => {
        insert.run(
          record.turnId,
          record.idempotencyKey,
          record.inputContentHash,
          record.userId,
          record.assistantId,
          record.engineSubjectId,
          record.conversationId,
          record.userMessageId,
          record.userMessageVersionId,
          record.sourceEventId,
          record.plannedRequestId,
          record.observationId,
          record.factId,
          record.expectedEngineRevision,
          record.createdAt,
          record.createdAt,
        );
        return mapTurn(findById.get(
          record.userId,
          record.assistantId,
          record.conversationId,
          record.turnId,
        ));
      }, 'Conversation turn conflicts with an existing idempotency or active-turn fact.');
    },
    attachRequest(record, updatedAt) {
      const result = constraint(
        () => attachRequest.run(updatedAt, record.turnId),
        'Conversation turn request association conflicts with persisted state.',
      );
      if (result.changes !== 1) return mapTurn(findById.get(
        record.userId, record.assistantId, record.conversationId, record.turnId,
      ));
      return mapTurn(findById.get(
        record.userId, record.assistantId, record.conversationId, record.turnId,
      ));
    },
    transition(record, expectedStatus, status, details = {}) {
      const result = constraint(() => updateState.run(
        status,
        details.capabilityRequestId ?? null,
        details.engineOperationId ?? null,
        details.confirmationId ?? null,
        details.publicFailureCode ?? null,
        details.updatedAt,
        record.turnId,
        expectedStatus,
      ), 'Conversation turn transition conflicts with immutable facts.');
      if (result.changes !== 1) return null;
      return mapTurn(findById.get(
        record.userId,
        record.assistantId,
        record.conversationId,
        record.turnId,
      ));
    },
    attachReply(record, details) {
      const result = constraint(() => attachReply.run(
        details.capabilityRequestId ?? null,
        details.engineOperationId,
        details.engineResponseId,
        details.subjectMessageId,
        details.subjectMessageVersionId,
        details.updatedAt,
        record.turnId,
      ), 'Engine response is already bound to a different conversation turn.');
      if (result.changes !== 1) return null;
      return mapTurn(findById.get(
        record.userId,
        record.assistantId,
        record.conversationId,
        record.turnId,
      ));
    },
    complete(record, completedAt) {
      const result = constraint(
        () => complete.run(completedAt, completedAt, record.turnId),
        'Conversation turn completion conflicts with persisted state.',
      );
      if (result.changes !== 1) return null;
      return mapTurn(findById.get(
        record.userId,
        record.assistantId,
        record.conversationId,
        record.turnId,
      ));
    },
  });
}
