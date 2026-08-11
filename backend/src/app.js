import { createServer } from 'node:http';

import { createRouter } from './http/router.js';
import { createUnconfiguredDeviceAdapterRegistry } from './integrations/devices/unconfigured-device-adapter-registry.js';
import { createSqliteApiProviderRepository } from './integrations/database/sqlite-api-provider-repository.js';
import { createSqliteApiProviderCredentialRepository } from './integrations/database/sqlite-api-provider-credential-repository.js';
import { createSqliteAssistantGlobalSettingsRepository } from './integrations/database/sqlite-assistant-global-settings-repository.js';
import { createSqliteAssistantPrivateSpaceRepository } from './integrations/database/sqlite-assistant-private-space-repository.js';
import { createSqliteAuditLogRepository } from './integrations/database/sqlite-audit-log-repository.js';
import { createSqliteCapabilityRegistryRepository } from './integrations/database/sqlite-capability-registry-repository.js';
import { createSqliteConfirmationRepository } from './integrations/database/sqlite-confirmation-repository.js';
import { createSqliteConversationRepository } from './integrations/database/sqlite-conversation-repository.js';
import { createSqliteConversationSummaryRepository } from './integrations/database/sqlite-conversation-summary-repository.js';
import { createSqliteDataExportRepository } from './integrations/database/sqlite-data-export-repository.js';
import { createSqliteDataIsolationRepository } from './integrations/database/sqlite-data-isolation-repository.js';
import { createSqliteDeviceRepository } from './integrations/database/sqlite-device-repository.js';
import { createSqliteEventRepository } from './integrations/database/sqlite-event-repository.js';
import { createSqliteLifeManagementRepository } from './integrations/database/sqlite-life-management-repository.js';
import { createSqliteMessageRepository } from './integrations/database/sqlite-message-repository.js';
import { createSqliteMessageVersionRepository } from './integrations/database/sqlite-message-version-repository.js';
import { createSqliteModelRoutingRuleRepository } from './integrations/database/sqlite-model-routing-rule-repository.js';
import { createSqliteDatabase } from './integrations/database/sqlite-database.js';
import { createSqliteModelRepository } from './integrations/database/sqlite-model-repository.js';
import { createSqlitePermissionRepository } from './integrations/database/sqlite-permission-repository.js';
import { createSqliteProactiveInteractionRepository } from './integrations/database/sqlite-proactive-interaction-repository.js';
import { createSqliteSecurityPolicyRepository } from './integrations/database/sqlite-security-policy-repository.js';
import { createSqliteSubjectRepository } from './integrations/database/sqlite-subject-repository.js';
import { createSqliteSubjectStateRepository } from './integrations/database/sqlite-subject-state-repository.js';
import { createSqliteUserRepository } from './integrations/database/sqlite-user-repository.js';
import { createSqliteUserSpaceRepository } from './integrations/database/sqlite-user-space-repository.js';
import { createUnconfiguredMigrationTargetRegistry } from './integrations/migrations/unconfigured-migration-target-registry.js';
import { createHttpContinuityIntegrationTransport } from './integrations/continuity-engine/http-continuity-integration-transport.js';
import { createSqliteContinuityDeliveryRepository } from './integrations/database/sqlite-continuity-delivery-repository.js';
import { createSqliteContinuityIntegrationRepository } from './integrations/database/sqlite-continuity-integration-repository.js';
import { createSqliteContinuityResultRepository } from './integrations/database/sqlite-continuity-result-repository.js';
import { createSqliteContinuityCapabilityRepository } from './integrations/database/sqlite-continuity-capability-repository.js';
import { createEnvironmentApiCredentialStore } from './integrations/secrets/environment-api-credential-store.js';
import { createOpenAiCompatibleModelExecutor } from './integrations/model-providers/openai-compatible-model-executor.js';
import { createApiProviderService } from './modules/api-providers/api-provider-service.js';
import { createAssistantGlobalSettingsService } from './modules/assistant-global-settings/assistant-global-settings-service.js';
import { createAssistantPrivateSpaceService } from './modules/assistant-private-spaces/assistant-private-space-service.js';
import { createAuditLogService } from './modules/audit-logs/audit-log-service.js';
import { createCapabilityRegistryService } from './modules/capability-registries/capability-registry-service.js';
import { createCapabilityService } from './modules/capabilities/capability-service.js';
import { createConfirmationService } from './modules/confirmations/confirmation-service.js';
import {
  createContinuityDeliveryService,
  createDisabledContinuityDeliveryService,
} from './modules/continuity-integration/continuity-delivery-service.js';
import { createFirstRoundContinuityRequestService } from './modules/continuity-integration/first-round-request-service.js';
import { createFirstRoundContinuityResultService } from './modules/continuity-integration/first-round-result-service.js';
import { createContinuityCapabilityService } from './modules/continuity-integration/continuity-capability-service.js';
import { createContextService } from './modules/contexts/context-service.js';
import { createConversationService } from './modules/conversations/conversation-service.js';
import { createConversationSummaryService } from './modules/conversation-summaries/conversation-summary-service.js';
import { createDataExportService } from './modules/data-exports/data-export-service.js';
import { createDataIsolationService } from './modules/data-isolation/data-isolation-service.js';
import { createDashboardService } from './modules/dashboard/dashboard-service.js';
import { createDeviceService } from './modules/devices/device-service.js';
import { createEventService } from './modules/events/event-service.js';
import { createLifeManagementService } from './modules/life-management/life-management-service.js';
import { createModelRouterService } from './modules/model-router/model-router-service.js';
import { createModelRoutingRuleService } from './modules/model-routing-rules/model-routing-rule-service.js';
import { createModelService } from './modules/models/model-service.js';
import { createMessageService } from './modules/messages/message-service.js';
import { createMessageVersionService } from './modules/message-versions/message-version-service.js';
import { createPermissionChecker } from './modules/permissions/permission-checker.js';
import { createPermissionService } from './modules/permissions/permission-service.js';
import { createProactiveInteractionService } from './modules/proactive-interactions/proactive-interaction-service.js';
import { createSecurityService } from './modules/security/security-service.js';
import { createSecurityPolicyService } from './modules/security-policies/security-policy-service.js';
import { createSensitiveDataService } from './modules/sensitive-data/sensitive-data-service.js';
import { createSubjectService } from './modules/subjects/subject-service.js';
import { createSubjectStateService } from './modules/subject-states/subject-state-service.js';
import { createToolUsageService } from './modules/tool-usage/tool-usage-service.js';
import { createUserService } from './modules/users/user-service.js';
import { createUserSpaceService } from './modules/user-spaces/user-space-service.js';

export function createApplication({
  config,
  logger = console,
  continuityTransport = null,
  credentialStore: providedCredentialStore = null,
  modelExecutor: providedModelExecutor = null,
}) {
  const database = createSqliteDatabase(config);
  const userRepository = createSqliteUserRepository(database.connection);
  const userSpaceRepository = createSqliteUserSpaceRepository(database.connection);
  const subjectRepository = createSqliteSubjectRepository(database.connection);
  const assistantGlobalSettingsRepository =
    createSqliteAssistantGlobalSettingsRepository(database.connection);
  const assistantPrivateSpaceRepository = createSqliteAssistantPrivateSpaceRepository(
    database.connection,
  );
  const conversationRepository = createSqliteConversationRepository(database.connection);
  const conversationSummaryRepository = createSqliteConversationSummaryRepository(
    database.connection,
  );
  const messageRepository = createSqliteMessageRepository(database.connection);
  const messageVersionRepository = createSqliteMessageVersionRepository(database.connection);
  const subjectStateRepository = createSqliteSubjectStateRepository(database.connection);
  const eventRepository = createSqliteEventRepository(database.connection);
  const lifeManagementRepository = createSqliteLifeManagementRepository(database.connection);
  const apiProviderRepository = createSqliteApiProviderRepository(database.connection);
  const apiProviderCredentialRepository = createSqliteApiProviderCredentialRepository(
    database.connection,
  );
  const modelRepository = createSqliteModelRepository(database.connection);
  const modelRoutingRuleRepository = createSqliteModelRoutingRuleRepository(
    database.connection,
  );
  const permissionRepository = createSqlitePermissionRepository(database.connection);
  const proactiveInteractionRepository = createSqliteProactiveInteractionRepository(
    database.connection,
  );
  const securityPolicyRepository = createSqliteSecurityPolicyRepository(database.connection);
  const auditLogRepository = createSqliteAuditLogRepository(database.connection);
  const capabilityRegistryRepository = createSqliteCapabilityRegistryRepository(
    database.connection,
  );
  const deviceRepository = createSqliteDeviceRepository(database.connection);
  const confirmationRepository = createSqliteConfirmationRepository(database.connection);
  const dataExportRepository = createSqliteDataExportRepository(database.connection);
  const dataIsolationRepository = createSqliteDataIsolationRepository(database.connection);
  const continuityIntegrationRepository = createSqliteContinuityIntegrationRepository(
    database.connection,
  );
  const continuityResultRepository = createSqliteContinuityResultRepository(database.connection);
  const continuityDeliveryRepository = createSqliteContinuityDeliveryRepository(
    database.connection,
  );
  const continuityCapabilityRepository = createSqliteContinuityCapabilityRepository(
    database.connection,
  );
  const credentialStore = providedCredentialStore
    ?? createEnvironmentApiCredentialStore();
  const deviceAdapterRegistry = createUnconfiguredDeviceAdapterRegistry();
  const migrationTargetRegistry = createUnconfiguredMigrationTargetRegistry();
  const userService = createUserService({
    userRepository,
    userSpaceRepository,
    runInTransaction: database.runInTransaction,
  });
  const eventService = createEventService({
    eventRepository,
    subjectRepository,
    userRepository,
  });
  const subjectService = createSubjectService({
    subjectRepository,
    assistantGlobalSettingsRepository,
    userSpaceRepository,
    userRepository,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const conversationService = createConversationService({
    conversationRepository,
    userRepository,
    subjectRepository,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const messageService = createMessageService({
    conversationService,
    conversationRepository,
    messageRepository,
    messageVersionRepository,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const messageVersionService = createMessageVersionService({
    conversationService,
    conversationRepository,
    messageService,
    messageRepository,
    messageVersionRepository,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const conversationSummaryService = createConversationSummaryService({
    conversationService,
    conversationSummaryRepository,
    messageVersionRepository,
    eventRepository,
    runInTransaction: database.runInTransaction,
  });
  const subjectStateService = createSubjectStateService({
    subjectService,
    conversationService,
    subjectStateRepository,
    conversationSummaryRepository,
    messageVersionRepository,
    eventRepository,
    runInTransaction: database.runInTransaction,
  });
  const assistantGlobalSettingsService = createAssistantGlobalSettingsService({
    subjectRepository,
    assistantGlobalSettingsRepository,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const contextService = createContextService({
    userService,
    subjectService,
    assistantGlobalSettingsService,
    conversationService,
    messageRepository,
    conversationSummaryService,
    subjectStateService,
    eventRepository,
  });
  const dashboardService = createDashboardService({ userService, subjectService });
  const auditLogService = createAuditLogService({
    auditLogRepository,
    userRepository,
    subjectRepository,
  });
  const securityPolicyService = createSecurityPolicyService({
    securityPolicyRepository,
    userRepository,
    auditLogService,
    runInTransaction: database.runInTransaction,
  });
  const confirmationService = createConfirmationService({
    confirmationRepository,
    auditLogService,
    userRepository,
    subjectRepository,
    runInTransaction: database.runInTransaction,
  });
  const modelService = createModelService({
    modelRepository,
    apiProviderRepository,
    userRepository,
  });
  const modelRouterService = createModelRouterService({
    modelRepository,
    modelRoutingRuleRepository,
    userRepository,
  });
  const modelRoutingRuleService = createModelRoutingRuleService({
    modelRoutingRuleRepository,
    modelRepository,
    userRepository,
  });
  const permissionService = createPermissionService({
    permissionRepository,
    userRepository,
    subjectRepository,
    eventService,
    auditLogService,
    runInTransaction: database.runInTransaction,
  });
  const permissionChecker = createPermissionChecker({
    permissionRepository,
    permissionService,
    userRepository,
    subjectRepository,
  });
  const securityService = createSecurityService({
    permissionChecker,
    securityPolicyService,
    confirmationService,
    auditLogService,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const apiProviderService = createApiProviderService({
    apiProviderRepository,
    credentialBindingRepository: apiProviderCredentialRepository,
    userRepository,
    auditLogService,
    credentialStore,
    securityService,
    runInTransaction: database.runInTransaction,
  });
  const dataExportService = createDataExportService({
    dataExportRepository,
    userRepository,
    subjectRepository,
    securityService,
    migrationTargetRegistry,
    runInTransaction: database.runInTransaction,
  });
  const proactiveInteractionService = createProactiveInteractionService({
    proactiveInteractionRepository,
    userRepository,
    subjectRepository,
    eventRepository,
    modelRepository,
    securityService,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const userSpaceService = createUserSpaceService({
    userSpaceRepository,
    userRepository,
    subjectRepository,
  });
  const dataIsolationService = createDataIsolationService({
    dataIsolationRepository,
    userSpaceRepository,
    userRepository,
    subjectRepository,
    securityService,
  });
  const assistantPrivateSpaceService = createAssistantPrivateSpaceService({
    assistantPrivateSpaceRepository,
    userRepository,
    subjectRepository,
    securityService,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const lifeManagementService = createLifeManagementService({
    lifeManagementRepository,
    userRepository,
    subjectRepository,
    securityService,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const sensitiveDataService = createSensitiveDataService();
  const capabilityRegistryService = createCapabilityRegistryService({
    capabilityRegistryRepository,
    userRepository,
  });
  const capabilityService = createCapabilityService({
    capabilityRegistryService,
    capabilityRegistryRepository,
    permissionChecker,
    userRepository,
    subjectRepository,
  });
  const toolUsageService = createToolUsageService({
    capabilityRegistryService,
    capabilityRegistryRepository,
    securityService,
    userRepository,
    subjectRepository,
    runInTransaction: database.runInTransaction,
  });
  const deviceService = createDeviceService({
    deviceRepository,
    deviceAdapterRegistry,
    userRepository,
    subjectRepository,
    permissionService,
    securityService,
    eventService,
    runInTransaction: database.runInTransaction,
  });
  const continuityRequestService = createFirstRoundContinuityRequestService({
    continuityRepository: continuityIntegrationRepository,
    userRepository,
    subjectRepository,
    conversationRepository,
    messageRepository,
    messageVersionRepository,
    eventRepository,
    runInTransaction: database.runInTransaction,
  });
  const continuityResultService = createFirstRoundContinuityResultService({
    requestService: continuityRequestService,
    resultRepository: continuityResultRepository,
    runInTransaction: database.runInTransaction,
  });
  const configuredContinuityTransport = config.continuityEngine.enabled
    ? (continuityTransport ?? createHttpContinuityIntegrationTransport({
      baseUrl: config.continuityEngine.baseUrl,
      serviceToken: config.continuityEngine.token,
      connectTimeoutMs: config.continuityEngine.connectTimeoutMs,
      responseTimeoutMs: config.continuityEngine.responseTimeoutMs,
      maxResponseBytes: config.continuityEngine.maxResponseBytes,
    }))
    : null;
  const configuredModelExecutor = providedModelExecutor
    ?? createOpenAiCompatibleModelExecutor({
      connectTimeoutMs: config.modelProvider.connectTimeoutMs,
      responseTimeoutMs: config.modelProvider.responseTimeoutMs,
      maxRequestBytes: config.modelProvider.maxRequestBytes,
      maxResponseBytes: config.modelProvider.maxResponseBytes,
      allowLoopbackHttp: false,
    });
  const continuityCapabilityService = configuredContinuityTransport
    ? createContinuityCapabilityService({
      requestService: continuityRequestService,
      resultService: continuityResultService,
      capabilityRepository: continuityCapabilityRepository,
      modelRouterService,
      modelService,
      apiProviderService,
      permissionChecker,
      securityService,
      proactiveInteractionService,
      modelExecutor: configuredModelExecutor,
      transport: configuredContinuityTransport,
      runInTransaction: database.runInTransaction,
      logger,
    })
    : null;
  const continuityDeliveryService = configuredContinuityTransport
    ? createContinuityDeliveryService({
      requestService: continuityRequestService,
      resultService: continuityResultService,
      deliveryRepository: continuityDeliveryRepository,
      transport: configuredContinuityTransport,
      capabilityService: continuityCapabilityService,
      runInTransaction: database.runInTransaction,
      logger,
    })
    : createDisabledContinuityDeliveryService();
  const router = createRouter({
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
    continuityCapabilityService,
    logger,
  });
  const server = createServer((request, response) => {
    void router(request, response);
  });
  let databaseClosed = false;

  return {
    server,
    database,
    continuityRequestService,
    continuityResultService,
    continuityDeliveryService,
    continuityCapabilityService,
    apiProviderService,
    modelService,
    modelRouterService,
    permissionService,
    permissionChecker,
    securityService,
    securityPolicyService,
    confirmationService,
    proactiveInteractionService,
    async start() {
      await continuityCapabilityService?.initialize();
      await continuityDeliveryService.initialize();
      await new Promise((resolve, reject) => {
        const handleError = (error) => {
          server.off('listening', handleListening);
          reject(error);
        };
        const handleListening = () => {
          server.off('error', handleError);
          resolve();
        };

        server.once('error', handleError);
        server.once('listening', handleListening);
        server.listen(config.port, config.host);
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Backend server did not expose a TCP address.');
      }

      return {
        host: address.address,
        port: address.port,
      };
    },
    async stop() {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }

      if (!databaseClosed) {
        database.close();
        databaseClosed = true;
      }
    },
  };
}
