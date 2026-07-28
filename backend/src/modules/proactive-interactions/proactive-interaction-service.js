import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalOpaqueResourceId,
  requireOpaqueResourceId,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import { EVENT_TYPES } from '../events/event-types.js';
import {
  BACKGROUND_RUN_STATES,
  MESSAGE_PRIORITIES,
  REGISTRY_STATUSES,
  TOKEN_OVERAGE_POLICIES,
  WAKE_AUTHORIZATION_STATUSES,
  WAKE_TYPES,
  requireProactiveValue,
} from './proactive-interaction-types.js';

const SECRET_FIELD_PATTERN = /^(api[_-]?key|password|passcode|verification[_-]?code|token|secret|secret[_-]?ref|credential|credentials)$/i;
const RUNTIME_PAYLOAD_FIELD_PATTERN = /^(audio|audio[_-]?data|audio[_-]?bytes|microphone|command|script|executable|endpoint|url|prompt|message|content)$/i;
const INTERNAL_TRIGGER_EVENTS = new Set([
  'wake_trigger_prepared',
  'proactive_prompt_prepared',
]);

function requireOnlyFields(value, allowedFields, field = 'body') {
  const input = requirePlainObject(value, field);
  const unexpectedFields = Object.keys(input).filter((name) => !allowedFields.includes(name));
  if (unexpectedFields.length > 0) {
    throw new ValidationError(`${field} contains unsupported fields.`, {
      field,
      unexpectedFields,
    });
  }
  return input;
}

function assertNoSecretFields(value, path = 'configuration') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new ValidationError('Proactive configuration must not contain secret fields.', {
        field: `${path}.${key}`,
      });
    }
    if (RUNTIME_PAYLOAD_FIELD_PATTERN.test(key)) {
      throw new ValidationError(
        'Proactive configuration accepts matching metadata, not runtime payloads.',
        { field: `${path}.${key}` },
      );
    }
    assertNoSecretFields(nested, `${path}.${key}`);
  }
}

function requireConfiguration(value, field) {
  const configuration = requirePlainObject(value, field);
  if (Buffer.byteLength(JSON.stringify(configuration)) > 8_192) {
    throw new ValidationError(`${field} must not exceed 8192 bytes.`, {
      field,
      maxBytes: 8_192,
    });
  }
  assertNoSecretFields(configuration, field);
  return configuration;
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean.`, { field });
  }
  return value;
}

function requireInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field} must be an integer between ${min} and ${max}.`, {
      field,
      min,
      max,
    });
  }
  return value;
}

function normalizeTimestamp(value, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a valid ISO-8601 timestamp.`, { field });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid ISO-8601 timestamp.`, { field });
  }
  return parsed.toISOString();
}

function requireTime(value, field) {
  const normalized = requireString(value, field, { maxLength: 5 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new ValidationError(`${field} must use HH:mm format.`, { field });
  }
  return normalized;
}

function requireWakeTypeList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('allowedWakeTypes must be a non-empty array.', {
      field: 'allowedWakeTypes',
    });
  }
  const normalized = value.map((item, index) => requireProactiveValue(
    item,
    `allowedWakeTypes[${index}]`,
    WAKE_TYPES,
  ));
  return WAKE_TYPES.filter((type) => normalized.includes(type));
}

function requireQuietHours(value) {
  if (value === undefined || value === null) return null;
  const input = requireOnlyFields(value, ['start', 'end'], 'quietHours');
  return {
    start: requireTime(input.start, 'quietHours.start'),
    end: requireTime(input.end, 'quietHours.end'),
  };
}

function dayBounds(timestamp) {
  const start = new Date(timestamp);
  start.setUTCHours(0, 0, 0, 0);
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 1);
  return [start.toISOString(), next.toISOString()];
}

function executionBoundary() {
  return {
    modelCall: 'not_performed',
    microphoneAccess: 'not_performed',
    systemWake: 'not_performed',
    messageDelivery: 'not_performed',
    externalServiceCall: 'not_performed',
  };
}

function operationStatus(decision) {
  return {
    allow: 'ready',
    confirm: 'confirmation_required',
    deny: 'denied',
  }[decision];
}

export function createProactiveInteractionService({
  proactiveInteractionRepository,
  userRepository,
  subjectRepository,
  eventRepository,
  modelRepository,
  securityService,
  eventService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireScope(userId, subjectId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });
    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }
    if (!subjectRepository.findById(normalizedUserId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }
    return { userId: normalizedUserId, subjectId: normalizedSubjectId };
  }

  function requireWakeRule(scope, wakeId) {
    const normalizedWakeId = requireOpaqueResourceId(wakeId, 'wakeId');
    const rule = proactiveInteractionRepository.findWakeRule(
      scope.userId,
      scope.subjectId,
      normalizedWakeId,
    );
    if (!rule) throw new NotFoundError('Wake rule was not found in this scope.');
    return rule;
  }

  function requirePromptRule(scope, promptRuleId) {
    const normalizedPromptRuleId = requireOpaqueResourceId(promptRuleId, 'promptRuleId');
    const rule = proactiveInteractionRepository.findPromptRule(
      scope.userId,
      scope.subjectId,
      normalizedPromptRuleId,
    );
    if (!rule) throw new NotFoundError('Proactive prompt rule was not found in this scope.');
    return rule;
  }

  function createConfigurationEvent(scope, eventType, reference, summary, data) {
    return eventService.createEvent(scope.userId, {
      subjectId: scope.subjectId,
      eventType,
      source: { type: 'proactive-interaction-service', reference },
      summary,
      data,
    });
  }

  function requireBackgroundReady(scope, wakeType = null) {
    const policy = proactiveInteractionRepository.findBackgroundPolicy(
      scope.userId,
      scope.subjectId,
    );
    if (!policy || !policy.backgroundEnabled || policy.runState !== 'active') {
      return { ready: false, reason: 'background_policy_inactive', policy };
    }
    if (wakeType && !policy.limits.allowedWakeTypes.includes(wakeType)) {
      return { ready: false, reason: 'wake_type_not_allowed_in_background', policy };
    }
    if (wakeType && policy.limits.maxWakeupsPerHour === 0) {
      return { ready: false, reason: 'wakeups_disabled_by_background_limit', policy };
    }
    if (!wakeType && policy.limits.maxPromptsPerHour === 0) {
      return { ready: false, reason: 'prompts_disabled_by_background_limit', policy };
    }
    return { ready: true, reason: 'background_policy_ready', policy };
  }

  return {
    createWakeRule(userId, subjectId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, [
        'wakeType', 'triggerCondition', 'userAuthorization', 'status',
      ]);
      const now = clock().toISOString();
      const userAuthorization = input.userAuthorization === undefined
        ? 'not_granted'
        : requireProactiveValue(
            input.userAuthorization,
            'userAuthorization',
            WAKE_AUTHORIZATION_STATUSES,
          );
      const status = input.status === undefined
        ? 'disabled'
        : requireProactiveValue(input.status, 'status', REGISTRY_STATUSES);
      if (status === 'enabled' && userAuthorization !== 'granted') {
        throw new ConflictError('Wake rule cannot be enabled without user authorization.');
      }
      const rule = {
        wakeId: idFactory(),
        ...scope,
        wakeType: requireProactiveValue(input.wakeType, 'wakeType', WAKE_TYPES),
        status,
        triggerCondition: requireConfiguration(input.triggerCondition, 'triggerCondition'),
        userAuthorization,
        createdAt: now,
        updatedAt: now,
      };
      return runInTransaction(() => {
        const created = proactiveInteractionRepository.insertWakeRule(rule);
        createConfigurationEvent(
          scope,
          'wake_configuration_changed',
          created.wakeId,
          'Wake configuration was created.',
          {
            wakeId: created.wakeId,
            wakeType: created.wakeType,
            changeType: 'created',
            status: created.status,
            authorizationStatus: created.userAuthorization,
            executionStatus: 'not_executed',
          },
        );
        return created;
      });
    },
    listWakeRules(userId, subjectId) {
      const scope = requireScope(userId, subjectId);
      return proactiveInteractionRepository.listWakeRules(scope.userId, scope.subjectId);
    },
    updateWakeRule(userId, subjectId, wakeId, value) {
      const scope = requireScope(userId, subjectId);
      const existing = requireWakeRule(scope, wakeId);
      const input = requireOnlyFields(value, ['status', 'userAuthorization']);
      if (Object.keys(input).length === 0) {
        throw new ValidationError('Wake rule update requires at least one field.');
      }
      const updated = {
        ...existing,
        status: input.status === undefined
          ? existing.status
          : requireProactiveValue(input.status, 'status', REGISTRY_STATUSES),
        userAuthorization: input.userAuthorization === undefined
          ? existing.userAuthorization
          : requireProactiveValue(
              input.userAuthorization,
              'userAuthorization',
              WAKE_AUTHORIZATION_STATUSES,
            ),
        updatedAt: clock().toISOString(),
      };
      if (input.status === 'enabled' && updated.userAuthorization !== 'granted') {
        throw new ConflictError('Wake rule cannot be enabled without user authorization.');
      }
      if (updated.userAuthorization !== 'granted') updated.status = 'disabled';
      return runInTransaction(() => {
        const saved = proactiveInteractionRepository.updateWakeRule(updated);
        createConfigurationEvent(
          scope,
          'wake_configuration_changed',
          saved.wakeId,
          'Wake configuration was updated.',
          {
            wakeId: saved.wakeId,
            wakeType: saved.wakeType,
            changeType: 'updated',
            status: saved.status,
            authorizationStatus: saved.userAuthorization,
            executionStatus: 'not_executed',
          },
        );
        return saved;
      });
    },
    prepareWake(userId, subjectId, wakeId, value) {
      const scope = requireScope(userId, subjectId);
      const rule = requireWakeRule(scope, wakeId);
      const input = requireOnlyFields(value, ['confirmationId', 'securitySessionId']);
      if (rule.status !== 'enabled' || rule.userAuthorization !== 'granted') {
        throw new ConflictError('Wake rule is not enabled and authorized.');
      }
      const background = requireBackgroundReady(scope, rule.wakeType);
      if (!background.ready) {
        return {
          operationStatus: 'suppressed',
          reason: background.reason,
          wakeRule: rule,
          backgroundPolicy: background.policy,
          execution: executionBoundary(),
        };
      }
      return runInTransaction(() => {
        const security = securityService.checkSecurity(scope.userId, {
          subjectId: scope.subjectId,
          resourceType: 'proactive_interaction',
          resourceId: rule.wakeId,
          action: 'execute',
          operationType: 'general_access',
          sensitiveDataCategories: [],
          ...(input.confirmationId ? {
            confirmationId: requireOpaqueResourceId(input.confirmationId, 'confirmationId'),
          } : {}),
          ...(input.securitySessionId ? {
            securitySessionId: requireOpaqueResourceId(
              input.securitySessionId,
              'securitySessionId',
            ),
          } : {}),
        }, { minimumRiskLevel: 'medium' });
        createConfigurationEvent(
          scope,
          'wake_trigger_prepared',
          rule.wakeId,
          'Wake trigger was evaluated without execution.',
          {
            wakeId: rule.wakeId,
            wakeType: rule.wakeType,
            operationStatus: operationStatus(security.decision),
            auditLogId: security.auditLogId,
            executionStatus: 'not_executed',
          },
        );
        return {
          operationStatus: operationStatus(security.decision),
          wakeRule: rule,
          backgroundPolicy: background.policy,
          security,
          execution: executionBoundary(),
        };
      });
    },
    createPromptRule(userId, subjectId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, [
        'name', 'priority', 'triggerEventType', 'condition',
        'requiresConfirmation', 'status',
      ]);
      const triggerEventType = requireProactiveValue(
        input.triggerEventType,
        'triggerEventType',
        EVENT_TYPES,
      );
      if (INTERNAL_TRIGGER_EVENTS.has(triggerEventType)) {
        throw new ValidationError('Internal preparation events cannot trigger prompt rules.', {
          field: 'triggerEventType',
        });
      }
      const now = clock().toISOString();
      const rule = {
        promptRuleId: idFactory(),
        ...scope,
        name: requireString(input.name, 'name', { maxLength: 120 }),
        priority: requireProactiveValue(input.priority, 'priority', MESSAGE_PRIORITIES),
        triggerEventType,
        condition: requireConfiguration(input.condition, 'condition'),
        requiresConfirmation: requireBoolean(
          input.requiresConfirmation,
          'requiresConfirmation',
        ),
        status: input.status === undefined
          ? 'disabled'
          : requireProactiveValue(input.status, 'status', REGISTRY_STATUSES),
        createdAt: now,
        updatedAt: now,
      };
      return proactiveInteractionRepository.insertPromptRule(rule);
    },
    listPromptRules(userId, subjectId) {
      const scope = requireScope(userId, subjectId);
      return proactiveInteractionRepository.listPromptRules(scope.userId, scope.subjectId);
    },
    updatePromptRule(userId, subjectId, promptRuleId, value) {
      const scope = requireScope(userId, subjectId);
      const existing = requirePromptRule(scope, promptRuleId);
      const input = requireOnlyFields(value, ['priority', 'requiresConfirmation', 'status']);
      if (Object.keys(input).length === 0) {
        throw new ValidationError('Prompt rule update requires at least one field.');
      }
      return proactiveInteractionRepository.updatePromptRule({
        ...existing,
        priority: input.priority === undefined
          ? existing.priority
          : requireProactiveValue(input.priority, 'priority', MESSAGE_PRIORITIES),
        requiresConfirmation: input.requiresConfirmation === undefined
          ? existing.requiresConfirmation
          : requireBoolean(input.requiresConfirmation, 'requiresConfirmation'),
        status: input.status === undefined
          ? existing.status
          : requireProactiveValue(input.status, 'status', REGISTRY_STATUSES),
        updatedAt: clock().toISOString(),
      });
    },
    preparePrompt(userId, subjectId, promptRuleId, value) {
      const scope = requireScope(userId, subjectId);
      const rule = requirePromptRule(scope, promptRuleId);
      const input = requireOnlyFields(value, [
        'triggerEventId', 'confirmationId', 'securitySessionId',
      ]);
      if (rule.status !== 'enabled') {
        throw new ConflictError('Proactive prompt rule is disabled.');
      }
      const triggerEventId = requireOpaqueResourceId(input.triggerEventId, 'triggerEventId');
      const triggerEvent = eventRepository.findById(scope.userId, triggerEventId);
      if (
        !triggerEvent
        || triggerEvent.eventType !== rule.triggerEventType
        || (triggerEvent.subjectId && triggerEvent.subjectId !== scope.subjectId)
      ) {
        throw new NotFoundError('Trigger Event was not found in the prompt rule scope.');
      }
      const background = requireBackgroundReady(scope);
      const silent = rule.priority === 'silent';
      if (!background.ready || silent) {
        return runInTransaction(() => {
          const record = proactiveInteractionRepository.insertPromptRecord({
            promptRecordId: idFactory(),
            ...scope,
            promptRuleId: rule.promptRuleId,
            triggerEventId,
            priority: rule.priority,
            status: 'suppressed',
            securityAuditLogId: null,
            createdAt: clock().toISOString(),
          });
          createConfigurationEvent(
            scope,
            'proactive_prompt_prepared',
            record.promptRecordId,
            'Proactive prompt was suppressed without delivery.',
            {
              promptRecordId: record.promptRecordId,
              promptRuleId: rule.promptRuleId,
              triggerEventId,
              priority: rule.priority,
              operationStatus: 'suppressed',
              reason: silent ? 'silent_priority' : background.reason,
              executionStatus: 'not_executed',
            },
          );
          return {
            operationStatus: 'suppressed',
            reason: silent ? 'silent_priority' : background.reason,
            record,
            backgroundPolicy: background.policy,
            execution: executionBoundary(),
          };
        });
      }
      return runInTransaction(() => {
        const security = securityService.checkSecurity(scope.userId, {
          subjectId: scope.subjectId,
          resourceType: 'proactive_interaction',
          resourceId: rule.promptRuleId,
          action: 'execute',
          operationType: 'general_access',
          sensitiveDataCategories: [],
          ...(input.confirmationId ? {
            confirmationId: requireOpaqueResourceId(input.confirmationId, 'confirmationId'),
          } : {}),
          ...(input.securitySessionId ? {
            securitySessionId: requireOpaqueResourceId(
              input.securitySessionId,
              'securitySessionId',
            ),
          } : {}),
        }, {
          minimumRiskLevel: rule.requiresConfirmation ? 'high' : 'low',
        });
        const status = {
          allow: 'ready',
          confirm: 'confirmation_required',
          deny: 'denied',
        }[security.decision];
        const record = proactiveInteractionRepository.insertPromptRecord({
          promptRecordId: idFactory(),
          ...scope,
          promptRuleId: rule.promptRuleId,
          triggerEventId,
          priority: rule.priority,
          status,
          securityAuditLogId: security.auditLogId,
          createdAt: clock().toISOString(),
        });
        createConfigurationEvent(
          scope,
          'proactive_prompt_prepared',
          record.promptRecordId,
          'Proactive prompt was evaluated without delivery.',
          {
            promptRecordId: record.promptRecordId,
            promptRuleId: rule.promptRuleId,
            triggerEventId,
            priority: rule.priority,
            operationStatus: status,
            auditLogId: security.auditLogId,
            executionStatus: 'not_executed',
          },
        );
        return {
          operationStatus: status,
          record,
          security,
          backgroundPolicy: background.policy,
          execution: executionBoundary(),
        };
      });
    },
    listPromptRecords(userId, subjectId) {
      const scope = requireScope(userId, subjectId);
      return proactiveInteractionRepository.listPromptRecords(scope.userId, scope.subjectId);
    },
    upsertTokenBudget(userId, subjectId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, [
        'dailyTokenLimit', 'sessionTokenLimit', 'overagePolicy', 'status',
      ]);
      const dailyTokenLimit = requireInteger(
        input.dailyTokenLimit,
        'dailyTokenLimit',
        { min: 1, max: 100_000_000 },
      );
      const sessionTokenLimit = requireInteger(
        input.sessionTokenLimit,
        'sessionTokenLimit',
        { min: 1, max: 100_000_000 },
      );
      if (sessionTokenLimit > dailyTokenLimit) {
        throw new ValidationError('sessionTokenLimit must not exceed dailyTokenLimit.', {
          field: 'sessionTokenLimit',
        });
      }
      const existing = proactiveInteractionRepository.findTokenBudget(
        scope.userId,
        scope.subjectId,
      );
      const now = clock().toISOString();
      const budget = {
        tokenBudgetId: existing?.tokenBudgetId ?? idFactory(),
        ...scope,
        dailyTokenLimit,
        sessionTokenLimit,
        overagePolicy: requireProactiveValue(
          input.overagePolicy,
          'overagePolicy',
          TOKEN_OVERAGE_POLICIES,
        ),
        status: input.status === undefined
          ? 'enabled'
          : requireProactiveValue(input.status, 'status', REGISTRY_STATUSES),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return runInTransaction(() => {
        const saved = proactiveInteractionRepository.upsertTokenBudget(budget);
        createConfigurationEvent(
          scope,
          'token_budget_changed',
          saved.tokenBudgetId,
          'Token budget configuration was saved.',
          {
            tokenBudgetId: saved.tokenBudgetId,
            changeType: existing ? 'updated' : 'created',
            overagePolicy: saved.overagePolicy,
            status: saved.status,
            modelCallStatus: 'not_performed',
          },
        );
        return saved;
      });
    },
    getTokenBudget(userId, subjectId) {
      const scope = requireScope(userId, subjectId);
      const budget = proactiveInteractionRepository.findTokenBudget(
        scope.userId,
        scope.subjectId,
      );
      if (!budget) throw new NotFoundError('Token budget was not found in this scope.');
      return budget;
    },
    checkTokenBudget(userId, subjectId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, [
        'estimatedTokens', 'budgetSessionId', 'confirmationId', 'securitySessionId',
      ]);
      const budget = proactiveInteractionRepository.findTokenBudget(
        scope.userId,
        scope.subjectId,
      );
      if (!budget) throw new NotFoundError('Token budget was not found in this scope.');
      if (budget.status !== 'enabled') throw new ConflictError('Token budget is disabled.');
      const estimatedTokens = requireInteger(
        input.estimatedTokens,
        'estimatedTokens',
        { min: 1, max: 100_000_000 },
      );
      const budgetSessionId = requireOpaqueResourceId(
        input.budgetSessionId,
        'budgetSessionId',
      );
      const now = clock().toISOString();
      const [dayStart, nextDayStart] = dayBounds(now);
      const usage = proactiveInteractionRepository.summarizeTokenUsage(
        scope.userId,
        scope.subjectId,
        dayStart,
        nextDayStart,
        budgetSessionId,
      );
      const projection = {
        dailyUsed: usage.dailyUsed,
        dailyProjected: usage.dailyUsed + estimatedTokens,
        dailyLimit: budget.dailyTokenLimit,
        sessionUsed: usage.sessionUsed,
        sessionProjected: usage.sessionUsed + estimatedTokens,
        sessionLimit: budget.sessionTokenLimit,
      };
      const exceeded = projection.dailyProjected > projection.dailyLimit
        || projection.sessionProjected > projection.sessionLimit;
      if (!exceeded) {
        if (input.confirmationId || input.securitySessionId) {
          throw new ValidationError(
            'Confirmation metadata is only accepted for confirmation-required overage.',
          );
        }
        return {
          decision: 'allow',
          operationStatus: 'within_budget',
          budget,
          projection,
          security: null,
          execution: executionBoundary(),
        };
      }
      if (budget.overagePolicy === 'block') {
        if (input.confirmationId || input.securitySessionId) {
          throw new ValidationError(
            'Confirmation metadata is not accepted by the block overage policy.',
          );
        }
        return {
          decision: 'deny',
          operationStatus: 'blocked_by_budget',
          budget,
          projection,
          security: null,
          execution: executionBoundary(),
        };
      }
      if (budget.overagePolicy === 'defer') {
        if (input.confirmationId || input.securitySessionId) {
          throw new ValidationError(
            'Confirmation metadata is not accepted by the defer overage policy.',
          );
        }
        return {
          decision: 'defer',
          operationStatus: 'deferred_by_budget',
          budget,
          projection,
          security: null,
          execution: executionBoundary(),
        };
      }
      const security = securityService.checkSecurity(scope.userId, {
        subjectId: scope.subjectId,
        resourceType: 'proactive_interaction',
        resourceId: budget.tokenBudgetId,
        action: 'execute',
        operationType: 'general_access',
        sensitiveDataCategories: [],
        ...(input.confirmationId ? {
          confirmationId: requireOpaqueResourceId(input.confirmationId, 'confirmationId'),
        } : {}),
        ...(input.securitySessionId ? {
          securitySessionId: requireOpaqueResourceId(
            input.securitySessionId,
            'securitySessionId',
          ),
        } : {}),
      }, { minimumRiskLevel: 'high' });
      return {
        decision: security.decision,
        operationStatus: operationStatus(security.decision),
        budget,
        projection,
        security,
        execution: executionBoundary(),
      };
    },
    recordTokenUsage(userId, subjectId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, [
        'budgetSessionId', 'modelId', 'inputTokens', 'outputTokens', 'occurredAt',
      ]);
      const budget = proactiveInteractionRepository.findTokenBudget(
        scope.userId,
        scope.subjectId,
      );
      if (!budget) throw new NotFoundError('Token budget was not found in this scope.');
      const modelId = optionalOpaqueResourceId(input.modelId, 'modelId');
      if (modelId && !modelRepository.findById(scope.userId, modelId)) {
        throw new NotFoundError('Model was not found for this user.');
      }
      const inputTokens = requireInteger(
        input.inputTokens,
        'inputTokens',
        { min: 0, max: 100_000_000 },
      );
      const outputTokens = requireInteger(
        input.outputTokens,
        'outputTokens',
        { min: 0, max: 100_000_000 },
      );
      if (inputTokens + outputTokens === 0) {
        throw new ValidationError('Token usage must contain at least one token.');
      }
      const recordedAt = clock().toISOString();
      const record = {
        tokenUsageId: idFactory(),
        ...scope,
        tokenBudgetId: budget.tokenBudgetId,
        budgetSessionId: requireOpaqueResourceId(
          input.budgetSessionId,
          'budgetSessionId',
        ),
        modelId,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        occurredAt: normalizeTimestamp(input.occurredAt, 'occurredAt', recordedAt),
        recordedAt,
      };
      return runInTransaction(() => {
        const saved = proactiveInteractionRepository.insertTokenUsage(record);
        createConfigurationEvent(
          scope,
          'token_usage_recorded',
          saved.tokenUsageId,
          'Token usage metadata was recorded without a platform model call.',
          {
            tokenUsageId: saved.tokenUsageId,
            tokenBudgetId: saved.tokenBudgetId,
            totalTokens: saved.totalTokens,
            usageSource: saved.usageSource,
            modelCallStatus: saved.modelCallStatus,
            billingStatus: saved.billingStatus,
          },
        );
        return saved;
      });
    },
    listTokenUsage(userId, subjectId) {
      const scope = requireScope(userId, subjectId);
      return proactiveInteractionRepository.listTokenUsage(scope.userId, scope.subjectId);
    },
    upsertBackgroundPolicy(userId, subjectId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, [
        'runState', 'backgroundEnabled', 'maxWakeupsPerHour',
        'maxPromptsPerHour', 'allowedWakeTypes', 'quietHours',
      ]);
      const existing = proactiveInteractionRepository.findBackgroundPolicy(
        scope.userId,
        scope.subjectId,
      );
      const now = clock().toISOString();
      const policy = {
        backgroundPolicyId: existing?.backgroundPolicyId ?? idFactory(),
        ...scope,
        runState: requireProactiveValue(
          input.runState,
          'runState',
          BACKGROUND_RUN_STATES,
        ),
        backgroundEnabled: requireBoolean(input.backgroundEnabled, 'backgroundEnabled'),
        limits: {
          maxWakeupsPerHour: requireInteger(
            input.maxWakeupsPerHour,
            'maxWakeupsPerHour',
            { min: 0, max: 60 },
          ),
          maxPromptsPerHour: requireInteger(
            input.maxPromptsPerHour,
            'maxPromptsPerHour',
            { min: 0, max: 60 },
          ),
          allowedWakeTypes: requireWakeTypeList(input.allowedWakeTypes),
          quietHours: requireQuietHours(input.quietHours),
        },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (!policy.backgroundEnabled && policy.runState === 'active') {
        throw new ValidationError('runState cannot be active when backgroundEnabled is false.', {
          field: 'runState',
        });
      }
      return runInTransaction(() => {
        const saved = proactiveInteractionRepository.upsertBackgroundPolicy(policy);
        createConfigurationEvent(
          scope,
          'background_policy_changed',
          saved.backgroundPolicyId,
          'Assistant background policy was saved.',
          {
            backgroundPolicyId: saved.backgroundPolicyId,
            changeType: existing ? 'updated' : 'created',
            runState: saved.runState,
            backgroundEnabled: saved.backgroundEnabled,
            executionStatus: 'not_executed',
          },
        );
        return saved;
      });
    },
    getBackgroundPolicy(userId, subjectId) {
      const scope = requireScope(userId, subjectId);
      const policy = proactiveInteractionRepository.findBackgroundPolicy(
        scope.userId,
        scope.subjectId,
      );
      if (!policy) throw new NotFoundError('Background policy was not found in this scope.');
      return policy;
    },
  };
}
