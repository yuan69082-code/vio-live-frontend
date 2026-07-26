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

export function createRouter({
  config,
  database,
  userService,
  subjectService,
  eventService,
  apiProviderService,
  modelService,
  modelRouterService,
  logger = console,
}) {
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

      const eventsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/events$/,
        ['userId'],
      );
      if (request.method === 'POST' && eventsRoute) {
        const input = await readJsonBody(request);
        const event = eventService.createEvent(eventsRoute.userId, input);
        sendJson(response, 201, { data: event }, {
          location: `/api/v1/users/${encodeURIComponent(event.userId)}/events/${encodeURIComponent(event.eventId)}`,
        });
        return;
      }

      if (request.method === 'GET' && eventsRoute) {
        const events = eventService.listEvents(eventsRoute.userId, {
          subjectId: url.searchParams.get('subjectId'),
          eventType: url.searchParams.get('eventType'),
          status: url.searchParams.get('status'),
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          limit: url.searchParams.get('limit'),
        });
        sendJson(response, 200, {
          data: events,
          meta: {
            count: events.length,
          },
        });
        return;
      }

      const eventRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/events\/([^/]+)$/,
        ['userId', 'eventId'],
      );
      if (request.method === 'GET' && eventRoute) {
        sendJson(response, 200, {
          data: eventService.getEvent(eventRoute.userId, eventRoute.eventId),
        });
        return;
      }

      const apiProvidersRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/api-providers$/,
        ['userId'],
      );
      if (request.method === 'POST' && apiProvidersRoute) {
        const input = await readJsonBody(request);
        const provider = apiProviderService.createProvider(apiProvidersRoute.userId, input);
        sendJson(response, 201, { data: provider }, {
          location: `/api/v1/users/${encodeURIComponent(provider.ownerUserId)}/api-providers/${encodeURIComponent(provider.providerId)}`,
        });
        return;
      }

      if (request.method === 'GET' && apiProvidersRoute) {
        const providers = apiProviderService.listProviders(apiProvidersRoute.userId);
        sendJson(response, 200, {
          data: providers,
          meta: { count: providers.length },
        });
        return;
      }

      const apiProviderStatusRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/api-providers\/([^/]+)\/status$/,
        ['userId', 'providerId'],
      );
      if (request.method === 'PATCH' && apiProviderStatusRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: apiProviderService.updateProviderStatus(
            apiProviderStatusRoute.userId,
            apiProviderStatusRoute.providerId,
            input,
          ),
        });
        return;
      }

      const apiProviderRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/api-providers\/([^/]+)$/,
        ['userId', 'providerId'],
      );
      if (request.method === 'GET' && apiProviderRoute) {
        sendJson(response, 200, {
          data: apiProviderService.getProvider(
            apiProviderRoute.userId,
            apiProviderRoute.providerId,
          ),
        });
        return;
      }

      const providerModelsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/api-providers\/([^/]+)\/models$/,
        ['userId', 'providerId'],
      );
      if (request.method === 'POST' && providerModelsRoute) {
        const input = await readJsonBody(request);
        const model = modelService.createModel(
          providerModelsRoute.userId,
          providerModelsRoute.providerId,
          input,
        );
        sendJson(response, 201, { data: model }, {
          location: `/api/v1/users/${encodeURIComponent(providerModelsRoute.userId)}/models/${encodeURIComponent(model.modelId)}`,
        });
        return;
      }

      const modelsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/models$/,
        ['userId'],
      );
      if (request.method === 'GET' && modelsRoute) {
        const models = modelService.findModelsByCapability(
          modelsRoute.userId,
          url.searchParams.get('capability'),
        );
        sendJson(response, 200, {
          data: models,
          meta: { count: models.length },
        });
        return;
      }

      const modelRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/models\/([^/]+)$/,
        ['userId', 'modelId'],
      );
      if (request.method === 'GET' && modelRoute) {
        sendJson(response, 200, {
          data: modelService.getModel(modelRoute.userId, modelRoute.modelId),
        });
        return;
      }

      const modelRouterRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/model-router\/select$/,
        ['userId'],
      );
      if (request.method === 'POST' && modelRouterRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: modelRouterService.selectModel(modelRouterRoute.userId, input.taskType),
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
