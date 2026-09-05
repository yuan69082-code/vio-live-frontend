import { ApplicationError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requireOpaqueResourceId } from '../../core/validation.js';
import { canonicalizeJson, sha256Hash } from '../../core/canonical-json.js';
import { requireMessageContent } from '../messages/message-types.js';
import { fields, text } from '../personal/personal-validation.js';
import { classifySecurityRisk } from '../security/risk-classifier.js';

const MAX_HISTORY_TURNS = 12;
const MAX_OUTPUT_CHARACTERS = 4_096;
const MAX_OUTPUT_TOKENS = 4_096;
const TOKEN_ESTIMATE_FIXED_OVERHEAD = 512;
const TOKEN_ESTIMATE_PER_MESSAGE_OVERHEAD = 128;
const EXECUTION_DEADLINE_MS = 60_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TERMINAL_TURN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'quarantined']);

function codedError(code, message, statusCode = 409) {
  return new ApplicationError(message, { code, statusCode });
}

function requireIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ValidationError(
      'Idempotency-Key must contain 8 to 128 safe identifier characters.',
      { field: 'Idempotency-Key' },
    );
  }
  return value;
}

function requireCreateInput(value) {
  fields(value, ['content'], ['content']);
  return Object.freeze({ content: requireMessageContent(value.content) });
}

function requireRecoveryInput(value) {
  fields(
    value,
    ['action', 'confirmationId'],
    ['action'],
  );
  if (!['resume', 'retry', 'cancel'].includes(value.action)) {
    throw new ValidationError('Recovery action is not supported.', { field: 'action' });
  }
  const input = { action: value.action };
  if (value.confirmationId !== undefined) {
    input.confirmationId = requireOpaqueResourceId(value.confirmationId, 'confirmationId');
  }
  return Object.freeze(input);
}

function inputHash(input) {
  return sha256Hash(canonicalizeJson(input));
}

function conservativeTokenEstimate(messages) {
  const inputBytes = messages.reduce(
    (total, message) => total + Buffer.byteLength(message.content, 'utf8'),
    0,
  );
  // Each valid tokenizer token consumes at least one input byte for the
  // supported text transport. The fixed and per-message allowances cover
  // protocol/tokenizer framing, while the exact Provider output token cap is
  // reserved in full.
  return inputBytes
    + TOKEN_ESTIMATE_FIXED_OVERHEAD
    + (messages.length * TOKEN_ESTIMATE_PER_MESSAGE_OVERHEAD)
    + MAX_OUTPUT_TOKENS;
}

function assertLockedMessage({
  messageRepository,
  messageVersionRepository,
  turn,
  senderType,
}) {
  const prefix = senderType === 'user' ? 'user' : 'assistant';
  const messageId = turn[`${prefix}MessageId`];
  const messageVersionId = turn[`${prefix}MessageVersionId`];
  if (!messageId || !messageVersionId) return null;
  const message = messageRepository.findById(
    turn.userId,
    turn.assistantId,
    turn.conversationId,
    messageId,
  );
  const version = messageVersionRepository.findById(
    turn.userId,
    turn.assistantId,
    turn.conversationId,
    messageId,
    messageVersionId,
  );
  if (
    !message
    || !version
    || message.userId !== turn.userId
    || message.subjectId !== turn.assistantId
    || message.conversationId !== turn.conversationId
    || message.senderType !== senderType
    || version.userId !== turn.userId
    || version.subjectId !== turn.assistantId
    || version.conversationId !== turn.conversationId
    || version.messageId !== messageId
    || version.messageVersionId !== messageVersionId
    || version.senderType !== senderType
  ) {
    throw codedError(
      'STANDALONE_LEDGER_INCONSISTENT',
      'Standalone chat message history is inconsistent.',
      500,
    );
  }
  return Object.freeze({
    messageId,
    messageVersionId,
    senderType,
    content: version.content,
    sequenceNumber: message.sequenceNumber,
    createdAt: message.createdAt,
  });
}

function modelFailureCode(error) {
  if (['DEFAULT_CHAT_MODEL_NOT_CONFIGURED', 'MODEL_DISABLED', 'PROVIDER_DISABLED'].includes(error?.code)) {
    return error.code;
  }
  return null;
}

function credentialFailureCode(error) {
  if (error?.code === 'VAULT_LOCKED') return 'VAULT_LOCKED';
  if (error?.code === 'CREDENTIAL_UNAVAILABLE' || error?.code === 'not_found') {
    return 'CREDENTIAL_UNAVAILABLE';
  }
  return null;
}

function budgetFailureCode(error) {
  if (error?.code === 'not_found') return 'TOKEN_BUDGET_NOT_CONFIGURED';
  if (error instanceof ConflictError) return 'TOKEN_BUDGET_DISABLED';
  return null;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function normalizeStandaloneProviderResult(result) {
  if (result?.status !== 'SUCCEEDED') return result;
  try {
    const responseCandidate = requireMessageContent(result.output?.responseCandidate);
    const finishReason = result.output?.finishReason;
    const usage = result.usage;
    if (
      hasUnpairedSurrogate(responseCandidate)
      || [...responseCandidate].length > MAX_OUTPUT_CHARACTERS
      || typeof finishReason !== 'string'
      || [...finishReason].length < 1
      || [...finishReason].length > 128
      || hasUnpairedSurrogate(finishReason)
      || !Number.isSafeInteger(usage?.inputTokens)
      || usage.inputTokens < 0
      || !Number.isSafeInteger(usage?.outputTokens)
      || usage.outputTokens < 0
      || !Number.isSafeInteger(usage?.totalTokens)
      || usage.totalTokens !== usage.inputTokens + usage.outputTokens
    ) {
      throw new ValidationError('Provider success facts are not recoverable.');
    }
    canonicalizeJson({ responseCandidate, finishReason, usage });
    return Object.freeze({
      ...result,
      output: Object.freeze({ responseCandidate, finishReason }),
      usage: Object.freeze({ ...usage }),
    });
  } catch {
    return Object.freeze({
      ...result,
      status: 'UNKNOWN',
      output: null,
      usage: null,
      errorCode: 'PROVIDER_RESULT_NOT_RECOVERABLE',
      requestMayHaveBeenSent: true,
      cost: Object.freeze({ status: 'not_reported', amountMicros: null, currency: null }),
    });
  }
}

export function createStandaloneChatService({
  repository,
  subjectRuntimeStatusService,
  personalIdentityService,
  conversationService,
  messageService,
  messageRepository,
  messageVersionRepository,
  eventRepository,
  modelRouterService,
  apiProviderService,
  securityService,
  permissionService,
  securityPolicyService,
  proactiveInteractionService,
  modelExecutor,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
  faultInjector = null,
}) {
  function assertStandaloneMode() {
    const runtime = subjectRuntimeStatusService.getStatus();
    if (runtime.mode !== 'none') {
      throw codedError(
        'STANDALONE_MODE_REQUIRED',
        'Standalone personal chat is unavailable while an external subject runtime is selected.',
      );
    }
  }

  function currentScope(context) {
    assertStandaloneMode();
    assertCurrentSession(context);
    const identity = personalIdentityService.identity(context.userId);
    if (!identity.current_assistant_id) {
      throw codedError(
        'ASSISTANT_NOT_SELECTED',
        'Select an assistant before using standalone chat.',
      );
    }
    const assistant = personalIdentityService.assistant(
      context.userId,
      identity.current_assistant_id,
    );
    if (assistant.status !== 'active') {
      throw codedError('ASSISTANT_NOT_SELECTED', 'The selected assistant is not active.');
    }
    return Object.freeze({
      userId: context.userId,
      sessionId: context.sessionId,
      assistantId: assistant.assistantId,
      assistant,
    });
  }

  function publicAssistant(assistant) {
    return Object.freeze({
      assistantId: assistant.assistantId,
      name: assistant.name,
    });
  }

  function assertCurrentSession(context) {
    if (typeof personalIdentityService.assertSessionActive === 'function') {
      personalIdentityService.assertSessionActive(context);
    } else {
      personalIdentityService.identity(context.userId);
    }
  }

  function turnForScope(scope, turnId) {
    const normalizedTurnId = requireOpaqueResourceId(turnId, 'turnId');
    const turn = repository.findTurn(scope.userId, scope.assistantId, normalizedTurnId);
    if (!turn) throw new NotFoundError('Standalone chat turn was not found.');
    return turn;
  }

  function lockedMessage(turn, senderType) {
    return assertLockedMessage({
      messageRepository,
      messageVersionRepository,
      turn,
      senderType,
    });
  }

  function externalCallFor(execution) {
    if (!execution || !execution.providerCallMayHaveStarted) return 'not_performed';
    return execution.status === 'outcome_unknown' ? 'outcome_unknown' : 'performed';
  }

  function publicTurn(turn) {
    const execution = repository.findExecutionByTurn(turn.turnId);
    const attempts = execution
      ? repository.listAttemptsByExecution(execution.executionId)
      : [];
    const lastAttempt = attempts.at(-1) ?? null;
    return Object.freeze({
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      status: turn.status,
      createdAt: turn.createdAt,
      updatedAt: turn.updatedAt,
      completedAt: turn.completedAt,
      userMessage: lockedMessage(turn, 'user'),
      assistantMessage: lockedMessage(turn, 'subject'),
      confirmation: turn.confirmationId ? Object.freeze({
        confirmationId: turn.confirmationId,
        kind: turn.confirmationKind,
      }) : null,
      error: turn.publicFailureCode ? Object.freeze({
        code: turn.publicFailureCode,
        retryable: turn.status === 'retryable',
      }) : null,
      execution: execution ? Object.freeze({
        executionId: execution.executionId,
        providerId: execution.providerId,
        modelId: execution.modelId,
        status: execution.status,
        attemptCount: attempts.length,
        lastAttemptStatus: lastAttempt?.status ?? null,
      }) : null,
      externalCall: externalCallFor(execution),
    });
  }

  function conversationMessages(conversationId, turns) {
    return turns.flatMap((turn) => [
      lockedMessage(turn, 'user'),
      lockedMessage(turn, 'subject'),
    ].filter(Boolean)).sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  }

  function systemMessage(assistant) {
    const settings = assistant.settings ?? {};
    const sections = [
      `You are ${assistant.name}.`,
      settings.positioning ? `Positioning: ${settings.positioning}` : null,
      settings.personality ? `Personality: ${settings.personality}` : null,
      settings.persona ? `Persona: ${settings.persona}` : null,
      settings.requirements ? `Requirements: ${settings.requirements}` : null,
      settings.contextMode ? `Context mode: ${settings.contextMode}` : null,
    ].filter(Boolean);
    const content = sections.join('\n');
    if ([...content].length > 32_768) {
      throw codedError(
        'ASSISTANT_CONFIGURATION_TOO_LARGE',
        'The selected assistant settings exceed the standalone chat boundary.',
      );
    }
    return Object.freeze({ role: 'system', content });
  }

  function providerMessages(scope, turn) {
    const completed = repository.listTurns(
      turn.userId,
      turn.assistantId,
      turn.conversationId,
    ).filter((item) => item.status === 'completed' && item.turnId !== turn.turnId)
      .map((item) => ({
        turn: item,
        user: lockedMessage(item, 'user'),
        assistant: lockedMessage(item, 'subject'),
      }))
      .sort((left, right) => left.user.sequenceNumber - right.user.sequenceNumber)
      .slice(-MAX_HISTORY_TURNS);
    const messages = [systemMessage(scope.assistant)];
    for (const historical of completed) {
      messages.push({ role: 'user', content: historical.user.content });
      messages.push({ role: 'assistant', content: historical.assistant.content });
    }
    messages.push({ role: 'user', content: lockedMessage(turn, 'user').content });
    return Object.freeze(messages.map((message) => Object.freeze(message)));
  }

  function retryablePreflightFailure(turn, expectedStatus, code, reason) {
    return repository.transitionTurn(turn.turnId, expectedStatus, 'retryable', {
      publicFailureCode: code,
      recoveryReason: reason,
      updatedAt: clock().toISOString(),
    });
  }

  function finishExistingExecution(turn, status, errorCode) {
    const execution = repository.findExecutionByTurn(turn.turnId);
    if (!execution) return null;
    if (execution.status === status) return execution;
    if (!['prepared', 'retryable'].includes(execution.status)) {
      throw codedError(
        'STANDALONE_LEDGER_INCONSISTENT',
        'Standalone turn and execution states cannot be terminated consistently.',
        500,
      );
    }
    const now = clock().toISOString();
    return repository.transitionExecution(execution.executionId, execution.status, status, {
      providerCallMayHaveStarted: execution.providerCallMayHaveStarted,
      completedAt: now,
      errorCode,
      updatedAt: now,
    });
  }

  function terminalPreflightFailure(turn, expectedStatus, code, reason) {
    finishExistingExecution(turn, 'failed_terminal', code);
    return repository.transitionTurn(turn.turnId, expectedStatus, 'failed', {
      publicFailureCode: code,
      recoveryReason: reason,
      updatedAt: clock().toISOString(),
    });
  }

  function targetAttemptNumber(turn) {
    const execution = repository.findExecutionByTurn(turn.turnId);
    return execution
      ? repository.listAttemptsByExecution(execution.executionId).length + 1
      : 1;
  }

  function normalizedPermissionFacts(permission) {
    return {
      permissionId: permission?.permissionId ?? null,
      permissionLevel: permission?.permissionLevel ?? null,
      permissionStatus: permission?.permissionStatus ?? permission?.status ?? null,
      permissionUpdatedAt: permission?.permissionUpdatedAt ?? permission?.updatedAt ?? null,
    };
  }

  function normalizedSecurityPolicyFacts(evaluation) {
    const policy = evaluation?.policy ?? null;
    const preferences = evaluation?.preferences ?? null;
    return {
      policy: policy ? {
        policyId: policy.policyId,
        resourceType: policy.resourceType,
        actionType: policy.actionType,
        riskLevel: policy.riskLevel,
        rule: policy.rule,
        status: policy.status,
        updatedAt: policy.updatedAt,
      } : null,
      preferences: preferences ? {
        defaultSecurityLevel: preferences.defaultSecurityLevel,
        highRiskOperationPolicy: preferences.highRiskOperationPolicy,
        updatedAt: preferences.updatedAt,
      } : null,
      effectiveRiskLevel: evaluation?.effectiveRiskLevel ?? null,
      securitySessionId: evaluation?.securitySessionId ?? null,
      decision: evaluation?.decision ?? null,
      confirmationMode: evaluation?.confirmationMode ?? null,
      reason: evaluation?.reason ?? null,
    };
  }

  function securityFactsHash(scope, providerId, permission, policyEvaluation) {
    return inputHash({
      schemaVersion: 'vio-standalone-security-facts/v1',
      userId: scope.userId,
      sessionId: scope.sessionId,
      resourceType: 'api',
      resourceId: providerId,
      action: 'execute',
      operationType: 'privacy_access_request',
      sensitiveDataCategories: ['private_record'],
      minimumRiskLevel: 'high',
      permission: normalizedPermissionFacts(permission),
      securityPolicy: normalizedSecurityPolicyFacts(policyEvaluation),
    });
  }

  function currentSecurityFactsHash(scope, providerId, permissionId) {
    const permission = permissionService.getPermission(scope.userId, permissionId);
    const classifiedRisk = classifySecurityRisk({
      operationType: 'privacy_access_request',
      resourceType: 'api',
      action: 'execute',
      sensitiveDataCategories: ['private_record'],
      minimumRiskLevel: 'high',
    });
    const evaluation = securityPolicyService.evaluate({
      userId: scope.userId,
      subjectId: null,
      resourceType: 'api',
      resourceId: providerId,
      actionType: 'execute',
      classifiedRiskLevel: classifiedRisk.level,
      securitySessionId: scope.sessionId,
    });
    return securityFactsHash(scope, providerId, permission, evaluation);
  }

  function budgetFactsHash(budget, {
    scope,
    turn,
    requestHash,
    targetAttempt,
    estimatedTokens,
  }) {
    return inputHash({
      schemaVersion: 'vio-standalone-budget-facts/v1',
      turnId: turn.turnId,
      approvedSessionId: scope.sessionId,
      targetAttempt,
      requestHash,
      estimatedTokens,
      budgetSessionId: turn.conversationId,
      decision: budget.decision,
      budget: {
        tokenBudgetId: budget.budget.tokenBudgetId,
        dailyTokenLimit: budget.budget.dailyTokenLimit,
        sessionTokenLimit: budget.budget.sessionTokenLimit,
        overagePolicy: budget.budget.overagePolicy,
        status: budget.budget.status,
        updatedAt: budget.budget.updatedAt,
      },
      projection: {
        dailyUsed: budget.projection.dailyUsed,
        dailyProjected: budget.projection.dailyProjected,
        dailyLimit: budget.projection.dailyLimit,
        sessionUsed: budget.projection.sessionUsed,
        sessionProjected: budget.projection.sessionProjected,
        sessionLimit: budget.projection.sessionLimit,
      },
    });
  }

  function assertApprovedFactsCurrent(context, scope, turn, approved, prepared) {
    assertCurrentSession(context);
    const currentSelection = modelRouterService.selectConfiguredDefaultModel(
      scope.userId,
      'chat',
    );
    const expectedModel = approved.selection.model;
    const currentModel = currentSelection.model;
    if (
      currentModel.modelId !== expectedModel.modelId
      || currentModel.providerId !== expectedModel.providerId
      || currentModel.modelName !== expectedModel.modelName
      || currentModel.provider.providerType !== expectedModel.provider.providerType
      || currentModel.provider.interfaceFormat !== expectedModel.provider.interfaceFormat
      || currentModel.provider.baseUrl !== expectedModel.provider.baseUrl
    ) {
      throw codedError(
        'MODEL_CONFIGURATION_CHANGED',
        'The selected chat model or Provider changed before the request was sent.',
      );
    }

    const currentCredential = apiProviderService.getCredentialBindingForExecution(
      scope.userId,
      expectedModel.providerId,
    );
    const currentApiKey = currentCredential.resolveApiKey();
    if (
      currentCredential.credentialBindingId !== approved.credential.credentialBindingId
      || currentApiKey !== approved.apiKey
    ) {
      throw codedError(
        'CREDENTIAL_CHANGED',
        'The Provider credential changed before the request was sent.',
      );
    }

    const approvedPermission = approved.security.permission;
    const activePermission = permissionService.inspectActivePermission(scope.userId, {
      subjectId: null,
      resourceType: 'api',
      resourceId: expectedModel.providerId,
      action: 'execute',
    });
    const activePermissionChanged = approvedPermission.permissionLevel === 'allow_once'
      ? activePermission !== null
      : (
          !activePermission
          || activePermission.permissionId !== approvedPermission.permissionId
          || activePermission.permissionLevel !== approvedPermission.permissionLevel
          || activePermission.status !== 'active'
          || activePermission.updatedAt !== approvedPermission.permissionUpdatedAt
        );
    if (activePermissionChanged) {
      throw codedError(
        'SECURITY_CONFIGURATION_CHANGED',
        'The active Permission changed before the request was sent.',
      );
    }

    const currentSecurityHash = currentSecurityFactsHash(
      scope,
      expectedModel.providerId,
      prepared.attempt.permissionId,
    );
    if (currentSecurityHash !== prepared.attempt.securityFactsHash) {
      throw codedError(
        'SECURITY_CONFIGURATION_CHANGED',
        'Permission or security policy facts changed before the request was sent.',
      );
    }

    const currentBudget = proactiveInteractionService.previewTokenBudget(
      scope.userId,
      scope.assistantId,
      {
        estimatedTokens: approved.estimatedTokens,
        budgetSessionId: turn.conversationId,
      },
    );
    const currentBudgetHash = budgetFactsHash(currentBudget, {
      scope,
      turn,
      requestHash: approved.requestHash,
      targetAttempt: prepared.attempt.attemptNumber,
      estimatedTokens: approved.estimatedTokens,
    });
    if (currentBudgetHash !== prepared.attempt.budgetFactsHash) {
      throw codedError(
        'TOKEN_BUDGET_CHANGED',
        'Token budget facts changed before the request was sent.',
      );
    }
    if (currentBudget.decision === 'confirm') {
      const budgetApproval = repository.findBudgetApproval(
        turn.turnId,
        prepared.attempt.attemptNumber,
        currentBudgetHash,
      );
      if (
        !budgetApproval
        || budgetApproval.budgetApprovalId !== prepared.attempt.budgetApprovalId
        || budgetApproval.approvedBySessionId !== scope.sessionId
      ) {
        throw codedError(
          'TOKEN_BUDGET_CONFIRMATION_REQUIRED',
          'The current Provider attempt does not have a matching budget approval.',
        );
      }
    } else if (currentBudget.decision !== 'allow') {
      throw codedError(
        currentBudget.decision === 'deny' ? 'TOKEN_BUDGET_BLOCKED' : 'TOKEN_BUDGET_DEFERRED',
        'The current token budget no longer permits the Provider request.',
      );
    }
  }

  function preflight(scope, turn, confirmation = {}) {
    let selection;
    try {
      selection = modelRouterService.selectConfiguredDefaultModel(scope.userId, 'chat');
    } catch (error) {
      const code = modelFailureCode(error);
      if (!code) throw error;
      return { turn: retryablePreflightFailure(turn, turn.status, code, 'model_preflight_failed') };
    }
    const { model } = selection;
    if (model.provider.interfaceFormat !== 'openai_compatible') {
      return {
        turn: terminalPreflightFailure(
          turn,
          turn.status,
          'PROVIDER_INTERFACE_UNSUPPORTED',
          'provider_interface_not_supported',
        ),
      };
    }

    let credential;
    try {
      credential = apiProviderService.getCredentialBindingForExecution(
        scope.userId,
        model.providerId,
      );
    } catch (error) {
      const code = credentialFailureCode(error);
      if (!code) throw error;
      return { turn: retryablePreflightFailure(turn, turn.status, code, 'credential_preflight_failed') };
    }

    const messages = providerMessages(scope, turn);
    const estimatedTokens = conservativeTokenEstimate(messages);
    const requestHash = inputHash({
      providerId: model.providerId,
      modelId: model.modelId,
      modelName: model.modelName,
      messages,
      maxOutputCharacters: MAX_OUTPUT_CHARACTERS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const targetAttempt = targetAttemptNumber(turn);
    let budget;
    let budgetApproval = null;
    let budgetSnapshot;
    let approvedBudgetFactsHash;
    try {
      budgetSnapshot = proactiveInteractionService.previewTokenBudget(
        scope.userId,
        scope.assistantId,
        {
          estimatedTokens,
          budgetSessionId: turn.conversationId,
        },
      );
      approvedBudgetFactsHash = budgetFactsHash(budgetSnapshot, {
        scope,
        turn,
        requestHash,
        targetAttempt,
        estimatedTokens,
      });
      if (budgetSnapshot.decision === 'confirm') {
        budgetApproval = repository.findBudgetApproval(
          turn.turnId,
          targetAttempt,
          approvedBudgetFactsHash,
        );
      }
      if (budgetSnapshot.decision === 'confirm' && !budgetApproval) {
        budget = proactiveInteractionService.checkTokenBudget(
          scope.userId,
          scope.assistantId,
          {
            estimatedTokens,
            budgetSessionId: turn.conversationId,
            ...(turn.status === 'waiting_budget' && confirmation.confirmationId
              ? { confirmationId: confirmation.confirmationId }
              : {}),
            // Bind both creation and consumption of the budget confirmation
            // to the same authenticated personal session.
            securitySessionId: scope.sessionId,
          },
        );
        if (budget.decision === 'allow') {
          budgetApproval = repository.insertBudgetApproval({
            budgetApprovalId: idFactory(),
            turnId: turn.turnId,
            userId: turn.userId,
            assistantId: turn.assistantId,
            conversationId: turn.conversationId,
            targetAttemptNumber: targetAttempt,
            tokenBudgetId: budgetSnapshot.budget.tokenBudgetId,
            budgetSessionId: turn.conversationId,
            estimatedTokens,
            dailyTokenLimit: budgetSnapshot.budget.dailyTokenLimit,
            sessionTokenLimit: budgetSnapshot.budget.sessionTokenLimit,
            overagePolicy: budgetSnapshot.budget.overagePolicy,
            budgetUpdatedAt: budgetSnapshot.budget.updatedAt,
            dailyProjected: budgetSnapshot.projection.dailyProjected,
            sessionProjected: budgetSnapshot.projection.sessionProjected,
            requestHash,
            budgetFactsHash: approvedBudgetFactsHash,
            confirmationId: confirmation.confirmationId,
            securityAuditLogId: budget.security.auditLogId,
            approvedBySessionId: scope.sessionId,
            approvedAt: clock().toISOString(),
          });
        }
      } else {
        budget = budgetSnapshot.decision === 'confirm'
          ? { ...budgetSnapshot, decision: 'allow', operationStatus: 'confirmed_budget' }
          : budgetSnapshot;
      }
    } catch (error) {
      const code = budgetFailureCode(error);
      if (!code) throw error;
      return { turn: retryablePreflightFailure(turn, turn.status, code, 'budget_preflight_failed') };
    }
    if (budget.decision === 'confirm') {
      return {
        turn: repository.transitionTurn(turn.turnId, turn.status, 'waiting_budget', {
          confirmationId: budget.security.confirmation.confirmationId,
          confirmationKind: 'budget',
          publicFailureCode: 'TOKEN_BUDGET_CONFIRMATION_REQUIRED',
          recoveryReason: 'token_budget_confirmation_required',
          updatedAt: clock().toISOString(),
        }),
      };
    }
    if (budget.decision === 'deny') {
      return {
        turn: terminalPreflightFailure(
          turn,
          turn.status,
          'TOKEN_BUDGET_BLOCKED',
          'token_budget_blocked',
        ),
      };
    }
    if (budget.decision === 'defer') {
      return {
        turn: retryablePreflightFailure(
          turn,
          turn.status,
          'TOKEN_BUDGET_DEFERRED',
          'token_budget_deferred',
        ),
      };
    }

    const security = securityService.checkSecurity(scope.userId, {
      subjectId: null,
      resourceType: 'api',
      resourceId: model.providerId,
      action: 'execute',
      operationType: 'privacy_access_request',
      sensitiveDataCategories: ['private_record'],
      ...(turn.status === 'waiting_confirmation' && confirmation.confirmationId
        ? { confirmationId: confirmation.confirmationId }
        : {}),
      securitySessionId: scope.sessionId,
    }, { minimumRiskLevel: 'high' });
    if (security.decision === 'confirm') {
      return {
        turn: repository.transitionTurn(turn.turnId, turn.status, 'waiting_confirmation', {
          confirmationId: security.confirmation.confirmationId,
          confirmationKind: 'security',
          publicFailureCode: 'SECURITY_CONFIRMATION_REQUIRED',
          recoveryReason: 'security_confirmation_required',
          updatedAt: clock().toISOString(),
        }),
      };
    }
    if (security.decision !== 'allow') {
      const code = security.permission.decision === 'deny'
        ? 'PERMISSION_DENIED'
        : 'SECURITY_DENIED';
      return {
        turn: terminalPreflightFailure(turn, turn.status, code, 'security_preflight_denied'),
      };
    }
    const approvedSecurityFactsHash = securityFactsHash(
      scope,
      model.providerId,
      security.permission,
      security.securityPolicy,
    );

    let apiKey;
    try {
      apiKey = credential.resolveApiKey();
    } catch (error) {
      const code = credentialFailureCode(error);
      if (!code) throw error;
      return { turn: retryablePreflightFailure(turn, turn.status, code, 'credential_resolution_failed') };
    }

    const request = Object.freeze({
      provider: model.provider,
      model,
      messages,
      deadlineAt: new Date(clock().getTime() + EXECUTION_DEADLINE_MS).toISOString(),
      maxOutputCharacters: MAX_OUTPUT_CHARACTERS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    return {
      selection,
      credential,
      budget,
      security,
      apiKey,
      request,
      requestHash,
      estimatedTokens,
      targetAttempt,
      budgetApproval,
      budgetFactsHash: approvedBudgetFactsHash,
      securityFactsHash: approvedSecurityFactsHash,
    };
  }

  function prepareExecution(scope, turn, approved) {
    const now = clock().toISOString();
    let execution = repository.findExecutionByTurn(turn.turnId);
    const snapshot = {
      providerId: approved.selection.model.providerId,
      modelId: approved.selection.model.modelId,
      credentialBindingId: approved.credential.credentialBindingId,
      tokenBudgetId: approved.budget.budget.tokenBudgetId,
      budgetSessionId: turn.conversationId,
      providerType: approved.selection.model.provider.providerType,
      providerInterfaceFormat: approved.selection.model.provider.interfaceFormat,
      modelName: approved.selection.model.modelName,
      requestHash: approved.requestHash,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    };
    if (execution) {
      const changed = Object.entries(snapshot).some(([key, value]) => execution[key] !== value);
      if (changed || execution.status !== 'retryable') {
        throw codedError(
          'TURN_RETRY_NOT_ALLOWED',
          'The persisted standalone execution cannot be retried with changed facts.',
        );
      }
      execution = repository.transitionExecution(
        execution.executionId,
        'retryable',
        'prepared',
        { updatedAt: now },
      );
    } else {
      execution = repository.insertExecution({
        executionId: idFactory(),
        turnId: turn.turnId,
        userId: turn.userId,
        assistantId: turn.assistantId,
        conversationId: turn.conversationId,
        ...snapshot,
        permissionDecision: 'allow',
        securityDecision: 'allow',
        budgetDecision: 'allow',
        estimatedTokens: approved.estimatedTokens,
        securityAuditLogId: approved.security.auditLogId,
        permissionId: approved.security.permission.permissionId,
        permissionUpdatedAt: approved.security.permission.permissionUpdatedAt,
        securityFactsHash: approved.securityFactsHash,
        budgetFactsHash: approved.budgetFactsHash,
        budgetApprovalId: approved.budgetApproval?.budgetApprovalId ?? null,
        startedAt: now,
      });
    }
    const attempt = repository.startAttempt({
      attemptId: idFactory(),
      executionId: execution.executionId,
      securityAuditLogId: approved.security.auditLogId,
      permissionId: approved.security.permission.permissionId,
      permissionUpdatedAt: approved.security.permission.permissionUpdatedAt,
      securityFactsHash: approved.securityFactsHash,
      budgetFactsHash: approved.budgetFactsHash,
      budgetApprovalId: approved.budgetApproval?.budgetApprovalId ?? null,
      requestHash: approved.requestHash,
      startedAt: now,
    });
    repository.transitionTurn(turn.turnId, turn.status, 'executing', { updatedAt: now });
    repository.transitionExecution(execution.executionId, 'prepared', 'in_flight', {
      // This is an aggregate fact for the logical execution. A later safe
      // attempt must never erase that an earlier attempt reached the Provider
      // boundary.
      providerCallMayHaveStarted: execution.providerCallMayHaveStarted,
      updatedAt: now,
    });
    repository.transitionAttempt(attempt.attemptId, 'prepared', 'in_flight', {
      providerCallMayHaveStarted: false,
    });
    return {
      execution: repository.findExecution(execution.executionId),
      attempt: repository.findLatestAttemptByExecution(execution.executionId),
    };
  }

  function usageFact(execution, attempt, result) {
    const sent = result.requestMayHaveBeenSent;
    const succeeded = result.status === 'SUCCEEDED';
    const usage = succeeded ? result.usage : null;
    return repository.insertUsage({
      usageLedgerEntryId: idFactory(),
      executionId: execution.executionId,
      attemptId: attempt.attemptId,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      usageStatus: succeeded ? 'provider_reported' : (sent ? 'unknown' : 'not_incurred'),
      costStatus: succeeded
        ? (result.cost?.status ?? 'not_reported')
        : (sent ? 'not_reported' : 'not_incurred'),
      costAmountMicros: succeeded ? (result.cost?.amountMicros ?? null) : null,
      costCurrency: succeeded ? (result.cost?.currency ?? null) : null,
      occurredAt: result.completedAt,
      recordedAt: clock().toISOString(),
    });
  }

  function persistExecutionResult(turn, execution, attempt, result) {
    const now = clock().toISOString();
    return runInTransaction(() => {
      if (result.status === 'SUCCEEDED') {
        repository.transitionAttempt(attempt.attemptId, 'in_flight', 'response_received', {
          providerCallMayHaveStarted: true,
          completedAt: result.completedAt,
        });
        repository.transitionExecution(execution.executionId, 'in_flight', 'succeeded', {
          providerCallMayHaveStarted: true,
          completedAt: result.completedAt,
          updatedAt: now,
        });
        const usage = usageFact(execution, attempt, result);
        const providerResult = Object.freeze({
          schemaVersion: 'vio-standalone-model-result/v1',
          responseCandidate: result.output.responseCandidate,
          finishReason: result.output.finishReason,
          usage: result.usage,
        });
        const resultJson = canonicalizeJson(providerResult).toString('utf8');
        repository.insertProviderResult({
          providerResultId: idFactory(),
          executionId: execution.executionId,
          attemptId: attempt.attemptId,
          usageLedgerEntryId: usage.usageLedgerEntryId,
          resultHash: sha256Hash(Buffer.from(resultJson, 'utf8')),
          responseContentHash: sha256Hash(Buffer.from(
            providerResult.responseCandidate,
            'utf8',
          )),
          resultJson,
          finishReason: providerResult.finishReason,
          receivedAt: result.completedAt,
        });
        return repository.transitionTurn(turn.turnId, 'executing', 'result_ready', {
          updatedAt: now,
        });
      }

      const safeRetry = result.status === 'FAILED_RETRYABLE';
      const attemptStatus = safeRetry
        ? (result.requestMayHaveBeenSent ? 'retryable' : 'not_sent')
        : result.status === 'UNKNOWN'
          ? 'outcome_unknown'
          : result.status === 'CANCELLED'
            ? 'cancelled'
            : 'failed_terminal';
      repository.transitionAttempt(attempt.attemptId, 'in_flight', attemptStatus, {
        providerCallMayHaveStarted: result.requestMayHaveBeenSent,
        completedAt: result.completedAt,
        errorCode: result.errorCode,
      });
      usageFact(execution, attempt, result);
      if (safeRetry) {
        repository.transitionExecution(execution.executionId, 'in_flight', 'retryable', {
          providerCallMayHaveStarted: execution.providerCallMayHaveStarted
            || result.requestMayHaveBeenSent,
          errorCode: result.errorCode,
          updatedAt: now,
        });
        return repository.transitionTurn(turn.turnId, 'executing', 'retryable', {
          publicFailureCode: result.requestMayHaveBeenSent
            ? 'PROVIDER_RETRYABLE_FAILURE'
            : 'PROVIDER_REQUEST_NOT_SENT',
          recoveryReason: result.errorCode,
          updatedAt: now,
        });
      }
      if (result.status === 'UNKNOWN') {
        repository.transitionExecution(execution.executionId, 'in_flight', 'outcome_unknown', {
          providerCallMayHaveStarted: true,
          completedAt: result.completedAt,
          errorCode: result.errorCode,
          updatedAt: now,
        });
        return repository.transitionTurn(turn.turnId, 'executing', 'outcome_unknown', {
          publicFailureCode: 'PROVIDER_OUTCOME_UNKNOWN',
          recoveryReason: result.errorCode,
          updatedAt: now,
        });
      }
      const executionStatus = result.status === 'CANCELLED' ? 'cancelled' : 'failed_terminal';
      repository.transitionExecution(execution.executionId, 'in_flight', executionStatus, {
        providerCallMayHaveStarted: execution.providerCallMayHaveStarted
          || result.requestMayHaveBeenSent,
        completedAt: result.completedAt,
        errorCode: result.errorCode,
        updatedAt: now,
      });
      const turnStatus = result.status === 'CANCELLED' ? 'cancelled' : 'failed';
      return repository.transitionTurn(turn.turnId, 'executing', turnStatus, {
        publicFailureCode: result.status === 'CANCELLED'
          ? 'TURN_CANCELLED'
          : 'PROVIDER_TERMINAL_FAILURE',
        recoveryReason: result.errorCode,
        updatedAt: now,
      });
    });
  }

  async function publishResult(context, turn) {
    assertCurrentSession(context);
    const result = repository.findProviderResultByTurn(turn.turnId);
    if (!result) {
      throw codedError(
        'STANDALONE_LEDGER_INCONSISTENT',
        'Standalone chat result is missing.',
        500,
      );
    }
    if (turn.status === 'publishing') {
      return repository.completeTurn(turn.turnId, clock().toISOString())
        ?? repository.findTurn(turn.userId, turn.assistantId, turn.turnId);
    }
    if (turn.status !== 'result_ready') return turn;
    return runInTransaction(() => {
      const message = messageService.createMessage(
        turn.userId,
        turn.assistantId,
        turn.conversationId,
        { senderType: 'subject', content: result.result.responseCandidate },
      );
      const attached = repository.attachAssistantMessage(turn.turnId, 'result_ready', {
        assistantMessageId: message.messageId,
        assistantMessageVersionId: message.currentVersionId,
        updatedAt: clock().toISOString(),
      });
      return repository.completeTurn(attached.turnId, clock().toISOString());
    });
  }

  async function executeApproved(context, scope, turn, approved, prepared) {
    let result;
    try {
      result = await modelExecutor.executeChat({
        ...approved.request,
        apiKey: approved.apiKey,
        onRequestStart: () => runInTransaction(() => {
          assertApprovedFactsCurrent(context, scope, turn, approved, prepared);
          const now = clock().toISOString();
          repository.transitionExecution(
            prepared.execution.executionId,
            'in_flight',
            'in_flight',
            { providerCallMayHaveStarted: true, updatedAt: now },
          );
          repository.transitionAttempt(
            prepared.attempt.attemptId,
            'in_flight',
            'in_flight',
            { providerCallMayHaveStarted: true },
          );
        }),
      });
    } catch {
      const completedAt = clock().toISOString();
      const currentAttempt = repository.findLatestAttemptByExecution(
        prepared.execution.executionId,
      );
      const requestMayHaveBeenSent = currentAttempt?.providerCallMayHaveStarted !== false;
      result = Object.freeze({
        status: requestMayHaveBeenSent ? 'UNKNOWN' : 'FAILED_RETRYABLE',
        output: null,
        usage: null,
        errorCode: requestMayHaveBeenSent
          ? 'PROVIDER_EXECUTION_INTERRUPTED'
          : 'PROVIDER_REQUEST_NOT_SENT',
        requestMayHaveBeenSent,
        startedAt: prepared.attempt.startedAt,
        completedAt,
        cost: Object.freeze({
          status: requestMayHaveBeenSent ? 'not_reported' : 'not_incurred',
          amountMicros: null,
          currency: null,
        }),
      });
    }
    result = normalizeStandaloneProviderResult(result);
    const currentAttempt = repository.findLatestAttemptByExecution(
      prepared.execution.executionId,
    );
    if (currentAttempt?.providerCallMayHaveStarted && !result.requestMayHaveBeenSent) {
      result = Object.freeze({
        ...result,
        status: 'UNKNOWN',
        output: null,
        usage: null,
        errorCode: 'PROVIDER_EXECUTION_INTERRUPTED',
        requestMayHaveBeenSent: true,
        cost: Object.freeze({ status: 'not_reported', amountMicros: null, currency: null }),
      });
    }
    let persisted = persistExecutionResult(
      repository.findTurn(turn.userId, turn.assistantId, turn.turnId),
      prepared.execution,
      prepared.attempt,
      result,
    );
    if (persisted.status === 'result_ready') {
      await faultInjector?.afterResultPersisted?.({
        turnId: persisted.turnId,
        executionId: prepared.execution.executionId,
      });
      persisted = await publishResult(context, persisted);
    } else {
      assertCurrentSession(context);
    }
    return persisted;
  }

  async function advance(context, scope, turn, input, action) {
    if (turn.status === 'result_ready' || turn.status === 'publishing') {
      if (action !== 'resume' && action !== 'initial') {
        throw codedError('TURN_RETRY_NOT_ALLOWED', 'Only local result publication can resume.');
      }
      return publishResult(context, turn);
    }
    if (turn.status === 'outcome_unknown') {
      throw codedError(
        'PROVIDER_OUTCOME_UNKNOWN',
        'The Provider outcome cannot be retried without reconciliation.',
      );
    }
    if (TERMINAL_TURN_STATUSES.has(turn.status)) {
      throw codedError('TURN_RETRY_NOT_ALLOWED', 'This standalone chat turn is terminal.');
    }
    if (action === 'cancel') {
      if (!['processing', 'waiting_confirmation', 'waiting_budget', 'retryable', 'ready'].includes(turn.status)) {
        throw codedError('TURN_RETRY_NOT_ALLOWED', 'This turn cannot be cancelled safely.');
      }
      return runInTransaction(() => {
        finishExistingExecution(turn, 'cancelled', 'TURN_CANCELLED');
        return repository.transitionTurn(turn.turnId, turn.status, 'cancelled', {
          publicFailureCode: 'TURN_CANCELLED',
          recoveryReason: 'cancelled_by_owner',
          updatedAt: clock().toISOString(),
        });
      });
    }
    if (turn.status === 'retryable' && action !== 'retry') {
      throw codedError('TURN_RETRY_NOT_ALLOWED', 'An explicit retry action is required.');
    }
    if (['processing', 'ready'].includes(turn.status)
      && !['initial', 'resume'].includes(action)) {
      throw codedError('TURN_RETRY_NOT_ALLOWED', 'Only an explicit resume action is allowed.');
    }
    if (['waiting_confirmation', 'waiting_budget'].includes(turn.status)) {
      if (action !== 'resume') {
        throw codedError('TURN_RETRY_NOT_ALLOWED', 'A confirmation resume action is required.');
      }
      if (!input.confirmationId || input.confirmationId !== turn.confirmationId) {
        throw new ConflictError('The confirmation does not belong to this standalone turn.');
      }
    } else if (input.confirmationId) {
      throw new ValidationError('confirmationId is only accepted for a waiting turn.', {
        field: 'confirmationId',
      });
    }

    const decision = runInTransaction(() => {
      const approved = preflight(scope, turn, input);
      if (approved.turn) return { turn: approved.turn };
      assertCurrentSession(context);
      const ready = repository.transitionTurn(turn.turnId, turn.status, 'ready', {
        updatedAt: clock().toISOString(),
      });
      return {
        approved,
        prepared: prepareExecution(scope, ready, approved),
      };
    });
    if (decision.turn) return decision.turn;
    return executeApproved(context, scope, turn, decision.approved, decision.prepared);
  }

  async function createTurn(context, value, idempotencyKey) {
    const scope = currentScope(context);
    assertCurrentSession(context);
    const input = requireCreateInput(value);
    const key = requireIdempotencyKey(idempotencyKey);
    const hash = inputHash(input);
    const existing = repository.findTurnByOwnerIdempotencyKey(scope.userId, key);
    if (existing) {
      if (existing.assistantId !== scope.assistantId) {
        throw new ConflictError(
          'Idempotency-Key is already bound to a different assistant.',
        );
      }
      if (existing.inputContentHash !== hash) {
        throw new ConflictError('Idempotency-Key is bound to different chat content.');
      }
      return publicTurn(existing);
    }

    const turn = runInTransaction(() => {
      let mapping = repository.findDefaultConversation(scope.userId, scope.assistantId);
      if (!mapping) {
        const conversation = conversationService.createConversation(
          scope.userId,
          scope.assistantId,
          { title: `Chat with ${scope.assistant.name}` },
        );
        mapping = repository.insertDefaultConversation({
          userId: scope.userId,
          assistantId: scope.assistantId,
          conversationId: conversation.conversationId,
          createdAt: clock().toISOString(),
        });
      }
      const active = repository.findActiveTurn(
        scope.userId,
        scope.assistantId,
        mapping.conversationId,
      );
      if (active) {
        throw codedError(
          'TURN_ALREADY_ACTIVE',
          'The current assistant already has an active standalone chat turn.',
        );
      }
      const userMessage = messageService.createMessage(
        scope.userId,
        scope.assistantId,
        mapping.conversationId,
        { senderType: 'user', content: input.content },
      );
      const sourceEvent = eventRepository.findMessageCreatedByMessage(
        scope.userId,
        scope.assistantId,
        userMessage.messageId,
      );
      if (!sourceEvent) {
        throw codedError('STANDALONE_LEDGER_INCONSISTENT', 'User message event is missing.', 500);
      }
      return repository.insertTurn({
        turnId: idFactory(),
        userId: scope.userId,
        assistantId: scope.assistantId,
        conversationId: mapping.conversationId,
        createdBySessionId: scope.sessionId,
        idempotencyKey: key,
        inputContentHash: hash,
        userMessageId: userMessage.messageId,
        userMessageVersionId: userMessage.currentVersionId,
        sourceEventId: sourceEvent.eventId,
        createdAt: clock().toISOString(),
      });
    });
    return publicTurn(await advance(context, scope, turn, {}, 'initial'));
  }

  function validateRecoveryIntent(turn, input) {
    if (turn.status === 'result_ready' || turn.status === 'publishing') {
      if (input.action !== 'resume') {
        throw codedError('TURN_RETRY_NOT_ALLOWED', 'Only local result publication can resume.');
      }
      return;
    }
    if (turn.status === 'outcome_unknown') {
      throw codedError(
        'PROVIDER_OUTCOME_UNKNOWN',
        'The Provider outcome cannot be retried without reconciliation.',
      );
    }
    if (TERMINAL_TURN_STATUSES.has(turn.status)) {
      throw codedError('TURN_RETRY_NOT_ALLOWED', 'This standalone chat turn is terminal.');
    }
    if (input.action === 'cancel') {
      if (!['processing', 'waiting_confirmation', 'waiting_budget', 'retryable', 'ready'].includes(turn.status)) {
        throw codedError('TURN_RETRY_NOT_ALLOWED', 'This turn cannot be cancelled safely.');
      }
      return;
    }
    if (turn.status === 'retryable' && input.action !== 'retry') {
      throw codedError('TURN_RETRY_NOT_ALLOWED', 'An explicit retry action is required.');
    }
    if (['processing', 'ready'].includes(turn.status) && input.action !== 'resume') {
      throw codedError('TURN_RETRY_NOT_ALLOWED', 'Only an explicit resume action is allowed.');
    }
    if (['waiting_confirmation', 'waiting_budget'].includes(turn.status)) {
      if (input.action !== 'resume') {
        throw codedError('TURN_RETRY_NOT_ALLOWED', 'A confirmation resume action is required.');
      }
      if (!input.confirmationId || input.confirmationId !== turn.confirmationId) {
        throw new ConflictError('The confirmation does not belong to this standalone turn.');
      }
    } else if (input.confirmationId) {
      throw new ValidationError('confirmationId is only accepted for a waiting turn.', {
        field: 'confirmationId',
      });
    }
  }

  function recoveryHasProgressed(recovery, turn) {
    if (turn.status !== recovery.turnStatusBefore) return true;
    const execution = repository.findExecutionByTurn(turn.turnId);
    const attemptCount = execution
      ? repository.listAttemptsByExecution(execution.executionId).length
      : 0;
    return attemptCount > recovery.attemptCountBefore;
  }

  async function recoverTurn(context, turnId, value, idempotencyKey) {
    const scope = currentScope(context);
    assertCurrentSession(context);
    const input = requireRecoveryInput(value);
    const key = requireIdempotencyKey(idempotencyKey);
    const turn = turnForScope(scope, turnId);
    const hash = inputHash(input);
    const existing = repository.findRecoveryByKey(scope.userId, scope.assistantId, key);
    if (existing) {
      if (existing.turnId !== turn.turnId
        || existing.actionType !== input.action
        || existing.contentHash !== hash) {
        throw new ConflictError('Recovery Idempotency-Key is bound to a different action.');
      }
      const current = repository.findTurn(scope.userId, scope.assistantId, turn.turnId);
      if (existing.status === 'completed' || recoveryHasProgressed(existing, current)) {
        if (existing.status === 'pending') {
          repository.completeRecovery(existing.recoveryActionId, clock().toISOString());
        }
        return publicTurn(current);
      }
      validateRecoveryIntent(current, input);
      const persistedInput = JSON.parse(existing.inputJson);
      const advanced = await advance(
        context,
        scope,
        current,
        persistedInput,
        existing.actionType,
      );
      repository.completeRecovery(existing.recoveryActionId, clock().toISOString());
      return publicTurn(advanced);
    }
    validateRecoveryIntent(turn, input);
    const execution = repository.findExecutionByTurn(turn.turnId);
    const attemptCountBefore = execution
      ? repository.listAttemptsByExecution(execution.executionId).length
      : 0;
    const recovery = repository.insertRecovery({
      recoveryActionId: idFactory(),
      userId: scope.userId,
      assistantId: scope.assistantId,
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      idempotencyKey: key,
      actionType: input.action,
      contentHash: hash,
      inputJson: canonicalizeJson(input).toString('utf8'),
      turnStatusBefore: turn.status,
      attemptCountBefore,
      createdAt: clock().toISOString(),
    });
    const advanced = await advance(context, scope, turn, input, input.action);
    repository.completeRecovery(recovery.recoveryActionId, clock().toISOString());
    return publicTurn(advanced);
  }

  return Object.freeze({
    initialize() {
      for (const execution of repository.listAmbiguousExecutions()) {
        if (execution.status !== 'in_flight') continue;
        runInTransaction(() => {
          const attempt = repository.findLatestAttemptByExecution(execution.executionId);
          const now = clock().toISOString();
          const requestWasDurablyNotSent = attempt?.status === 'in_flight'
            && attempt.providerCallMayHaveStarted === false;
          if (attempt?.status === 'in_flight') {
            repository.transitionAttempt(
              attempt.attemptId,
              'in_flight',
              requestWasDurablyNotSent ? 'not_sent' : 'outcome_unknown',
              {
                providerCallMayHaveStarted: requestWasDurablyNotSent ? false : true,
                completedAt: now,
                errorCode: 'PROCESS_INTERRUPTED',
              },
            );
            usageFact(execution, attempt, {
              status: requestWasDurablyNotSent ? 'FAILED_RETRYABLE' : 'UNKNOWN',
              requestMayHaveBeenSent: !requestWasDurablyNotSent,
              completedAt: now,
            });
          }
          repository.transitionExecution(
            execution.executionId,
            'in_flight',
            requestWasDurablyNotSent ? 'retryable' : 'outcome_unknown',
            {
              providerCallMayHaveStarted: execution.providerCallMayHaveStarted
                || !requestWasDurablyNotSent,
              completedAt: requestWasDurablyNotSent ? null : now,
              errorCode: 'PROCESS_INTERRUPTED',
              updatedAt: now,
            },
          );
          const turn = repository.findTurn(
            execution.userId,
            execution.assistantId,
            execution.turnId,
          );
          if (turn?.status === 'executing') {
            repository.transitionTurn(
              turn.turnId,
              'executing',
              requestWasDurablyNotSent ? 'retryable' : 'outcome_unknown',
              {
                publicFailureCode: requestWasDurablyNotSent
                  ? 'PROVIDER_REQUEST_NOT_SENT'
                  : 'PROVIDER_OUTCOME_UNKNOWN',
                recoveryReason: 'PROCESS_INTERRUPTED',
                updatedAt: now,
              },
            );
          }
        });
      }
    },

    getDefaultChat(context) {
      const scope = currentScope(context);
      const mapping = repository.findDefaultConversation(scope.userId, scope.assistantId);
      if (!mapping) {
        return Object.freeze({
          assistant: publicAssistant(scope.assistant),
          conversation: null,
          messages: [],
          activeTurn: null,
          externalCall: 'not_performed',
        });
      }
      const conversation = conversationService.getConversation(
        scope.userId,
        scope.assistantId,
        mapping.conversationId,
      );
      const turns = repository.listTurns(
        scope.userId,
        scope.assistantId,
        mapping.conversationId,
      );
      const active = repository.findActiveTurn(
        scope.userId,
        scope.assistantId,
        mapping.conversationId,
      );
      return Object.freeze({
        assistant: publicAssistant(scope.assistant),
        conversation: Object.freeze({
          conversationId: conversation.conversationId,
          status: conversation.status,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        }),
        messages: conversationMessages(conversation.conversationId, turns),
        activeTurn: active ? publicTurn(active) : null,
        externalCall: 'not_performed',
      });
    },

    createTurn,

    getTurn(context, turnId) {
      const scope = currentScope(context);
      return publicTurn(turnForScope(scope, turnId));
    },

    getTurnByIdempotencyKey(context, idempotencyKey) {
      const scope = currentScope(context);
      const key = requireIdempotencyKey(idempotencyKey);
      const turn = repository.findTurnByIdempotencyKey(scope.userId, scope.assistantId, key);
      if (!turn) throw new NotFoundError('Standalone chat turn was not found.');
      return publicTurn(turn);
    },

    recoverTurn,
  });
}
