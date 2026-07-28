import { ApplicationError, NotFoundError, ValidationError } from '../core/errors.js';
import { createId } from '../core/ids.js';
import { readJsonBody, sendJson } from './json.js';
import { requireDevelopmentUserId } from './request-context.js';

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
  conversationService,
  conversationSummaryService,
  subjectStateService,
  contextService,
  messageService,
  messageVersionService,
  dashboardService,
  eventService,
  apiProviderService,
  modelService,
  modelRouterService,
  permissionService,
  permissionChecker,
  securityService,
  sensitiveDataService,
  auditLogService,
  confirmationService,
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

      if (
        request.method === 'GET'
        && url.pathname === '/api/v1/security/sensitive-data-categories'
      ) {
        const classifications = sensitiveDataService.listClassifications();
        sendJson(response, 200, {
          data: classifications,
          meta: { count: classifications.length },
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

      if (request.method === 'GET' && url.pathname === '/api/v1/users/current') {
        const userId = requireDevelopmentUserId(request);
        sendJson(response, 200, { data: userService.getUser(userId) });
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

      if (request.method === 'GET' && subjectsRoute) {
        const subjects = subjectService.listSubjects(subjectsRoute.userId);
        sendJson(response, 200, {
          data: subjects,
          meta: { count: subjects.length },
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

      if (request.method === 'PATCH' && subjectRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: subjectService.updateSubject(
            subjectRoute.userId,
            subjectRoute.subjectId,
            input,
          ),
        });
        return;
      }

      const dashboardRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/dashboard$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'GET' && dashboardRoute) {
        sendJson(response, 200, {
          data: dashboardService.getDashboard(
            dashboardRoute.userId,
            dashboardRoute.subjectId,
          ),
        });
        return;
      }

      const subjectStateRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/state$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'GET' && subjectStateRoute) {
        sendJson(response, 200, {
          data: subjectStateService.getCurrentState(
            subjectStateRoute.userId,
            subjectStateRoute.subjectId,
          ),
        });
        return;
      }

      const subjectStateUpdatesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/state-updates$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && subjectStateUpdatesRoute) {
        const input = await readJsonBody(request);
        const state = subjectStateService.createStateUpdate(
          subjectStateUpdatesRoute.userId,
          subjectStateUpdatesRoute.subjectId,
          input,
        );
        sendJson(response, 201, { data: state }, {
          location: `/api/v1/users/${encodeURIComponent(state.userId)}/subjects/${encodeURIComponent(state.subjectId)}/state-updates/${encodeURIComponent(state.subjectStateId)}`,
        });
        return;
      }

      if (request.method === 'GET' && subjectStateUpdatesRoute) {
        const states = subjectStateService.listStateUpdates(
          subjectStateUpdatesRoute.userId,
          subjectStateUpdatesRoute.subjectId,
          { limit: url.searchParams.get('limit') },
        );
        sendJson(response, 200, {
          data: states,
          meta: { count: states.length },
        });
        return;
      }

      const subjectStateUpdateRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/state-updates\/([^/]+)$/,
        ['userId', 'subjectId', 'subjectStateId'],
      );
      if (request.method === 'GET' && subjectStateUpdateRoute) {
        sendJson(response, 200, {
          data: subjectStateService.getStateUpdate(
            subjectStateUpdateRoute.userId,
            subjectStateUpdateRoute.subjectId,
            subjectStateUpdateRoute.subjectStateId,
          ),
        });
        return;
      }

      const conversationsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && conversationsRoute) {
        const input = await readJsonBody(request);
        const conversation = conversationService.createConversation(
          conversationsRoute.userId,
          conversationsRoute.subjectId,
          input,
        );
        sendJson(response, 201, { data: conversation }, {
          location: `/api/v1/users/${encodeURIComponent(conversation.userId)}/subjects/${encodeURIComponent(conversation.subjectId)}/conversations/${encodeURIComponent(conversation.conversationId)}`,
        });
        return;
      }

      if (request.method === 'GET' && conversationsRoute) {
        const conversations = conversationService.listConversations(
          conversationsRoute.userId,
          conversationsRoute.subjectId,
        );
        sendJson(response, 200, {
          data: conversations,
          meta: { count: conversations.length },
        });
        return;
      }

      const conversationRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)$/,
        ['userId', 'subjectId', 'conversationId'],
      );
      if (request.method === 'GET' && conversationRoute) {
        sendJson(response, 200, {
          data: conversationService.getConversation(
            conversationRoute.userId,
            conversationRoute.subjectId,
            conversationRoute.conversationId,
          ),
        });
        return;
      }

      const conversationSummariesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/summaries$/,
        ['userId', 'subjectId', 'conversationId'],
      );
      if (request.method === 'POST' && conversationSummariesRoute) {
        const input = await readJsonBody(request);
        const summary = conversationSummaryService.createSummary(
          conversationSummariesRoute.userId,
          conversationSummariesRoute.subjectId,
          conversationSummariesRoute.conversationId,
          input,
        );
        sendJson(response, 201, { data: summary }, {
          location: `${url.pathname}/${encodeURIComponent(summary.summaryId)}`,
        });
        return;
      }

      if (request.method === 'GET' && conversationSummariesRoute) {
        const summaries = conversationSummaryService.listSummaries(
          conversationSummariesRoute.userId,
          conversationSummariesRoute.subjectId,
          conversationSummariesRoute.conversationId,
          { limit: url.searchParams.get('limit') },
        );
        sendJson(response, 200, {
          data: summaries,
          meta: { count: summaries.length },
        });
        return;
      }

      const conversationSummaryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/summaries\/([^/]+)$/,
        ['userId', 'subjectId', 'conversationId', 'summaryId'],
      );
      if (request.method === 'GET' && conversationSummaryRoute) {
        sendJson(response, 200, {
          data: conversationSummaryService.getSummary(
            conversationSummaryRoute.userId,
            conversationSummaryRoute.subjectId,
            conversationSummaryRoute.conversationId,
            conversationSummaryRoute.summaryId,
          ),
        });
        return;
      }

      const crossWindowSummariesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/cross-window-summaries$/,
        ['userId', 'subjectId', 'conversationId'],
      );
      if (request.method === 'GET' && crossWindowSummariesRoute) {
        const summaries = conversationSummaryService.listCrossWindowSummaries(
          crossWindowSummariesRoute.userId,
          crossWindowSummariesRoute.subjectId,
          crossWindowSummariesRoute.conversationId,
          { limit: url.searchParams.get('limit') },
        );
        sendJson(response, 200, {
          data: summaries,
          meta: { count: summaries.length },
        });
        return;
      }

      const contextRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/context$/,
        ['userId', 'subjectId', 'conversationId'],
      );
      if (request.method === 'GET' && contextRoute) {
        sendJson(response, 200, {
          data: contextService.assembleContext(
            contextRoute.userId,
            contextRoute.subjectId,
            contextRoute.conversationId,
            {
              recentMessageLimit: url.searchParams.get('recentMessageLimit'),
              crossWindowSummaryLimit: url.searchParams.get(
                'crossWindowSummaryLimit',
              ),
            },
          ),
        });
        return;
      }

      const messagesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/messages$/,
        ['userId', 'subjectId', 'conversationId'],
      );
      if (request.method === 'POST' && messagesRoute) {
        const input = await readJsonBody(request);
        const message = messageService.createMessage(
          messagesRoute.userId,
          messagesRoute.subjectId,
          messagesRoute.conversationId,
          input,
        );
        sendJson(response, 201, { data: message }, {
          location: `/api/v1/users/${encodeURIComponent(message.userId)}/subjects/${encodeURIComponent(message.subjectId)}/conversations/${encodeURIComponent(message.conversationId)}/messages/${encodeURIComponent(message.messageId)}`,
        });
        return;
      }

      if (request.method === 'GET' && messagesRoute) {
        const messages = messageService.listMessages(
          messagesRoute.userId,
          messagesRoute.subjectId,
          messagesRoute.conversationId,
        );
        sendJson(response, 200, {
          data: messages,
          meta: { count: messages.length },
        });
        return;
      }

      const messageRegenerationsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/messages\/([^/]+)\/regenerations$/,
        ['userId', 'subjectId', 'conversationId', 'messageId'],
      );
      if (request.method === 'POST' && messageRegenerationsRoute) {
        const input = await readJsonBody(request);
        const version = messageVersionService.regenerateSubjectMessage(
          messageRegenerationsRoute.userId,
          messageRegenerationsRoute.subjectId,
          messageRegenerationsRoute.conversationId,
          messageRegenerationsRoute.messageId,
          input,
        );
        sendJson(response, 201, { data: version }, {
          location: `${url.pathname.replace(/\/regenerations$/, '/versions')}/${encodeURIComponent(version.messageVersionId)}`,
        });
        return;
      }

      const messageVersionsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/messages\/([^/]+)\/versions$/,
        ['userId', 'subjectId', 'conversationId', 'messageId'],
      );
      if (request.method === 'GET' && messageVersionsRoute) {
        const versions = messageVersionService.listMessageVersions(
          messageVersionsRoute.userId,
          messageVersionsRoute.subjectId,
          messageVersionsRoute.conversationId,
          messageVersionsRoute.messageId,
        );
        sendJson(response, 200, {
          data: versions,
          meta: { count: versions.length },
        });
        return;
      }

      const messageVersionRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/messages\/([^/]+)\/versions\/([^/]+)$/,
        ['userId', 'subjectId', 'conversationId', 'messageId', 'messageVersionId'],
      );
      if (request.method === 'GET' && messageVersionRoute) {
        sendJson(response, 200, {
          data: messageVersionService.getMessageVersion(
            messageVersionRoute.userId,
            messageVersionRoute.subjectId,
            messageVersionRoute.conversationId,
            messageVersionRoute.messageId,
            messageVersionRoute.messageVersionId,
          ),
        });
        return;
      }

      const messageRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/conversations\/([^/]+)\/messages\/([^/]+)$/,
        ['userId', 'subjectId', 'conversationId', 'messageId'],
      );
      if (request.method === 'GET' && messageRoute) {
        sendJson(response, 200, {
          data: messageService.getMessage(
            messageRoute.userId,
            messageRoute.subjectId,
            messageRoute.conversationId,
            messageRoute.messageId,
          ),
        });
        return;
      }

      if (request.method === 'PATCH' && messageRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: messageVersionService.editUserMessage(
            messageRoute.userId,
            messageRoute.subjectId,
            messageRoute.conversationId,
            messageRoute.messageId,
            input,
          ),
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

      const permissionsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/permissions$/,
        ['userId'],
      );
      if (request.method === 'POST' && permissionsRoute) {
        const input = await readJsonBody(request);
        const permission = permissionService.createPermission(
          permissionsRoute.userId,
          input,
        );
        sendJson(response, 201, { data: permission }, {
          location: `/api/v1/users/${encodeURIComponent(permission.userId)}/permissions/${encodeURIComponent(permission.permissionId)}`,
        });
        return;
      }

      if (request.method === 'GET' && permissionsRoute) {
        const permissions = permissionService.listPermissions(permissionsRoute.userId, {
          subjectId: url.searchParams.get('subjectId'),
          resourceType: url.searchParams.get('resourceType'),
          resourceId: url.searchParams.get('resourceId'),
          action: url.searchParams.get('action'),
          status: url.searchParams.get('status'),
        });
        sendJson(response, 200, {
          data: permissions,
          meta: { count: permissions.length },
        });
        return;
      }

      const permissionRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/permissions\/([^/]+)$/,
        ['userId', 'permissionId'],
      );
      if (request.method === 'GET' && permissionRoute) {
        sendJson(response, 200, {
          data: permissionService.getPermission(
            permissionRoute.userId,
            permissionRoute.permissionId,
          ),
        });
        return;
      }

      if (request.method === 'PATCH' && permissionRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: permissionService.updatePermission(
            permissionRoute.userId,
            permissionRoute.permissionId,
            input,
          ),
        });
        return;
      }

      if (request.method === 'DELETE' && permissionRoute) {
        sendJson(response, 200, {
          data: permissionService.deletePermission(
            permissionRoute.userId,
            permissionRoute.permissionId,
          ),
        });
        return;
      }

      const permissionChecksRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/permission-checks$/,
        ['userId'],
      );
      if (request.method === 'POST' && permissionChecksRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: permissionChecker.checkPermission(permissionChecksRoute.userId, input),
        });
        return;
      }

      const securityChecksRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/security-checks$/,
        ['userId'],
      );
      if (request.method === 'POST' && securityChecksRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: securityService.checkSecurity(securityChecksRoute.userId, input),
        });
        return;
      }

      const auditLogsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/audit-logs$/,
        ['userId'],
      );
      if (request.method === 'GET' && auditLogsRoute) {
        const auditLogs = auditLogService.listAuditLogs(auditLogsRoute.userId, {
          subjectId: url.searchParams.get('subjectId'),
          operationType: url.searchParams.get('operationType'),
          resourceType: url.searchParams.get('resourceType'),
          result: url.searchParams.get('result'),
          riskLevel: url.searchParams.get('riskLevel'),
          limit: url.searchParams.get('limit'),
        });
        sendJson(response, 200, {
          data: auditLogs,
          meta: { count: auditLogs.length },
        });
        return;
      }

      const auditLogRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/audit-logs\/([^/]+)$/,
        ['userId', 'auditLogId'],
      );
      if (request.method === 'GET' && auditLogRoute) {
        sendJson(response, 200, {
          data: auditLogService.getAuditLog(
            auditLogRoute.userId,
            auditLogRoute.auditLogId,
          ),
        });
        return;
      }

      const confirmationRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/confirmations\/([^/]+)$/,
        ['userId', 'confirmationId'],
      );
      if (request.method === 'GET' && confirmationRoute) {
        sendJson(response, 200, {
          data: confirmationService.getConfirmation(
            confirmationRoute.userId,
            confirmationRoute.confirmationId,
          ),
        });
        return;
      }

      if (request.method === 'PATCH' && confirmationRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: confirmationService.decideConfirmation(
            confirmationRoute.userId,
            confirmationRoute.confirmationId,
            input,
          ),
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
