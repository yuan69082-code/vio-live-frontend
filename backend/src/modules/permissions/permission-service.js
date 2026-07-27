import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalOpaqueResourceId,
  optionalString,
  requirePlainObject,
  requireOpaqueResourceId,
  requireString,
} from '../../core/validation.js';
import {
  EDITABLE_PERMISSION_STATUSES,
  PERMISSION_ACTIONS,
  PERMISSION_LEVELS,
  PERMISSION_RESOURCE_TYPES,
  PERMISSION_STATUSES,
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

function optionalPermissionValue(value, field, allowedValues) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return requirePermissionValue(value, field, allowedValues);
}

export function createPermissionService({
  permissionRepository,
  userRepository,
  subjectRepository,
  eventService,
  auditLogService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireUser(userId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });

    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }

    return normalizedUserId;
  }

  function requireSubject(userId, subjectId) {
    const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });

    if (!subjectRepository.findById(userId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }

    return normalizedSubjectId;
  }

  function recordChange(permission, changeType, previous = null) {
    eventService.createEvent(permission.userId, {
      subjectId: permission.subjectId,
      eventType: 'permission_changed',
      source: {
        type: 'permission-service',
        reference: permission.permissionId,
      },
      summary: `Permission rule ${changeType}.`,
      data: {
        permissionId: permission.permissionId,
        changeType,
        resourceType: permission.resourceType,
        resourceId: permission.resourceId,
        action: permission.action,
        permissionLevel: permission.permissionLevel,
        status: permission.status,
        ...(previous ? {
          previousPermissionLevel: previous.permissionLevel,
          previousStatus: previous.status,
        } : {}),
      },
    });
    auditLogService.recordAuditLog({
      userId: permission.userId,
      subjectId: permission.subjectId,
      operationType: 'permission_change',
      resourceType: 'permission',
      resourceId: permission.permissionId,
      action: changeType,
      riskLevel: 'high',
      result: 'succeeded',
      reasonCode: `permission_${changeType}`,
    });
  }

  return {
    createPermission(userId, value) {
      const normalizedUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'subjectId',
        'resourceType',
        'resourceId',
        'action',
        'permissionLevel',
        'status',
      ]);
      const subjectId = requireSubject(normalizedUserId, input.subjectId);
      const now = clock().toISOString();
      const permission = {
        permissionId: idFactory(),
        userId: normalizedUserId,
        subjectId,
        resourceType: requirePermissionValue(
          input.resourceType,
          'resourceType',
          PERMISSION_RESOURCE_TYPES,
        ),
        resourceId: requireOpaqueResourceId(input.resourceId),
        action: requirePermissionValue(input.action, 'action', PERMISSION_ACTIONS),
        permissionLevel: requirePermissionValue(
          input.permissionLevel,
          'permissionLevel',
          PERMISSION_LEVELS,
        ),
        status: input.status === undefined
          ? 'active'
          : requirePermissionValue(
            input.status,
            'status',
            EDITABLE_PERMISSION_STATUSES,
          ),
        createdAt: now,
        updatedAt: now,
      };

      return runInTransaction(() => {
        const created = permissionRepository.insert(permission);
        recordChange(created, 'created');
        return created;
      });
    },
    getPermission(userId, permissionId) {
      const normalizedUserId = requireUser(userId);
      const normalizedPermissionId = requireString(
        permissionId,
        'permissionId',
        { maxLength: 128 },
      );
      const permission = permissionRepository.findById(
        normalizedUserId,
        normalizedPermissionId,
      );

      if (!permission) {
        throw new NotFoundError('Permission rule was not found for this user.');
      }

      return permission;
    },
    listPermissions(userId, filters = {}) {
      const normalizedUserId = requireUser(userId);
      const subjectId = optionalString(filters.subjectId, 'subjectId', { maxLength: 128 });

      if (subjectId) {
        requireSubject(normalizedUserId, subjectId);
      }

      return permissionRepository.findMany({
        userId: normalizedUserId,
        subjectId,
        resourceType: optionalPermissionValue(
          filters.resourceType,
          'resourceType',
          PERMISSION_RESOURCE_TYPES,
        ),
        resourceId: optionalOpaqueResourceId(filters.resourceId),
        action: optionalPermissionValue(filters.action, 'action', PERMISSION_ACTIONS),
        status: optionalPermissionValue(filters.status, 'status', PERMISSION_STATUSES),
      });
    },
    updatePermission(userId, permissionId, value) {
      const normalizedUserId = requireUser(userId);
      const normalizedPermissionId = requireString(
        permissionId,
        'permissionId',
        { maxLength: 128 },
      );
      const input = requireOnlyFields(value, ['permissionLevel', 'status']);

      if (input.permissionLevel === undefined && input.status === undefined) {
        throw new ValidationError('At least one permission field must be updated.');
      }

      return runInTransaction(() => {
        const current = permissionRepository.findById(
          normalizedUserId,
          normalizedPermissionId,
        );

        if (!current) {
          throw new NotFoundError('Permission rule was not found for this user.');
        }

        if (!EDITABLE_PERMISSION_STATUSES.includes(current.status)) {
          throw new ConflictError('Permission rule is no longer editable.');
        }

        const permissionLevel = input.permissionLevel === undefined
          ? current.permissionLevel
          : requirePermissionValue(
            input.permissionLevel,
            'permissionLevel',
            PERMISSION_LEVELS,
          );
        const status = input.status === undefined
          ? current.status
          : requirePermissionValue(input.status, 'status', EDITABLE_PERMISSION_STATUSES);

        if (permissionLevel === current.permissionLevel && status === current.status) {
          return current;
        }

        const updated = permissionRepository.update(normalizedUserId, normalizedPermissionId, {
          permissionLevel,
          status,
          updatedAt: clock().toISOString(),
        });
        recordChange(updated, 'updated', current);
        return updated;
      });
    },
    deletePermission(userId, permissionId) {
      const normalizedUserId = requireUser(userId);
      const normalizedPermissionId = requireString(
        permissionId,
        'permissionId',
        { maxLength: 128 },
      );

      return runInTransaction(() => {
        const current = permissionRepository.findById(
          normalizedUserId,
          normalizedPermissionId,
        );

        if (!current || current.status === 'deleted') {
          throw new NotFoundError('Permission rule was not found for this user.');
        }

        const deleted = permissionRepository.softDelete(
          normalizedUserId,
          normalizedPermissionId,
          clock().toISOString(),
        );
        recordChange(deleted, 'deleted', current);
        return deleted;
      });
    },
    consumeOnceForCheck(userId, permissionId) {
      return runInTransaction(() => {
        const current = permissionRepository.findById(userId, permissionId);

        if (
          !current
          || current.status !== 'active'
          || current.permissionLevel !== 'allow_once'
        ) {
          return null;
        }

        const consumed = permissionRepository.consumeOnce(
          userId,
          permissionId,
          clock().toISOString(),
        );

        if (!consumed) {
          return null;
        }

        recordChange(consumed, 'consumed', current);
        return consumed;
      });
    },
  };
}
