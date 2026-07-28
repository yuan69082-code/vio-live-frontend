import { createServer } from 'node:http';

import { createRouter } from './http/router.js';
import { createSqliteAuditLogRepository } from './integrations/database/sqlite-audit-log-repository.js';
import { createSqliteApiProviderRepository } from './integrations/database/sqlite-api-provider-repository.js';
import { createSqliteConfirmationRepository } from './integrations/database/sqlite-confirmation-repository.js';
import { createSqliteConversationRepository } from './integrations/database/sqlite-conversation-repository.js';
import { createSqliteConversationSummaryRepository } from './integrations/database/sqlite-conversation-summary-repository.js';
import { createSqliteEventRepository } from './integrations/database/sqlite-event-repository.js';
import { createSqliteMessageRepository } from './integrations/database/sqlite-message-repository.js';
import { createSqliteMessageVersionRepository } from './integrations/database/sqlite-message-version-repository.js';
import { createSqliteDatabase } from './integrations/database/sqlite-database.js';
import { createSqliteModelRepository } from './integrations/database/sqlite-model-repository.js';
import { createSqlitePermissionRepository } from './integrations/database/sqlite-permission-repository.js';
import { createSqliteSubjectRepository } from './integrations/database/sqlite-subject-repository.js';
import { createSqliteSubjectStateRepository } from './integrations/database/sqlite-subject-state-repository.js';
import { createSqliteUserRepository } from './integrations/database/sqlite-user-repository.js';
import { createApiProviderService } from './modules/api-providers/api-provider-service.js';
import { createAuditLogService } from './modules/audit-logs/audit-log-service.js';
import { createConfirmationService } from './modules/confirmations/confirmation-service.js';
import { createContextService } from './modules/contexts/context-service.js';
import { createConversationService } from './modules/conversations/conversation-service.js';
import { createConversationSummaryService } from './modules/conversation-summaries/conversation-summary-service.js';
import { createDashboardService } from './modules/dashboard/dashboard-service.js';
import { createEventService } from './modules/events/event-service.js';
import { createModelRouterService } from './modules/model-router/model-router-service.js';
import { createModelService } from './modules/models/model-service.js';
import { createMessageService } from './modules/messages/message-service.js';
import { createMessageVersionService } from './modules/message-versions/message-version-service.js';
import { createPermissionChecker } from './modules/permissions/permission-checker.js';
import { createPermissionService } from './modules/permissions/permission-service.js';
import { createSecurityService } from './modules/security/security-service.js';
import { createSensitiveDataService } from './modules/sensitive-data/sensitive-data-service.js';
import { createSubjectService } from './modules/subjects/subject-service.js';
import { createSubjectStateService } from './modules/subject-states/subject-state-service.js';
import { createUserService } from './modules/users/user-service.js';

export function createApplication({ config, logger = console }) {
  const database = createSqliteDatabase(config);
  const userRepository = createSqliteUserRepository(database.connection);
  const subjectRepository = createSqliteSubjectRepository(database.connection);
  const conversationRepository = createSqliteConversationRepository(database.connection);
  const conversationSummaryRepository = createSqliteConversationSummaryRepository(
    database.connection,
  );
  const messageRepository = createSqliteMessageRepository(database.connection);
  const messageVersionRepository = createSqliteMessageVersionRepository(database.connection);
  const subjectStateRepository = createSqliteSubjectStateRepository(database.connection);
  const eventRepository = createSqliteEventRepository(database.connection);
  const apiProviderRepository = createSqliteApiProviderRepository(database.connection);
  const modelRepository = createSqliteModelRepository(database.connection);
  const permissionRepository = createSqlitePermissionRepository(database.connection);
  const auditLogRepository = createSqliteAuditLogRepository(database.connection);
  const confirmationRepository = createSqliteConfirmationRepository(database.connection);
  const userService = createUserService({ userRepository });
  const eventService = createEventService({
    eventRepository,
    subjectRepository,
    userRepository,
  });
  const subjectService = createSubjectService({
    subjectRepository,
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
  const contextService = createContextService({
    userService,
    subjectService,
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
  const confirmationService = createConfirmationService({
    confirmationRepository,
    auditLogService,
    userRepository,
    subjectRepository,
    runInTransaction: database.runInTransaction,
  });
  const apiProviderService = createApiProviderService({
    apiProviderRepository,
    userRepository,
    auditLogService,
    runInTransaction: database.runInTransaction,
  });
  const modelService = createModelService({
    modelRepository,
    apiProviderRepository,
    userRepository,
  });
  const modelRouterService = createModelRouterService({
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
    confirmationService,
    auditLogService,
    runInTransaction: database.runInTransaction,
  });
  const sensitiveDataService = createSensitiveDataService();
  const router = createRouter({
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
    logger,
  });
  const server = createServer((request, response) => {
    void router(request, response);
  });
  let databaseClosed = false;

  return {
    server,
    database,
    async start() {
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
