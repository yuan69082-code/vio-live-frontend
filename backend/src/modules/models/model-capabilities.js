import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const MODEL_CAPABILITIES = Object.freeze([
  'chat',
  'vision',
  'image',
  'video',
  'embedding',
]);

export function requireCapability(value, field = 'capability') {
  const capability = requireString(value, field, { maxLength: 80 });

  if (!MODEL_CAPABILITIES.includes(capability)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues: MODEL_CAPABILITIES,
    });
  }

  return capability;
}
