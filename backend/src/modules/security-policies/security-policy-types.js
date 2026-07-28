import { ValidationError } from '../../core/errors.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCE_TYPES,
  requirePermissionValue,
} from '../permissions/permission-types.js';
import {
  SECURITY_RISK_LEVELS,
  requireSecurityValue,
} from '../security/security-types.js';

export const SECURITY_POLICY_RULES = Object.freeze([
  'always_allow',
  'session_allow',
  'always_confirm',
  'deny',
  'deny_without_confirm',
]);

export const HIGH_RISK_OPERATION_POLICIES = Object.freeze([
  'always_confirm',
  'deny',
  'deny_without_confirm',
]);

export const SECURITY_POLICY_STATUSES = Object.freeze(['active', 'deleted']);

export const DEFAULT_SECURITY_PREFERENCES = Object.freeze({
  defaultSecurityLevel: 'low',
  highRiskOperationPolicy: 'always_confirm',
  autoConfirmationScopes: Object.freeze([]),
  forbiddenScopes: Object.freeze([]),
});

function requireOnlyFields(value, field, allowedFields) {
  const input = requirePlainObject(value, field);
  const unexpectedFields = Object.keys(input).filter(
    (name) => !allowedFields.includes(name),
  );
  if (unexpectedFields.length > 0) {
    throw new ValidationError(`${field} contains unsupported fields.`, {
      field,
      unexpectedFields,
    });
  }
  return input;
}

function normalizeScope(value, field, { autoConfirmation }) {
  const allowedFields = autoConfirmation
    ? ['resourceType', 'actionType', 'maximumRiskLevel']
    : ['resourceType', 'actionType'];
  const input = requireOnlyFields(value, field, allowedFields);
  const scope = {
    resourceType: requirePermissionValue(
      input.resourceType,
      `${field}.resourceType`,
      PERMISSION_RESOURCE_TYPES,
    ),
    actionType: requirePermissionValue(
      input.actionType,
      `${field}.actionType`,
      PERMISSION_ACTIONS,
    ),
  };

  if (autoConfirmation) {
    scope.maximumRiskLevel = requireSecurityValue(
      input.maximumRiskLevel,
      `${field}.maximumRiskLevel`,
      ['low', 'medium'],
    );
  }

  return scope;
}

export function normalizeSecurityScopes(value, field, { autoConfirmation = false } = {}) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array.`, { field });
  }
  if (value.length > 100) {
    throw new ValidationError(`${field} contains too many items.`, {
      field,
      maxItems: 100,
    });
  }

  const scopes = value.map((scope, index) => normalizeScope(
    scope,
    `${field}[${index}]`,
    { autoConfirmation },
  ));
  const keys = scopes.map((scope) => JSON.stringify(scope));
  if (new Set(keys).size !== keys.length) {
    throw new ValidationError(`${field} must not contain duplicate scopes.`, { field });
  }
  return scopes;
}

export function requireSecurityPolicyRule(value, field = 'rule') {
  return requireSecurityValue(value, field, SECURITY_POLICY_RULES);
}

export function requireSecuritySessionId(value) {
  const sessionId = requireString(value, 'securitySessionId', { maxLength: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(sessionId)) {
    throw new ValidationError('securitySessionId must be an opaque registry identifier.', {
      field: 'securitySessionId',
    });
  }
  return sessionId;
}

export function riskRank(level) {
  return SECURITY_RISK_LEVELS.indexOf(level);
}
