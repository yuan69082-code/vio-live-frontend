import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const MODEL_CAPABILITIES = Object.freeze([
  'chat',
  'long_text',
  'vision',
  'image',
  'video',
  'audio',
  'search',
  'embedding',
]);

export const MODEL_TASK_TYPES = Object.freeze([
  'chat',
  'long_text',
  'image',
  'video',
  'audio',
  'search',
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

export function requireTaskType(value, field = 'taskType') {
  const taskType = requireString(value, field, { maxLength: 80 });

  if (!MODEL_TASK_TYPES.includes(taskType)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues: MODEL_TASK_TYPES,
    });
  }

  return taskType;
}
