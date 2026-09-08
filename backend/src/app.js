import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';

import { createRouter } from './http/router.js';
import { createPersonalHttpAccess } from './http/personal-routes.js';
import { createSqlitePersonalRepository } from './integrations/database/sqlite-personal-repository.js';
import { createPersonalIdentityService } from './modules/personal/personal-identity-service.js';
import { createPersonalConfigurationService } from './modules/personal/personal-configuration-service.js';
import { createPersonalDeletionService } from './modules/personal/personal-deletion-service.js';
import { createPersonalManagedCopies } from './modules/personal/personal-managed-copies.js';
import { createProviderConnectionChecker } from './integrations/model-providers/provider-connection-check.js';
import { createPersonalCredentialVault } from './integrations/secrets/personal-credential-vault.js';
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
import { createSqliteStandaloneChatRepository } from './integrations/database/sqlite-standalone-chat-repository.js';
import { createSqliteMultiConversationRepository } from './integrations/database/sqlite-multi-conversation-repository.js';
import { createSqliteContextAssemblyRepository } from './integrations/database/sqlite-context-assembly-repository.js';
import { createSqliteLocalMemoryRepository } from './integrations/database/sqlite-local-memory-repository.js';
import { createSqliteUnifiedCapabilityRepository } from './integrations/database/sqlite-unified-capability-repository.js';
import { createManagedChatAttachmentStore } from './integrations/storage/managed-chat-attachment-store.js';
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
import { createSqliteContinuityConversationTurnRepository } from './integrations/database/sqlite-continuity-conversation-turn-repository.js';
import { createEnvironmentApiCredentialStore } from './integrations/secrets/environment-api-credential-store.js';
import { createOpenAiCompatibleModelExecutor } from './integrations/model-providers/openai-compatible-model-executor.js';
import { createMcpStreamableHttpClient } from './integrations/mcp/mcp-streamable-http-client.js';
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
import { createContinuityConversationTurnService } from './modules/continuity-integration/continuity-conversation-turn-service.js';
import { createFixedLocalChatProfileService } from './modules/continuity-integration/fixed-local-chat-profile-service.js';
import { createLiveChatPreparationService } from './modules/continuity-integration/live-chat-preparation-service.js';
import { createContextService } from './modules/contexts/context-service.js';
import { createContextAssemblyService } from './modules/contexts/context-assembly-service.js';
import { createConversationService } from './modules/conversations/conversation-service.js';
import { createConversationSummaryService } from './modules/conversation-summaries/conversation-summary-service.js';
import { createDataExportService } from './modules/data-exports/data-export-service.js';
import { createDataIsolationService } from './modules/data-isolation/data-isolation-service.js';
import { createDashboardService } from './modules/dashboard/dashboard-service.js';
import { createDeviceService } from './modules/devices/device-service.js';
import { createEventService } from './modules/events/event-service.js';
import { createLifeManagementService } from './modules/life-management/life-management-service.js';
import { createLocalMemoryService } from './modules/memories/local-memory-service.js';
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
import { createNoneSubjectRuntimeAdapter } from './modules/subject-runtime/none-subject-runtime-adapter.js';
import { createSubjectRuntimeStatusService } from './modules/subject-runtime/subject-runtime-status-service.js';
import { createStandaloneChatService } from './modules/standalone-chat/standalone-chat-service.js';
import { createMultiConversationService } from './modules/standalone-chat/multi-conversation-service.js';
import { createToolUsageService } from './modules/tool-usage/tool-usage-service.js';
import { createUnifiedCapabilityExecutionService } from './modules/capability-execution/unified-capability-execution-service.js';
import { createUserService } from './modules/users/user-service.js';
import { createUserSpaceService } from './modules/user-spaces/user-space-service.js';

export function createApplication({
  config,
  environment = process.env,
  logger = console,
  continuityTransport = null,
  credentialStore: providedCredentialStore = null,
  modelExecutor: providedModelExecutor = null,
  conversationTurnFaultInjector = null,
  standaloneChatFaultInjector = null,
  subjectRuntimeAdapter: providedSubjectRuntimeAdapter = null,
  requestAccess = null,
  personalClock = () => new Date(),
  personalManagedRoot = null,
  personalDeletionBeforeOnlineDelete = () => {},
  providerConnectionChecker: providedConnectionChecker = null,
  standaloneChatAttachmentRoot = null,
  runtimeProjectionPort = null,
  modelContextLimitPort = null,
  contextSourceAccessPort = null,
  contextSummaryBuilder = null,
  mcpClient: providedMcpClient = null,
}) {
  const subjectRuntimeAdapter = providedSubjectRuntimeAdapter
    ?? createNoneSubjectRuntimeAdapter();
  const subjectRuntimeStatusService = createSubjectRuntimeStatusService({
    adapter: subjectRuntimeAdapter,
  });
  const database = createSqliteDatabase(config);
  const userRepository = createSqliteUserRepository(database.connection);
  const personalRepository = createSqlitePersonalRepository(database.connection);
  const ownerBusinessAllowed = userId => userRepository.findById(userId)?.status === 'active';
  const personalVault = createPersonalCredentialVault({repository:personalRepository});
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
  const continuityConversationTurnRepository =
    createSqliteContinuityConversationTurnRepository(database.connection);
  const standaloneChatRepository = createSqliteStandaloneChatRepository(database.connection);
  const multiConversationRepository = createSqliteMultiConversationRepository(database.connection);
  const contextAssemblyRepository = createSqliteContextAssemblyRepository(database.connection);
  const localMemoryRepository = createSqliteLocalMemoryRepository(database);
  const unifiedCapabilityRepository = createSqliteUnifiedCapabilityRepository(database.connection);
  const legacyCredentialStore = providedCredentialStore ?? createEnvironmentApiCredentialStore(environment);
  const credentialStore = {
    describeApiKey(args) {
      return args.secretRef?.startsWith('vault:') ? personalVault.describeApiKey(args) : legacyCredentialStore.describeApiKey(args);
    },
    resolveApiKey(args) {
      // A verified personal identity can never fall back to historical environment credentials.
      return args.secretRef?.startsWith('vault:') || userRepository.isPersonalIdentity(args.ownerUserId)
        ? personalVault.resolveApiKey(args) : legacyCredentialStore.resolveApiKey(args);
    },
  };
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
      ownerBusinessAllowed,
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
      ownerBusinessAllowed,
      requestService: continuityRequestService,
      resultService: continuityResultService,
      deliveryRepository: continuityDeliveryRepository,
      transport: configuredContinuityTransport,
      capabilityService: continuityCapabilityService,
      runInTransaction: database.runInTransaction,
      logger,
    })
    : createDisabledContinuityDeliveryService();
  const fixedLocalChatProfileService = createFixedLocalChatProfileService({
    userRepository,
    userSpaceRepository,
    subjectRepository,
    assistantGlobalSettingsRepository,
    conversationRepository,
    eventService,
    requestService: continuityRequestService,
    runInTransaction: database.runInTransaction,
  });
  const liveChatPreparationService = createLiveChatPreparationService({
    connection: database.connection,
    fixedLocalChatProfileService,
    apiProviderService,
    modelService,
    modelRoutingRuleService,
    permissionService,
    confirmationService,
    proactiveInteractionService,
    environment,
  });
  const continuityConversationTurnService = createContinuityConversationTurnService({
    ownerBusinessAllowed,
    turnRepository: continuityConversationTurnRepository,
    conversationService,
    messageService,
    messageRepository,
    messageVersionRepository,
    eventRepository,
    requestService: continuityRequestService,
    resultService: continuityResultService,
    deliveryService: continuityDeliveryService,
    capabilityService: continuityCapabilityService,
    confirmationService,
    runInTransaction: database.runInTransaction,
    faultInjector: conversationTurnFaultInjector,
  });
  const personalIdentityService = createPersonalIdentityService({repository:personalRepository,userRepository,userSpaceRepository,
    subjectService,userSpaceService,permissionService,runInTransaction:database.runInTransaction,vault:personalVault,clock:personalClock});
  const personalConfigurationService = createPersonalConfigurationService({repository:personalRepository,identityService:personalIdentityService,
    apiProviderService,modelService,modelRoutingRuleService,permissionService,securityService,confirmationService,
    credentialBindingRepository:apiProviderCredentialRepository,connectionChecker:providedConnectionChecker??createProviderConnectionChecker(),vault:personalVault,
    runInTransaction:database.runInTransaction,clock:personalClock});
  const mcpClient = providedMcpClient ?? createMcpStreamableHttpClient();
  const unifiedCapabilityExecutionService = createUnifiedCapabilityExecutionService({
    repository: unifiedCapabilityRepository,
    capabilityRegistryService,
    personalIdentityService,
    personalConfigurationService,
    permissionService,
    permissionChecker,
    securityService,
    mcpClient,
    standaloneChatRepository,
    modelService,
    runInTransaction: database.runInTransaction,
    clock: personalClock,
  });
  let multiConversationService = null;
  const multiConversationPort = Object.freeze({
    createDefaultConversation(context) {
      return multiConversationService?.createDefaultConversation(context) ?? null;
    },
    providerMessagesForTurn(turn) { return multiConversationService?.providerMessagesForTurn(turn) ?? null; },
    findTurnBinding(turnId) { return multiConversationService?.findTurnBinding(turnId) ?? null; },
    linkTurnAndUserMessage(record) { return multiConversationService?.linkTurnAndUserMessage(record); },
    linkAssistantMessage(turn, message) { return multiConversationService?.linkAssistantMessage(turn, message); },
    findConversationBinding(userId, assistantId, conversationId) {
      return multiConversationService?.findConversationBinding(userId, assistantId, conversationId) ?? null;
    },
  });
  let standaloneChatService = null;
  const standaloneRecoveryPort = Object.freeze({
    retryAfterContextFold(context, turnId, idempotencyKey) {
      return standaloneChatService?.recoverTurn(context, turnId, { action: 'retry' }, idempotencyKey);
    },
  });
  const localMemoryService = createLocalMemoryService({
    repository: localMemoryRepository,
    personalIdentityService,
    permissionChecker,
    securityService,
    messageVersionRepository,
    eventRepository,
    multiConversationRepository,
    runInTransaction: database.runInTransaction,
    clock: personalClock,
  });
  const contextAssemblyService = createContextAssemblyService({
    repository: contextAssemblyRepository,
    personalIdentityService,
    multiConversationRepository,
    standaloneChatRepository,
    eventRepository,
    modelRouterService,
    subjectRuntimeStatusService,
    runtimeProjectionPort,
    memoryPort: localMemoryService,
    ...(modelContextLimitPort ? { modelContextLimitPort } : {}),
    ...(contextSourceAccessPort ? { sourceAccessPort: contextSourceAccessPort } : {}),
    ...(contextSummaryBuilder ? { summaryBuilder: contextSummaryBuilder } : {}),
    runInTransaction: database.runInTransaction,
    clock: personalClock,
    standaloneRecoveryPort,
  });
  standaloneChatService = createStandaloneChatService({
    repository: standaloneChatRepository,
    subjectRuntimeStatusService,
    personalIdentityService,
    conversationService,
    messageService,
    messageRepository,
    messageVersionRepository,
    eventRepository,
    modelRouterService,
    apiProviderService,
    securityService,
    permissionService,
    securityPolicyService,
    proactiveInteractionService,
    modelExecutor: configuredModelExecutor,
    runInTransaction: database.runInTransaction,
    clock: personalClock,
    faultInjector: standaloneChatFaultInjector,
    multiConversationPort,
    contextAssemblyService,
    unifiedExecutionPort: unifiedCapabilityExecutionService,
  });
  const attachmentRoot = standaloneChatAttachmentRoot ?? join(
    dirname(config.databasePath === ':memory:' ? resolve('data/vio.db') : config.databasePath),
    'standalone-chat-attachments',
  );
  const attachmentStore = createManagedChatAttachmentStore({root: attachmentRoot});
  const managedRoots = [...new Set([attachmentRoot, personalManagedRoot].filter(Boolean))];
  const personalManagedCopies=createPersonalManagedCopies({db:database.connection,clock:personalClock,allowedRootRequired:managedRoots});
  multiConversationService = createMultiConversationService({
    repository: multiConversationRepository,
    personalIdentityService,
    subjectRuntimeStatusService,
    conversationService,
    messageRepository,
    messageVersionRepository,
    standaloneChatService,
    modelRouterService,
    apiProviderService,
    securityService,
    proactiveInteractionService,
    modelExecutor: configuredModelExecutor,
    attachmentStore,
    managedCopies: personalManagedCopies,
    runInTransaction: database.runInTransaction,
    clock: personalClock,
    faultInjector: standaloneChatFaultInjector,
  });
  const personalDeletionService=createPersonalDeletionService({database,identityService:personalIdentityService,configurationService:personalConfigurationService,
    repository:personalRepository,vault:personalVault,managedCopies:personalManagedCopies,clock:personalClock,beforeOnlineDelete:personalDeletionBeforeOnlineDelete});
  const personalHttpAccess = createPersonalHttpAccess({identityService:personalIdentityService,configurationService:personalConfigurationService,deletionService:personalDeletionService,vault:personalVault,
    standaloneChatService,multiConversationService,contextAssemblyService,localMemoryService,unifiedCapabilityExecutionService,
    secureCookies:config.personalAccess.secureCookies,allowedOrigin:config.personalAccess.allowedOrigin});
  const router = createRouter({
    personalHttpAccess,
    requestAccess,
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
    continuityConversationTurnService,
    subjectRuntimeStatusService,
    logger,
  });
  const server = createServer((request, response) => {
    void router(request, response);
  });
  let databaseClosed = false;
  let deletionTimer=null;

  return {
    server,
    database,
    personalIdentityService,
    personalConfigurationService,
    personalVault,
    personalDeletionService,
    standaloneChatService,
    multiConversationService,
    contextAssemblyService,
    localMemoryService,
    unifiedCapabilityExecutionService,
    personalManagedCopies,
    continuityRequestService,
    continuityResultService,
    continuityDeliveryService,
    continuityCapabilityService,
    continuityConversationTurnService,
    subjectRuntimeStatusService,
    fixedLocalChatProfileService,
    liveChatPreparationService,
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
      try{personalDeletionService.sweep();}catch{logger.error?.('[vio] deletion maintenance deferred',{code:'DELETION_MAINTENANCE_DEFERRED'});}
      try{localMemoryService.initialize();}catch(error){
        if(error.errcode!==5&&error.code!=='SQLITE_BUSY')throw error;
        logger.error?.('[vio] memory recovery deferred',{code:'MEMORY_RECOVERY_DATABASE_BUSY'});
      }
      try{personalConfigurationService.initialize();}catch(error){
        if(error.errcode!==5&&error.code!=='SQLITE_BUSY')throw error;
        logger.error?.('[vio] personal recovery deferred',{code:'PERSONAL_RECOVERY_DATABASE_BUSY'});
      }
      await standaloneChatService.initialize();
      try{unifiedCapabilityExecutionService.initialize();}catch(error){
        if(error.errcode!==5&&error.code!=='SQLITE_BUSY')throw error;
        logger.error?.('[vio] capability recovery deferred',{code:'CAPABILITY_RECOVERY_DATABASE_BUSY'});
      }
      await continuityCapabilityService?.initialize();
      await continuityDeliveryService.initialize();
      await continuityConversationTurnService.initialize();
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

      deletionTimer=setInterval(()=>{
        try{personalDeletionService.sweep();}catch{logger.error?.('[vio] deletion maintenance deferred',{code:'DELETION_MAINTENANCE_DEFERRED'});}
      },60000);
      deletionTimer.unref();
      return {
        host: address.address,
        port: address.port,
      };
    },
    async stop() {
      clearInterval(deletionTimer);
      personalVault.close();
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
