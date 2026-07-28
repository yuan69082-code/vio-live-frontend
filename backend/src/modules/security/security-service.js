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
import { requireSecuritySessionId } from '../security-policies/security-policy-types.js';
import {
  classifySecurityRisk,
  createSecurityPolicyFingerprint,
} from './risk-classifier.js';
import {
  SECURITY_OPERATION_TYPES,
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

function confirmationView(
  mode,
  required,
  status,
  confirmationId = null,
  confirmationReason = null,
  riskDescription = null,
) {
  return {
    mode,
    required,
    status,
    confirmationId,
    ...(confirmationReason ? { confirmationReason } : {}),
    ...(riskDescription ? { riskDescription } : {}),
  };
}

function presentPolicy(evaluation) {
  return {
    policy: evaluation.policy,
    decision: evaluation.decision,
    canAsk: evaluation.canAsk,
    confirmationMode: evaluation.confirmationMode,
    reason: evaluation.reason,
    effectiveRiskLevel: evaluation.effectiveRiskLevel,
    preferences: evaluation.preferences,
    securitySessionId: evaluation.securitySessionId,
    sessionGrant: evaluation.sessionGrant,
  };
}

function describeRisk(risk) {
  const factors = risk.reasons.length > 0
    ? risk.reasons.join(', ')
    : 'platform baseline';
  return `Risk level ${risk.level}; factors: ${factors}.`;
}

export function createSecurityService({
  permissionChecker,
  securityPolicyService,
  confirmationService,
  auditLogService,
  eventService,
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
    securityPolicy,
    auditLog,
  }) {
    return {
      decision,
      preflightPassed: decision === 'allow',
      executionAllowed: false,
      executionStatus: 'not_executed',
      permission,
      risk,
      securityPolicy: presentPolicy(securityPolicy),
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
        'securitySessionId',
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
      const securitySessionId = input.securitySessionId === undefined
        ? null
        : requireSecuritySessionId(input.securitySessionId);

      return runInTransaction(() => {
        let permission = permissionChecker.checkPermission(
          userId,
          scope,
          { consumeAllowOnce: false },
        );
        const classifiedRisk = classifySecurityRisk({
          operationType,
          resourceType: scope.resourceType,
          action: scope.action,
          sensitiveDataCategories,
        });
        let securityPolicy = securityPolicyService.evaluate({
          userId,
          subjectId: scope.subjectId,
          resourceType: scope.resourceType,
          resourceId: scope.resourceId,
          actionType: scope.action,
          classifiedRiskLevel: classifiedRisk.level,
          securitySessionId,
        });
        const risk = {
          ...classifiedRisk,
          level: securityPolicy.effectiveRiskLevel,
          sensitiveOperation: ['high', 'critical'].includes(
            securityPolicy.effectiveRiskLevel,
          ),
          reasons: securityPolicy.effectiveRiskLevel === classifiedRisk.level
            ? classifiedRisk.reasons
            : [
                ...classifiedRisk.reasons,
                `user_default_security_level:${securityPolicy.effectiveRiskLevel}`,
              ],
          policyVersion: 'security-policy-v2',
          classificationSource: 'platform_rules_and_user_security_policy',
        };
        const policyMode = securityPolicy.confirmationMode;

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
            securityPolicy,
            confirmation: confirmationView(
              policyMode,
              false,
              'blocked_by_permission',
            ),
            auditLog,
          });
        }

        if (securityPolicy.decision === 'deny') {
          const auditLog = recordResult({
            userId,
            scope,
            operationType,
            risk,
            permission,
            confirmationMode: 'not_required',
            result: 'denied',
            reasonCode: 'security_policy_denied',
            confirmationId: null,
          });
          return result({
            decision: 'deny',
            permission,
            risk,
            securityPolicy,
            confirmation: confirmationView(
              'not_required',
              false,
              'blocked_by_security_policy',
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
          securityPolicy,
        });
        let confirmation = null;
        let shouldCreateSessionGrant = false;
        const confirmationReason = permission.decision === 'ask'
          ? 'The active Permission requires confirmation for every request.'
          : `Security policy requires confirmation before ${scope.action} on ${scope.resourceType}.`;
        const riskDescription = describeRisk(risk);

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
              securityPolicyId: securityPolicy.policy?.policyId ?? null,
              securityPolicyUpdatedAt: securityPolicy.policy?.updatedAt ?? null,
              securitySessionId,
              confirmationReason,
              riskDescription,
            });
            eventService.createEvent(userId, {
              subjectId: scope.subjectId,
              eventType: 'confirmation_required',
              source: {
                type: 'security-service',
                reference: confirmation.confirmationId,
              },
              summary: 'Security confirmation is required.',
              data: {
                confirmationId: confirmation.confirmationId,
                operationType,
                resourceType: scope.resourceType,
                action: scope.action,
                riskLevel: risk.level,
                confirmationMode,
                securityPolicyId: securityPolicy.policy?.policyId ?? null,
                executionStatus: 'not_executed',
              },
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
              securityPolicy,
              confirmation: confirmationView(
                confirmationMode,
                true,
                confirmation.status,
                confirmation.confirmationId,
                confirmation.confirmationReason,
                confirmation.riskDescription,
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
            securityPolicyId: securityPolicy.policy?.policyId ?? null,
            securityPolicyUpdatedAt: securityPolicy.policy?.updatedAt ?? null,
            securitySessionId,
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
              securityPolicy,
              confirmation: confirmationView(
                confirmationMode,
                true,
                confirmation.status,
                confirmation.confirmationId,
                confirmation.confirmationReason,
                confirmation.riskDescription,
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
              securityPolicy,
              confirmation: confirmationView(
                confirmationMode,
                true,
                displayStatus,
                confirmation.confirmationId,
                confirmation.confirmationReason,
                confirmation.riskDescription,
              ),
              auditLog,
            });
          }

          if (
            permission.decision !== 'ask'
            && securityPolicy.policy?.rule === 'session_allow'
            && securitySessionId
            && !['high', 'critical'].includes(securityPolicy.effectiveRiskLevel)
          ) {
            shouldCreateSessionGrant = true;
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
              securityPolicy,
              confirmation: confirmationView(
                confirmationMode,
                confirmationRequired,
                confirmation?.status ?? 'not_required',
                confirmation?.confirmationId ?? null,
                confirmation?.confirmationReason ?? null,
                confirmation?.riskDescription ?? null,
              ),
              auditLog,
            });
          }
        }

        if (shouldCreateSessionGrant) {
          const sessionGrant = securityPolicyService.createSessionGrant({
            userId,
            subjectId: scope.subjectId,
            resourceId: scope.resourceId,
            actionType: scope.action,
            evaluation: securityPolicy,
          });
          securityPolicy = {
            ...securityPolicy,
            sessionGrant,
            decision: 'allow',
            confirmationMode: 'not_required',
            reason: 'session_grant_created',
          };
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
          securityPolicy,
          confirmation: confirmationView(
            confirmationMode,
            confirmationRequired,
            confirmation?.status ?? 'not_required',
            confirmation?.confirmationId ?? null,
            confirmation?.confirmationReason ?? null,
            confirmation?.riskDescription ?? null,
          ),
          auditLog,
        });
      });
    },
  };
}
