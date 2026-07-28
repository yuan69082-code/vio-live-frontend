import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const REGISTRY_STATUSES = Object.freeze(['enabled', 'disabled']);

export const CAPABILITY_CATEGORIES = Object.freeze([
  'tool',
  'mcp',
  'skill',
  'plugin',
]);

export function requireRegistryValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });
  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues,
    });
  }

  return normalized;
}

export function optionalRegistryValue(value, field, allowedValues) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return requireRegistryValue(value, field, allowedValues);
}
