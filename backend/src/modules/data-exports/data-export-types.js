import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const CURRENT_EXPORT_SCHEMA_VERSION = 'vio-live-export-v1';

export const EXPORT_TYPES = Object.freeze(['full', 'selected', 'migration']);

export const EXPORT_SCOPE_TYPES = Object.freeze([
  'user_data',
  'subject_state',
  'event',
  'message_version',
  'conversation_summary',
  'assistant_private_space',
  'assistant_global_settings',
  'permission',
  'security_policy',
  'tool',
  'device',
  'life_data',
]);

export const MIGRATION_TARGET_TYPES = Object.freeze(['robot', 'other_carrier']);

export function requireDataExportValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });
  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues,
    });
  }
  return normalized;
}
