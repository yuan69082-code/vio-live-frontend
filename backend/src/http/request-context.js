import { ValidationError } from '../core/errors.js';
import { requireString } from '../core/validation.js';

export const DEVELOPMENT_USER_HEADER = 'x-vio-user-id';

export function requireDevelopmentUserId(request) {
  const value = request.headers[DEVELOPMENT_USER_HEADER];

  if (Array.isArray(value)) {
    throw new ValidationError(`${DEVELOPMENT_USER_HEADER} must have one value.`, {
      header: DEVELOPMENT_USER_HEADER,
    });
  }

  if (value === undefined) {
    throw new ValidationError(
      `${DEVELOPMENT_USER_HEADER} is required for the development current-user route.`,
      { header: DEVELOPMENT_USER_HEADER },
    );
  }

  return requireString(value, DEVELOPMENT_USER_HEADER, { maxLength: 128 });
}
