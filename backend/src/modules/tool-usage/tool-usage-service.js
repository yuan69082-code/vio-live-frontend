import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpectedFields.length > 0) {
    throw new ValidationError(
      'Tool execution preparation accepts confirmation metadata only.',
      { unexpectedFields },
    );
  }

  return input;
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') {
    return 50;
  }
  if (!/^\d+$/.test(String(value))) {
    throw new ValidationError('limit must be an integer between 1 and 200.', {
      field: 'limit',
    });
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ValidationError('limit must be an integer between 1 and 200.', {
      field: 'limit',
    });
  }

  return limit;
}

function preparationStatus(securityDecision) {
  return {
    allow: 'ready',
    confirm: 'confirmation_required',
    deny: 'denied',
  }[securityDecision];
}

function resultSummary(status) {
  return {
    ready: 'Security preparation completed; Tool execution was not performed.',
    confirmation_required: 'Confirmation is required; Tool execution was not performed.',
    denied: 'Permission or security denied preparation; Tool execution was not performed.',
  }[status];
}

const NO_EXECUTION_CONSUMPTION = Object.freeze({
  durationMs: 0,
  externalCalls: 0,
  tokens: 0,
  billableAmount: null,
  source: 'not_executed',
});

export function createToolUsageService({
  capabilityRegistryService,
  capabilityRegistryRepository,
  securityService,
  userRepository,
  subjectRepository,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireScope(userId, subjectId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    const normalizedSubjectId = requireString(subjectId, 'subjectId', {
      maxLength: 128,
    });
    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }
    if (!subjectRepository.findById(normalizedUserId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }

    return { userId: normalizedUserId, subjectId: normalizedSubjectId };
  }

  return {
    prepareToolExecution(userId, subjectId, toolId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, ['confirmationId']);
      const tool = capabilityRegistryService.getTool(scope.userId, toolId);
      if (tool.status !== 'enabled') {
        throw new ConflictError('Tool registry entry is disabled.');
      }
      const confirmationId = optionalString(
        input.confirmationId,
        'confirmationId',
        { maxLength: 128 },
      );

      return runInTransaction(() => {
        const security = securityService.checkSecurity(scope.userId, {
          subjectId: scope.subjectId,
          resourceType: 'tool',
          resourceId: tool.toolId,
          action: tool.permissionRequirement.action,
          operationType: 'general_access',
          sensitiveDataCategories: [],
          ...(confirmationId ? { confirmationId } : {}),
        });
        const status = preparationStatus(security.decision);
        const usageRecord = capabilityRegistryRepository.insertToolUsage({
          toolUsageId: idFactory(),
          userId: scope.userId,
          subjectId: scope.subjectId,
          toolId: tool.toolId,
          permissionDecision: security.permission.decision,
          securityDecision: security.decision,
          preparationStatus: status,
          executionStatus: 'not_executed',
          resultSummary: resultSummary(status),
          consumption: NO_EXECUTION_CONSUMPTION,
          auditLogId: security.auditLogId,
          occurredAt: clock().toISOString(),
        });

        return {
          tool,
          preparationStatus: status,
          security,
          usageRecord,
          execution: {
            supported: false,
            status: 'not_executed',
            externalCalls: 'not_performed',
            reason: 'tool_executor_not_implemented',
          },
        };
      });
    },
    listToolUsage(userId, subjectId, filters = {}) {
      const scope = requireScope(userId, subjectId);
      const toolId = optionalString(filters.toolId, 'toolId', { maxLength: 128 });
      if (toolId) {
        capabilityRegistryService.getTool(scope.userId, toolId);
      }

      return capabilityRegistryRepository.listToolUsage({
        ...scope,
        toolId,
        limit: normalizeLimit(filters.limit),
      });
    },
    getToolUsage(userId, subjectId, toolUsageId) {
      const scope = requireScope(userId, subjectId);
      const normalizedToolUsageId = requireString(
        toolUsageId,
        'toolUsageId',
        { maxLength: 128 },
      );
      const record = capabilityRegistryRepository.findToolUsage(
        scope.userId,
        scope.subjectId,
        normalizedToolUsageId,
      );
      if (!record) {
        throw new NotFoundError('Tool usage record was not found for this subject.');
      }

      return record;
    },
  };
}
