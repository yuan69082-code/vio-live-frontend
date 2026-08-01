import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictError, ValidationError } from '../src/core/errors.js';
import { loadConfig } from '../src/config.js';
import { createSqliteContinuityIntegrationRepository } from '../src/integrations/database/sqlite-continuity-integration-repository.js';
import { createSqliteConversationRepository } from '../src/integrations/database/sqlite-conversation-repository.js';
import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import { createSqliteEventRepository } from '../src/integrations/database/sqlite-event-repository.js';
import { createSqliteMessageRepository } from '../src/integrations/database/sqlite-message-repository.js';
import { createSqliteMessageVersionRepository } from '../src/integrations/database/sqlite-message-version-repository.js';
import { createSqliteSubjectRepository } from '../src/integrations/database/sqlite-subject-repository.js';
import { createSqliteUserRepository } from '../src/integrations/database/sqlite-user-repository.js';
import {
  EXPECTED_BINDING_FIXTURE_HASH,
  EXPECTED_CONTENT_HASH,
  EXPECTED_REQUEST_HASH,
  FACT_SCHEMA_ID,
  OBSERVATION_SCHEMA_ID,
  REQUEST_SCHEMA_ID,
  SCHEMA_IDS,
  conformanceRequest,
  fixedSubjectBindingFixture,
} from '../src/modules/continuity-integration/first-round-contract.js';
import {
  calculateBindingFixtureHash,
  calculateContentHash,
  calculateRequestHash,
  canonicalizeJson,
} from '../src/modules/continuity-integration/first-round-hashing.js';
import { createFirstRoundContinuityRequestService } from '../src/modules/continuity-integration/first-round-request-service.js';
import {
  FIRST_ROUND_SCHEMA_REGISTRY,
} from '../src/modules/continuity-integration/first-round-schema-registry.js';
import {
  validateFirstRoundRequest,
  validateFixedSubjectBindingFixture,
} from '../src/modules/continuity-integration/first-round-validator.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

const FIXED_TIME = '2026-07-30T00:00:00Z';

function firstRoundInput(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function seedFirstRoundPlatformFacts(connection) {
  connection.prepare(`
    INSERT INTO users (
      user_id, primary_email, display_name, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?)
  `).run('user-001', 'first-round@example.com', 'First Round User', FIXED_TIME, FIXED_TIME);
  connection.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, '{}', 'active', ?, ?)
  `).run('assistant-001', 'user-001', 'First Round Assistant', FIXED_TIME, FIXED_TIME);
  connection.prepare(`
    INSERT INTO conversations (
      conversation_id, user_id, subject_id, title, status,
      created_at, updated_at, last_activity_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    'conversation-001',
    'user-001',
    'assistant-001',
    'First round conversation',
    FIXED_TIME,
    FIXED_TIME,
    FIXED_TIME,
  );
  connection.prepare(`
    INSERT INTO messages (
      message_id, user_id, subject_id, conversation_id, sender_type,
      status, sequence_number, current_version_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'user', 'active', 1, NULL, ?, ?)
  `).run(
    'message-001',
    'user-001',
    'assistant-001',
    'conversation-001',
    FIXED_TIME,
    FIXED_TIME,
  );
  connection.prepare(`
    INSERT INTO message_versions (
      message_version_id, user_id, subject_id, conversation_id, message_id,
      version_number, sender_type, change_reason, content, parent_version_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'user', 'original', 'hello', NULL, ?)
  `).run(
    'message-version-001',
    'user-001',
    'assistant-001',
    'conversation-001',
    'message-001',
    FIXED_TIME,
  );
  connection.prepare(`
    UPDATE messages SET current_version_id = ?
    WHERE user_id = ? AND subject_id = ? AND conversation_id = ? AND message_id = ?
  `).run(
    'message-version-001',
    'user-001',
    'assistant-001',
    'conversation-001',
    'message-001',
  );
  connection.prepare(`
    INSERT INTO events (
      event_id, user_id, subject_id, event_type, source_type, source_ref,
      occurred_at, recorded_at, event_data_json, summary, status
    ) VALUES (?, ?, ?, 'message_created', 'message-service', ?, ?, ?, ?, ?, 'pending')
  `).run(
    'event-001',
    'user-001',
    'assistant-001',
    'message-001',
    FIXED_TIME,
    FIXED_TIME,
    JSON.stringify({
      conversationId: 'conversation-001',
      messageId: 'message-001',
      messageVersionId: 'message-version-001',
      senderType: 'user',
    }),
    'A conversation message was created.',
  );
}

function createHarness(databasePath, clock = () => new Date(FIXED_TIME)) {
  const config = loadConfig({ VIO_BACKEND_DB_PATH: databasePath });
  const database = createSqliteDatabase(config);
  const connection = database.connection;
  const continuityRepository = createSqliteContinuityIntegrationRepository(connection);
  const service = createFirstRoundContinuityRequestService({
    continuityRepository,
    userRepository: createSqliteUserRepository(connection),
    subjectRepository: createSqliteSubjectRepository(connection),
    conversationRepository: createSqliteConversationRepository(connection),
    messageRepository: createSqliteMessageRepository(connection),
    messageVersionRepository: createSqliteMessageVersionRepository(connection),
    eventRepository: createSqliteEventRepository(connection),
    runInTransaction: database.runInTransaction,
    clock,
  });
  return { database, connection, continuityRepository, service };
}

function withSeededHarness(operation) {
  const testDatabase = createTestDatabasePath();
  const harness = createHarness(testDatabase.databasePath);
  seedFirstRoundPlatformFacts(harness.connection);
  try {
    return operation(harness, testDatabase);
  } finally {
    harness.database.close();
    testDatabase.remove();
  }
}

test('three strict local schemas and RFC 8785 hashes match the Engine conformance vector', () => {
  assert.deepEqual(FIRST_ROUND_SCHEMA_REGISTRY.schemaIds, SCHEMA_IDS);
  assert.equal(new Set(SCHEMA_IDS).size, 3);
  assert.ok(SCHEMA_IDS.every((schemaId) => schemaId.startsWith('urn:')));
  const requestSchema = FIRST_ROUND_SCHEMA_REGISTRY.getSchema(REQUEST_SCHEMA_ID);
  const references = new Set([
    requestSchema.properties.platformFactPackage.properties.facts.items.$ref,
    requestSchema.properties.observations.items.$ref,
  ]);
  assert.deepEqual(references, new Set([FACT_SCHEMA_ID, OBSERVATION_SCHEMA_ID]));

  const request = conformanceRequest();
  FIRST_ROUND_SCHEMA_REGISTRY.validate(REQUEST_SCHEMA_ID, request);
  assert.deepEqual(validateFirstRoundRequest(request), request);
  assert.equal(calculateContentHash('hello'), EXPECTED_CONTENT_HASH);
  assert.equal(calculateRequestHash(request), EXPECTED_REQUEST_HASH);
  assert.equal(
    calculateBindingFixtureHash(fixedSubjectBindingFixture()),
    EXPECTED_BINDING_FIXTURE_HASH,
  );

  const reordered = Object.fromEntries(Object.entries(request).reverse());
  reordered.identity = Object.fromEntries(Object.entries(request.identity).reverse());
  assert.deepEqual(canonicalizeJson(reordered), canonicalizeJson(request));
  assert.equal(calculateRequestHash(reordered), EXPECTED_REQUEST_HASH);
});

test('schema and semantic validation reject unknown, state-write, duplicate-body and mismatch input', () => {
  const invalidRequests = [];
  const unknownFieldTargets = [
    (request) => request,
    (request) => request.identity,
    (request) => request.conversation,
    (request) => request.platformFactPackage,
    (request) => request.platformFactPackage.facts[0],
    (request) => request.platformFactPackage.facts[0].identity,
    (request) => request.observations[0],
    (request) => request.observations[0].identity,
    (request) => request.observations[0].messageVersionRef,
    (request) => request.constraints,
  ];
  for (const selectTarget of unknownFieldTargets) {
    const request = conformanceRequest();
    selectTarget(request).unknown = true;
    invalidRequests.push(request);
  }
  const duplicateBody = conformanceRequest();
  duplicateBody.observations[0].content = 'hello';
  invalidRequests.push(duplicateBody);
  const identityMismatch = conformanceRequest();
  identityMismatch.observations[0].identity.subjectId = 'subject-002';
  invalidRequests.push(identityMismatch);
  const conversationMismatch = conformanceRequest();
  conversationMismatch.platformFactPackage.facts[0].messageId = 'message-002';
  invalidRequests.push(conversationMismatch);
  const observationMismatch = conformanceRequest();
  observationMismatch.platformFactPackage.observationRefs = ['observation-002'];
  invalidRequests.push(observationMismatch);
  const contentHashMismatch = conformanceRequest();
  contentHashMismatch.platformFactPackage.facts[0].contentHash = `sha256:${'0'.repeat(64)}`;
  invalidRequests.push(contentHashMismatch);
  const requestHashMismatch = conformanceRequest();
  requestHashMismatch.requestHash = `sha256:${'0'.repeat(64)}`;
  invalidRequests.push(requestHashMismatch);

  for (const request of invalidRequests) {
    assert.throws(() => validateFirstRoundRequest(request), ValidationError);
  }
  assert.throws(
    () => FIRST_ROUND_SCHEMA_REGISTRY.getSchema('https://example.com/remote.schema.json'),
    /not registered locally/,
  );
  for (const field of [
    'mutation',
    'StateMutation',
    'impact_scope',
    'field_path',
    'operation',
    'before_state',
    'after_state',
    'state_patch',
    'state_snapshot',
    'SubjectStatePatch',
  ]) {
    const request = conformanceRequest();
    request.constraints[field] = {};
    assert.throws(
      () => validateFirstRoundRequest(request),
      /State-write field is forbidden/,
    );
  }
});

test('fixed SubjectBinding rejects every field, version or status change', () => {
  const fixture = fixedSubjectBindingFixture();
  assert.deepEqual(
    validateFixedSubjectBindingFixture(fixture, EXPECTED_BINDING_FIXTURE_HASH),
    fixture,
  );
  const changes = {
    schemaVersion: 'subject-binding/first-round-v2',
    bindingId: 'binding-002',
    userId: 'user-002',
    assistantId: 'assistant-002',
    subjectId: 'subject-002',
    bindingVersion: 2,
    status: 'revoked',
    createdAt: '2026-07-30T00:00:01Z',
    effectiveAt: '2026-07-30T00:00:01Z',
    replacedBindingId: 'binding-000',
  };
  for (const [field, value] of Object.entries(changes)) {
    const changed = structuredClone(fixture);
    changed[field] = value;
    assert.notEqual(calculateBindingFixtureHash(changed), EXPECTED_BINDING_FIXTURE_HASH);
    assert.throws(
      () => validateFixedSubjectBindingFixture(
        changed,
        calculateBindingFixtureHash(changed),
      ),
      ValidationError,
    );
  }
});

test('Vio constructs and persists the exact first-round logical request without sending it', () => {
  withSeededHarness(({ service, connection }) => {
    const binding = service.prepareFixedBindingFixtureForTests();
    assert.equal(binding.bindingFixtureHash, EXPECTED_BINDING_FIXTURE_HASH);
    const request = service.constructAndStoreRequest(firstRoundInput());
    assert.deepEqual(request, conformanceRequest());
    assert.equal(request.requestHash, EXPECTED_REQUEST_HASH);
    assert.equal(request.platformFactPackage.facts[0].contentHash, EXPECTED_CONTENT_HASH);
    assert.equal(request.observations[0].content, undefined);
    assert.equal(
      connection.prepare('SELECT COUNT(*) AS count FROM continuity_first_round_requests').get().count,
      1,
    );
    assert.deepEqual(service.getStoredRequest('request-001'), request);
  });
});

test('same request retry and process restart recover the first requestId, time and hash', () => {
  const testDatabase = createTestDatabasePath();
  let harness = createHarness(testDatabase.databasePath);
  try {
    seedFirstRoundPlatformFacts(harness.connection);
    harness.service.prepareFixedBindingFixtureForTests();
    const first = harness.service.constructAndStoreRequest(firstRoundInput());
    const retried = harness.service.constructAndStoreRequest(firstRoundInput());
    assert.deepEqual(retried, first);
    harness.database.close();

    harness = createHarness(
      testDatabase.databasePath,
      () => new Date('2026-07-30T12:34:56Z'),
    );
    const binding = harness.service.prepareFixedBindingFixtureForTests();
    const restarted = harness.service.constructAndStoreRequest(firstRoundInput());
    assert.deepEqual(restarted, first);
    assert.equal(restarted.createdAt, FIXED_TIME);
    assert.equal(restarted.requestHash, EXPECTED_REQUEST_HASH);
    assert.equal(binding.loadedAt, FIXED_TIME);
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_first_round_requests',
      ).get().count,
      1,
    );
    assert.throws(
      () => harness.service.constructAndStoreRequest(
        firstRoundInput({ factId: 'fact-different' }),
      ),
      ConflictError,
    );
  } finally {
    harness.database.close();
    testDatabase.remove();
  }
});

test('construction enforces Vio ownership and exact source provenance', () => {
  const invalidInputs = [
    { userId: 'user-002' },
    { assistantId: 'assistant-002' },
    { conversationId: 'conversation-002' },
    { messageId: 'message-002' },
    { messageVersionId: 'message-version-002' },
    { sourceEventId: 'event-002' },
  ];
  for (const overrides of invalidInputs) {
    withSeededHarness(({ service }) => {
      service.prepareFixedBindingFixtureForTests();
      assert.throws(() => service.constructAndStoreRequest(firstRoundInput(overrides)));
    });
  }
  withSeededHarness(({ service, connection }) => {
    service.prepareFixedBindingFixtureForTests();
    connection.prepare(`
      UPDATE events SET event_data_json = ? WHERE event_id = 'event-001'
    `).run(JSON.stringify({
      conversationId: 'conversation-001',
      messageId: 'message-001',
      messageVersionId: 'message-version-wrong',
      senderType: 'user',
    }));
    assert.throws(
      () => service.constructAndStoreRequest(firstRoundInput()),
      /matching Vio message_created source fact/,
    );
  });
});

test('construction creates no Event, StateMutation, SubjectState advance or external call', () => {
  withSeededHarness(({ service, connection }) => {
    service.prepareFixedBindingFixtureForTests();
    const eventCount = connection.prepare('SELECT COUNT(*) AS count FROM events').get().count;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('network access is forbidden');
    };
    try {
      const request = service.constructAndStoreRequest(firstRoundInput());
      const serialized = JSON.stringify(request);
      for (const forbidden of [
        'StateMutation',
        'statePatch',
        'stateSnapshot',
        'beforeState',
        'afterState',
      ]) {
        assert.equal(serialized.includes(forbidden), false);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(connection.prepare('SELECT COUNT(*) AS count FROM events').get().count, eventCount);
    assert.equal(connection.prepare('SELECT COUNT(*) AS count FROM subject_states').get().count, 0);
    assert.equal(connection.prepare('SELECT COUNT(*) AS count FROM subject_state_heads').get().count, 0);
  });
});

test('migration stores only immutable V1 Binding and request input records', () => {
  withSeededHarness(({ service, connection }) => {
    service.prepareFixedBindingFixtureForTests();
    service.constructAndStoreRequest(firstRoundInput());
    assert.equal(
      connection.prepare(`
        SELECT COUNT(*) AS count FROM schema_migrations
        WHERE version = '018_create_continuity_v1_contract_foundation.sql'
      `).get().count,
      1,
    );
    const requestColumns = connection.prepare(
      'PRAGMA table_info(continuity_first_round_requests)',
    ).all().map((column) => column.name);
    for (const absent of ['operation_id', 'response_json', 'state_projection_json']) {
      assert.equal(requestColumns.includes(absent), false);
    }
    assert.throws(
      () => connection.prepare(`
        UPDATE continuity_first_round_binding_fixtures SET status = 'active'
      `).run(),
      /SubjectBinding fixture is immutable/,
    );
    assert.throws(
      () => connection.prepare(`
        UPDATE continuity_first_round_requests SET expected_engine_revision = 1
      `).run(),
      /continuity requests are immutable/,
    );
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(), []);
  });
});
