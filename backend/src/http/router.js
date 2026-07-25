import { ApplicationError, NotFoundError, ValidationError } from '../core/errors.js';
import { createId } from '../core/ids.js';
import { readJsonBody, sendJson } from './json.js';

function decodePathPart(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ValidationError(`${field} is not a valid path value.`, { field });
  }
}

function routeMatch(pathname, expression, names) {
  const match = pathname.match(expression);

  if (!match) {
    return null;
  }

  return Object.fromEntries(
    names.map((name, index) => [name, decodePathPart(match[index + 1], name)]),
  );
}

function errorPayload(error, requestId) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      requestId,
    },
  };
}

export function createRouter({ config, database, userService, subjectService, logger = console }) {
  return async function route(request, response) {
    const requestId = createId();
    response.setHeader('x-request-id', requestId);

    try {
      const url = new URL(request.url ?? '/', 'http://localhost');

      if (request.method === 'GET' && url.pathname === '/') {
        sendJson(response, 200, {
          data: {
            service: config.serviceName,
            version: config.serviceVersion,
            status: 'running',
          },
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          data: {
            status: 'ok',
            service: config.serviceName,
            version: config.serviceVersion,
            database: database.ping() ? 'ok' : 'unavailable',
          },
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/users') {
        const input = await readJsonBody(request);
        const user = userService.createUser(input);
        sendJson(response, 201, { data: user }, {
          location: `/api/v1/users/${encodeURIComponent(user.userId)}`,
        });
        return;
      }

      const userRoute = routeMatch(url.pathname, /^\/api\/v1\/users\/([^/]+)$/, ['userId']);
      if (request.method === 'GET' && userRoute) {
        sendJson(response, 200, { data: userService.getUser(userRoute.userId) });
        return;
      }

      const subjectsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects$/,
        ['userId'],
      );
      if (request.method === 'POST' && subjectsRoute) {
        const input = await readJsonBody(request);
        const subject = subjectService.createSubject(subjectsRoute.userId, input);
        sendJson(response, 201, { data: subject }, {
          location: `/api/v1/users/${encodeURIComponent(subject.ownerUserId)}/subjects/${encodeURIComponent(subject.subjectId)}`,
        });
        return;
      }

      const subjectRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'GET' && subjectRoute) {
        sendJson(response, 200, {
          data: subjectService.getSubject(subjectRoute.userId, subjectRoute.subjectId),
        });
        return;
      }

      throw new NotFoundError('Route was not found.');
    } catch (error) {
      if (error instanceof ApplicationError) {
        sendJson(response, error.statusCode, errorPayload(error, requestId));
        return;
      }

      logger.error?.('Unhandled backend request error.', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      const internalError = new ApplicationError('Internal server error.');
      sendJson(response, 500, errorPayload(internalError, requestId));
    }
  };
}
