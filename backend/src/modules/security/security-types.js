import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const SECURITY_RISK_LEVELS = Object.freeze([
  'low',
  'medium',
  'high',
  'critical',
]);

export const SECURITY_OPERATION_TYPES = Object.freeze([
  'general_access',
  'permission_change',
  'security_policy_change',
  'api_configuration_change',
  'privacy_access_request',
  'payment_operation',
  'device_control',
  'sensitive_data_access',
  'data_deletion',
]);

export const SECURITY_RESOURCE_TYPES = Object.freeze([
  'permission',
  'security_policy',
  'api_provider',
  'memory',
  'tool',
  'mcp',
  'skill',
  'device',
  'api',
  'private_domain',
  'identity',
  'payment',
]);

export const CONFIRMATION_MODES = Object.freeze([
  'not_required',
  'every_time',
  'user_defined',
]);

export const STORED_CONFIRMATION_MODES = Object.freeze([
  'every_time',
  'user_defined',
]);

export const CONFIRMATION_STATUSES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'consumed',
  'expired',
]);

export const AUDIT_RESULTS = Object.freeze([
  'allowed',
  'denied',
  'confirmation_required',
  'confirmed',
  'rejected',
  'succeeded',
  'failed',
]);

export const PERMISSION_DECISIONS = Object.freeze([
  'allow',
  'ask',
  'deny',
]);

export const AUDIT_REASON_CODES = Object.freeze([
  'permission_created',
  'permission_updated',
  'permission_deleted',
  'permission_consumed',
  'security_policy_created',
  'security_policy_updated',
  'security_policy_deleted',
  'security_preference_updated',
  'security_policy_denied',
  'api_provider_created',
  'api_provider_status_updated',
  'permission_denied',
  'confirmation_required',
  'confirmation_pending',
  'confirmation_approved',
  'confirmation_rejected',
  'confirmation_scope_mismatch',
  'confirmation_replayed',
  'confirmation_expired',
  'security_preflight_allowed',
  'allow_once_unavailable',
]);

const riskRanks = new Map(SECURITY_RISK_LEVELS.map((level, index) => [level, index]));

export function requireSecurityValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });

  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues,
    });
  }

  return normalized;
}

export function highestRiskLevel(...levels) {
  return levels.reduce((highest, level) => (
    riskRanks.get(level) > riskRanks.get(highest) ? level : highest
  ), 'low');
}

export function confirmationModeForRisk(riskLevel) {
  if (riskLevel === 'high' || riskLevel === 'critical') {
    return 'every_time';
  }

  if (riskLevel === 'medium') {
    return 'user_defined';
  }

  return 'not_required';
}
