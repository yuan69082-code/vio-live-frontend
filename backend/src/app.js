import { createServer } from 'node:http';

import { createRouter } from './http/router.js';
import { createSqliteApiProviderRepository } from './integrations/database/sqlite-api-provider-repository.js';
import { createSqliteEventRepository } from './integrations/database/sqlite-event-repository.js';
import { createSqliteDatabase } from './integrations/database/sqlite-database.js';
import { createSqliteModelRepository } from './integrations/database/sqlite-model-repository.js';
import { createSqlitePermissionRepository } from './integrations/database/sqlite-permission-repository.js';
import { createSqliteSubjectRepository } from './integrations/database/sqlite-subject-repository.js';
import { createSqliteUserRepository } from './integrations/database/sqlite-user-repository.js';
import { createApiProviderService } from './modules/api-providers/api-provider-service.js';
import { createEventService } from './modules/events/event-service.js';
import { createModelRouterService } from './modules/model-router/model-router-service.js';
import { createModelService } from './modules/models/model-service.js';
import { createPermissionChecker } from './modules/permissions/permission-checker.js';
import { createPermissionService } from './modules/permissions/permission-service.js';
import { createSubjectService } from './modules/subjects/subject-service.js';
import { createUserService } from './modules/users/user-service.js';

export function createApplication({ config, logger = console }) {
  const database = createSqliteDatabase(config);
  const userRepository = createSqliteUserRepository(database.connection);
  const subjectRepository = createSqliteSubjectRepository(database.connection);
  const eventRepository = createSqliteEventRepository(database.connection);
  const apiProviderRepository = createSqliteApiProviderRepository(database.connection);
  const modelRepository = createSqliteModelRepository(database.connection);
  const permissionRepository = createSqlitePermissionRepository(database.connection);
  const userService = createUserService({ userRepository });
  const subjectService = createSubjectService({ subjectRepository, userRepository });
  const eventService = createEventService({
    eventRepository,
    subjectRepository,
    userRepository,
  });
  const apiProviderService = createApiProviderService({
    apiProviderRepository,
    userRepository,
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
    runInTransaction: database.runInTransaction,
  });
  const permissionChecker = createPermissionChecker({
    permissionRepository,
    permissionService,
    userRepository,
    subjectRepository,
  });
  const router = createRouter({
    config,
    database,
    userService,
    subjectService,
    eventService,
    apiProviderService,
    modelService,
    modelRouterService,
    permissionService,
    permissionChecker,
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
