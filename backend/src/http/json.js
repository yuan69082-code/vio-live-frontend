import {
  ApplicationError,
  PayloadTooLargeError,
  ValidationError,
} from '../core/errors.js';

const maxBodyBytes = 1_048_576;

export function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

export async function readJsonBody(request) {
  const contentType = request.headers['content-type'] ?? '';

  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ApplicationError('Content-Type must be application/json.', {
      code: 'unsupported_media_type',
      statusCode: 415,
    });
  }

  const chunks = [];
  let bodyBytes = 0;

  for await (const chunk of request) {
    bodyBytes += chunk.length;

    if (bodyBytes > maxBodyBytes) {
      throw new PayloadTooLargeError();
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body must contain valid JSON.');
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  return value;
}
