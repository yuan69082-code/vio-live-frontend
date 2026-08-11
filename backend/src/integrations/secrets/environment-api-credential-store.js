import { ValidationError } from '../../core/errors.js';

export const API_KEY_SECRET_REF_PATTERN = /^env:(VIO_MODEL_API_KEY_[A-Z0-9_]+)$/;

export function requireApiKeySecretRef(value) {
  if (typeof value !== 'string' || value.length > 160) {
    throw new ValidationError('secretRef must be a supported environment reference.', {
      field: 'secretRef',
    });
  }
  const match = API_KEY_SECRET_REF_PATTERN.exec(value);
  if (!match) {
    throw new ValidationError(
      'secretRef must use env:VIO_MODEL_API_KEY_* with uppercase letters, digits, or underscores.',
      { field: 'secretRef' },
    );
  }
  return Object.freeze({ secretRef: value, environmentName: match[1] });
}

export function createEnvironmentApiCredentialStore(environment = process.env) {
  return Object.freeze({
    describeApiKey({ secretRef }) {
      if (!secretRef) return Object.freeze({
        status: 'not_configured',
        storage: 'secure_store_required',
        writeSupported: false,
      });
      requireApiKeySecretRef(secretRef);
      return Object.freeze({
        status: 'configured',
        storage: 'environment_reference',
        writeSupported: true,
      });
    },
    resolveApiKey({ secretRef }) {
      const { environmentName } = requireApiKeySecretRef(secretRef);
      const value = environment[environmentName];
      if (typeof value !== 'string' || value.length < 1 || value.length > 8192) {
        throw new ValidationError('Configured API credential cannot be resolved.');
      }
      return value;
    },
  });
}
