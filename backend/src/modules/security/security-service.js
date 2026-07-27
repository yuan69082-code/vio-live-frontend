import { ValidationError } from '../../core/errors.js';
import {
  optionalString,
  requireOpaqueResourceId,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCE_TYPES,
  requirePermissionValue,
} from '../permissions/permission-types.js';
import { normalizeSensitiveDataCategories } from '../sensitive-data/sensitive-data-types.js';
import {
  classifySecurityRisk,
  createSecurityPolicyFingerprint,
} from './risk-classifier.js';
import {
  SECURITY_OPERATION_TYPES,
  confirmationModeForRisk,
  requireSecurityValue,
} from './security-types.js';

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    throw new ValidationError('Security checks accept classification metadata only.', {
      unexpectedFields,
    });
  }

  return input;
}

function confirmationView(mode, required, status, confirmationId = null) {
  return {
    mode,
    required,
    status,
    confirmationId,
  };
}

export function createSecurityService({
  permissionChecker,
  confirmationService,
  auditLogService,
  runInTransaction,
}) {
  function recordResult({
    userId,
    scope,
    operationType,
    risk,
    permission,
    confirmationMode,
    result,
    reasonCode,
    confirmationId,
  }) {
    return auditLogService.recordAuditLog({
      userId,
      subjectId: scope.subjectId,
      operationType,
      resourceType: scope.resourceType,
      resourceId: scope.resourceId,
      action: scope.action,
      riskLevel: risk.level,
      permissionDecision: permission.decision,
      confirmationMode,
      result,
      reasonCode,
      confirmationId,
    });
  }

  function result({
    decision,
    permission,
    risk,
    confirmation,
    auditLog,
  }) {
    return {
      decision,
      preflightPassed: decision === 'allow',
      executionAllowed: false,
      executionStatus: 'not_executed',
      permission,
      risk,
      confirmation,
      auditLogId: auditLog.auditLogId,
    };
  }

  return {
    checkSecurity(userId, value) {
      const input = requireOnlyFields(value, [
        'subjectId',
        'resourceType',
        'resourceId',
        'action',
        'operationType',
        'sensitiveDataCategories',
        'confirmationId',
      ]);
      const scope = {
        subjectId: requireString(input.subjectId, 'subjectId', { maxLength: 128 }),
        resourceType: requirePermissionValue(
          input.resourceType,
          'resourceType',
          PERMISSION_RESOURCE_TYPES,
        ),
        resourceId: requireOpaqueResourceId(input.resourceId),
        action: requirePermissionValue(input.action, 'action', PERMISSION_ACTIONS),
      };
      const operationType = requireSecurityValue(
        input.operationType,
        'operationType',
        SECURITY_OPERATION_TYPES,
      );
      const sensitiveDataCategories = normalizeSensitiveDataCategories(
        input.sensitiveDataCategories,
      );
      const confirmationId = optionalString(
        input.confirmationId,
        'confirmationId',
        { maxLength: 128 },
      );

      return runInTransaction(() => {
        let permission = permissionChecker.checkPermission(
          userId,
          scope,
          { consumeAllowOnce: false },
        );
        const risk = classifySecurityRisk({
          operationType,
          resourceType: scope.resourceType,
          action: scope.action,
          sensitiveDataCategories,
        });
        const policyMode = confirmationModeForRisk(risk.level);

        if (permission.decision === 'deny') {
          const auditLog = recordResult({
            userId,
            scope,
            operationType,
            risk,
            permission,
            confirmationMode: policyMode,
            result: 'denied',
            reasonCode: 'permission_denied',
            confirmationId: null,
          });
          return result({
            decision: 'deny',
            permission,
            risk,
            confirmation: confirmationView(
              policyMode,
              false,
              'blocked_by_permission',
            ),
            auditLog,
          });
        }

        const confirmationMode = permission.decision === 'ask'
          ? 'every_time'
          : policyMode;
        const confirmationRequired = confirmationMode !== 'not_required';
        const policyFingerprint = createSecurityPolicyFingerprint({
          operationType,
          ...scope,
          sensitiveDataCategories,
          risk,
          confirmationMode,
        });
        let confirmation = null;

        if (!confirmationRequired && confirmationId) {
          throw new ValidationError('confirmationId is not accepted when confirmation is not required.', {
            field: 'confirmationId',
          });
        }

        if (confirmationRequired) {
          if (!confirmationId) {
            confirmation = confirmationService.createForSecurityCheck({
              userId,
              ...scope,
              operationType,
              permissionId: permission.permissionId,
              permissionLevel: permission.permissionLevel,
              permissionUpdatedAt: permission.permissionUpdatedAt,
              policyFingerprint,
              confirmationMode,
              riskLevel: risk.level,
            });
            const auditLog = recordResult({
              userId,
              scope,
              operationType,
              risk,
              permission,
              confirmationMode,
              result: 'confirmation_required',
              reasonCode: 'confirmation_required',
              confirmationId: confirmation.confirmationId,
            });
            return result({
              decision: 'confirm',
              permission,
              risk,
              confirmation: confirmationView(
                confirmationMode,
                true,
                confirmation.status,
                confirmation.confirmationId,
              ),
              auditLog,
            });
          }

          const confirmationUse = confirmationService.useForSecurityCheck(userId, confirmationId, {
            ...scope,
            operationType,
            permissionId: permission.permissionId,
            permissionLevel: permission.permissionLevel,
            permissionUpdatedAt: permission.permissionUpdatedAt,
            policyFingerprint,
            confirmationMode,
            riskLevel: risk.level,
          });
          confirmation = confirmationUse.confirmation;

          if (confirmationUse.outcome === 'pending') {
            const auditLog = recordResult({
              userId,
              scope,
              operationType,
              risk,
              permission,
              confirmationMode,
              result: 'confirmation_required',
              reasonCode: 'confirmation_pending',
              confirmationId: confirmation.confirmationId,
            });
            return result({
              decision: 'confirm',
              permission,
              risk,
              confirmation: confirmationView(
                confirmationMode,
                true,
                confirmation.status,
                confirmation.confirmationId,
              ),
              auditLog,
            });
          }

          if (confirmationUse.outcome !== 'accepted') {
            const reasonCodes = {
              rejected: 'confirmation_rejected',
              expired: 'confirmation_expired',
              scope_mismatch: 'confirmation_scope_mismatch',
              already_consumed: 'confirmation_replayed',
            };
            const displayStatus = {
              scope_mismatch: 'scope_mismatch',
              already_consumed: 'already_consumed',
            }[confirmationUse.outcome] ?? confirmation.status;
            const auditLog = recordResult({
              userId,
              scope,
              operationType,
              risk,
              permission,
              confirmationMode,
              result: 'denied',
              reasonCode: reasonCodes[confirmationUse.outcome] ?? 'confirmation_rejected',
              confirmationId: confirmation.confirmationId,
            });
            return result({
              decision: 'deny',
              permission,
              risk,
              confirmation: confirmationView(
                confirmationMode,
                true,
                displayStatus,
                confirmation.confirmationId,
              ),
              auditLog,
            });
          }
        }

        if (permission.permissionLevel === 'allow_once') {
          permission = permissionChecker.checkPermission(userId, scope);

          if (permission.decision !== 'allow') {
            const auditLog = recordResult({
              userId,
              scope,
              operationType,
              risk,
              permission,
              confirmationMode,
              result: 'denied',
              reasonCode: 'allow_once_unavailable',
              confirmationId: confirmation?.confirmationId ?? null,
            });
            return result({
              decision: 'deny',
              permission,
              risk,
              confirmation: confirmationView(
                confirmationMode,
                confirmationRequired,
                confirmation?.status ?? 'not_required',
                confirmation?.confirmationId ?? null,
              ),
              auditLog,
            });
          }
        }

        const auditLog = recordResult({
          userId,
          scope,
          operationType,
          risk,
          permission,
          confirmationMode,
          result: 'allowed',
          reasonCode: 'security_preflight_allowed',
          confirmationId: confirmation?.confirmationId ?? null,
        });
        return result({
          decision: 'allow',
          permission,
          risk,
          confirmation: confirmationView(
            confirmationMode,
            confirmationRequired,
            confirmation?.status ?? 'not_required',
            confirmation?.confirmationId ?? null,
          ),
          auditLog,
        });
      });
    },
  };
}
