import { loadConfig } from '../src/config.js';
import { createHttpContinuityIntegrationTransport } from '../src/integrations/continuity-engine/http-continuity-integration-transport.js';
import { createSqliteContinuityDeliveryRepository } from '../src/integrations/database/sqlite-continuity-delivery-repository.js';
import { createSqliteContinuityIntegrationRepository } from '../src/integrations/database/sqlite-continuity-integration-repository.js';
import { createSqliteContinuityResultRepository } from '../src/integrations/database/sqlite-continuity-result-repository.js';
import { createSqliteConversationRepository } from '../src/integrations/database/sqlite-conversation-repository.js';
import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import { createSqliteEventRepository } from '../src/integrations/database/sqlite-event-repository.js';
import { createSqliteMessageRepository } from '../src/integrations/database/sqlite-message-repository.js';
import { createSqliteMessageVersionRepository } from '../src/integrations/database/sqlite-message-version-repository.js';
import { createSqliteSubjectRepository } from '../src/integrations/database/sqlite-subject-repository.js';
import { createSqliteUserRepository } from '../src/integrations/database/sqlite-user-repository.js';
import { createContinuityDeliveryService } from '../src/modules/continuity-integration/continuity-delivery-service.js';
import { createFirstRoundContinuityRequestService } from '../src/modules/continuity-integration/first-round-request-service.js';
import { createFirstRoundContinuityResultService } from '../src/modules/continuity-integration/first-round-result-service.js';

const required = [
  'S3_VIO_DATABASE_PATH',
  'S3_ENGINE_BASE_URL',
  'S3_ENGINE_SERVICE_TOKEN',
  'S3_REQUEST_ID',
];
for (const name of required) {
  if (typeof process.env[name] !== 'string' || process.env[name].length === 0) {
    throw new Error(`${name} is required.`);
  }
}

const config = loadConfig({
  VIO_BACKEND_DB_PATH: process.env.S3_VIO_DATABASE_PATH,
  VIO_CONTINUITY_ENGINE_ENABLED: 'true',
  VIO_CONTINUITY_ENGINE_BASE_URL: process.env.S3_ENGINE_BASE_URL,
  VIO_CONTINUITY_ENGINE_TOKEN: process.env.S3_ENGINE_SERVICE_TOKEN,
});
const database = createSqliteDatabase(config);
const connection = database.connection;
const requestService = createFirstRoundContinuityRequestService({
  continuityRepository: createSqliteContinuityIntegrationRepository(connection),
  userRepository: createSqliteUserRepository(connection),
  subjectRepository: createSqliteSubjectRepository(connection),
  conversationRepository: createSqliteConversationRepository(connection),
  messageRepository: createSqliteMessageRepository(connection),
  messageVersionRepository: createSqliteMessageVersionRepository(connection),
  eventRepository: createSqliteEventRepository(connection),
  runInTransaction: database.runInTransaction,
});
const resultService = createFirstRoundContinuityResultService({
  requestService,
  resultRepository: createSqliteContinuityResultRepository(connection),
  runInTransaction: database.runInTransaction,
  faultInjector(stage) {
    if (stage === 'after_pointer_advanced') process.exit(86);
  },
});
const transport = createHttpContinuityIntegrationTransport({
  baseUrl: config.continuityEngine.baseUrl,
  serviceToken: config.continuityEngine.token,
  connectTimeoutMs: config.continuityEngine.connectTimeoutMs,
  responseTimeoutMs: config.continuityEngine.responseTimeoutMs,
  maxResponseBytes: config.continuityEngine.maxResponseBytes,
});
const deliveryService = createContinuityDeliveryService({
  requestService,
  resultService,
  deliveryRepository: createSqliteContinuityDeliveryRepository(connection),
  transport,
  runInTransaction: database.runInTransaction,
  logger: { error() {} },
});

await deliveryService.submitStoredRequest(process.env.S3_REQUEST_ID);
throw new Error('The Vio crash worker did not stop at the requested persistence boundary.');
