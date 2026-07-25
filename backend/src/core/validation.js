import { ValidationError } from './errors.js';

export function requireString(value, field, { maxLength, minLength = 1 } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`, { field });
  }

  const normalized = value.trim();

  if (normalized.length < minLength) {
    throw new ValidationError(`${field} is required.`, { field });
  }

  if (maxLength && normalized.length > maxLength) {
    throw new ValidationError(`${field} must not exceed ${maxLength} characters.`, {
      field,
      maxLength,
    });
  }

  return normalized;
}

export function optionalString(value, field, { maxLength } = {}) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return requireString(value, field, { maxLength });
}

export function normalizeEmail(value) {
  const email = requireString(value, 'email', { maxLength: 254 }).toLowerCase();
  const simpleEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!simpleEmailPattern.test(email)) {
    throw new ValidationError('email must be a valid email address.', { field: 'email' });
  }

  return email;
}

export function requirePlainObject(value, field) {
  if (value === undefined) {
    return {};
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object.`, { field });
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ValidationError(`${field} must be a plain JSON object.`, { field });
  }

  try {
    const serialized = JSON.stringify(value);

    if (Buffer.byteLength(serialized) > 32_768) {
      throw new ValidationError(`${field} must not exceed 32768 bytes.`, {
        field,
        maxBytes: 32_768,
      });
    }

    return JSON.parse(serialized);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    throw new ValidationError(`${field} must contain JSON-compatible values.`, { field });
  }
}
