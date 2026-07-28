import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCE_TYPES,
  requirePermissionValue,
} from '../permissions/permission-types.js';
import {
  SECURITY_RISK_LEVELS,
  confirmationModeForRisk,
  highestRiskLevel,
  requireSecurityValue,
} from '../security/security-types.js';
import {
  DEFAULT_SECURITY_PREFERENCES,
  HIGH_RISK_OPERATION_POLICIES,
  SECURITY_POLICY_STATUSES,
  normalizeSecurityScopes,
  requireSecurityPolicyRule,
  requireSecuritySessionId,
  riskRank,
} from './security-policy-types.js';

const SESSION_GRANT_TTL_MS = 30 * 60 * 1_000;

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpectedFields.length > 0) {
    throw new ValidationError('Request body contains unsupported fields.', {
      unexpectedFields,
    });
  }
  return input;
}

function optionalPolicyValue(value, field, allowedValues) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requireSecurityValue(value, field, allowedValues);
}

function scopeMatches(scope, resourceType, actionType) {
  return scope.resourceType === resourceType && scope.actionType === actionType;
}

function defaultPreferences(userId) {
  return {
    userId,
    ...DEFAULT_SECURITY_PREFERENCES,
    autoConfirmationScopes: [],
    forbiddenScopes: [],
    createdAt: null,
    updatedAt: null,
  };
}

export function createSecurityPolicyService({
  securityPolicyRepository,
  userRepository,
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

  function requirePolicy(userId, policyId, { active = false } = {}) {
    const normalizedPolicyId = requireString(policyId, 'policyId', { maxLength: 128 });
    const policy = securityPolicyRepository.findPolicy(userId, normalizedPolicyId);
    if (!policy || (active && policy.status !== 'active')) {
      throw new NotFoundError('Security policy was not found for this user.');
    }
    return policy;
  }

  function recordPolicyChange(userId, policy, action, reasonCode) {
    return auditLogService.recordAuditLog({
      userId,
      operationType: 'security_policy_change',
      resourceType: 'security_policy',
      resourceId: policy.policyId,
      action,
      riskLevel: policy.riskLevel,
      result: 'succeeded',
      reasonCode,
    });
  }

  function readPreferences(userId) {
    return securityPolicyRepository.findPreferences(userId) ?? defaultPreferences(userId);
  }

  return {
    createPolicy(userId, value) {
      const normalizedUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'resourceType',
        'actionType',
        'riskLevel',
        'rule',
      ]);
      const now = clock().toISOString();
      const policy = {
        policyId: idFactory(),
        userId: normalizedUserId,
        resourceType: requirePermissionValue(
          input.resourceType,
          'resourceType',
          PERMISSION_RESOURCE_TYPES,
        ),
        actionType: requirePermissionValue(
          input.actionType,
          'actionType',
          PERMISSION_ACTIONS,
        ),
        riskLevel: requireSecurityValue(
          input.riskLevel,
          'riskLevel',
          SECURITY_RISK_LEVELS,
        ),
        rule: requireSecurityPolicyRule(input.rule),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      return runInTransaction(() => {
        const created = securityPolicyRepository.insertPolicy(policy);
        recordPolicyChange(
          normalizedUserId,
          created,
          'created',
          'security_policy_created',
        );
        return created;
      });
    },
    getPolicy(userId, policyId) {
      return requirePolicy(requireUser(userId), policyId);
    },
    listPolicies(userId, filters = {}) {
      const normalizedUserId = requireUser(userId);
      const resourceType = filters.resourceType
        ? requirePermissionValue(filters.resourceType, 'resourceType', PERMISSION_RESOURCE_TYPES)
        : null;
      const actionType = filters.actionType
        ? requirePermissionValue(filters.actionType, 'actionType', PERMISSION_ACTIONS)
        : null;
      const riskLevel = optionalPolicyValue(
        filters.riskLevel,
        'riskLevel',
        SECURITY_RISK_LEVELS,
      );
      const status = optionalPolicyValue(
        filters.status,
        'status',
        SECURITY_POLICY_STATUSES,
      ) ?? 'active';
      return securityPolicyRepository.listPolicies(normalizedUserId)
        .filter((policy) => policy.status === status)
        .filter((policy) => !resourceType || policy.resourceType === resourceType)
        .filter((policy) => !actionType || policy.actionType === actionType)
        .filter((policy) => !riskLevel || policy.riskLevel === riskLevel);
    },
    updatePolicy(userId, policyId, value) {
      const normalizedUserId = requireUser(userId);
      const input = requireOnlyFields(value, ['riskLevel', 'rule']);
      if (input.riskLevel === undefined && input.rule === undefined) {
        throw new ValidationError('At least one security policy field must be updated.');
      }

      return runInTransaction(() => {
        const current = requirePolicy(normalizedUserId, policyId, { active: true });
        const riskLevel = input.riskLevel === undefined
          ? current.riskLevel
          : requireSecurityValue(input.riskLevel, 'riskLevel', SECURITY_RISK_LEVELS);
        const rule = input.rule === undefined
          ? current.rule
          : requireSecurityPolicyRule(input.rule);
        if (riskLevel === current.riskLevel && rule === current.rule) {
          return current;
        }
        const updated = securityPolicyRepository.updatePolicy(
          normalizedUserId,
          current.policyId,
          { riskLevel, rule, updatedAt: clock().toISOString() },
        );
        if (!updated) {
          throw new ConflictError('Security policy is no longer editable.');
        }
        recordPolicyChange(
          normalizedUserId,
          updated,
          'updated',
          'security_policy_updated',
        );
        return updated;
      });
    },
    deletePolicy(userId, policyId) {
      const normalizedUserId = requireUser(userId);
      return runInTransaction(() => {
        const current = requirePolicy(normalizedUserId, policyId, { active: true });
        const deleted = securityPolicyRepository.softDeletePolicy(
          normalizedUserId,
          current.policyId,
          clock().toISOString(),
        );
        if (!deleted) {
          throw new ConflictError('Security policy is no longer editable.');
        }
        recordPolicyChange(
          normalizedUserId,
          deleted,
          'deleted',
          'security_policy_deleted',
        );
        return deleted;
      });
    },
    getPreferences(userId) {
      return readPreferences(requireUser(userId));
    },
    updatePreferences(userId, value) {
      const normalizedUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'defaultSecurityLevel',
        'highRiskOperationPolicy',
        'autoConfirmationScopes',
        'forbiddenScopes',
      ]);
      if (Object.keys(input).length === 0) {
        throw new ValidationError('At least one security preference must be updated.');
      }

      return runInTransaction(() => {
        const current = readPreferences(normalizedUserId);
        const now = clock().toISOString();
        const next = {
          userId: normalizedUserId,
          defaultSecurityLevel: input.defaultSecurityLevel === undefined
            ? current.defaultSecurityLevel
            : requireSecurityValue(
                input.defaultSecurityLevel,
                'defaultSecurityLevel',
                SECURITY_RISK_LEVELS,
              ),
          highRiskOperationPolicy: input.highRiskOperationPolicy === undefined
            ? current.highRiskOperationPolicy
            : requireSecurityValue(
                input.highRiskOperationPolicy,
                'highRiskOperationPolicy',
                HIGH_RISK_OPERATION_POLICIES,
              ),
          autoConfirmationScopes: input.autoConfirmationScopes === undefined
            ? current.autoConfirmationScopes
            : normalizeSecurityScopes(
                input.autoConfirmationScopes,
                'autoConfirmationScopes',
                { autoConfirmation: true },
              ),
          forbiddenScopes: input.forbiddenScopes === undefined
            ? current.forbiddenScopes
            : normalizeSecurityScopes(input.forbiddenScopes, 'forbiddenScopes'),
          createdAt: current.createdAt ?? now,
          updatedAt: now,
        };
        const unchanged = current.createdAt !== null
          && JSON.stringify({ ...current, createdAt: null, updatedAt: null })
            === JSON.stringify({ ...next, createdAt: null, updatedAt: null });
        if (unchanged) {
          return current;
        }
        const updated = securityPolicyRepository.upsertPreferences(next);
        auditLogService.recordAuditLog({
          userId: normalizedUserId,
          operationType: 'security_policy_change',
          resourceType: 'security_policy',
          resourceId: `security-preferences-${normalizedUserId}`,
          action: 'preferences_updated',
          riskLevel: 'high',
          result: 'succeeded',
          reasonCode: 'security_preference_updated',
        });
        return updated;
      });
    },
    evaluate({
      userId,
      subjectId,
      resourceType,
      resourceId,
      actionType,
      classifiedRiskLevel,
      securitySessionId,
    }) {
      const preferences = readPreferences(userId);
      const effectiveRiskLevel = highestRiskLevel(
        classifiedRiskLevel,
        preferences.defaultSecurityLevel,
      );
      const policy = securityPolicyRepository.findActivePolicy({
        userId,
        resourceType,
        actionType,
        riskLevel: effectiveRiskLevel,
      });
      const forbidden = preferences.forbiddenScopes.some(
        (scope) => scopeMatches(scope, resourceType, actionType),
      );
      const base = {
        policy,
        preferences: {
          defaultSecurityLevel: preferences.defaultSecurityLevel,
          highRiskOperationPolicy: preferences.highRiskOperationPolicy,
          updatedAt: preferences.updatedAt,
        },
        effectiveRiskLevel,
        securitySessionId: securitySessionId ?? null,
        sessionGrant: null,
      };

      if (forbidden) {
        return {
          ...base,
          decision: 'deny',
          canAsk: false,
          confirmationMode: 'not_required',
          reason: 'forbidden_scope',
        };
      }
      if (policy?.rule === 'deny' || policy?.rule === 'deny_without_confirm') {
        return {
          ...base,
          decision: 'deny',
          canAsk: policy.rule === 'deny',
          confirmationMode: 'not_required',
          reason: policy.rule,
        };
      }
      if (
        ['high', 'critical'].includes(effectiveRiskLevel)
        && ['deny', 'deny_without_confirm'].includes(preferences.highRiskOperationPolicy)
      ) {
        return {
          ...base,
          decision: 'deny',
          canAsk: preferences.highRiskOperationPolicy === 'deny',
          confirmationMode: 'not_required',
          reason: `high_risk_${preferences.highRiskOperationPolicy}`,
        };
      }
      if (['high', 'critical'].includes(effectiveRiskLevel)) {
        return {
          ...base,
          decision: 'confirm',
          canAsk: true,
          confirmationMode: 'every_time',
          reason: 'platform_high_risk_floor',
        };
      }
      if (policy?.rule === 'always_confirm') {
        return {
          ...base,
          decision: 'confirm',
          canAsk: true,
          confirmationMode: 'every_time',
          reason: 'policy_always_confirm',
        };
      }
      if (policy?.rule === 'session_allow') {
        if (!securitySessionId) {
          return {
            ...base,
            decision: 'confirm',
            canAsk: true,
            confirmationMode: 'user_defined',
            reason: 'security_session_id_required',
          };
        }
        const sessionGrant = securityPolicyRepository.findSessionGrant({
          userId,
          subjectId,
          policyId: policy.policyId,
          policyUpdatedAt: policy.updatedAt,
          securitySessionId,
          resourceId,
          actionType,
          riskLevel: effectiveRiskLevel,
          now: clock().toISOString(),
        });
        if (sessionGrant) {
          return {
            ...base,
            sessionGrant,
            decision: 'allow',
            canAsk: false,
            confirmationMode: 'not_required',
            reason: 'active_session_grant',
          };
        }
        return {
          ...base,
          decision: 'confirm',
          canAsk: true,
          confirmationMode: 'user_defined',
          reason: 'session_confirmation_required',
        };
      }
      if (policy?.rule === 'always_allow') {
        return {
          ...base,
          decision: 'allow',
          canAsk: false,
          confirmationMode: 'not_required',
          reason: 'policy_always_allow',
        };
      }
      const automaticScope = preferences.autoConfirmationScopes.find((scope) => (
        scopeMatches(scope, resourceType, actionType)
        && riskRank(effectiveRiskLevel) <= riskRank(scope.maximumRiskLevel)
      ));
      if (automaticScope) {
        return {
          ...base,
          decision: 'allow',
          canAsk: false,
          confirmationMode: 'not_required',
          reason: 'auto_confirmation_scope',
        };
      }
      const confirmationMode = confirmationModeForRisk(effectiveRiskLevel);
      return {
        ...base,
        decision: confirmationMode === 'not_required' ? 'allow' : 'confirm',
        canAsk: confirmationMode !== 'not_required',
        confirmationMode,
        reason: 'default_security_policy',
      };
    },
    createSessionGrant({
      userId,
      subjectId,
      resourceId,
      actionType,
      evaluation,
    }) {
      if (
        evaluation.policy?.rule !== 'session_allow'
        || !evaluation.securitySessionId
        || ['high', 'critical'].includes(evaluation.effectiveRiskLevel)
      ) {
        return null;
      }
      const currentPolicy = requirePolicy(userId, evaluation.policy.policyId, { active: true });
      if (currentPolicy.updatedAt !== evaluation.policy.updatedAt) {
        throw new ConflictError('Security policy changed before the session grant was created.');
      }
      const currentTime = clock();
      return securityPolicyRepository.insertSessionGrant({
        sessionGrantId: idFactory(),
        userId,
        subjectId,
        policyId: currentPolicy.policyId,
        policyUpdatedAt: currentPolicy.updatedAt,
        securitySessionId: requireSecuritySessionId(evaluation.securitySessionId),
        resourceId,
        actionType,
        riskLevel: evaluation.effectiveRiskLevel,
        grantedAt: currentTime.toISOString(),
        expiresAt: new Date(currentTime.getTime() + SESSION_GRANT_TTL_MS).toISOString(),
      });
    },
  };
}
