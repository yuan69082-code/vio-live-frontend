import { createServer } from 'node:http';

import { createRouter } from './http/router.js';
import { createSqliteEventRepository } from './integrations/database/sqlite-event-repository.js';
import { createSqliteDatabase } from './integrations/database/sqlite-database.js';
import { createSqliteSubjectRepository } from './integrations/database/sqlite-subject-repository.js';
import { createSqliteUserRepository } from './integrations/database/sqlite-user-repository.js';
import { createEventService } from './modules/events/event-service.js';
import { createSubjectService } from './modules/subjects/subject-service.js';
import { createUserService } from './modules/users/user-service.js';

export function createApplication({ config, logger = console }) {
  const database = createSqliteDatabase(config);
  const userRepository = createSqliteUserRepository(database.connection);
  const subjectRepository = createSqliteSubjectRepository(database.connection);
  const eventRepository = createSqliteEventRepository(database.connection);
  const userService = createUserService({ userRepository });
  const subjectService = createSubjectService({ subjectRepository, userRepository });
  const eventService = createEventService({
    eventRepository,
    subjectRepository,
    userRepository,
  });
  const router = createRouter({
    config,
    database,
    userService,
    subjectService,
    eventService,
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
