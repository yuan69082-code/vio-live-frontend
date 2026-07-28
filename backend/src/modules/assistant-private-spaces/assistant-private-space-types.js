import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const ASSISTANT_PRIVATE_SPACE_STATUSES = Object.freeze([
  'active',
  'inactive',
]);

export const ASSISTANT_PRIVATE_CONTENT_TYPES = Object.freeze([
  'ai_state_record',
  'ai_cognition_record',
  'ai_long_term_preference',
  'ai_work_record',
  'ai_private_note',
]);

export function requireAssistantPrivateValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });
  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues,
    });
  }

  return normalized;
}
