import { createHash, timingSafeEqual } from 'node:crypto';

import { ValidationError } from '../../core/errors.js';

export const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new ValidationError('RFC 8785 input contains an unpaired surrogate.');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ValidationError('RFC 8785 input contains an unpaired surrogate.');
    }
  }
}

function canonicalizeValue(value, seen) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError('RFC 8785 input numbers must be finite.');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new ValidationError('Value cannot be canonicalized as RFC 8785 JSON.');
  }
  if (seen.has(value)) {
    throw new ValidationError('RFC 8785 input must not contain cycles.');
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalizeValue(item, seen)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ValidationError('RFC 8785 input must contain plain JSON objects.');
    }
    const keys = Object.keys(value).sort();
    const members = keys.map((key) => {
      assertUnicodeScalarString(key);
      return `${JSON.stringify(key)}:${canonicalizeValue(value[key], seen)}`;
    });
    return `{${members.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeJson(value) {
  return Buffer.from(canonicalizeValue(value, new Set()), 'utf8');
}

export function sha256Hash(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function calculateContentHash(content) {
  if (typeof content !== 'string') {
    throw new ValidationError('content must be a string.', { field: 'content' });
  }
  return sha256Hash(Buffer.from(content, 'utf8'));
}

export function calculateRequestHash(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new ValidationError('request hash input must be an object.');
  }
  const logicalRequest = { ...request };
  delete logicalRequest.requestHash;
  return sha256Hash(canonicalizeJson(logicalRequest));
}

export function calculateStateHash(authoritativeState) {
  if (
    authoritativeState === null
    || typeof authoritativeState !== 'object'
    || Array.isArray(authoritativeState)
  ) {
    throw new ValidationError('SubjectState hash input must be an object.');
  }
  return sha256Hash(canonicalizeJson(authoritativeState));
}

export function calculateProjectionContentHash(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new ValidationError('state projection snapshot hash input must be an object.');
  }
  return sha256Hash(canonicalizeJson(snapshot));
}

export function calculateEnvelopeHash(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new ValidationError('Engine envelope hash input must be an object.');
  }
  return sha256Hash(canonicalizeJson(envelope));
}

function withoutHashFields(value) {
  if (Array.isArray(value)) return value.map(withoutHashFields);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.toLowerCase().endsWith('hash'))
    .map(([key, item]) => [key, withoutHashFields(item)]));
}

export function calculateBindingFixtureHash(fixture) {
  if (fixture === null || typeof fixture !== 'object' || Array.isArray(fixture)) {
    throw new ValidationError('SubjectBinding fixture hash input must be an object.');
  }
  return sha256Hash(canonicalizeJson(withoutHashFields(fixture)));
}

export function verifyDeclaredHash({ declared, calculated, fieldName }) {
  if (typeof declared !== 'string' || !HASH_PATTERN.test(declared)) {
    throw new ValidationError(
      `${fieldName} must use sha256: followed by 64 lowercase hexadecimal digits.`,
      { field: fieldName },
    );
  }
  const declaredBytes = Buffer.from(declared);
  const calculatedBytes = Buffer.from(calculated);
  if (
    declaredBytes.length !== calculatedBytes.length
    || !timingSafeEqual(declaredBytes, calculatedBytes)
  ) {
    throw new ValidationError(`${fieldName} does not match its content.`, {
      field: fieldName,
    });
  }
}
