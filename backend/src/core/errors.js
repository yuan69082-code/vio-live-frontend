export class ApplicationError extends Error {
  constructor(message, { code = 'internal_error', statusCode = 500, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends ApplicationError {
  constructor(message, details) {
    super(message, { code: 'validation_error', statusCode: 400, details });
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message) {
    super(message, { code: 'not_found', statusCode: 404 });
  }
}

export class ConflictError extends ApplicationError {
  constructor(message) {
    super(message, { code: 'conflict', statusCode: 409 });
  }
}

export class PayloadTooLargeError extends ApplicationError {
  constructor(message = 'Request body is too large.') {
    super(message, { code: 'payload_too_large', statusCode: 413 });
  }
}
