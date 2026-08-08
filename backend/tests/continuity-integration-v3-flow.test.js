import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  ContinuityTransportError,
  createHttpContinuityIntegrationTransport,
} from '../src/integrations/continuity-engine/http-continuity-integration-transport.js';
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
import {
  calculateProjectionContentHash,
  calculateStateHash,
  canonicalizeJson,
} from '../src/modules/continuity-integration/first-round-hashing.js';
import { createFirstRoundContinuityRequestService } from '../src/modules/continuity-integration/first-round-request-service.js';
import { createFirstRoundContinuityResultService } from '../src/modules/continuity-integration/first-round-result-service.js';
import { FIRST_ROUND_ERROR_RULES } from '../src/modules/continuity-integration/first-round-result-contract.js';
import { createContinuityDeliveryService } from '../src/modules/continuity-integration/continuity-delivery-service.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

const TOKEN = 'vio-test-service-token-000000000001';
const PLATFORM_TIME = '2026-08-08T00:00:00Z';
const ENGINE_TIME = '2026-08-08T00:00:01Z';
const RECEIVE_TIME = '2026-08-08T00:00:02Z';

function jsonResponse(response, statusCode, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    ...headers,
  });
  response.end(body);
}

async function startHttpFixture(handler) {
  const server = createServer(handler);
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      });
    },
  };
}

function createTransport(baseUrl, overrides = {}) {
  return createHttpContinuityIntegrationTransport({
    baseUrl,
    serviceToken: TOKEN,
    connectTimeoutMs: 100,
    responseTimeoutMs: 100,
    maxResponseBytes: 1_048_576,
    ...overrides,
  });
}

function authoritativeStateFixture(revision = 0) {
  return {
    schema_version: 1,
    revision,
    subject_id: 'subject-001',
    identity: {
      stable_traits: [],
      expression_preferences: [],
      judgment_principles: [],
      self_concept: '',
    },
    relationship: {
      definition: '',
      interaction_preferences: [],
      important_moments: [],
      current_status: '',
    },
    continuity: { unfinished_items: [], current_focus: [], recent_changes: [] },
    temporal: {
      created_at: ENGINE_TIME,
      updated_at: ENGINE_TIME,
      last_interaction_at: null,
      lifecycle_events: [],
    },
    intentions: { emerging_thoughts: [], judgments: [], action_tendencies: [] },
    emotion_state: { interaction_state: '', emotions: [], continuity_notes: [] },
  };
}

function successEnvelope(request, {
  operationId = `operation-${request.requestId}`,
  previousRevision = request.expectedEngineRevision,
  currentRevision = previousRevision,
  changed = currentRevision !== previousRevision,
  engineUpdateId = changed ? `update-${request.requestId}` : null,
} = {}) {
  const state = authoritativeStateFixture(currentRevision);
  const snapshot = {
    schemaVersion: 1,
    subjectId: request.identity.subjectId,
    revision: currentRevision,
    stateHash: calculateStateHash(state),
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
    response: {
      responseId: `response-${request.requestId}`,
      role: 'subject',
      content: 'Deterministic Engine-approved reply.',
    },
    stateProjection: {
      schemaVersion: 'engine-subject-state-projection/first-round-v1',
      subjectId: request.identity.subjectId,
      bindingId: request.identity.bindingId,
      bindingVersion: request.identity.bindingVersion,
      previousRevision,
      currentRevision,
      changed,
      engineUpdateId,
      snapshot,
      contentHash: calculateProjectionContentHash(snapshot),
    },
    consumedObservationIds: request.observations.map(({ observationId }) => observationId),
    completedAt: ENGINE_TIME,
  };
}

function errorEnvelope(request, code) {
  const rule = FIRST_ROUND_ERROR_RULES[code];
  return {
    contractVersion: 'continuity-integration/v1.1',
    requestId: request.requestId,
    operationId: null,
    status: 'failed_terminal',
    error: {
      code,
      message: rule.message,
      retryClass: rule.retryClass,
      currentEngineRevision: code === 'REVISION_CONFLICT' ? 1 : null,
      currentBindingVersion: null,
    },
  };
}

function queryEnvelope(request, status, operationId, result = null) {
  return {
    contractVersion: 'continuity-integration/v1.1',
    requestId: request.requestId,
    requestHash: request.requestHash,
    operationId,
    status,
    result,
  };
}

function seedPlatform(connection) {
  connection.prepare(`
    INSERT INTO users (
      user_id, primary_email, display_name, status, created_at, updated_at
    ) VALUES ('user-001', 'v3@example.com', 'V3 User', 'active', ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES ('assistant-001', 'user-001', 'V3 Assistant', NULL, '{}', 'active', ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO conversations (
      conversation_id, user_id, subject_id, title, status,
      created_at, updated_at, last_activity_at
    ) VALUES (
      'conversation-001', 'user-001', 'assistant-001', 'V3 conversation',
      'active', ?, ?, ?
    )
  `).run(PLATFORM_TIME, PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO messages (
      message_id, user_id, subject_id, conversation_id, sender_type,
      status, sequence_number, current_version_id, created_at, updated_at
    ) VALUES (
      'message-001', 'user-001', 'assistant-001', 'conversation-001',
      'user', 'active', 1, NULL, ?, ?
    )
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO message_versions (
      message_version_id, user_id, subject_id, conversation_id, message_id,
      version_number, sender_type, change_reason, content, parent_version_id,
      created_at
    ) VALUES (
      'message-version-001', 'user-001', 'assistant-001', 'conversation-001',
      'message-001', 1, 'user', 'original', '你好，continuity', NULL, ?
    )
  `).run(PLATFORM_TIME);
  connection.prepare(`
    UPDATE messages SET current_version_id = 'message-version-001'
    WHERE message_id = 'message-001'
  `).run();
  connection.prepare(`
    INSERT INTO events (
      event_id, user_id, subject_id, event_type, source_type, source_ref,
      occurred_at, recorded_at, event_data_json, summary, status
    ) VALUES (
      'event-001', 'user-001', 'assistant-001', 'message_created',
      'message-service', 'message-001', ?, ?, ?, 'Message created.', 'pending'
    )
  `).run(PLATFORM_TIME, PLATFORM_TIME, JSON.stringify({
    conversationId: 'conversation-001',
    messageId: 'message-001',
    messageVersionId: 'message-version-001',
    senderType: 'user',
  }));
}

function createHarness(databasePath, transport, { seed = true } = {}) {
  const config = loadConfig({ VIO_BACKEND_DB_PATH: databasePath });
  const database = createSqliteDatabase(config);
  const connection = database.connection;
  if (seed) seedPlatform(connection);
  const continuityRepository = createSqliteContinuityIntegrationRepository(connection);
  const requestService = createFirstRoundContinuityRequestService({
    continuityRepository,
    userRepository: createSqliteUserRepository(connection),
    subjectRepository: createSqliteSubjectRepository(connection),
    conversationRepository: createSqliteConversationRepository(connection),
    messageRepository: createSqliteMessageRepository(connection),
    messageVersionRepository: createSqliteMessageVersionRepository(connection),
    eventRepository: createSqliteEventRepository(connection),
    runInTransaction: database.runInTransaction,
    clock: () => new Date(PLATFORM_TIME),
  });
  const resultRepository = createSqliteContinuityResultRepository(connection);
  const resultService = createFirstRoundContinuityResultService({
    requestService,
    resultRepository,
    runInTransaction: database.runInTransaction,
    clock: () => new Date(RECEIVE_TIME),
  });
  const deliveryRepository = createSqliteContinuityDeliveryRepository(connection);
  let id = 0;
  const deliveryService = createContinuityDeliveryService({
    requestService,
    resultService,
    deliveryRepository,
    transport,
    runInTransaction: database.runInTransaction,
    clock: () => new Date(RECEIVE_TIME),
    idFactory: () => `attempt-${++id}`,
    logger: { error() {} },
  });
  return {
    connection,
    database,
    requestService,
    resultService,
    deliveryRepository,
    deliveryService,
  };
}

function prepareRequest(harness) {
  harness.requestService.prepareFixedBindingFixtureForTests();
  return harness.requestService.constructAndStoreRequest({
    requestId: 'request-001',
    userId: 'user-001',
    assistantId: 'assistant-001',
    conversationId: 'conversation-001',
    messageId: 'message-001',
    messageVersionId: 'message-version-001',
    observationId: 'observation-001',
    sourceEventId: 'event-001',
    factId: 'fact-001',
    expectedEngineRevision: 0,
  });
}

async function withHarness(operation, transport) {
  const testDatabase = createTestDatabasePath();
  const harness = createHarness(testDatabase.databasePath, transport);
  try {
    return await operation(harness, testDatabase);
  } finally {
    harness.database.close();
    testDatabase.remove();
  }
}

function queuedTransport({ posts = [], queries = [], ready = true } = {}) {
  const receivedBodies = [];
  let postIndex = 0;
  let queryIndex = 0;
  return {
    receivedBodies,
    get postCount() { return postIndex; },
    get queryCount() { return queryIndex; },
    async submitCanonicalRequest(body) {
      receivedBodies.push(Buffer.from(body));
      const value = posts[postIndex++];
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(body) : value;
    },
    async queryRequest(requestId) {
      const value = queries[queryIndex++];
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(requestId) : value;
    },
    async checkReady() { return ready; },
  };
}

test('configuration is disabled by default and enabled mode requires loopback URL and token', () => {
  const disabled = loadConfig({});
  assert.equal(disabled.continuityEngine.enabled, false);
  assert.equal(disabled.continuityEngine.baseUrl, 'http://127.0.0.1:8766');
  assert.equal(disabled.continuityEngine.token, '');
  assert.throws(() => loadConfig({ VIO_CONTINUITY_ENGINE_ENABLED: 'true' }), /BASE_URL/);
  assert.throws(() => loadConfig({
    VIO_CONTINUITY_ENGINE_ENABLED: 'true',
    VIO_CONTINUITY_ENGINE_BASE_URL: 'http://127.0.0.1:8766',
  }), /TOKEN/);
  assert.throws(() => loadConfig({
    VIO_CONTINUITY_ENGINE_ENABLED: 'true',
    VIO_CONTINUITY_ENGINE_BASE_URL: 'http://0.0.0.0:8766',
    VIO_CONTINUITY_ENGINE_TOKEN: TOKEN,
  }), /127\.0\.0\.1/);
});

test('HTTP transport sends the original canonical UTF-8 body to the exact E4 endpoint', async () => {
  const request = { requestId: '请求-001', text: '你好 👋', nested: { z: 1, a: true } };
  const canonical = canonicalizeJson(request);
  let captured;
  const fixture = await startHttpFixture((incoming, response) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', () => {
      captured = {
        method: incoming.method,
        url: incoming.url,
        authorization: incoming.headers.authorization,
        contentType: incoming.headers['content-type'],
        body: Buffer.concat(chunks),
      };
      jsonResponse(response, 200, { status: 'completed' });
    });
  });
  try {
    const result = await createTransport(fixture.baseUrl).submitCanonicalRequest(canonical);
    assert.deepEqual(result.payload, { status: 'completed' });
    assert.equal(captured.method, 'POST');
    assert.equal(captured.url, '/internal/v1/continuity/interactions');
    assert.equal(captured.authorization, `Bearer ${TOKEN}`);
    assert.equal(captured.contentType, 'application/json; charset=utf-8');
    assert.deepEqual(captured.body, canonical);
    assert.equal(captured.body.toString('utf8'), canonical.toString('utf8'));
  } finally {
    await fixture.close();
  }
});

test('HTTP 200 success and all four machine contract errors pass through unchanged', async () => {
  const payloads = [
    { status: 'completed', operationId: 'operation-1' },
    ...Object.keys(FIRST_ROUND_ERROR_RULES).map((code) => ({
      status: 'failed_terminal',
      error: { code },
    })),
  ];
  let index = 0;
  const fixture = await startHttpFixture((incoming, response) => {
    incoming.resume();
    incoming.on('end', () => jsonResponse(response, 200, payloads[index++]));
  });
  try {
    const transport = createTransport(fixture.baseUrl);
    for (const payload of payloads) {
      const result = await transport.submitCanonicalRequest(Buffer.from('{}'));
      assert.deepEqual(result.payload, payload);
    }
  } finally {
    await fixture.close();
  }
});

test('HTTP query supports completed, recovery_required and exact not_found', async () => {
  const responses = [
    [200, { requestId: 'request-001', status: 'completed' }],
    [200, { requestId: 'request-001', status: 'recovery_required' }],
    [404, { error: 'not_found' }],
  ];
  let index = 0;
  const paths = [];
  const fixture = await startHttpFixture((incoming, response) => {
    paths.push(incoming.url);
    const [status, payload] = responses[index++];
    jsonResponse(response, status, payload);
  });
  try {
    const transport = createTransport(fixture.baseUrl);
    assert.equal((await transport.queryRequest('request-001')).kind, 'query');
    assert.equal((await transport.queryRequest('request-001')).kind, 'query');
    assert.equal((await transport.queryRequest('request-001')).kind, 'not_found');
    assert.deepEqual(paths, Array(3).fill('/internal/v1/continuity/requests/request-001'));
  } finally {
    await fixture.close();
  }
});

test('health readiness is unauthenticated and accepts only the exact ready response', async () => {
  const headers = [];
  let calls = 0;
  const fixture = await startHttpFixture((incoming, response) => {
    headers.push(incoming.headers.authorization ?? null);
    jsonResponse(response, calls++ === 0 ? 200 : 503, calls === 1
      ? { status: 'ready' }
      : { status: 'not_ready' });
  });
  try {
    const transport = createTransport(fixture.baseUrl);
    assert.equal(await transport.checkReady(), true);
    assert.equal(await transport.checkReady(), false);
    assert.deepEqual(headers, [null, null]);
  } finally {
    await fixture.close();
  }
});

test('HTTP transport classifies 401, 5xx, invalid JSON and oversized responses', async () => {
  const cases = [
    { status: 401, payload: { error: 'unauthorized' }, code: 'unauthorized' },
    { status: 503, payload: { error: 'not_ready' }, code: 'engine_unavailable' },
    { status: 200, raw: '{not-json', code: 'invalid_json' },
    { status: 200, raw: JSON.stringify({ value: 'x'.repeat(128) }), code: 'response_too_large' },
  ];
  for (const variant of cases) {
    const fixture = await startHttpFixture((incoming, response) => {
      incoming.resume();
      incoming.on('end', () => {
        if (variant.raw !== undefined) {
          response.writeHead(variant.status, { 'content-type': 'application/json; charset=utf-8' });
          response.end(Buffer.from(variant.raw));
        } else {
          jsonResponse(response, variant.status, variant.payload);
        }
      });
    });
    try {
      const transport = createTransport(fixture.baseUrl, {
        maxResponseBytes: variant.code === 'response_too_large' ? 32 : 1_048_576,
      });
      await assert.rejects(
        transport.submitCanonicalRequest(Buffer.from('{}')),
        (error) => error instanceof ContinuityTransportError
          && error.transportCode === variant.code,
      );
    } finally {
      await fixture.close();
    }
  }
});

test('HTTP transport rejects invalid UTF-8 and invalid Content-Type', async () => {
  const variants = [
    { contentType: 'application/json; charset=utf-8', body: Buffer.from([0xc3, 0x28]), code: 'invalid_utf8' },
    { contentType: 'text/plain', body: Buffer.from('{}'), code: 'invalid_content_type' },
  ];
  for (const variant of variants) {
    const fixture = await startHttpFixture((incoming, response) => {
      incoming.resume();
      incoming.on('end', () => {
        response.writeHead(200, { 'content-type': variant.contentType });
        response.end(variant.body);
      });
    });
    try {
      await assert.rejects(
        createTransport(fixture.baseUrl).submitCanonicalRequest(Buffer.from('{}')),
        (error) => error.transportCode === variant.code,
      );
    } finally {
      await fixture.close();
    }
  }
});

test('HTTP transport distinguishes connection refusal and response timeout', async () => {
  const reservation = await startHttpFixture((_request, response) => response.end());
  const unavailableUrl = reservation.baseUrl;
  await reservation.close();
  await assert.rejects(
    createTransport(unavailableUrl).submitCanonicalRequest(Buffer.from('{}')),
    (error) => error.transportCode === 'connection_failed' && error.outcomeUnknown === false,
  );

  const fixture = await startHttpFixture((incoming) => incoming.resume());
  try {
    await assert.rejects(
      createTransport(fixture.baseUrl, { responseTimeoutMs: 20 })
        .submitCanonicalRequest(Buffer.from('{}')),
      (error) => error.transportCode === 'response_timeout' && error.outcomeUnknown === true,
    );
  } finally {
    await fixture.close();
  }
});

test('delivery success and four machine errors reuse V1 and finish in the V2 ledger', async () => {
  const variants = ['success', ...Object.keys(FIRST_ROUND_ERROR_RULES)];
  for (const variant of variants) {
    let request;
    const transport = queuedTransport({
      posts: [(body) => ({
        statusCode: 200,
        payload: variant === 'success'
          ? successEnvelope(request)
          : errorEnvelope(request, variant),
      })],
    });
    await withHarness(async (harness) => {
      request = prepareRequest(harness);
      const beforeRequestCount = harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_first_round_requests',
      ).get().count;
      const beforeLegacyStateCount = harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM subject_states',
      ).get().count;
      const result = await harness.deliveryService.submitStoredRequest(request.requestId);
      assert.equal(result.delivery.status, 'completed');
      assert.equal(harness.deliveryService.getHealthStatus(), 'ready');
      assert.equal(
        result.result.processingStage,
        variant === 'success' ? 'completed' : 'terminal_error',
      );
      assert.deepEqual(transport.receivedBodies[0], canonicalizeJson(request));
      assert.equal(harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_first_round_requests',
      ).get().count, beforeRequestCount);
      assert.equal(harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM subject_states',
      ).get().count, beforeLegacyStateCount);
    }, transport);
  }
});

test('POST timeout becomes outcome_unknown and query completed finishes without another POST', async () => {
  let request;
  const transport = queuedTransport({
    posts: [new ContinuityTransportError('timeout', {
      transportCode: 'response_timeout',
      outcomeUnknown: true,
    })],
    queries: [() => ({
      statusCode: 200,
      kind: 'query',
      payload: queryEnvelope(request, 'completed', 'operation-001', successEnvelope(request, {
        operationId: 'operation-001',
      })),
    })],
  });
  await withHarness(async (harness) => {
    request = prepareRequest(harness);
    const first = await harness.deliveryService.submitStoredRequest(request.requestId);
    assert.equal(first.delivery.status, 'outcome_unknown');
    const recovered = await harness.deliveryService.submitStoredRequest(request.requestId);
    assert.equal(recovered.delivery.status, 'completed');
    assert.equal(transport.postCount, 1);
    assert.equal(transport.queryCount, 1);
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 0);
  }, transport);
});

test('query recovery_required reposts the identical persisted request and preserves operationId', async () => {
  let request;
  const timeout = new ContinuityTransportError('timeout', {
    transportCode: 'response_timeout',
    outcomeUnknown: true,
  });
  const transport = queuedTransport({
    posts: [timeout, (body) => ({
      statusCode: 200,
      payload: successEnvelope(JSON.parse(body.toString('utf8')), {
        operationId: 'operation-001',
      }),
    })],
    queries: [() => ({
      statusCode: 200,
      kind: 'query',
      payload: queryEnvelope(request, 'recovery_required', 'operation-001'),
    })],
  });
  await withHarness(async (harness) => {
    request = prepareRequest(harness);
    await harness.deliveryService.submitStoredRequest(request.requestId);
    const recovered = await harness.deliveryService.submitStoredRequest(request.requestId);
    assert.equal(recovered.delivery.status, 'completed');
    assert.equal(recovered.delivery.operationId, 'operation-001');
    assert.equal(transport.postCount, 2);
    assert.deepEqual(transport.receivedBodies[1], transport.receivedBodies[0]);
    assert.equal(JSON.parse(transport.receivedBodies[1]).createdAt, request.createdAt);
    assert.equal(JSON.parse(transport.receivedBodies[1]).requestHash, request.requestHash);
  }, transport);
});

test('query not_found reposts once while query failure remains outcome_unknown', async () => {
  let request;
  const timeout = new ContinuityTransportError('timeout', {
    transportCode: 'response_timeout',
    outcomeUnknown: true,
  });
  const notFoundTransport = queuedTransport({
    posts: [timeout, (body) => ({
      statusCode: 200,
      payload: successEnvelope(JSON.parse(body.toString('utf8'))),
    })],
    queries: [{ statusCode: 404, kind: 'not_found', payload: { error: 'not_found' } }],
  });
  await withHarness(async (harness) => {
    request = prepareRequest(harness);
    await harness.deliveryService.submitStoredRequest(request.requestId);
    const recovered = await harness.deliveryService.submitStoredRequest(request.requestId);
    assert.equal(recovered.delivery.status, 'completed');
    assert.equal(notFoundTransport.postCount, 2);
  }, notFoundTransport);

  const queryFailureTransport = queuedTransport({
    posts: [timeout],
    queries: [new ContinuityTransportError('unavailable', {
      transportCode: 'connection_failed',
    })],
  });
  await withHarness(async (harness) => {
    request = prepareRequest(harness);
    await harness.deliveryService.submitStoredRequest(request.requestId);
    const held = await harness.deliveryService.submitStoredRequest(request.requestId);
    assert.equal(held.delivery.status, 'outcome_unknown');
    assert.equal(queryFailureTransport.postCount, 1);
    assert.equal(queryFailureTransport.queryCount, 1);
  }, queryFailureTransport);
});

test('query requestHash mismatch and operationId drift are quarantined without V2 projection', async () => {
  const variants = ['hash', 'operation'];
  for (const variant of variants) {
    let request;
    const timeout = new ContinuityTransportError('timeout', {
      transportCode: 'response_timeout',
      outcomeUnknown: true,
    });
    const transport = queuedTransport({
      posts: variant === 'operation'
        ? [timeout, (body) => ({
          statusCode: 200,
          payload: successEnvelope(JSON.parse(body.toString('utf8')), {
            operationId: 'operation-002',
          }),
        })]
        : [timeout],
      queries: [() => {
        const envelope = queryEnvelope(request, 'recovery_required', 'operation-001');
        if (variant === 'hash') envelope.requestHash = `sha256:${'0'.repeat(64)}`;
        return { statusCode: 200, kind: 'query', payload: envelope };
      }],
    });
    await withHarness(async (harness) => {
      request = prepareRequest(harness);
      await harness.deliveryService.submitStoredRequest(request.requestId);
      const outcome = await harness.deliveryService.submitStoredRequest(request.requestId);
      assert.equal(outcome.delivery.status, 'quarantined');
      assert.equal(harness.resultService.getProjectionHead('subject-001'), null);
      assert.equal(harness.resultService.getStoredResult(request.requestId), null);
    }, transport);
  }
});

test('startup completes an unfinished outbox from local V2 without calling Engine', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = queuedTransport({ ready: true });
  let harness = createHarness(testDatabase.databasePath, transport);
  try {
    const request = prepareRequest(harness);
    harness.deliveryRepository.ensureOutbox({
      requestId: request.requestId,
      requestHash: request.requestHash,
      createdAt: RECEIVE_TIME,
    });
    harness.resultService.receiveResult(request.requestId, successEnvelope(request));
    harness.database.close();
    harness = createHarness(testDatabase.databasePath, transport, { seed: false });
    const initialized = await harness.deliveryService.initialize();
    assert.equal(initialized.status, 'ready');
    assert.equal(initialized.recovered, 1);
    assert.equal(harness.deliveryService.getOutbox(request.requestId).status, 'completed');
    assert.equal(transport.postCount, 0);
    assert.equal(transport.queryCount, 0);
  } finally {
    harness.database.close();
    testDatabase.remove();
  }
});

test('startup recovers pending, in_flight and outcome_unknown by their fixed rules', async () => {
  for (const initialStatus of ['pending', 'in_flight', 'outcome_unknown']) {
    const testDatabase = createTestDatabasePath();
    let request;
    const transport = queuedTransport({
      ready: true,
      posts: [(body) => ({
        statusCode: 200,
        payload: successEnvelope(JSON.parse(body.toString('utf8')), {
          operationId: 'operation-001',
        }),
      })],
      queries: [() => ({
        statusCode: 200,
        kind: 'query',
        payload: queryEnvelope(request, 'completed', 'operation-001', successEnvelope(request, {
          operationId: 'operation-001',
        })),
      })],
    });
    let harness = createHarness(testDatabase.databasePath, transport);
    try {
      request = prepareRequest(harness);
      let outbox = harness.deliveryRepository.ensureOutbox({
        requestId: request.requestId,
        requestHash: request.requestHash,
        createdAt: RECEIVE_TIME,
      });
      if (initialStatus !== 'pending') {
        outbox = harness.deliveryRepository.transitionOutbox({
          requestId: request.requestId,
          expectedStatus: outbox.status,
          status: 'in_flight',
          updatedAt: RECEIVE_TIME,
        });
      }
      if (initialStatus === 'outcome_unknown') {
        harness.deliveryRepository.transitionOutbox({
          requestId: request.requestId,
          expectedStatus: outbox.status,
          status: 'outcome_unknown',
          updatedAt: RECEIVE_TIME,
        });
      }
      harness.database.close();
      harness = createHarness(testDatabase.databasePath, transport, { seed: false });
      const initialized = await harness.deliveryService.initialize();
      assert.equal(initialized.status, 'ready');
      assert.equal(harness.deliveryService.getOutbox(request.requestId).status, 'completed');
      assert.equal(transport.postCount, initialStatus === 'pending' ? 1 : 0);
      assert.equal(transport.queryCount, initialStatus === 'pending' ? 0 : 1);
    } finally {
      harness.database.close();
      testDatabase.remove();
    }
  }
});

test('Engine unavailable marks the enabled app degraded without blocking Vio startup', async () => {
  const reservation = await startHttpFixture((_request, response) => response.end());
  const unavailableUrl = reservation.baseUrl;
  await reservation.close();
  const testDatabase = createTestDatabasePath();
  const config = loadConfig({
    VIO_BACKEND_HOST: '127.0.0.1',
    VIO_BACKEND_PORT: '0',
    VIO_BACKEND_DB_PATH: testDatabase.databasePath,
    VIO_CONTINUITY_ENGINE_ENABLED: 'true',
    VIO_CONTINUITY_ENGINE_BASE_URL: unavailableUrl,
    VIO_CONTINUITY_ENGINE_TOKEN: TOKEN,
    VIO_CONTINUITY_ENGINE_CONNECT_TIMEOUT_MS: '50',
    VIO_CONTINUITY_ENGINE_RESPONSE_TIMEOUT_MS: '50',
  });
  const application = createApplication({ config, logger: { error() {} } });
  try {
    const address = await application.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, 'ok');
    assert.equal(body.data.continuityEngine, 'degraded');
  } finally {
    await application.stop();
    testDatabase.remove();
  }
});

test('migration 020 installs from 001 and upgrades databases at 018 and 019', () => {
  const root = mkdtempSync(join(tmpdir(), 'vio-v3-migrations-'));
  const allMigrations = resolve('./migrations');
  try {
    for (const cutoff of [0, 18, 19]) {
      const databasePath = join(root, `upgrade-${cutoff}.sqlite`);
      if (cutoff > 0) {
        const subset = join(root, `through-${cutoff}`);
        mkdirSync(subset);
        for (const filename of readdirSync(allMigrations)) {
          const version = Number.parseInt(filename.slice(0, 3), 10);
          if (/^\d+_.+\.sql$/.test(filename) && version <= cutoff) {
            cpSync(join(allMigrations, filename), join(subset, filename));
          }
        }
        const before = createSqliteDatabase({ databasePath, migrationsPath: subset });
        assert.equal(before.connection.prepare(
          'SELECT COUNT(*) AS count FROM schema_migrations',
        ).get().count, cutoff);
        before.close();
      }
      const after = createSqliteDatabase({ databasePath, migrationsPath: allMigrations });
      assert.equal(after.connection.prepare(
        'SELECT COUNT(*) AS count FROM schema_migrations',
      ).get().count, 20);
      assert.equal(after.connection.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'continuity_first_round_delivery_outbox',
          'continuity_first_round_delivery_attempts'
        )
      `).get().count, 2);
      assert.equal(after.connection.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_continuity_delivery_%'
      `).get().count, 3);
      assert.equal(after.connection.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'trigger' AND name LIKE '%continuity_delivery_%'
      `).get().count, 5);
      assert.deepEqual(after.connection.prepare('PRAGMA foreign_key_check').all(), []);
      after.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migration 020 constraints protect identity, terminal records and attempt transactions', async () => {
  const transport = queuedTransport({ posts: [] });
  await withHarness(async (harness) => {
    const request = prepareRequest(harness);
    const outbox = harness.deliveryRepository.ensureOutbox({
      requestId: request.requestId,
      requestHash: request.requestHash,
      createdAt: RECEIVE_TIME,
    });
    harness.database.runInTransaction(() => harness.deliveryRepository.startAttempt({
      attemptId: 'attempt-fixed',
      requestId: request.requestId,
      operationType: 'post',
      startedAt: RECEIVE_TIME,
    }));
    assert.throws(() => harness.database.runInTransaction(() => (
      harness.deliveryRepository.startAttempt({
        attemptId: 'attempt-fixed',
        requestId: request.requestId,
        operationType: 'post',
        startedAt: RECEIVE_TIME,
      })
    )), /UNIQUE constraint/);
    assert.equal(harness.deliveryRepository.findOutbox(request.requestId).attemptCount, 1);
    const completed = harness.deliveryRepository.transitionOutbox({
      requestId: request.requestId,
      expectedStatus: outbox.status,
      status: 'result_received',
      operationId: 'operation-001',
      updatedAt: RECEIVE_TIME,
    });
    harness.deliveryRepository.transitionOutbox({
      requestId: request.requestId,
      expectedStatus: completed.status,
      status: 'completed',
      operationId: 'operation-001',
      updatedAt: RECEIVE_TIME,
    });
    assert.throws(() => harness.connection.prepare(`
      UPDATE continuity_first_round_delivery_outbox
      SET operation_id = 'operation-002'
      WHERE request_id = 'request-001'
    `).run());
    assert.throws(() => harness.connection.prepare(`
      DELETE FROM continuity_first_round_delivery_outbox
      WHERE request_id = 'request-001'
    `).run());
    assert.deepEqual(harness.connection.prepare('PRAGMA foreign_key_check').all(), []);
  }, transport);
});
