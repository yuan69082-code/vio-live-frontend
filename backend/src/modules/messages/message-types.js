import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const MESSAGE_SENDER_TYPES = Object.freeze([
  'user',
  'subject',
  'system',
]);

export const MESSAGE_VERSION_REASONS = Object.freeze([
  'original',
  'edited',
  'regenerated',
]);

export function requireMessageSender(value) {
  const senderType = requireString(value, 'senderType', { maxLength: 32 });

  if (!MESSAGE_SENDER_TYPES.includes(senderType)) {
    throw new ValidationError('senderType is not supported.', {
      field: 'senderType',
      allowedValues: MESSAGE_SENDER_TYPES,
    });
  }

  return senderType;
}

export function requireMessageContent(value) {
  if (typeof value !== 'string') {
    throw new ValidationError('content must be a string.', { field: 'content' });
  }

  const content = value.replace(/\r\n?/g, '\n');

  if (content.trim().length === 0) {
    throw new ValidationError('content is required.', { field: 'content' });
  }

  if (content.length > 32_768) {
    throw new ValidationError('content must not exceed 32768 characters.', {
      field: 'content',
      maxLength: 32_768,
    });
  }

  return content;
}
