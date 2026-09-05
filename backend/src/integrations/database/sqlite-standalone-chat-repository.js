import { ConflictError } from '../../core/errors.js';
import {
  canonicalizeJson,
  sha256Hash,
} from '../../core/canonical-json.js';

function isConstraintError(error) {
  const code = String(error?.code ?? '');
  return code.startsWith('ERR_SQLITE_CONSTRAINT')
    || code.startsWith('SQLITE_CONSTRAINT')
    || /constraint failed/i.test(error?.message ?? '');
}

function constrained(operation, message) {
  try {
    return operation();
  } catch (error) {
    if (isConstraintError(error)) throw new ConflictError(message);
    throw error;
  }
}

function parseJson(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

function mapDefaultConversation(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
  };
}

function mapTurn(row) {
  if (!row) return null;
  return {
    turnId: row.turn_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    createdBySessionId: row.created_by_session_id,
    idempotencyKey: row.idempotency_key,
    inputContentHash: row.input_content_hash,
    userMessageId: row.user_message_id,
    userMessageVersionId: row.user_message_version_id,
    sourceEventId: row.source_event_id,
    assistantMessageId: row.assistant_message_id,
    assistantMessageVersionId: row.assistant_message_version_id,
    confirmationId: row.confirmation_id,
    confirmationKind: row.confirmation_kind,
    status: row.status,
    publicFailureCode: row.public_failure_code,
    recoveryReason: row.recovery_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapExecution(row) {
  if (!row) return null;
  return {
    executionId: row.execution_id,
    turnId: row.turn_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    credentialBindingId: row.credential_binding_id,
    tokenBudgetId: row.token_budget_id,
    budgetSessionId: row.budget_session_id,
    providerType: row.provider_type,
    providerInterfaceFormat: row.provider_interface_format,
    modelName: row.model_name,
    permissionDecision: row.permission_decision,
    securityDecision: row.security_decision,
    budgetDecision: row.budget_decision,
    estimatedTokens: row.estimated_tokens,
    securityAuditLogId: row.security_audit_log_id,
    permissionId: row.permission_id,
    permissionUpdatedAt: row.permission_updated_at,
    securityFactsHash: row.security_facts_hash,
    budgetFactsHash: row.budget_facts_hash,
    budgetApprovalId: row.budget_approval_id,
    maxOutputTokens: row.max_output_tokens,
    requestHash: row.request_hash,
    status: row.status,
    providerCallMayHaveStarted: row.provider_call_may_have_started === 1,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
  };
}

function mapAttempt(row) {
  if (!row) return null;
  return {
    attemptId: row.attempt_id,
    executionId: row.execution_id,
    turnId: row.turn_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    attemptNumber: row.attempt_number,
    securityAuditLogId: row.security_audit_log_id,
    permissionId: row.permission_id,
    permissionUpdatedAt: row.permission_updated_at,
    securityFactsHash: row.security_facts_hash,
    budgetFactsHash: row.budget_facts_hash,
    budgetApprovalId: row.budget_approval_id,
    requestHash: row.request_hash,
    status: row.status,
    providerCallMayHaveStarted: row.provider_call_may_have_started === 1,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
  };
}

function mapBudgetApproval(row) {
  if (!row) return null;
  return {
    budgetApprovalId: row.budget_approval_id,
    turnId: row.turn_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    targetAttemptNumber: row.target_attempt_number,
    tokenBudgetId: row.token_budget_id,
    budgetSessionId: row.budget_session_id,
    estimatedTokens: row.estimated_tokens,
    dailyTokenLimit: row.daily_token_limit,
    sessionTokenLimit: row.session_token_limit,
    overagePolicy: row.overage_policy,
    budgetUpdatedAt: row.budget_updated_at,
    dailyProjected: row.daily_projected,
    sessionProjected: row.session_projected,
    requestHash: row.request_hash,
    budgetFactsHash: row.budget_facts_hash,
    confirmationId: row.confirmation_id,
    securityAuditLogId: row.security_audit_log_id,
    approvedBySessionId: row.approved_by_session_id,
    approvedAt: row.approved_at,
  };
}

function mapUsage(row) {
  if (!row) return null;
  return {
    usageLedgerEntryId: row.usage_ledger_entry_id,
    executionId: row.execution_id,
    turnId: row.turn_id,
    attemptId: row.attempt_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    tokenBudgetId: row.token_budget_id,
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

function mapProviderResult(row) {
  if (!row) return null;
  return {
    providerResultId: row.provider_result_id,
    executionId: row.execution_id,
    turnId: row.turn_id,
    attemptId: row.attempt_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    usageLedgerEntryId: row.usage_ledger_entry_id,
    resultHash: row.result_hash,
    responseContentHash: row.response_content_hash,
    result: parseJson(row.result_json),
    resultJson: row.result_json,
    finishReason: row.finish_reason,
    receivedAt: row.received_at,
  };
}

function mapRecoveryAction(row) {
  if (!row) return null;
  return {
    recoveryActionId: row.recovery_action_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    idempotencyKey: row.idempotency_key,
    actionType: row.action_type,
    contentHash: row.content_hash,
    inputJson: row.input_json,
    turnStatusBefore: row.turn_status_before,
    attemptCountBefore: row.attempt_count_before,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function exactUsage(left, right) {
  return left.usageLedgerEntryId === right.usageLedgerEntryId
    && left.executionId === right.executionId
    && left.attemptId === right.attemptId
    && left.inputTokens === right.inputTokens
    && left.outputTokens === right.outputTokens
    && left.totalTokens === right.totalTokens
    && left.usageStatus === right.usageStatus
    && left.costStatus === right.costStatus
    && left.costAmountMicros === (right.costAmountMicros ?? null)
    && left.costCurrency === (right.costCurrency ?? null)
    && left.occurredAt === right.occurredAt
    && left.recordedAt === right.recordedAt;
}

function exactBudgetApproval(left, right) {
  return Object.keys(left).every((key) => left[key] === (right[key] ?? null));
}

function validateProviderResultRecord(record) {
  try {
    const value = JSON.parse(record.resultJson);
    const canonical = canonicalizeJson(value).toString('utf8');
    const responseLength = typeof value?.responseCandidate === 'string'
      ? [...value.responseCandidate].length
      : 0;
    const finishReasonLength = typeof value?.finishReason === 'string'
      ? [...value.finishReason].length
      : 0;
    const validKeys = value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.keys(value).sort().join(',') === 'finishReason,responseCandidate,schemaVersion,usage'
      && value.schemaVersion === 'vio-standalone-model-result/v1'
      && typeof value.responseCandidate === 'string'
      && responseLength >= 1
      && responseLength <= 4_096
      && typeof value.finishReason === 'string'
      && finishReasonLength >= 1
      && finishReasonLength <= 128
      && value.usage !== null
      && typeof value.usage === 'object'
      && !Array.isArray(value.usage)
      && Object.keys(value.usage).sort().join(',') === 'inputTokens,outputTokens,totalTokens'
      && Number.isSafeInteger(value.usage.inputTokens)
      && value.usage.inputTokens >= 0
      && Number.isSafeInteger(value.usage.outputTokens)
      && value.usage.outputTokens >= 0
      && Number.isSafeInteger(value.usage.totalTokens)
      && value.usage.totalTokens === value.usage.inputTokens + value.usage.outputTokens;
    if (
      !validKeys
      || canonical !== record.resultJson
      || sha256Hash(Buffer.from(canonical, 'utf8')) !== record.resultHash
      || sha256Hash(Buffer.from(value.responseCandidate, 'utf8')) !== record.responseContentHash
      || value.finishReason !== record.finishReason
    ) {
      throw new Error('mismatch');
    }
  } catch {
    throw new ConflictError('Standalone provider result integrity validation failed.');
  }
}

export function createSqliteStandaloneChatRepository(connection) {
  const defaultSelect = 'SELECT * FROM standalone_chat_default_conversations';
  const turnSelect = 'SELECT * FROM standalone_chat_turns';
  const executionSelect = 'SELECT * FROM standalone_chat_model_executions';
  const attemptSelect = 'SELECT * FROM standalone_chat_provider_attempts';
  const usageSelect = 'SELECT * FROM standalone_chat_usage_facts';
  const resultSelect = 'SELECT * FROM standalone_chat_provider_results';
  const recoverySelect = 'SELECT * FROM standalone_chat_recovery_actions';
  const budgetApprovalSelect = 'SELECT * FROM standalone_chat_budget_approvals';

  const findDefaultConversation = connection.prepare(`
    ${defaultSelect} WHERE user_id = ? AND assistant_id = ?
  `);
  const insertDefaultConversation = connection.prepare(`
    INSERT INTO standalone_chat_default_conversations (
      user_id, assistant_id, conversation_id, created_at
    ) VALUES (?, ?, ?, ?)
  `);

  const findTurn = connection.prepare(`
    ${turnSelect} WHERE user_id = ? AND assistant_id = ? AND turn_id = ?
  `);
  const findTurnByIdempotencyKey = connection.prepare(`
    ${turnSelect}
    WHERE user_id = ? AND assistant_id = ? AND idempotency_key = ?
  `);
  const findTurnByOwnerIdempotencyKey = connection.prepare(`
    ${turnSelect}
    WHERE user_id = ? AND idempotency_key = ?
  `);
  const findActiveTurn = connection.prepare(`
    ${turnSelect}
    WHERE user_id = ? AND assistant_id = ? AND conversation_id = ?
      AND status NOT IN ('completed', 'failed', 'cancelled', 'quarantined')
    LIMIT 1
  `);
  const listTurns = connection.prepare(`
    ${turnSelect}
    WHERE user_id = ? AND assistant_id = ? AND conversation_id = ?
    ORDER BY created_at, turn_id
  `);
  const listRecoverableTurns = connection.prepare(`
    ${turnSelect}
    WHERE status NOT IN ('completed', 'failed', 'cancelled', 'quarantined')
    ORDER BY created_at, turn_id
  `);
  const insertTurn = connection.prepare(`
    INSERT INTO standalone_chat_turns (
      turn_id, user_id, assistant_id, conversation_id, created_by_session_id,
      idempotency_key, input_content_hash, user_message_id,
      user_message_version_id, source_event_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)
  `);
  const transitionTurn = connection.prepare(`
    UPDATE standalone_chat_turns
    SET status = ?, confirmation_id = ?, confirmation_kind = ?,
        public_failure_code = ?, recovery_reason = ?, updated_at = ?
    WHERE turn_id = ? AND status = ?
  `);
  const attachAssistantMessage = connection.prepare(`
    UPDATE standalone_chat_turns
    SET status = 'publishing', assistant_message_id = ?,
        assistant_message_version_id = ?, confirmation_id = NULL,
        confirmation_kind = NULL, public_failure_code = NULL,
        recovery_reason = NULL, updated_at = ?
    WHERE turn_id = ? AND status = ?
      AND assistant_message_id IS NULL
      AND assistant_message_version_id IS NULL
  `);
  const completeTurn = connection.prepare(`
    UPDATE standalone_chat_turns
    SET status = 'completed', completed_at = ?, updated_at = ?
    WHERE turn_id = ? AND status = 'publishing'
  `);

  const findExecution = connection.prepare(`
    ${executionSelect} WHERE execution_id = ?
  `);
  const findExecutionByTurn = connection.prepare(`
    ${executionSelect} WHERE turn_id = ?
  `);
  const listAmbiguousExecutions = connection.prepare(`
    ${executionSelect}
    WHERE status IN ('in_flight', 'outcome_unknown')
    ORDER BY started_at, execution_id
  `);
  const insertExecution = connection.prepare(`
    INSERT INTO standalone_chat_model_executions (
      execution_id, turn_id, user_id, assistant_id, conversation_id,
      provider_id, model_id, credential_binding_id, token_budget_id,
      budget_session_id, provider_type, provider_interface_format, model_name,
      permission_decision, security_decision, budget_decision, estimated_tokens,
      security_audit_log_id, permission_id, permission_updated_at,
      security_facts_hash, budget_facts_hash, budget_approval_id,
      max_output_tokens, request_hash, status,
      provider_call_may_have_started, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      'prepared', 0, ?, ?)
  `);
  const transitionExecution = connection.prepare(`
    UPDATE standalone_chat_model_executions
    SET status = ?,
        provider_call_may_have_started = CASE
          WHEN provider_call_may_have_started = 1 THEN 1
          WHEN ? IS NULL THEN provider_call_may_have_started ELSE ? END,
        completed_at = ?, error_code = ?, updated_at = ?
    WHERE execution_id = ? AND status = ?
  `);

  const findLatestAttemptByExecution = connection.prepare(`
    ${attemptSelect}
    WHERE execution_id = ?
    ORDER BY attempt_number DESC
    LIMIT 1
  `);
  const listAttemptsByExecution = connection.prepare(`
    ${attemptSelect}
    WHERE execution_id = ?
    ORDER BY attempt_number, attempt_id
  `);
  const nextAttemptNumber = connection.prepare(`
    SELECT COALESCE(MAX(attempt_number), 0) + 1 AS value
    FROM standalone_chat_provider_attempts
    WHERE execution_id = ?
  `);
  const insertAttempt = connection.prepare(`
    INSERT INTO standalone_chat_provider_attempts (
      attempt_id, execution_id, turn_id, user_id, assistant_id, conversation_id,
      attempt_number, security_audit_log_id, permission_id, permission_updated_at,
      security_facts_hash, budget_facts_hash, budget_approval_id, request_hash, status,
      provider_call_may_have_started, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', 0, ?)
  `);

  const findBudgetApproval = connection.prepare(`
    ${budgetApprovalSelect}
    WHERE turn_id = ? AND target_attempt_number = ? AND budget_facts_hash = ?
  `);
  const findBudgetApprovalById = connection.prepare(`
    ${budgetApprovalSelect} WHERE budget_approval_id = ?
  `);
  const insertBudgetApproval = connection.prepare(`
    INSERT INTO standalone_chat_budget_approvals (
      budget_approval_id, turn_id, user_id, assistant_id, conversation_id,
      target_attempt_number, token_budget_id, budget_session_id, estimated_tokens,
      daily_token_limit, session_token_limit, overage_policy, budget_updated_at,
      daily_projected, session_projected, request_hash, budget_facts_hash,
      confirmation_id, security_audit_log_id, approved_by_session_id, approved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const transitionAttempt = connection.prepare(`
    UPDATE standalone_chat_provider_attempts
    SET status = ?,
        provider_call_may_have_started = CASE
          WHEN provider_call_may_have_started = 1 THEN 1
          WHEN ? IS NULL THEN provider_call_may_have_started ELSE ? END,
        completed_at = ?, error_code = ?
    WHERE attempt_id = ? AND status = ?
  `);

  const findUsageByAttempt = connection.prepare(`
    ${usageSelect} WHERE attempt_id = ?
  `);
  const listUsageByExecution = connection.prepare(`
    ${usageSelect}
    WHERE execution_id = ?
    ORDER BY occurred_at, usage_ledger_entry_id
  `);
  const findUsageById = connection.prepare(`
    ${usageSelect} WHERE usage_ledger_entry_id = ?
  `);
  const insertUsage = connection.prepare(`
    INSERT INTO standalone_chat_usage_facts (
      usage_ledger_entry_id, execution_id, turn_id, attempt_id, user_id, assistant_id,
      conversation_id, token_budget_id, budget_session_id, model_id,
      input_tokens, output_tokens, total_tokens, usage_status, cost_status,
      cost_amount_micros, cost_currency, occurred_at, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findProviderResult = connection.prepare(`
    ${resultSelect} WHERE provider_result_id = ?
  `);
  const findProviderResultByExecution = connection.prepare(`
    ${resultSelect} WHERE execution_id = ?
  `);
  const findProviderResultByTurn = connection.prepare(`
    ${resultSelect} WHERE turn_id = ?
  `);
  const insertProviderResult = connection.prepare(`
    INSERT INTO standalone_chat_provider_results (
      provider_result_id, execution_id, turn_id, attempt_id, user_id,
      assistant_id, conversation_id, usage_ledger_entry_id, result_hash,
      response_content_hash, result_json, finish_reason, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findRecoveryById = connection.prepare(`
    ${recoverySelect} WHERE recovery_action_id = ?
  `);
  const findRecoveryByKey = connection.prepare(`
    ${recoverySelect}
    WHERE user_id = ? AND assistant_id = ? AND idempotency_key = ?
  `);
  const insertRecovery = connection.prepare(`
    INSERT INTO standalone_chat_recovery_actions (
      recovery_action_id, user_id, assistant_id, conversation_id, turn_id,
      idempotency_key, action_type, content_hash, input_json,
      turn_status_before, attempt_count_before, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  const completeRecovery = connection.prepare(`
    UPDATE standalone_chat_recovery_actions
    SET status = 'completed', completed_at = ?
    WHERE recovery_action_id = ? AND status = 'pending'
  `);

  function scopedTurn(turnId) {
    return mapTurn(connection.prepare(`${turnSelect} WHERE turn_id = ?`).get(turnId));
  }

  return Object.freeze({
    findDefaultConversation(userId, assistantId) {
      return mapDefaultConversation(findDefaultConversation.get(userId, assistantId));
    },
    insertDefaultConversation(record) {
      const existing = mapDefaultConversation(
        findDefaultConversation.get(record.userId, record.assistantId),
      );
      if (existing) {
        if (existing.conversationId !== record.conversationId) {
          throw new ConflictError('Assistant already has a different default conversation.');
        }
        return existing;
      }
      return constrained(() => {
        insertDefaultConversation.run(
          record.userId, record.assistantId, record.conversationId, record.createdAt,
        );
        return mapDefaultConversation(
          findDefaultConversation.get(record.userId, record.assistantId),
        );
      }, 'Standalone default conversation conflicts with persisted ownership.');
    },

    findTurn(userId, assistantId, turnId) {
      return mapTurn(findTurn.get(userId, assistantId, turnId));
    },
    findTurnByIdempotencyKey(userId, assistantId, idempotencyKey) {
      return mapTurn(findTurnByIdempotencyKey.get(userId, assistantId, idempotencyKey));
    },
    findTurnByOwnerIdempotencyKey(userId, idempotencyKey) {
      return mapTurn(findTurnByOwnerIdempotencyKey.get(userId, idempotencyKey));
    },
    findActiveTurn(userId, assistantId, conversationId) {
      return mapTurn(findActiveTurn.get(userId, assistantId, conversationId));
    },
    listTurns(userId, assistantId, conversationId) {
      return listTurns.all(userId, assistantId, conversationId).map(mapTurn);
    },
    listRecoverableTurns() {
      return listRecoverableTurns.all().map(mapTurn);
    },
    insertTurn(record) {
      return constrained(() => {
        insertTurn.run(
          record.turnId,
          record.userId,
          record.assistantId,
          record.conversationId,
          record.createdBySessionId,
          record.idempotencyKey,
          record.inputContentHash,
          record.userMessageId,
          record.userMessageVersionId,
          record.sourceEventId,
          record.createdAt,
          record.createdAt,
        );
        return mapTurn(findTurn.get(record.userId, record.assistantId, record.turnId));
      }, 'Standalone turn conflicts with an idempotency, message, or active-turn fact.');
    },
    transitionTurn(turnId, expectedStatus, status, details) {
      const changed = constrained(() => transitionTurn.run(
        status,
        details.confirmationId ?? null,
        details.confirmationKind ?? null,
        details.publicFailureCode ?? null,
        details.recoveryReason ?? null,
        details.updatedAt,
        turnId,
        expectedStatus,
      ), 'Standalone turn transition conflicts with persisted facts.');
      return changed.changes === 1 ? scopedTurn(turnId) : null;
    },
    attachAssistantMessage(turnId, expectedStatus, details) {
      const changed = constrained(() => attachAssistantMessage.run(
        details.assistantMessageId,
        details.assistantMessageVersionId,
        details.updatedAt,
        turnId,
        expectedStatus,
      ), 'Standalone assistant message conflicts with persisted facts.');
      return changed.changes === 1 ? scopedTurn(turnId) : null;
    },
    completeTurn(turnId, completedAt) {
      const changed = constrained(
        () => completeTurn.run(completedAt, completedAt, turnId),
        'Standalone turn completion conflicts with persisted facts.',
      );
      return changed.changes === 1 ? scopedTurn(turnId) : null;
    },

    findExecution(executionId) {
      return mapExecution(findExecution.get(executionId));
    },
    findExecutionByTurn(turnId) {
      return mapExecution(findExecutionByTurn.get(turnId));
    },
    listAmbiguousExecutions() {
      return listAmbiguousExecutions.all().map(mapExecution);
    },
    insertExecution(record) {
      return constrained(() => {
        insertExecution.run(
          record.executionId,
          record.turnId,
          record.userId,
          record.assistantId,
          record.conversationId,
          record.providerId,
          record.modelId,
          record.credentialBindingId,
          record.tokenBudgetId,
          record.budgetSessionId,
          record.providerType,
          record.providerInterfaceFormat,
          record.modelName,
          record.permissionDecision,
          record.securityDecision,
          record.budgetDecision,
          record.estimatedTokens,
          record.securityAuditLogId,
          record.permissionId,
          record.permissionUpdatedAt,
          record.securityFactsHash,
          record.budgetFactsHash,
          record.budgetApprovalId ?? null,
          record.maxOutputTokens,
          record.requestHash,
          record.startedAt,
          record.startedAt,
        );
        return mapExecution(findExecution.get(record.executionId));
      }, 'Standalone turn cannot start this model execution.');
    },
    transitionExecution(executionId, expectedStatus, status, details) {
      const mayHaveStarted = details.providerCallMayHaveStarted;
      const encodedMayHaveStarted = mayHaveStarted === undefined
        ? null
        : (mayHaveStarted ? 1 : 0);
      const changed = constrained(() => transitionExecution.run(
        status,
        encodedMayHaveStarted,
        encodedMayHaveStarted,
        details.completedAt ?? null,
        details.errorCode ?? null,
        details.updatedAt,
        executionId,
        expectedStatus,
      ), 'Standalone execution transition conflicts with persisted facts.');
      return changed.changes === 1 ? mapExecution(findExecution.get(executionId)) : null;
    },

    findLatestAttemptByExecution(executionId) {
      return mapAttempt(findLatestAttemptByExecution.get(executionId));
    },
    listAttemptsByExecution(executionId) {
      return listAttemptsByExecution.all(executionId).map(mapAttempt);
    },
    findBudgetApproval(turnId, targetAttemptNumber, budgetFactsHash) {
      return mapBudgetApproval(findBudgetApproval.get(
        turnId,
        targetAttemptNumber,
        budgetFactsHash,
      ));
    },
    insertBudgetApproval(record) {
      const existing = mapBudgetApproval(findBudgetApprovalById.get(record.budgetApprovalId));
      if (existing) {
        if (!exactBudgetApproval(existing, record)) {
          throw new ConflictError('Standalone budget approval ID is bound to different facts.');
        }
        return existing;
      }
      const sameFacts = mapBudgetApproval(findBudgetApproval.get(
        record.turnId,
        record.targetAttemptNumber,
        record.budgetFactsHash,
      ));
      if (sameFacts) {
        if (!exactBudgetApproval(sameFacts, record)) {
          throw new ConflictError('Standalone budget approval facts cannot be replaced.');
        }
        return sameFacts;
      }
      return constrained(() => {
        insertBudgetApproval.run(
          record.budgetApprovalId,
          record.turnId,
          record.userId,
          record.assistantId,
          record.conversationId,
          record.targetAttemptNumber,
          record.tokenBudgetId,
          record.budgetSessionId,
          record.estimatedTokens,
          record.dailyTokenLimit,
          record.sessionTokenLimit,
          record.overagePolicy,
          record.budgetUpdatedAt,
          record.dailyProjected,
          record.sessionProjected,
          record.requestHash,
          record.budgetFactsHash,
          record.confirmationId,
          record.securityAuditLogId,
          record.approvedBySessionId,
          record.approvedAt,
        );
        return mapBudgetApproval(findBudgetApprovalById.get(record.budgetApprovalId));
      }, 'Standalone budget approval conflicts with persisted facts.');
    },
    startAttempt(record) {
      const execution = mapExecution(findExecution.get(record.executionId));
      if (!execution) throw new ConflictError('Standalone execution was not found.');
      const attemptNumber = nextAttemptNumber.get(record.executionId).value;
      return constrained(() => {
        insertAttempt.run(
          record.attemptId,
          execution.executionId,
          execution.turnId,
          execution.userId,
          execution.assistantId,
          execution.conversationId,
          attemptNumber,
          record.securityAuditLogId,
          record.permissionId,
          record.permissionUpdatedAt,
          record.securityFactsHash,
          record.budgetFactsHash,
          record.budgetApprovalId ?? null,
          record.requestHash,
          record.startedAt,
        );
        return mapAttempt(findLatestAttemptByExecution.get(record.executionId));
      }, 'Standalone provider attempt is not safely retryable.');
    },
    transitionAttempt(attemptId, expectedStatus, status, details) {
      const mayHaveStarted = details.providerCallMayHaveStarted;
      const encodedMayHaveStarted = mayHaveStarted === undefined
        ? null
        : (mayHaveStarted ? 1 : 0);
      const changed = constrained(() => transitionAttempt.run(
        status,
        encodedMayHaveStarted,
        encodedMayHaveStarted,
        details.completedAt ?? null,
        details.errorCode ?? null,
        attemptId,
        expectedStatus,
      ), 'Standalone provider attempt transition conflicts with persisted facts.');
      if (changed.changes !== 1) return null;
      return mapAttempt(connection.prepare(`${attemptSelect} WHERE attempt_id = ?`).get(attemptId));
    },

    findUsageByAttempt(attemptId) {
      return mapUsage(findUsageByAttempt.get(attemptId));
    },
    listUsageByExecution(executionId) {
      return listUsageByExecution.all(executionId).map(mapUsage);
    },
    insertUsage(record) {
      const execution = mapExecution(findExecution.get(record.executionId));
      if (!execution) throw new ConflictError('Standalone execution was not found.');
      const attempt = mapAttempt(connection.prepare(
        `${attemptSelect} WHERE attempt_id = ? AND execution_id = ?`,
      ).get(record.attemptId, record.executionId));
      if (!attempt) throw new ConflictError('Standalone provider attempt was not found.');
      const existing = mapUsage(findUsageByAttempt.get(record.attemptId));
      if (existing) {
        if (!exactUsage(existing, record)) {
          throw new ConflictError('Standalone execution is bound to different usage facts.');
        }
        return existing;
      }
      return constrained(() => {
        insertUsage.run(
          record.usageLedgerEntryId,
          execution.executionId,
          execution.turnId,
          attempt.attemptId,
          execution.userId,
          execution.assistantId,
          execution.conversationId,
          execution.tokenBudgetId,
          execution.budgetSessionId,
          execution.modelId,
          record.inputTokens,
          record.outputTokens,
          record.totalTokens,
          record.usageStatus,
          record.costStatus,
          record.costAmountMicros ?? null,
          record.costCurrency ?? null,
          record.occurredAt,
          record.recordedAt,
        );
        return mapUsage(findUsageById.get(record.usageLedgerEntryId));
      }, 'Standalone usage conflicts with an existing immutable fact.');
    },

    findProviderResult(providerResultId) {
      return mapProviderResult(findProviderResult.get(providerResultId));
    },
    findProviderResultByExecution(executionId) {
      return mapProviderResult(findProviderResultByExecution.get(executionId));
    },
    findProviderResultByTurn(turnId) {
      return mapProviderResult(findProviderResultByTurn.get(turnId));
    },
    insertProviderResult(record) {
      validateProviderResultRecord(record);
      const existing = mapProviderResult(findProviderResult.get(record.providerResultId));
      if (existing) {
        if (existing.executionId !== record.executionId
          || existing.attemptId !== record.attemptId
          || existing.usageLedgerEntryId !== record.usageLedgerEntryId
          || existing.resultHash !== record.resultHash
          || existing.responseContentHash !== record.responseContentHash
          || existing.resultJson !== record.resultJson
          || existing.finishReason !== record.finishReason
          || existing.receivedAt !== record.receivedAt) {
          throw new ConflictError('providerResultId is bound to different content.');
        }
        return existing;
      }
      const execution = mapExecution(findExecution.get(record.executionId));
      if (!execution) throw new ConflictError('Standalone execution was not found.');
      return constrained(() => {
        insertProviderResult.run(
          record.providerResultId,
          execution.executionId,
          execution.turnId,
          record.attemptId,
          execution.userId,
          execution.assistantId,
          execution.conversationId,
          record.usageLedgerEntryId,
          record.resultHash,
          record.responseContentHash,
          record.resultJson,
          record.finishReason,
          record.receivedAt,
        );
        return mapProviderResult(findProviderResult.get(record.providerResultId));
      }, 'Standalone provider result conflicts with existing immutable facts.');
    },

    findRecoveryByKey(userId, assistantId, idempotencyKey) {
      return mapRecoveryAction(findRecoveryByKey.get(
        userId, assistantId, idempotencyKey,
      ));
    },
    insertRecovery(record) {
      const existing = mapRecoveryAction(findRecoveryByKey.get(
        record.userId, record.assistantId, record.idempotencyKey,
      ));
      if (existing) {
        if (existing.turnId !== record.turnId
          || existing.actionType !== record.actionType
          || existing.contentHash !== record.contentHash
          || existing.inputJson !== record.inputJson) {
          throw new ConflictError(
            'Recovery Idempotency-Key is bound to a different action.',
          );
        }
        return existing;
      }
      return constrained(() => {
        insertRecovery.run(
          record.recoveryActionId,
          record.userId,
          record.assistantId,
          record.conversationId,
          record.turnId,
          record.idempotencyKey,
          record.actionType,
          record.contentHash,
          record.inputJson,
          record.turnStatusBefore,
          record.attemptCountBefore,
          record.createdAt,
        );
        return mapRecoveryAction(findRecoveryById.get(record.recoveryActionId));
      }, 'Standalone recovery action conflicts with persisted facts.');
    },
    completeRecovery(recoveryActionId, completedAt) {
      const changed = constrained(
        () => completeRecovery.run(completedAt, recoveryActionId),
        'Standalone recovery completion conflicts with persisted facts.',
      );
      const recovery = mapRecoveryAction(findRecoveryById.get(recoveryActionId));
      if (changed.changes === 0 && recovery?.status !== 'completed') return null;
      return recovery;
    },
  });
}
