import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const WAKE_TYPES = Object.freeze(['voice', 'desktop', 'schedule', 'event']);
export const REGISTRY_STATUSES = Object.freeze(['enabled', 'disabled']);
export const WAKE_AUTHORIZATION_STATUSES = Object.freeze([
  'not_granted',
  'granted',
  'revoked',
]);
export const MESSAGE_PRIORITIES = Object.freeze([
  'urgent',
  'important',
  'normal',
  'silent',
]);
export const TOKEN_OVERAGE_POLICIES = Object.freeze([
  'block',
  'require_confirmation',
  'defer',
]);
export const BACKGROUND_RUN_STATES = Object.freeze(['idle', 'active']);

export function requireProactiveValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });
  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues,
    });
  }
  return normalized;
}
