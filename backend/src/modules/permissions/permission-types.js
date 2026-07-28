import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const PERMISSION_RESOURCE_TYPES = Object.freeze([
  'memory',
  'tool',
  'mcp',
  'skill',
  'device',
  'api',
  'private_domain',
  'life_data',
  'proactive_interaction',
]);

export const PERMISSION_LEVELS = Object.freeze([
  'always_allow',
  'ask_every_time',
  'allow_once',
  'denied',
  'forbidden_ask',
]);

export const PERMISSION_STATUSES = Object.freeze([
  'active',
  'inactive',
  'consumed',
  'deleted',
]);

export const EDITABLE_PERMISSION_STATUSES = Object.freeze([
  'active',
  'inactive',
]);

export const PERMISSION_ACTIONS = Object.freeze([
  'read',
  'write',
  'execute',
  'control',
  'connect',
  'export',
  'delete',
  'manage',
]);

export function requirePermissionValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });

  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues,
    });
  }

  return normalized;
}
