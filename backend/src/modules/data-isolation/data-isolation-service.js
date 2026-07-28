import { NotFoundError, ValidationError } from '../../core/errors.js';
import {
  optionalString,
  requireOpaqueResourceId,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import { PERMISSION_ACTIONS, requirePermissionValue } from '../permissions/permission-types.js';
import {
  getDataIsolationDefinition,
  listDataIsolationDefinitions,
} from './data-isolation-types.js';

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    throw new ValidationError('Data access checks accept scope metadata only.', {
      unexpectedFields,
    });
  }

  return input;
}

function directAccessResult() {
  return {
    decision: 'allow',
    preflightPassed: true,
    executionAllowed: false,
    executionStatus: 'not_executed',
    reason: 'ownership_scope_verified',
    permission: null,
    securityPolicy: null,
    confirmation: {
      mode: 'not_required',
      required: false,
      status: 'not_required',
      confirmationId: null,
    },
  };
}

export function createDataIsolationService({
  dataIsolationRepository,
  userSpaceRepository,
  userRepository,
  subjectRepository,
  securityService,
}) {
  function requireUser(userId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }
    return normalizedUserId;
  }

  return {
    listBoundaries() {
      return listDataIsolationDefinitions();
    },
    checkAccess(userId, value) {
      const normalizedUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'assistantId',
        'resourceType',
        'resourceId',
        'action',
        'confirmationId',
        'securitySessionId',
      ]);
      const definition = getDataIsolationDefinition(input.resourceType);
      const resourceId = requireOpaqueResourceId(input.resourceId);
      const action = requirePermissionValue(input.action, 'action', PERMISSION_ACTIONS);

      if (!definition.allowedActions.includes(action)) {
        throw new ValidationError('action is not supported for this isolated resource.', {
          field: 'action',
          allowedValues: definition.allowedActions,
        });
      }

      const assistantId = optionalString(input.assistantId, 'assistantId', {
        maxLength: 128,
      });
      if (definition.assistantRequired && !assistantId) {
        throw new ValidationError('assistantId is required for this isolated resource.', {
          field: 'assistantId',
        });
      }
      if (!definition.assistantRequired && definition.resourceType !== 'event' && assistantId) {
        throw new ValidationError('assistantId is not accepted for this isolated resource.', {
          field: 'assistantId',
        });
      }
      if (assistantId && !subjectRepository.findById(normalizedUserId, assistantId)) {
        throw new NotFoundError('Assistant was not found in this User Space.');
      }

      const ownership = dataIsolationRepository.findOwnership({
        resourceType: definition.resourceType,
        userId: normalizedUserId,
        assistantId,
        resourceId,
      });
      if (!ownership) {
        throw new NotFoundError('Data resource was not found in this ownership scope.');
      }

      const userSpace = userSpaceRepository.findByUser(normalizedUserId);
      if (!userSpace) {
        throw new NotFoundError('User Space was not found.');
      }

      const requirement = definition.permissionRequirement;
      if (!requirement && (input.confirmationId || input.securitySessionId)) {
        throw new ValidationError(
          'Confirmation metadata is not accepted for ownership-only resources.',
          { fields: ['confirmationId', 'securitySessionId'] },
        );
      }
      const access = requirement
        ? securityService.checkSecurity(normalizedUserId, {
            subjectId: assistantId,
            resourceType: requirement.resourceType,
            resourceId: requirement.resourceIdSource === 'resource'
              ? ownership.resourceId
              : requirement.resourceId,
            action,
            operationType: requirement.operationType,
            sensitiveDataCategories: requirement.sensitiveDataCategories,
            ...(input.confirmationId ? { confirmationId: input.confirmationId } : {}),
            ...(input.securitySessionId ? { securitySessionId: input.securitySessionId } : {}),
          })
        : directAccessResult();

      return {
        operationStatus: {
          allow: 'ready',
          confirm: 'confirmation_required',
          deny: 'denied',
        }[access.decision],
        resource: {
          resourceType: definition.resourceType,
          resourceId: ownership.resourceId,
          dataCategory: definition.dataCategory,
        },
        ownership: {
          verified: true,
          userSpaceId: userSpace.spaceId,
          userId: ownership.userId,
          assistantId: ownership.assistantId ?? assistantId,
          scope: definition.ownershipScope,
        },
        boundary: {
          queryFilter: [...definition.queryFilter],
          permissionRequired: Boolean(requirement),
          permissionResourceType: requirement?.resourceType ?? null,
          permissionResourceId: requirement
            ? (requirement.resourceIdSource === 'resource'
                ? ownership.resourceId
                : requirement.resourceId)
            : null,
        },
        access,
        execution: {
          status: 'not_executed',
          externalServiceCall: 'not_performed',
        },
      };
    },
  };
}
