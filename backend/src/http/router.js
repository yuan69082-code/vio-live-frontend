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

function sendSecuredResult(response, result, { created = false } = {}) {
  const statusCode = created && result.operationStatus === 'completed' ? 201 : 200;
  sendJson(response, statusCode, { data: result });
}

export function createRouter({
  config,
  database,
  userService,
  userSpaceService,
  dataIsolationService,
  subjectService,
  assistantGlobalSettingsService,
  assistantPrivateSpaceService,
  lifeManagementService,
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
  modelRoutingRuleService,
  permissionService,
  permissionChecker,
  securityService,
  securityPolicyService,
  dataExportService,
  proactiveInteractionService,
  sensitiveDataService,
  auditLogService,
  confirmationService,
  capabilityRegistryService,
  capabilityService,
  toolUsageService,
  deviceService,
  continuityDeliveryService,
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
            continuityEngine: continuityDeliveryService.getHealthStatus(),
          },
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/data-export/schemas') {
        const schemas = dataExportService.listSchemas();
        sendJson(response, 200, { data: schemas, meta: { count: schemas.length } });
        return;
      }

      if (
        request.method === 'GET'
        && url.pathname === '/api/v1/data-export/migration-target-contracts'
      ) {
        const contracts = dataExportService.listMigrationTargetContracts();
        sendJson(response, 200, { data: contracts, meta: { count: contracts.length } });
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

      if (request.method === 'GET' && url.pathname === '/api/v1/data-access-boundaries') {
        const boundaries = dataIsolationService.listBoundaries();
        sendJson(response, 200, {
          data: boundaries,
          meta: { count: boundaries.length },
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

      const userSpaceRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/user-space$/,
        ['userId'],
      );
      if (request.method === 'GET' && userSpaceRoute) {
        sendJson(response, 200, {
          data: userSpaceService.getUserSpace(userSpaceRoute.userId),
        });
        return;
      }

      const userSpaceAssistantsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/user-space\/assistants$/,
        ['userId'],
      );
      if (request.method === 'GET' && userSpaceAssistantsRoute) {
        const assistants = userSpaceService.listAssistants(userSpaceAssistantsRoute.userId);
        sendJson(response, 200, {
          data: assistants,
          meta: { count: assistants.length },
        });
        return;
      }

      const currentAssistantRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/user-space\/current-assistant$/,
        ['userId'],
      );
      if (request.method === 'GET' && currentAssistantRoute) {
        sendJson(response, 200, {
          data: userSpaceService.getCurrentAssistant(currentAssistantRoute.userId),
        });
        return;
      }
      if (request.method === 'PATCH' && currentAssistantRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: userSpaceService.switchCurrentAssistant(
            currentAssistantRoute.userId,
            input,
          ),
        });
        return;
      }

      const dataAccessChecksRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/data-access-checks$/,
        ['userId'],
      );
      if (request.method === 'POST' && dataAccessChecksRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: dataIsolationService.checkAccess(dataAccessChecksRoute.userId, input),
        });
        return;
      }

      const dataExportsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/data-exports$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && dataExportsRoute) {
        const input = await readJsonBody(request);
        const result = dataExportService.createExportRecord(
          dataExportsRoute.userId,
          dataExportsRoute.subjectId,
          input,
        );
        sendJson(response, 201, { data: result }, {
          location: `/api/v1/users/${encodeURIComponent(result.record.userId)}/subjects/${encodeURIComponent(result.record.subjectId)}/data-exports/${encodeURIComponent(result.record.exportId)}`,
        });
        return;
      }
      if (request.method === 'GET' && dataExportsRoute) {
        const records = dataExportService.listExportRecords(
          dataExportsRoute.userId,
          dataExportsRoute.subjectId,
        );
        sendJson(response, 200, { data: records, meta: { count: records.length } });
        return;
      }

      const dataExportRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/data-exports\/([^/]+)$/,
        ['userId', 'subjectId', 'exportId'],
      );
      if (request.method === 'GET' && dataExportRoute) {
        sendJson(response, 200, {
          data: dataExportService.getExportRecord(
            dataExportRoute.userId,
            dataExportRoute.subjectId,
            dataExportRoute.exportId,
          ),
        });
        return;
      }

      const dataExportPreparationRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/data-exports\/([^/]+)\/preparations$/,
        ['userId', 'subjectId', 'exportId'],
      );
      if (request.method === 'POST' && dataExportPreparationRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: dataExportService.prepareExport(
            dataExportPreparationRoute.userId,
            dataExportPreparationRoute.subjectId,
            dataExportPreparationRoute.exportId,
            input,
          ),
        });
        return;
      }

      const migrationPreparationRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/data-exports\/([^/]+)\/migration-preparations$/,
        ['userId', 'subjectId', 'exportId'],
      );
      if (request.method === 'POST' && migrationPreparationRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: dataExportService.prepareMigration(
            migrationPreparationRoute.userId,
            migrationPreparationRoute.subjectId,
            migrationPreparationRoute.exportId,
            input,
          ),
        });
        return;
      }

      const wakeRulesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/wake-rules$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && wakeRulesRoute) {
        const input = await readJsonBody(request);
        const rule = proactiveInteractionService.createWakeRule(
          wakeRulesRoute.userId,
          wakeRulesRoute.subjectId,
          input,
        );
        sendJson(response, 201, { data: rule }, {
          location: `/api/v1/users/${encodeURIComponent(rule.userId)}/subjects/${encodeURIComponent(rule.subjectId)}/wake-rules/${encodeURIComponent(rule.wakeId)}`,
        });
        return;
      }
      if (request.method === 'GET' && wakeRulesRoute) {
        const rules = proactiveInteractionService.listWakeRules(
          wakeRulesRoute.userId,
          wakeRulesRoute.subjectId,
        );
        sendJson(response, 200, { data: rules, meta: { count: rules.length } });
        return;
      }

      const wakeRuleRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/wake-rules\/([^/]+)$/,
        ['userId', 'subjectId', 'wakeId'],
      );
      if (request.method === 'PATCH' && wakeRuleRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: proactiveInteractionService.updateWakeRule(
            wakeRuleRoute.userId,
            wakeRuleRoute.subjectId,
            wakeRuleRoute.wakeId,
            input,
          ),
        });
        return;
      }

      const wakePreparationRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/wake-rules\/([^/]+)\/preparations$/,
        ['userId', 'subjectId', 'wakeId'],
      );
      if (request.method === 'POST' && wakePreparationRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: proactiveInteractionService.prepareWake(
            wakePreparationRoute.userId,
            wakePreparationRoute.subjectId,
            wakePreparationRoute.wakeId,
            input,
          ),
        });
        return;
      }

      const promptRulesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/proactive-prompt-rules$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && promptRulesRoute) {
        const input = await readJsonBody(request);
        const rule = proactiveInteractionService.createPromptRule(
          promptRulesRoute.userId,
          promptRulesRoute.subjectId,
          input,
        );
        sendJson(response, 201, { data: rule }, {
          location: `/api/v1/users/${encodeURIComponent(rule.userId)}/subjects/${encodeURIComponent(rule.subjectId)}/proactive-prompt-rules/${encodeURIComponent(rule.promptRuleId)}`,
        });
        return;
      }
      if (request.method === 'GET' && promptRulesRoute) {
        const rules = proactiveInteractionService.listPromptRules(
          promptRulesRoute.userId,
          promptRulesRoute.subjectId,
        );
        sendJson(response, 200, { data: rules, meta: { count: rules.length } });
        return;
      }

      const promptRuleRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/proactive-prompt-rules\/([^/]+)$/,
        ['userId', 'subjectId', 'promptRuleId'],
      );
      if (request.method === 'PATCH' && promptRuleRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: proactiveInteractionService.updatePromptRule(
            promptRuleRoute.userId,
            promptRuleRoute.subjectId,
            promptRuleRoute.promptRuleId,
            input,
          ),
        });
        return;
      }

      const promptPreparationRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/proactive-prompt-rules\/([^/]+)\/preparations$/,
        ['userId', 'subjectId', 'promptRuleId'],
      );
      if (request.method === 'POST' && promptPreparationRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: proactiveInteractionService.preparePrompt(
            promptPreparationRoute.userId,
            promptPreparationRoute.subjectId,
            promptPreparationRoute.promptRuleId,
            input,
          ),
        });
        return;
      }

      const promptRecordsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/proactive-prompt-records$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'GET' && promptRecordsRoute) {
        const records = proactiveInteractionService.listPromptRecords(
          promptRecordsRoute.userId,
          promptRecordsRoute.subjectId,
        );
        sendJson(response, 200, { data: records, meta: { count: records.length } });
        return;
      }

      const tokenBudgetRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/token-budget$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'PUT' && tokenBudgetRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: proactiveInteractionService.upsertTokenBudget(
            tokenBudgetRoute.userId,
            tokenBudgetRoute.subjectId,
            input,
          ),
        });
        return;
      }
      if (request.method === 'GET' && tokenBudgetRoute) {
        sendJson(response, 200, {
          data: proactiveInteractionService.getTokenBudget(
            tokenBudgetRoute.userId,
            tokenBudgetRoute.subjectId,
          ),
        });
        return;
      }

      const tokenBudgetCheckRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/token-budget\/checks$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && tokenBudgetCheckRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: proactiveInteractionService.checkTokenBudget(
            tokenBudgetCheckRoute.userId,
            tokenBudgetCheckRoute.subjectId,
            input,
          ),
        });
        return;
      }

      const tokenUsageRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/token-usage-records$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && tokenUsageRoute) {
        const input = await readJsonBody(request);
        const record = proactiveInteractionService.recordTokenUsage(
          tokenUsageRoute.userId,
          tokenUsageRoute.subjectId,
          input,
        );
        sendJson(response, 201, { data: record });
        return;
      }
      if (request.method === 'GET' && tokenUsageRoute) {
        const records = proactiveInteractionService.listTokenUsage(
          tokenUsageRoute.userId,
          tokenUsageRoute.subjectId,
        );
        sendJson(response, 200, { data: records, meta: { count: records.length } });
        return;
      }

      const backgroundPolicyRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/background-policy$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'PUT' && backgroundPolicyRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: proactiveInteractionService.upsertBackgroundPolicy(
            backgroundPolicyRoute.userId,
            backgroundPolicyRoute.subjectId,
            input,
          ),
        });
        return;
      }
      if (request.method === 'GET' && backgroundPolicyRoute) {
        sendJson(response, 200, {
          data: proactiveInteractionService.getBackgroundPolicy(
            backgroundPolicyRoute.userId,
            backgroundPolicyRoute.subjectId,
          ),
        });
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

      const assistantGlobalSettingsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/global-settings$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'GET' && assistantGlobalSettingsRoute) {
        sendJson(response, 200, {
          data: assistantGlobalSettingsService.getSettings(
            assistantGlobalSettingsRoute.userId,
            assistantGlobalSettingsRoute.subjectId,
          ),
        });
        return;
      }

      if (request.method === 'PATCH' && assistantGlobalSettingsRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantGlobalSettingsService.updateSettings(
            assistantGlobalSettingsRoute.userId,
            assistantGlobalSettingsRoute.subjectId,
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

      const assistantPrivateSpacesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces$/,
        ['userId', 'assistantId'],
      );
      if (request.method === 'POST' && assistantPrivateSpacesRoute) {
        const input = await readJsonBody(request);
        const space = assistantPrivateSpaceService.createSpace(
          assistantPrivateSpacesRoute.userId,
          assistantPrivateSpacesRoute.assistantId,
          input,
        );
        sendJson(response, 201, { data: space }, {
          location: `${url.pathname}/${encodeURIComponent(space.spaceId)}`,
        });
        return;
      }

      const currentAssistantPrivateSpaceRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/current\/read$/,
        ['userId', 'assistantId'],
      );
      if (request.method === 'POST' && currentAssistantPrivateSpaceRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantPrivateSpaceService.readCurrentSpace(
            currentAssistantPrivateSpaceRoute.userId,
            currentAssistantPrivateSpaceRoute.assistantId,
            input,
          ),
        });
        return;
      }

      const assistantPrivateSpaceStatusRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/([^/]+)\/status$/,
        ['userId', 'assistantId', 'spaceId'],
      );
      if (request.method === 'PATCH' && assistantPrivateSpaceStatusRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantPrivateSpaceService.updateSpaceStatus(
            assistantPrivateSpaceStatusRoute.userId,
            assistantPrivateSpaceStatusRoute.assistantId,
            assistantPrivateSpaceStatusRoute.spaceId,
            input,
          ),
        });
        return;
      }

      const assistantPrivateContentsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/([^/]+)\/contents$/,
        ['userId', 'assistantId', 'spaceId'],
      );
      if (request.method === 'POST' && assistantPrivateContentsRoute) {
        const input = await readJsonBody(request);
        const result = assistantPrivateSpaceService.createContent(
          assistantPrivateContentsRoute.userId,
          assistantPrivateContentsRoute.assistantId,
          assistantPrivateContentsRoute.spaceId,
          input,
        );
        const statusCode = result.operationStatus === 'completed' ? 201 : 200;
        const headers = result.result
          ? { location: `${url.pathname}/${encodeURIComponent(result.result.contentId)}` }
          : {};
        sendJson(response, statusCode, { data: result }, headers);
        return;
      }

      const assistantPrivateContentQueryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/([^/]+)\/contents\/query$/,
        ['userId', 'assistantId', 'spaceId'],
      );
      if (request.method === 'POST' && assistantPrivateContentQueryRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantPrivateSpaceService.listContent(
            assistantPrivateContentQueryRoute.userId,
            assistantPrivateContentQueryRoute.assistantId,
            assistantPrivateContentQueryRoute.spaceId,
            input,
          ),
        });
        return;
      }

      const assistantPrivateContentReadRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/([^/]+)\/contents\/([^/]+)\/read$/,
        ['userId', 'assistantId', 'spaceId', 'contentId'],
      );
      if (request.method === 'POST' && assistantPrivateContentReadRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantPrivateSpaceService.getContent(
            assistantPrivateContentReadRoute.userId,
            assistantPrivateContentReadRoute.assistantId,
            assistantPrivateContentReadRoute.spaceId,
            assistantPrivateContentReadRoute.contentId,
            input,
          ),
        });
        return;
      }

      const assistantPrivateContentVersionsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/([^/]+)\/contents\/([^/]+)\/versions\/query$/,
        ['userId', 'assistantId', 'spaceId', 'contentId'],
      );
      if (request.method === 'POST' && assistantPrivateContentVersionsRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantPrivateSpaceService.listContentVersions(
            assistantPrivateContentVersionsRoute.userId,
            assistantPrivateContentVersionsRoute.assistantId,
            assistantPrivateContentVersionsRoute.spaceId,
            assistantPrivateContentVersionsRoute.contentId,
            input,
          ),
        });
        return;
      }

      const assistantPrivateContentRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/([^/]+)\/contents\/([^/]+)$/,
        ['userId', 'assistantId', 'spaceId', 'contentId'],
      );
      if (request.method === 'PATCH' && assistantPrivateContentRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantPrivateSpaceService.updateContent(
            assistantPrivateContentRoute.userId,
            assistantPrivateContentRoute.assistantId,
            assistantPrivateContentRoute.spaceId,
            assistantPrivateContentRoute.contentId,
            input,
          ),
        });
        return;
      }

      const assistantPrivateContextRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/([^/]+)\/context-projections$/,
        ['userId', 'assistantId', 'spaceId'],
      );
      if (request.method === 'POST' && assistantPrivateContextRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantPrivateSpaceService.createContextProjection(
            assistantPrivateContextRoute.userId,
            assistantPrivateContextRoute.assistantId,
            assistantPrivateContextRoute.spaceId,
            input,
          ),
        });
        return;
      }

      const assistantPrivateExportRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/private-spaces\/([^/]+)\/export-manifests$/,
        ['userId', 'assistantId', 'spaceId'],
      );
      if (request.method === 'POST' && assistantPrivateExportRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: assistantPrivateSpaceService.createExportManifest(
            assistantPrivateExportRoute.userId,
            assistantPrivateExportRoute.assistantId,
            assistantPrivateExportRoute.spaceId,
            input,
          ),
        });
        return;
      }

      const lifeFinanceRecordsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/finance\/records$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeFinanceRecordsRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.createFinancialRecord(
          lifeFinanceRecordsRoute.userId,
          lifeFinanceRecordsRoute.subjectId,
          input,
        ), { created: true });
        return;
      }

      const lifeFinanceRecordsQueryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/finance\/records\/query$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeFinanceRecordsQueryRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.listFinancialRecords(
          lifeFinanceRecordsQueryRoute.userId,
          lifeFinanceRecordsQueryRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeFinanceCategoryStatisticsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/finance\/statistics\/categories$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeFinanceCategoryStatisticsRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.getFinancialCategoryStatistics(
          lifeFinanceCategoryStatisticsRoute.userId,
          lifeFinanceCategoryStatisticsRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeFinanceMonthlySummaryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/finance\/summaries\/monthly$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeFinanceMonthlySummaryRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.getFinancialMonthlySummary(
          lifeFinanceMonthlySummaryRoute.userId,
          lifeFinanceMonthlySummaryRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeFinanceBudgetsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/finance\/budgets$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeFinanceBudgetsRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.upsertBudget(
          lifeFinanceBudgetsRoute.userId,
          lifeFinanceBudgetsRoute.subjectId,
          input,
        ), { created: true });
        return;
      }

      const lifeFinanceBudgetsQueryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/finance\/budgets\/query$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeFinanceBudgetsQueryRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.listBudgets(
          lifeFinanceBudgetsQueryRoute.userId,
          lifeFinanceBudgetsQueryRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeCalendarEntriesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/calendar\/entries$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeCalendarEntriesRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.createCalendarEntry(
          lifeCalendarEntriesRoute.userId,
          lifeCalendarEntriesRoute.subjectId,
          input,
        ), { created: true });
        return;
      }

      const lifeCalendarEntriesQueryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/calendar\/entries\/query$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeCalendarEntriesQueryRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.listCalendarEntries(
          lifeCalendarEntriesQueryRoute.userId,
          lifeCalendarEntriesQueryRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeCalendarEntryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/calendar\/entries\/([^/]+)$/,
        ['userId', 'subjectId', 'calendarEntryId'],
      );
      if (request.method === 'PATCH' && lifeCalendarEntryRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.updateCalendarEntry(
          lifeCalendarEntryRoute.userId,
          lifeCalendarEntryRoute.subjectId,
          lifeCalendarEntryRoute.calendarEntryId,
          input,
        ));
        return;
      }

      const lifeBodyRecordsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/body\/records$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeBodyRecordsRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.createBodyRecord(
          lifeBodyRecordsRoute.userId,
          lifeBodyRecordsRoute.subjectId,
          input,
        ), { created: true });
        return;
      }

      const lifeBodyRecordsQueryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/body\/records\/query$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeBodyRecordsQueryRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.listBodyRecords(
          lifeBodyRecordsQueryRoute.userId,
          lifeBodyRecordsQueryRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeBodyTrendsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/body\/trends$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeBodyTrendsRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.getBodyTrend(
          lifeBodyTrendsRoute.userId,
          lifeBodyTrendsRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeBodyGoalsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/body\/goals$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeBodyGoalsRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.upsertBodyGoal(
          lifeBodyGoalsRoute.userId,
          lifeBodyGoalsRoute.subjectId,
          input,
        ), { created: true });
        return;
      }

      const lifeBodyGoalReadRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/body\/goals\/read$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeBodyGoalReadRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.getBodyGoal(
          lifeBodyGoalReadRoute.userId,
          lifeBodyGoalReadRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeMemoriesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/memories$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeMemoriesRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.createLocalMemory(
          lifeMemoriesRoute.userId,
          lifeMemoriesRoute.subjectId,
          input,
        ), { created: true });
        return;
      }

      const lifeMemoriesQueryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/memories\/query$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeMemoriesQueryRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.listLocalMemories(
          lifeMemoriesQueryRoute.userId,
          lifeMemoriesQueryRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeMemoryContextRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/memories\/context-projections$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'POST' && lifeMemoryContextRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.createLocalMemoryContextProjection(
          lifeMemoryContextRoute.userId,
          lifeMemoryContextRoute.subjectId,
          input,
        ));
        return;
      }

      const lifeMemoryRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/life\/memories\/([^/]+)$/,
        ['userId', 'subjectId', 'memoryId'],
      );
      if (request.method === 'PATCH' && lifeMemoryRoute) {
        const input = await readJsonBody(request);
        sendSecuredResult(response, lifeManagementService.updateLocalMemoryFlags(
          lifeMemoryRoute.userId,
          lifeMemoryRoute.subjectId,
          lifeMemoryRoute.memoryId,
          input,
        ));
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

      const modelRoutingRulesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/model-routing-rules$/,
        ['userId'],
      );
      if (request.method === 'POST' && modelRoutingRulesRoute) {
        const input = await readJsonBody(request);
        const rule = modelRoutingRuleService.createRule(
          modelRoutingRulesRoute.userId,
          input,
        );
        sendJson(response, 201, { data: rule }, {
          location: `/api/v1/users/${encodeURIComponent(rule.userId)}/model-routing-rules/${encodeURIComponent(rule.taskType)}`,
        });
        return;
      }

      if (request.method === 'GET' && modelRoutingRulesRoute) {
        const rules = modelRoutingRuleService.listRules(
          modelRoutingRulesRoute.userId,
        );
        sendJson(response, 200, {
          data: rules,
          meta: { count: rules.length },
        });
        return;
      }

      const modelRoutingRuleRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/model-routing-rules\/([^/]+)$/,
        ['userId', 'taskType'],
      );
      if (request.method === 'GET' && modelRoutingRuleRoute) {
        sendJson(response, 200, {
          data: modelRoutingRuleService.getRule(
            modelRoutingRuleRoute.userId,
            modelRoutingRuleRoute.taskType,
          ),
        });
        return;
      }

      if (request.method === 'PATCH' && modelRoutingRuleRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: modelRoutingRuleService.updateRule(
            modelRoutingRuleRoute.userId,
            modelRoutingRuleRoute.taskType,
            input,
          ),
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

      const toolsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/tools$/,
        ['userId'],
      );
      if (request.method === 'POST' && toolsRoute) {
        const input = await readJsonBody(request);
        const tool = capabilityRegistryService.createTool(toolsRoute.userId, input);
        sendJson(response, 201, { data: tool }, {
          location: `/api/v1/users/${encodeURIComponent(toolsRoute.userId)}/tools/${encodeURIComponent(tool.toolId)}`,
        });
        return;
      }
      if (request.method === 'GET' && toolsRoute) {
        const tools = capabilityRegistryService.listTools(toolsRoute.userId, {
          status: url.searchParams.get('status'),
        });
        sendJson(response, 200, { data: tools, meta: { count: tools.length } });
        return;
      }

      const toolStatusRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/tools\/([^/]+)\/status$/,
        ['userId', 'toolId'],
      );
      if (request.method === 'PATCH' && toolStatusRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: capabilityRegistryService.updateToolStatus(
            toolStatusRoute.userId,
            toolStatusRoute.toolId,
            input,
          ),
        });
        return;
      }

      const toolRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/tools\/([^/]+)$/,
        ['userId', 'toolId'],
      );
      if (request.method === 'GET' && toolRoute) {
        sendJson(response, 200, {
          data: capabilityRegistryService.getTool(
            toolRoute.userId,
            toolRoute.toolId,
          ),
        });
        return;
      }

      const mcpRegistrationsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/mcp-registrations$/,
        ['userId'],
      );
      if (request.method === 'POST' && mcpRegistrationsRoute) {
        const input = await readJsonBody(request);
        const mcp = capabilityRegistryService.createMcp(
          mcpRegistrationsRoute.userId,
          input,
        );
        sendJson(response, 201, { data: mcp }, {
          location: `/api/v1/users/${encodeURIComponent(mcpRegistrationsRoute.userId)}/mcp-registrations/${encodeURIComponent(mcp.mcpId)}`,
        });
        return;
      }
      if (request.method === 'GET' && mcpRegistrationsRoute) {
        const registrations = capabilityRegistryService.listMcps(
          mcpRegistrationsRoute.userId,
          { status: url.searchParams.get('status') },
        );
        sendJson(response, 200, {
          data: registrations,
          meta: { count: registrations.length },
        });
        return;
      }

      const mcpStatusRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/mcp-registrations\/([^/]+)\/status$/,
        ['userId', 'mcpId'],
      );
      if (request.method === 'PATCH' && mcpStatusRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: capabilityRegistryService.updateMcpStatus(
            mcpStatusRoute.userId,
            mcpStatusRoute.mcpId,
            input,
          ),
        });
        return;
      }

      const mcpRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/mcp-registrations\/([^/]+)$/,
        ['userId', 'mcpId'],
      );
      if (request.method === 'GET' && mcpRoute) {
        sendJson(response, 200, {
          data: capabilityRegistryService.getMcp(mcpRoute.userId, mcpRoute.mcpId),
        });
        return;
      }

      const skillsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/skills$/,
        ['userId'],
      );
      if (request.method === 'POST' && skillsRoute) {
        const input = await readJsonBody(request);
        const skill = capabilityRegistryService.createSkill(skillsRoute.userId, input);
        sendJson(response, 201, { data: skill }, {
          location: `/api/v1/users/${encodeURIComponent(skillsRoute.userId)}/skills/${encodeURIComponent(skill.skillId)}`,
        });
        return;
      }
      if (request.method === 'GET' && skillsRoute) {
        const skills = capabilityRegistryService.listSkills(skillsRoute.userId, {
          status: url.searchParams.get('status'),
        });
        sendJson(response, 200, { data: skills, meta: { count: skills.length } });
        return;
      }

      const skillStatusRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/skills\/([^/]+)\/status$/,
        ['userId', 'skillId'],
      );
      if (request.method === 'PATCH' && skillStatusRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: capabilityRegistryService.updateSkillStatus(
            skillStatusRoute.userId,
            skillStatusRoute.skillId,
            input,
          ),
        });
        return;
      }

      const skillRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/skills\/([^/]+)$/,
        ['userId', 'skillId'],
      );
      if (request.method === 'GET' && skillRoute) {
        sendJson(response, 200, {
          data: capabilityRegistryService.getSkill(
            skillRoute.userId,
            skillRoute.skillId,
          ),
        });
        return;
      }

      const pluginsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/plugins$/,
        ['userId'],
      );
      if (request.method === 'POST' && pluginsRoute) {
        const input = await readJsonBody(request);
        const plugin = capabilityRegistryService.createPlugin(
          pluginsRoute.userId,
          input,
        );
        sendJson(response, 201, { data: plugin }, {
          location: `/api/v1/users/${encodeURIComponent(pluginsRoute.userId)}/plugins/${encodeURIComponent(plugin.pluginId)}`,
        });
        return;
      }
      if (request.method === 'GET' && pluginsRoute) {
        const plugins = capabilityRegistryService.listPlugins(pluginsRoute.userId, {
          status: url.searchParams.get('status'),
        });
        sendJson(response, 200, {
          data: plugins,
          meta: { count: plugins.length },
        });
        return;
      }

      const pluginStatusRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/plugins\/([^/]+)\/status$/,
        ['userId', 'pluginId'],
      );
      if (request.method === 'PATCH' && pluginStatusRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: capabilityRegistryService.updatePluginStatus(
            pluginStatusRoute.userId,
            pluginStatusRoute.pluginId,
            input,
          ),
        });
        return;
      }

      const pluginRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/plugins\/([^/]+)$/,
        ['userId', 'pluginId'],
      );
      if (request.method === 'GET' && pluginRoute) {
        sendJson(response, 200, {
          data: capabilityRegistryService.getPlugin(
            pluginRoute.userId,
            pluginRoute.pluginId,
          ),
        });
        return;
      }

      const capabilitiesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/capabilities$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'GET' && capabilitiesRoute) {
        const capabilities = capabilityService.listCapabilities(
          capabilitiesRoute.userId,
          capabilitiesRoute.subjectId,
          {
            category: url.searchParams.get('category'),
            status: url.searchParams.get('status'),
          },
        );
        sendJson(response, 200, {
          data: capabilities,
          meta: { count: capabilities.length },
        });
        return;
      }

      const toolExecutionPreparationRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/tools\/([^/]+)\/execution-preparations$/,
        ['userId', 'subjectId', 'toolId'],
      );
      if (request.method === 'POST' && toolExecutionPreparationRoute) {
        const input = await readJsonBody(request);
        const preparation = toolUsageService.prepareToolExecution(
          toolExecutionPreparationRoute.userId,
          toolExecutionPreparationRoute.subjectId,
          toolExecutionPreparationRoute.toolId,
          input,
        );
        sendJson(response, 201, { data: preparation }, {
          location: `/api/v1/users/${encodeURIComponent(toolExecutionPreparationRoute.userId)}/subjects/${encodeURIComponent(toolExecutionPreparationRoute.subjectId)}/tool-usage-records/${encodeURIComponent(preparation.usageRecord.toolUsageId)}`,
        });
        return;
      }

      const toolUsageRecordsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/tool-usage-records$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'GET' && toolUsageRecordsRoute) {
        const records = toolUsageService.listToolUsage(
          toolUsageRecordsRoute.userId,
          toolUsageRecordsRoute.subjectId,
          {
            toolId: url.searchParams.get('toolId'),
            limit: url.searchParams.get('limit'),
          },
        );
        sendJson(response, 200, {
          data: records,
          meta: { count: records.length },
        });
        return;
      }

      const toolUsageRecordRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/tool-usage-records\/([^/]+)$/,
        ['userId', 'subjectId', 'toolUsageId'],
      );
      if (request.method === 'GET' && toolUsageRecordRoute) {
        sendJson(response, 200, {
          data: toolUsageService.getToolUsage(
            toolUsageRecordRoute.userId,
            toolUsageRecordRoute.subjectId,
            toolUsageRecordRoute.toolUsageId,
          ),
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/device-adapters') {
        const adapters = deviceService.listAdapterDescriptors();
        sendJson(response, 200, {
          data: adapters,
          meta: { count: adapters.length },
        });
        return;
      }

      const devicesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/devices$/,
        ['userId'],
      );
      if (request.method === 'POST' && devicesRoute) {
        const input = await readJsonBody(request);
        const result = deviceService.createDevice(devicesRoute.userId, input);
        sendJson(response, 201, { data: result }, {
          location: `/api/v1/users/${encodeURIComponent(devicesRoute.userId)}/devices/${encodeURIComponent(result.device.deviceId)}`,
        });
        return;
      }
      if (request.method === 'GET' && devicesRoute) {
        const devices = deviceService.listDevices(devicesRoute.userId, {
          deviceType: url.searchParams.get('deviceType'),
          status: url.searchParams.get('status'),
          brand: url.searchParams.get('brand'),
        });
        sendJson(response, 200, {
          data: devices,
          meta: { count: devices.length },
        });
        return;
      }

      const deviceStatusRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/devices\/([^/]+)\/status$/,
        ['userId', 'deviceId'],
      );
      if (request.method === 'PATCH' && deviceStatusRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: deviceService.updateDeviceStatus(
            deviceStatusRoute.userId,
            deviceStatusRoute.deviceId,
            input,
          ),
        });
        return;
      }

      const deviceAuthorizationsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/devices\/([^/]+)\/authorizations$/,
        ['userId', 'deviceId'],
      );
      if (request.method === 'POST' && deviceAuthorizationsRoute) {
        const input = await readJsonBody(request);
        const result = deviceService.createDeviceAuthorization(
          deviceAuthorizationsRoute.userId,
          deviceAuthorizationsRoute.deviceId,
          input,
        );
        sendJson(response, 201, { data: result }, {
          location: `/api/v1/users/${encodeURIComponent(deviceAuthorizationsRoute.userId)}/permissions/${encodeURIComponent(result.permission.permissionId)}`,
        });
        return;
      }

      const deviceRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/devices\/([^/]+)$/,
        ['userId', 'deviceId'],
      );
      if (request.method === 'GET' && deviceRoute) {
        sendJson(response, 200, {
          data: deviceService.getDevice(deviceRoute.userId, deviceRoute.deviceId),
        });
        return;
      }

      const deviceOperationPreparationRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/devices\/([^/]+)\/operation-preparations$/,
        ['userId', 'subjectId', 'deviceId'],
      );
      if (request.method === 'POST' && deviceOperationPreparationRoute) {
        const input = await readJsonBody(request);
        const preparation = deviceService.prepareDeviceOperation(
          deviceOperationPreparationRoute.userId,
          deviceOperationPreparationRoute.subjectId,
          deviceOperationPreparationRoute.deviceId,
          input,
        );
        sendJson(response, 201, { data: preparation }, {
          location: `/api/v1/users/${encodeURIComponent(deviceOperationPreparationRoute.userId)}/subjects/${encodeURIComponent(deviceOperationPreparationRoute.subjectId)}/device-operation-logs/${encodeURIComponent(preparation.operationLog.deviceOperationLogId)}`,
        });
        return;
      }

      const deviceOperationLogsRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/device-operation-logs$/,
        ['userId', 'subjectId'],
      );
      if (request.method === 'GET' && deviceOperationLogsRoute) {
        const logs = deviceService.listDeviceOperationLogs(
          deviceOperationLogsRoute.userId,
          deviceOperationLogsRoute.subjectId,
          {
            deviceId: url.searchParams.get('deviceId'),
            capability: url.searchParams.get('capability'),
            limit: url.searchParams.get('limit'),
          },
        );
        sendJson(response, 200, {
          data: logs,
          meta: { count: logs.length },
        });
        return;
      }

      const deviceOperationLogRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/subjects\/([^/]+)\/device-operation-logs\/([^/]+)$/,
        ['userId', 'subjectId', 'deviceOperationLogId'],
      );
      if (request.method === 'GET' && deviceOperationLogRoute) {
        sendJson(response, 200, {
          data: deviceService.getDeviceOperationLog(
            deviceOperationLogRoute.userId,
            deviceOperationLogRoute.subjectId,
            deviceOperationLogRoute.deviceOperationLogId,
          ),
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

      const securityPreferencesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/security-preferences$/,
        ['userId'],
      );
      if (request.method === 'GET' && securityPreferencesRoute) {
        sendJson(response, 200, {
          data: securityPolicyService.getPreferences(securityPreferencesRoute.userId),
        });
        return;
      }
      if (request.method === 'PATCH' && securityPreferencesRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: securityPolicyService.updatePreferences(
            securityPreferencesRoute.userId,
            input,
          ),
        });
        return;
      }

      const securityPoliciesRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/security-policies$/,
        ['userId'],
      );
      if (request.method === 'POST' && securityPoliciesRoute) {
        const input = await readJsonBody(request);
        const policy = securityPolicyService.createPolicy(
          securityPoliciesRoute.userId,
          input,
        );
        sendJson(response, 201, { data: policy }, {
          location: `/api/v1/users/${encodeURIComponent(policy.userId)}/security-policies/${encodeURIComponent(policy.policyId)}`,
        });
        return;
      }
      if (request.method === 'GET' && securityPoliciesRoute) {
        const policies = securityPolicyService.listPolicies(
          securityPoliciesRoute.userId,
          {
            resourceType: url.searchParams.get('resourceType'),
            actionType: url.searchParams.get('actionType'),
            riskLevel: url.searchParams.get('riskLevel'),
            status: url.searchParams.get('status'),
          },
        );
        sendJson(response, 200, {
          data: policies,
          meta: { count: policies.length },
        });
        return;
      }

      const securityPolicyRoute = routeMatch(
        url.pathname,
        /^\/api\/v1\/users\/([^/]+)\/security-policies\/([^/]+)$/,
        ['userId', 'policyId'],
      );
      if (request.method === 'GET' && securityPolicyRoute) {
        sendJson(response, 200, {
          data: securityPolicyService.getPolicy(
            securityPolicyRoute.userId,
            securityPolicyRoute.policyId,
          ),
        });
        return;
      }
      if (request.method === 'PATCH' && securityPolicyRoute) {
        const input = await readJsonBody(request);
        sendJson(response, 200, {
          data: securityPolicyService.updatePolicy(
            securityPolicyRoute.userId,
            securityPolicyRoute.policyId,
            input,
          ),
        });
        return;
      }
      if (request.method === 'DELETE' && securityPolicyRoute) {
        sendJson(response, 200, {
          data: securityPolicyService.deletePolicy(
            securityPolicyRoute.userId,
            securityPolicyRoute.policyId,
          ),
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
