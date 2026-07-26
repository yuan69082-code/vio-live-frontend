import { NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCE_TYPES,
  requirePermissionValue,
} from './permission-types.js';

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    throw new ValidationError('Request body contains unsupported fields.', {
      unexpectedFields,
    });
  }

  return input;
}

function decision(permission, value, canAsk, reason) {
  return {
    decision: value,
    canAsk,
    reason,
    permissionId: permission?.permissionId ?? null,
    permissionLevel: permission?.permissionLevel ?? null,
    permissionStatus: permission?.status ?? null,
  };
}

export function createPermissionChecker({
  permissionRepository,
  permissionService,
  userRepository,
  subjectRepository,
}) {
  return {
    checkPermission(userId, value) {
      const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });

      if (!userRepository.findById(normalizedUserId)) {
        throw new NotFoundError('User was not found.');
      }

      const input = requireOnlyFields(value, [
        'subjectId',
        'resourceType',
        'resourceId',
        'action',
      ]);
      const subjectId = requireString(input.subjectId, 'subjectId', { maxLength: 128 });

      if (!subjectRepository.findById(normalizedUserId, subjectId)) {
        throw new NotFoundError('Subject was not found for this user.');
      }

      const scope = {
        userId: normalizedUserId,
        subjectId,
        resourceType: requirePermissionValue(
          input.resourceType,
          'resourceType',
          PERMISSION_RESOURCE_TYPES,
        ),
        resourceId: requireString(input.resourceId, 'resourceId', { maxLength: 256 }),
        action: requirePermissionValue(input.action, 'action', PERMISSION_ACTIONS),
      };
      const permission = permissionRepository.findActiveRule(scope);

      if (!permission) {
        return decision(null, 'deny', true, 'no_active_rule');
      }

      if (permission.permissionLevel === 'always_allow') {
        return decision(permission, 'allow', false, 'always_allow');
      }

      if (permission.permissionLevel === 'ask_every_time') {
        return decision(permission, 'ask', true, 'ask_every_time');
      }

      if (permission.permissionLevel === 'denied') {
        return decision(permission, 'deny', true, 'denied');
      }

      if (permission.permissionLevel === 'forbidden_ask') {
        return decision(permission, 'deny', false, 'forbidden_ask');
      }

      const consumed = permissionService.consumeOnceForCheck(
        normalizedUserId,
        permission.permissionId,
      );

      if (!consumed) {
        return decision(null, 'deny', true, 'rule_unavailable');
      }

      return decision(consumed, 'allow', false, 'allow_once_consumed');
    },
  };
}
