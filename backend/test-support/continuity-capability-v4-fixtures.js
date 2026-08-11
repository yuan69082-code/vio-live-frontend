import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  calculateProjectionContentHash,
  canonicalizeJson,
  sha256Hash,
} from '../src/modules/continuity-integration/first-round-hashing.js';

export const V4_TIME = '2026-08-10T00:00:00Z';
export const ENGINE_TIME = '2026-08-10T00:00:05Z';
export const SERVICE_TOKEN = 'vio-v4-test-service-token-000000000001';

export function createFakeCredentialStore(secret = 'test-credential-value') {
  return Object.freeze({
    describeApiKey({ secretRef }) {
      return Object.freeze(secretRef
        ? { status: 'configured', storage: 'environment_reference', writeSupported: true }
        : { status: 'not_configured', storage: 'secure_store_required', writeSupported: false });
    },
    resolveApiKey({ secretRef }) {
      if (!secretRef?.startsWith('env:VIO_MODEL_API_KEY_')) throw new Error('invalid test ref');
      return secret;
    },
  });
}

export function seedV4Platform(connection, content = 'hello') {
  connection.prepare(`INSERT INTO users (user_id, primary_email, display_name, status, created_at, updated_at)
    VALUES ('user-001','v4@example.com','V4 User','active',?,?)`).run(V4_TIME, V4_TIME);
  connection.prepare(`INSERT INTO subjects (subject_id, owner_user_id, name, avatar_ref, basic_settings_json, status, created_at, updated_at)
    VALUES ('assistant-001','user-001','V4 Assistant',NULL,'{}','active',?,?)`).run(V4_TIME, V4_TIME);
  connection.prepare(`INSERT INTO conversations (conversation_id,user_id,subject_id,title,status,created_at,updated_at,last_activity_at)
    VALUES ('conversation-001','user-001','assistant-001','V4 conversation','active',?,?,?)`).run(V4_TIME, V4_TIME, V4_TIME);
  connection.prepare(`INSERT INTO messages (message_id,user_id,subject_id,conversation_id,sender_type,status,sequence_number,current_version_id,created_at,updated_at)
    VALUES ('message-001','user-001','assistant-001','conversation-001','user','active',1,NULL,?,?)`).run(V4_TIME, V4_TIME);
  connection.prepare(`INSERT INTO message_versions (message_version_id,user_id,subject_id,conversation_id,message_id,version_number,sender_type,change_reason,content,parent_version_id,created_at)
    VALUES ('message-version-001','user-001','assistant-001','conversation-001','message-001',1,'user','original',?,NULL,?)`).run(content, V4_TIME);
  connection.prepare(`UPDATE messages SET current_version_id='message-version-001' WHERE message_id='message-001'`).run();
  connection.prepare(`INSERT INTO events (event_id,user_id,subject_id,event_type,source_type,source_ref,occurred_at,recorded_at,event_data_json,summary,status)
    VALUES ('event-001','user-001','assistant-001','message_created','message-service','message-001',?,?,?,'Message created.','pending')`).run(V4_TIME, V4_TIME, JSON.stringify({
    conversationId: 'conversation-001', messageId: 'message-001',
    messageVersionId: 'message-version-001', senderType: 'user',
  }));
}

export function prepareV1Request(application, requestId = 'request-001') {
  application.continuityRequestService.prepareFixedBindingFixtureForTests();
  return application.continuityRequestService.constructAndStoreRequest({
    requestId,
    userId: 'user-001',
    assistantId: 'assistant-001',
    conversationId: 'conversation-001',
    messageId: 'message-001',
    messageVersionId: 'message-version-001',
    observationId: `observation-${requestId}`,
    sourceEventId: 'event-001',
    factId: `fact-${requestId}`,
    expectedEngineRevision: 0,
  });
}

export function capabilityRequiredEnvelope(request, overrides = {}) {
  const input = {
    instruction: 'Reply helpfully using the supplied message fact.',
    messageFactId: request.platformFactPackage.facts[0].factId,
    observationId: request.observations[0].observationId,
    messageContent: request.platformFactPackage.facts[0].content,
    perceptionId: 'perception-001',
    perceptionSummary: 'The user sent a message.',
    currentFocus: 'Respond to the current user message.',
    sourceRevision: request.expectedEngineRevision,
    outputSchemaVersion: 'continuity-model-output/v1',
    maximumOutputCharacters: 4096,
  };
  const capabilityRequest = {
    contractVersion: 'continuity-capability/v1',
    schemaVersion: 'continuity-capability-request/v1',
    capabilityRequestId: 'capability-request-001',
    operationId: 'operation-001',
    requestId: request.requestId,
    requestHash: request.requestHash,
    subjectId: request.identity.subjectId,
    bindingId: request.identity.bindingId,
    bindingVersion: request.identity.bindingVersion,
    originatingSessionType: 'thinking',
    originatingSessionId: 'thinking-session-001',
    capabilityType: 'model.generate',
    taskType: 'conversation_response',
    inputSchemaVersion: 'continuity-model-input/v1',
    input,
    inputHash: sha256Hash(canonicalizeJson(input)),
    permissionRef: 'engine-permission:model.generate:subject-001',
    resourceRef: 'engine-resource:thinking:operation-001',
    riskLevel: 'MEDIUM',
    deadlineAt: '2099-08-10T00:10:00Z',
    idempotencyKey: sha256Hash(Buffer.from('capability-request-001', 'utf8')),
    createdAt: '2026-08-10T00:00:01Z',
    ...overrides.capabilityRequest,
  };
  return {
    contractVersion: 'continuity-capability/v1',
    schemaVersion: 'continuity-capability-required/v1',
    status: 'capability_required',
    requestId: request.requestId,
    requestHash: request.requestHash,
    operationId: capabilityRequest.operationId,
    subjectId: request.identity.subjectId,
    capabilityRequest,
    updatedAt: '2026-08-10T00:00:02Z',
    ...overrides.envelope,
  };
}

export function completedEnvelope(request, operationId = 'operation-001') {
  const snapshot = {
    schemaVersion: 1,
    subjectId: request.identity.subjectId,
    revision: 0,
    stateHash: `sha256:${'1'.repeat(64)}`,
  };
  return {
    contractVersion: 'continuity-integration/v1.1',
    requestId: request.requestId,
    requestHash: request.requestHash,
    operationId,
    status: 'completed',
    subjectId: request.identity.subjectId,
    bindingId: request.identity.bindingId,
    bindingVersion: request.identity.bindingVersion,
    response: { responseId: `response-${request.requestId}`, role: 'subject', content: 'Engine-approved provider reply.' },
    stateProjection: {
      schemaVersion: 'engine-subject-state-projection/first-round-v1',
      subjectId: request.identity.subjectId,
      bindingId: request.identity.bindingId,
      bindingVersion: request.identity.bindingVersion,
      previousRevision: 0,
      currentRevision: 0,
      changed: false,
      engineUpdateId: null,
      snapshot,
      contentHash: calculateProjectionContentHash(snapshot),
    },
    consumedObservationIds: request.observations.map(({ observationId }) => observationId),
    completedAt: ENGINE_TIME,
  };
}

export function createEngineTransportDouble() {
  const state = {
    request: null,
    capabilityEnvelope: null,
    capabilityResult: null,
    capabilityResults: [],
    posts: 0,
    resultPosts: 0,
    queries: 0,
  };
  return {
    state,
    mode: 'injected-test-double',
    testOnly: true,
    async checkReady() { return true; },
    async submitCanonicalRequest(body) {
      state.posts += 1;
      state.request = JSON.parse(body.toString('utf8'));
      state.capabilityEnvelope = capabilityRequiredEnvelope(state.request);
      return { statusCode: 200, payload: state.capabilityEnvelope };
    },
    async submitCapabilityResult(body) {
      state.resultPosts += 1;
      state.capabilityResult = JSON.parse(body.toString('utf8'));
      state.capabilityResults.push(state.capabilityResult);
      if (['FAILED_TERMINAL', 'CANCELLED', 'EXPIRED'].includes(state.capabilityResult.status)) {
        return { statusCode: 200, payload: {
          contractVersion: 'continuity-capability/v1',
          schemaVersion: 'continuity-capability-failed/v1',
          status: 'capability_failed',
          requestId: state.capabilityResult.requestId,
          requestHash: state.capabilityResult.requestHash,
          operationId: state.capabilityResult.operationId,
          subjectId: state.capabilityResult.subjectId,
          capabilityRequestId: state.capabilityResult.capabilityRequestId,
          failureStatus: state.capabilityResult.status,
          errorCode: state.capabilityResult.errorCode,
          retryClass: 'never',
          updatedAt: ENGINE_TIME,
        } };
      }
      if (['FAILED_RETRYABLE', 'UNKNOWN'].includes(state.capabilityResult.status)) {
        return { statusCode: 200, payload: state.capabilityEnvelope };
      }
      return { statusCode: 200, payload: completedEnvelope(state.request) };
    },
    async queryRequest(requestId) {
      state.queries += 1;
      if (!state.request || state.request.requestId !== requestId) return { statusCode: 404, kind: 'not_found', payload: { error: 'not_found' } };
      if (state.capabilityResult) {
        if (['FAILED_TERMINAL', 'CANCELLED', 'EXPIRED'].includes(state.capabilityResult.status)) {
          const result = state.capabilityResult;
          return { statusCode: 200, kind: 'query', payload: {
            contractVersion: 'continuity-capability/v1',
            schemaVersion: 'continuity-capability-failed/v1',
            status: 'capability_failed', requestId, requestHash: result.requestHash,
            operationId: result.operationId, subjectId: result.subjectId,
            capabilityRequestId: result.capabilityRequestId,
            failureStatus: result.status, errorCode: result.errorCode,
            retryClass: 'never', updatedAt: ENGINE_TIME,
          } };
        }
        if (['FAILED_RETRYABLE', 'UNKNOWN'].includes(state.capabilityResult.status)) {
          return { statusCode: 200, kind: 'query', payload: state.capabilityEnvelope };
        }
        return { statusCode: 200, kind: 'query', payload: {
          contractVersion: 'continuity-integration/v1.1', requestId,
          requestHash: state.request.requestHash, operationId: 'operation-001',
          status: 'completed', result: completedEnvelope(state.request),
        } };
      }
      return { statusCode: 200, kind: 'query', payload: state.capabilityEnvelope };
    },
  };
}

export function createV4Application(databasePath, {
  transport = createEngineTransportDouble(),
  credentialStore = createFakeCredentialStore(),
  modelExecutor,
} = {}) {
  const config = loadConfig({
    VIO_BACKEND_DB_PATH: databasePath,
    VIO_BACKEND_PORT: '0',
    VIO_CONTINUITY_ENGINE_ENABLED: 'true',
    VIO_CONTINUITY_ENGINE_BASE_URL: 'http://127.0.0.1:8766',
    VIO_CONTINUITY_ENGINE_TOKEN: SERVICE_TOKEN,
  });
  const application = createApplication({
    config,
    logger: { error() {} },
    continuityTransport: transport,
    credentialStore,
    modelExecutor,
  });
  return { application, transport };
}

export function configureV4Execution(application, {
  baseUrl = 'https://provider.invalid',
  executePermission = 'always_allow',
  dailyTokenLimit = 1_000_000,
  sessionTokenLimit = 100_000,
  overagePolicy = 'block',
} = {}) {
  const provider = application.apiProviderService.createProvider('user-001', {
    displayName: 'V4 configured provider', providerType: 'custom', baseUrl,
    interfaceFormat: 'openai_compatible', status: 'enabled',
  });
  const model = application.modelService.createModel('user-001', provider.providerId, {
    modelName: 'v4-model', modelType: 'chat', capabilities: ['chat'], costDescription: '',
  });
  application.permissionService.createPermission('user-001', {
    subjectId: 'assistant-001', resourceType: 'api', resourceId: provider.providerId,
    action: 'manage', permissionLevel: 'always_allow', status: 'active',
  });
  const pending = application.apiProviderService.bindCredentialReference('user-001', provider.providerId, {
    subjectId: 'assistant-001', secretRef: 'env:VIO_MODEL_API_KEY_TEST',
  });
  application.confirmationService.decideConfirmation(
    'user-001', pending.security.confirmation.confirmationId, { decision: 'approve' },
  );
  application.apiProviderService.bindCredentialReference('user-001', provider.providerId, {
    subjectId: 'assistant-001', secretRef: 'env:VIO_MODEL_API_KEY_TEST',
    confirmationId: pending.security.confirmation.confirmationId,
  });
  application.permissionService.createPermission('user-001', {
    subjectId: 'assistant-001', resourceType: 'api', resourceId: provider.providerId,
    action: 'execute', permissionLevel: executePermission, status: 'active',
  });
  application.proactiveInteractionService.upsertTokenBudget('user-001', 'assistant-001', {
    dailyTokenLimit, sessionTokenLimit, overagePolicy, status: 'enabled',
  });
  return { provider, model };
}

export function approveLatestExecutionConfirmation(application) {
  const row = application.database.connection.prepare(`
    SELECT confirmation_id FROM security_confirmations
    WHERE resource_type='api' AND action='execute' AND status='pending'
    ORDER BY requested_at DESC, confirmation_id DESC LIMIT 1
  `).get();
  if (!row) throw new Error('Expected an execution confirmation.');
  application.confirmationService.decideConfirmation(
    'user-001', row.confirmation_id, { decision: 'approve' },
  );
  return row.confirmation_id;
}
