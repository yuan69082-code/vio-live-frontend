import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requireOpaqueResourceId,
  requireString,
} from '../../core/validation.js';
import {
  AUDIT_REASON_CODES,
  AUDIT_RESULTS,
  CONFIRMATION_MODES,
  PERMISSION_DECISIONS,
  SECURITY_OPERATION_TYPES,
  SECURITY_RESOURCE_TYPES,
  SECURITY_RISK_LEVELS,
  requireSecurityValue,
} from '../security/security-types.js';

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

function optionalSecurityValue(value, field, allowedValues) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return requireSecurityValue(value, field, allowedValues);
}

export function createAuditLogService({
  auditLogRepository,
  userRepository,
  subjectRepository,
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

  function normalizeSubject(userId, subjectId) {
    const normalizedSubjectId = optionalString(subjectId, 'subjectId', { maxLength: 128 });

    if (normalizedSubjectId && !subjectRepository.findById(userId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }

    return normalizedSubjectId;
  }

  return {
    recordAuditLog(value) {
      const userId = requireUser(value.userId);
      const auditLog = {
        auditLogId: idFactory(),
        userId,
        subjectId: normalizeSubject(userId, value.subjectId),
        operationType: requireSecurityValue(
          value.operationType,
          'operationType',
          SECURITY_OPERATION_TYPES,
        ),
        resourceType: requireSecurityValue(
          value.resourceType,
          'resourceType',
          SECURITY_RESOURCE_TYPES,
        ),
        resourceId: requireOpaqueResourceId(value.resourceId),
        action: requireString(value.action, 'action', { maxLength: 80 }),
        riskLevel: requireSecurityValue(
          value.riskLevel,
          'riskLevel',
          SECURITY_RISK_LEVELS,
        ),
        permissionDecision: optionalSecurityValue(
          value.permissionDecision,
          'permissionDecision',
          PERMISSION_DECISIONS,
        ),
        confirmationMode: optionalSecurityValue(
          value.confirmationMode,
          'confirmationMode',
          CONFIRMATION_MODES,
        ),
        result: requireSecurityValue(value.result, 'result', AUDIT_RESULTS),
        reasonCode: requireSecurityValue(
          value.reasonCode,
          'reasonCode',
          AUDIT_REASON_CODES,
        ),
        confirmationId: optionalString(
          value.confirmationId,
          'confirmationId',
          { maxLength: 128 },
        ),
        occurredAt: clock().toISOString(),
      };

      return auditLogRepository.insert(auditLog);
    },
    getAuditLog(userId, auditLogId) {
      const normalizedUserId = requireUser(userId);
      const normalizedAuditLogId = requireString(
        auditLogId,
        'auditLogId',
        { maxLength: 128 },
      );
      const auditLog = auditLogRepository.findById(normalizedUserId, normalizedAuditLogId);

      if (!auditLog) {
        throw new NotFoundError('Audit log was not found for this user.');
      }

      return auditLog;
    },
    listAuditLogs(userId, filters = {}) {
      const normalizedUserId = requireUser(userId);
      const subjectId = normalizeSubject(normalizedUserId, filters.subjectId);

      return auditLogRepository.findMany({
        userId: normalizedUserId,
        subjectId,
        operationType: optionalSecurityValue(
          filters.operationType,
          'operationType',
          SECURITY_OPERATION_TYPES,
        ),
        resourceType: optionalSecurityValue(
          filters.resourceType,
          'resourceType',
          SECURITY_RESOURCE_TYPES,
        ),
        result: optionalSecurityValue(filters.result, 'result', AUDIT_RESULTS),
        riskLevel: optionalSecurityValue(
          filters.riskLevel,
          'riskLevel',
          SECURITY_RISK_LEVELS,
        ),
        limit: normalizeLimit(filters.limit),
      });
    },
  };
}
