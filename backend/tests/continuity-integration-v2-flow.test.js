import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { ConflictError, ValidationError } from '../src/core/errors.js';
import { loadConfig } from '../src/config.js';
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
} from '../src/modules/continuity-integration/first-round-hashing.js';
import { createFirstRoundContinuityRequestService } from '../src/modules/continuity-integration/first-round-request-service.js';
import { createFirstRoundContinuityResultService } from '../src/modules/continuity-integration/first-round-result-service.js';
import {
  FIRST_ROUND_ERROR_RULES,
} from '../src/modules/continuity-integration/first-round-result-contract.js';
import {
  validateFirstRoundEngineEnvelope,
  validateFirstRoundErrorEnvelope,
  validateFirstRoundSuccessResult,
} from '../src/modules/continuity-integration/first-round-result-validator.js';
import { FirstRoundTransportUnavailableError } from '../src/modules/continuity-integration/first-round-transport.js';
import { createFirstRoundFixtureTransport } from '../test-support/first-round-fixture-transport.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

const PLATFORM_TIME = '2026-07-30T00:00:00Z';
const ENGINE_TIME = '2026-07-30T02:00:00Z';
const RECEIVE_TIME = '2026-08-02T00:00:00Z';
const FIXED_STATE_HASH =
  'sha256:178a823481c174ad8ea09fd1ec339f53b751f6f7983c5801610c9438267d96a9';
const FIXED_PROJECTION_HASH =
  'sha256:12fa0c2630886b2df7a4d7e36880ff344bb33943a658a1c0c5d8f13254c79199';

function authoritativeStateFixture(revision = 0, note = null) {
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
    continuity: {
      unfinished_items: [],
      current_focus: note === null ? [] : [note],
      recent_changes: [],
    },
    temporal: {
      created_at: ENGINE_TIME,
      updated_at: ENGINE_TIME,
      last_interaction_at: null,
      lifecycle_events: [],
    },
    intentions: {
      emerging_thoughts: [],
      judgments: [],
      action_tendencies: [],
    },
    emotion_state: {
      interaction_state: '',
      emotions: [],
      continuity_notes: [],
    },
  };
}

function successEnvelope(request, {
  previousRevision = request.expectedEngineRevision,
  currentRevision = previousRevision,
  changed = currentRevision !== previousRevision,
  engineUpdateId = changed ? `update-${request.requestId}` : null,
  operationId = `operation-${request.requestId}`,
  responseId = `response-${request.requestId}`,
  responseContent = 'Deterministic Engine-approved reply.',
  subjectId = request.identity.subjectId,
  bindingId = request.identity.bindingId,
  bindingVersion = request.identity.bindingVersion,
  stateNote = currentRevision === 0 ? null : `revision-${currentRevision}`,
  consumedObservationIds = request.observations.map(({ observationId }) => observationId),
  requestId = request.requestId,
  requestHash = request.requestHash,
} = {}) {
  const state = authoritativeStateFixture(currentRevision, stateNote);
  state.subject_id = subjectId;
  const snapshot = {
    schemaVersion: 1,
    subjectId,
    revision: currentRevision,
    stateHash: calculateStateHash(state),
  };
  return {
    contractVersion: 'continuity-integration/v1.1',
    requestId,
    requestHash,
    operationId,
    status: 'completed',
    subjectId,
    bindingId,
    bindingVersion,
    response: {
      responseId,
      role: 'subject',
      content: responseContent,
    },
    stateProjection: {
      schemaVersion: 'engine-subject-state-projection/first-round-v1',
      subjectId,
      bindingId,
      bindingVersion,
      previousRevision,
      currentRevision,
      changed,
      engineUpdateId,
      snapshot,
      contentHash: calculateProjectionContentHash(snapshot),
    },
    consumedObservationIds,
    completedAt: ENGINE_TIME,
  };
}

function errorEnvelope(request, code, { currentEngineRevision = null } = {}) {
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
      currentEngineRevision,
      currentBindingVersion: null,
    },
  };
}

function seedFirstRoundPlatformFacts(connection) {
  connection.prepare(`
    INSERT INTO users (
      user_id, primary_email, display_name, status, created_at, updated_at
    ) VALUES ('user-001', 'v2@example.com', 'V2 User', 'active', ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES ('assistant-001', 'user-001', 'V2 Assistant', NULL, '{}', 'active', ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO conversations (
      conversation_id, user_id, subject_id, title, status,
      created_at, updated_at, last_activity_at
    ) VALUES (
      'conversation-001', 'user-001', 'assistant-001', 'V2 conversation',
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
      'message-001', 1, 'user', 'original', 'hello', NULL, ?
    )
  `).run(PLATFORM_TIME);
  connection.prepare(`
    UPDATE messages SET current_version_id = 'message-version-001'
    WHERE message_id = 'message-001'
  `).run();
  insertSourceEvent(connection, '001');
}

function insertSourceEvent(connection, suffix) {
  const eventId = `event-${suffix}`;
  connection.prepare(`
    INSERT INTO events (
      event_id, user_id, subject_id, event_type, source_type, source_ref,
      occurred_at, recorded_at, event_data_json, summary, status
    ) VALUES (?, 'user-001', 'assistant-001', 'message_created',
      'message-service', 'message-001', ?, ?, ?, ?, 'pending')
  `).run(
    eventId,
    PLATFORM_TIME,
    PLATFORM_TIME,
    JSON.stringify({
      conversationId: 'conversation-001',
      messageId: 'message-001',
      messageVersionId: 'message-version-001',
      senderType: 'user',
    }),
    'A conversation message was created.',
  );
}

function createHarness(databasePath, {
  transport,
  faultInjector = null,
  decorateResultRepository = null,
} = {}) {
  const config = loadConfig({ VIO_BACKEND_DB_PATH: databasePath });
  const database = createSqliteDatabase(config);
  const connection = database.connection;
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
  const baseResultRepository = createSqliteContinuityResultRepository(connection);
  const resultRepository = decorateResultRepository
    ? decorateResultRepository(baseResultRepository)
    : baseResultRepository;
  const resultService = createFirstRoundContinuityResultService({
    requestService,
    resultRepository,
    runInTransaction: database.runInTransaction,
    transport,
    clock: () => new Date(RECEIVE_TIME),
    faultInjector,
  });
  return {
    database,
    connection,
    requestService,
    resultRepository,
    resultService,
  };
}

function prepareStoredRequest(harness, {
  suffix = '001',
  requestId = `request-${suffix}`,
  expectedEngineRevision = 0,
} = {}) {
  if (suffix !== '001') insertSourceEvent(harness.connection, suffix);
  harness.requestService.prepareFixedBindingFixtureForTests();
  return harness.requestService.constructAndStoreRequest({
    requestId,
    userId: 'user-001',
    assistantId: 'assistant-001',
    conversationId: 'conversation-001',
    messageId: 'message-001',
    messageVersionId: 'message-version-001',
    observationId: `observation-${suffix}`,
    sourceEventId: `event-${suffix}`,
    factId: `fact-${suffix}`,
    expectedEngineRevision,
  });
}

function withHarness(operation, options = {}) {
  const testDatabase = createTestDatabasePath();
  const harness = createHarness(testDatabase.databasePath, options);
  seedFirstRoundPlatformFacts(harness.connection);
  try {
    return operation(harness, testDatabase);
  } finally {
    harness.database.close();
    testDatabase.remove();
  }
}

test('success model is exact and independently verifies state and projection hashes', () => {
  const request = {
    requestId: 'request-001',
    requestHash: `sha256:${'1'.repeat(64)}`,
    expectedEngineRevision: 0,
    identity: { subjectId: 'subject-001', bindingId: 'binding-001', bindingVersion: 1 },
    observations: [{ observationId: 'observation-001' }],
  };
  const envelope = successEnvelope(request);
  assert.deepEqual(validateFirstRoundSuccessResult(envelope), envelope);
  assert.equal(calculateStateHash(authoritativeStateFixture()), FIXED_STATE_HASH);
  assert.equal(envelope.stateProjection.snapshot.stateHash, FIXED_STATE_HASH);
  assert.equal(calculateProjectionContentHash(envelope.stateProjection.snapshot), FIXED_PROJECTION_HASH);
  assert.equal(envelope.stateProjection.contentHash, FIXED_PROJECTION_HASH);

  for (const mutate of [
    (value) => { value.unknown = true; },
    (value) => { value.response.response_id = value.response.responseId; },
    (value) => { value.stateProjection.delta = {}; },
    (value) => { value.stateProjection.snapshot.state = {}; },
    (value) => { value.stateProjection.engineUpdateId = 'update-illegal'; },
    (value) => { value.stateProjection.contentHash = `sha256:${'0'.repeat(64)}`; },
  ]) {
    const invalid = structuredClone(envelope);
    mutate(invalid);
    assert.throws(() => validateFirstRoundSuccessResult(invalid), ValidationError);
  }
});

test('the four exact error envelopes reject aliases, old codes and information leaks', () => {
  const request = { requestId: 'request-errors' };
  for (const code of Object.keys(FIRST_ROUND_ERROR_RULES)) {
    const revision = code === 'REVISION_CONFLICT' ? 3 : null;
    const envelope = errorEnvelope(request, code, { currentEngineRevision: revision });
    assert.deepEqual(validateFirstRoundErrorEnvelope(envelope), envelope);
  }
  for (const mutate of [
    (value) => { value.error.code = 'IDEMPOTENCY_CONFLICT'; },
    (value) => { value.error.retryClass = 'retry'; },
    (value) => { value.error.currentBindingVersion = 1; },
    (value) => { value.error.currentEngineRevision = 0; },
    (value) => { value.error.errorCode = value.error.code; },
    (value) => { value.unknown = true; },
  ]) {
    const invalid = errorEnvelope(request, 'SCHEMA_INVALID');
    mutate(invalid);
    assert.throws(() => validateFirstRoundErrorEnvelope(invalid), ValidationError);
  }
  const revisionWithoutCurrent = errorEnvelope(request, 'REVISION_CONFLICT', {
    currentEngineRevision: 2,
  });
  revisionWithoutCurrent.error.currentEngineRevision = null;
  assert.throws(() => validateFirstRoundErrorEnvelope(revisionWithoutCurrent));
});

test('test-only transport receives the first persisted V1 request byte-for-byte logically', () => {
  let transport;
  withHarness((harness) => {
    const request = prepareStoredRequest(harness);
    const result = harness.resultService.submitStoredRequest(request.requestId);
    assert.equal(result.processingStage, 'completed');
    assert.equal(transport.callCount, 1);
    assert.deepEqual(transport.receivedRequests[0], request);
    assert.equal(transport.receivedRequests[0].createdAt, PLATFORM_TIME);
    assert.equal(transport.receivedRequests[0].requestHash, request.requestHash);
  }, {
    transport: transport = createFirstRoundFixtureTransport(
      (request) => successEnvelope(request),
    ),
  });
});

test('unconfigured transport fails explicitly and no production-style transport can be injected', () => {
  withHarness((harness) => {
    const request = prepareStoredRequest(harness);
    assert.throws(
      () => harness.resultService.submitStoredRequest(request.requestId),
      FirstRoundTransportUnavailableError,
    );
    assert.equal(
      harness.connection.prepare('SELECT COUNT(*) AS count FROM continuity_first_round_results')
        .get().count,
      0,
    );
  });
  assert.throws(() => createFirstRoundContinuityResultService({
    requestService: {},
    resultRepository: {},
    runInTransaction: (operation) => operation(),
    transport: { mode: 'network', testOnly: false, submit() {} },
  }), /test-only/);
});

test('first changed=false initializes the confirmed revision zero head atomically', () => {
  withHarness((harness) => {
    const request = prepareStoredRequest(harness);
    const result = harness.resultService.receiveResult(
      request.requestId,
      successEnvelope(request),
    );
    assert.equal(result.processingStage, 'completed');
    const head = harness.resultService.getProjectionHead('subject-001');
    assert.equal(head.currentRevision, 0);
    assert.equal(head.currentRequestId, request.requestId);
    assert.equal(
      harness.connection.prepare('SELECT COUNT(*) AS count FROM subject_states').get().count,
      0,
    );
    assert.equal(
      harness.connection.prepare('SELECT COUNT(*) AS count FROM subject_state_heads').get().count,
      0,
    );
    const stored = harness.resultRepository.findResultByRequestId(request.requestId);
    assert.equal(stored.receiveStatus, 'received');
    assert.equal(stored.validationStatus, 'validated');
    assert.equal(stored.saveStatus, 'persisted');
    assert.equal(stored.publicationStatus, 'not_published');
  });
});

test('replaying the first changed=false result keeps one unchanged revision zero head', () => {
  withHarness((harness) => {
    const request = prepareStoredRequest(harness);
    const envelope = successEnvelope(request);
    const first = harness.resultService.receiveResult(request.requestId, envelope);
    const firstHead = harness.resultService.getProjectionHead('subject-001');
    const replay = harness.resultService.receiveResult(request.requestId, structuredClone(envelope));
    assert.deepEqual(replay, first);
    assert.deepEqual(harness.resultService.getProjectionHead('subject-001'), firstHead);
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_engine_state_projection_versions',
      ).get().count,
      1,
    );
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_engine_state_projection_receipts',
      ).get().count,
      1,
    );
  });
});

test('changed=true advances the projection pointer exactly once and replays without transport', () => {
  let transport;
  withHarness((harness) => {
    const baseline = prepareStoredRequest(harness);
    harness.resultService.receiveResult(baseline.requestId, successEnvelope(baseline));
    const request = prepareStoredRequest(harness, { suffix: '002' });
    const first = harness.resultService.submitStoredRequest(request.requestId);
    const second = harness.resultService.submitStoredRequest(request.requestId);
    assert.deepEqual(second, first);
    assert.equal(transport.callCount, 1);
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_engine_state_projection_receipts',
      ).get().count,
      2,
    );
  }, {
    transport: transport = createFirstRoundFixtureTransport(
      (request) => successEnvelope(request, {
        currentRevision: 1,
        changed: true,
        engineUpdateId: 'engine-update-001',
      }),
    ),
  });
});

test('content hash mismatch is rejected and recorded without a projection or pointer', () => {
  withHarness((harness) => {
    const request = prepareStoredRequest(harness);
    const invalid = successEnvelope(request);
    invalid.stateProjection.snapshot.stateHash = `sha256:${'9'.repeat(64)}`;
    assert.throws(
      () => harness.resultService.receiveResult(request.requestId, invalid),
      ValidationError,
    );
    assert.equal(harness.resultService.getResultIncidents(request.requestId).length, 1);
    assert.equal(harness.resultService.getProjectionHead('subject-001'), null);
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_engine_state_projection_versions',
      ).get().count,
      0,
    );
  });
});

test('request, hash, subject, binding and observation mismatches are quarantined', () => {
  const variants = [
    { reason: 'request_id_mismatch', options: { requestId: 'request-other' } },
    { reason: 'request_hash_mismatch', options: { requestHash: `sha256:${'8'.repeat(64)}` } },
    { reason: 'subject_mismatch', options: { subjectId: 'subject-other' } },
    { reason: 'binding_mismatch', options: { bindingId: 'binding-other' } },
    { reason: 'consumed_observation_mismatch', options: { consumedObservationIds: ['other'] } },
  ];
  for (const variant of variants) {
    withHarness((harness) => {
      const request = prepareStoredRequest(harness);
      const outcomeValue = harness.resultService.receiveResult(
        request.requestId,
        successEnvelope(request, variant.options),
      );
      assert.equal(outcomeValue.processingStage, 'quarantined');
      assert.equal(outcomeValue.reasonCode, variant.reason);
      assert.equal(harness.resultService.getProjectionHead('subject-001'), null);
    });
  }
  withHarness((harness) => {
    const request = prepareStoredRequest(harness);
    const invalidVersion = successEnvelope(request);
    invalidVersion.bindingVersion = 2;
    invalidVersion.stateProjection.bindingVersion = 2;
    assert.throws(
      () => harness.resultService.receiveResult(request.requestId, invalidVersion),
      ValidationError,
    );
    assert.equal(
      harness.resultService.getResultIncidents(request.requestId)[0].reasonCode,
      'engine_envelope_invalid',
    );
  });
});

test('same result replay is idempotent and a different result cannot overwrite it', () => {
  withHarness((harness) => {
    const request = prepareStoredRequest(harness);
    const envelope = successEnvelope(request);
    const first = harness.resultService.receiveResult(request.requestId, envelope);
    const replay = harness.resultService.receiveResult(
      request.requestId,
      structuredClone(envelope),
    );
    assert.deepEqual(replay, first);
    const different = successEnvelope(request, { responseContent: 'Different result.' });
    assert.throws(
      () => harness.resultService.receiveResult(request.requestId, different),
      ConflictError,
    );
    assert.throws(
      () => harness.resultService.receiveResult(
        request.requestId,
        errorEnvelope(request, 'SCHEMA_INVALID'),
      ),
      ConflictError,
    );
    assert.equal(harness.resultService.getResultIncidents(request.requestId).length, 2);
    assert.deepEqual(
      harness.resultRepository.findResultByRequestId(request.requestId).envelope,
      envelope,
    );
  });
});

test('operationId and responseId conflicts are quarantined without changing the head', () => {
  withHarness((harness) => {
    const firstRequest = prepareStoredRequest(harness);
    const firstEnvelope = successEnvelope(firstRequest);
    harness.resultService.receiveResult(firstRequest.requestId, firstEnvelope);
    const firstHead = harness.resultService.getProjectionHead('subject-001');
    for (const [suffix, options, reasonCode] of [
      ['002', { operationId: firstEnvelope.operationId }, 'operation_id_conflict'],
      ['003', { responseId: firstEnvelope.response.responseId }, 'response_id_conflict'],
    ]) {
      const request = prepareStoredRequest(harness, { suffix });
      const isolated = harness.resultService.receiveResult(
        request.requestId,
        successEnvelope(request, options),
      );
      assert.equal(isolated.processingStage, 'quarantined');
      assert.equal(isolated.reasonCode, reasonCode);
      assert.equal(isolated.publicationStatus, 'not_published');
      assert.deepEqual(harness.resultService.getProjectionHead('subject-001'), firstHead);
    }
  });
});

test('same subject revision and content is shared by multiple request receipts', () => {
  withHarness((harness) => {
    const firstRequest = prepareStoredRequest(harness);
    harness.resultService.receiveResult(firstRequest.requestId, successEnvelope(firstRequest));
    const secondRequest = prepareStoredRequest(harness, {
      suffix: '002',
      expectedEngineRevision: 0,
    });
    const second = harness.resultService.receiveResult(
      secondRequest.requestId,
      successEnvelope(secondRequest),
    );
    assert.equal(second.processingStage, 'completed');
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_engine_state_projection_versions',
      ).get().count,
      1,
    );
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_engine_state_projection_receipts',
      ).get().count,
      2,
    );
    const head = harness.resultService.getProjectionHead('subject-001');
    assert.equal(head.currentRevision, 0);
    assert.equal(head.currentRequestId, firstRequest.requestId);
  });
});

test('changed=false at an existing revision never replaces or advances the head', () => {
  withHarness((harness) => {
    const baseline = prepareStoredRequest(harness);
    harness.resultService.receiveResult(baseline.requestId, successEnvelope(baseline));
    const changedRequest = prepareStoredRequest(harness, { suffix: '002' });
    harness.resultService.receiveResult(changedRequest.requestId, successEnvelope(changedRequest, {
      currentRevision: 1,
      changed: true,
      engineUpdateId: 'engine-update-001',
    }));
    const advancedHead = harness.resultService.getProjectionHead('subject-001');
    const unchangedRequest = prepareStoredRequest(harness, {
      suffix: '003',
      expectedEngineRevision: 1,
    });
    const unchanged = harness.resultService.receiveResult(
      unchangedRequest.requestId,
      successEnvelope(unchangedRequest),
    );
    assert.equal(unchanged.processingStage, 'completed');
    assert.deepEqual(harness.resultService.getProjectionHead('subject-001'), advancedHead);
    assert.equal(advancedHead.currentRevision, 1);
    assert.equal(advancedHead.currentRequestId, changedRequest.requestId);
  });
});

test('a missing head rejects non-zero or changed projection initialization', () => {
  for (const variant of [
    { expectedEngineRevision: 1 },
    {
      expectedEngineRevision: 0,
      envelope: { currentRevision: 1, changed: true, engineUpdateId: 'engine-update-gap' },
    },
  ]) {
    withHarness((harness) => {
      const request = prepareStoredRequest(harness, {
        expectedEngineRevision: variant.expectedEngineRevision,
      });
      const isolated = harness.resultService.receiveResult(
        request.requestId,
        successEnvelope(request, variant.envelope),
      );
      assert.equal(isolated.processingStage, 'reconciling');
      assert.equal(
        isolated.reasonCode,
        'missing_head_requires_revision_zero_initialization',
      );
      assert.equal(harness.resultService.getProjectionHead('subject-001'), null);
    });
  }
});

test('same revision with different state or projection content enters reconciling', () => {
  withHarness((harness) => {
    const firstRequest = prepareStoredRequest(harness);
    harness.resultService.receiveResult(firstRequest.requestId, successEnvelope(firstRequest));
    const secondRequest = prepareStoredRequest(harness, { suffix: '002' });
    const conflict = harness.resultService.receiveResult(
      secondRequest.requestId,
      successEnvelope(secondRequest, { stateNote: 'conflicting same revision' }),
    );
    assert.equal(conflict.processingStage, 'reconciling');
    assert.equal(conflict.reasonCode, 'same_revision_state_hash_conflict');
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 0);
  });
});

test('a non-null engineUpdateId cannot bind to a different projection', () => {
  withHarness((harness) => {
    const baseline = prepareStoredRequest(harness);
    harness.resultService.receiveResult(baseline.requestId, successEnvelope(baseline));
    const firstRequest = prepareStoredRequest(harness, { suffix: '002' });
    harness.resultService.receiveResult(firstRequest.requestId, successEnvelope(firstRequest, {
      currentRevision: 1,
      changed: true,
      engineUpdateId: 'engine-update-shared',
    }));
    const secondRequest = prepareStoredRequest(harness, {
      suffix: '003',
      expectedEngineRevision: 1,
    });
    const conflict = harness.resultService.receiveResult(
      secondRequest.requestId,
      successEnvelope(secondRequest, {
        currentRevision: 2,
        changed: true,
        engineUpdateId: 'engine-update-shared',
      }),
    );
    assert.equal(conflict.processingStage, 'reconciling');
    assert.equal(conflict.reasonCode, 'engine_update_id_conflict');
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);
  });
});

test('old and skipped revisions stay isolated and never advance the pointer', () => {
  withHarness((harness) => {
    const baseline = prepareStoredRequest(harness);
    harness.resultService.receiveResult(baseline.requestId, successEnvelope(baseline));
    const initial = prepareStoredRequest(harness, { suffix: '002' });
    harness.resultService.receiveResult(initial.requestId, successEnvelope(initial, {
      currentRevision: 1,
      changed: true,
      engineUpdateId: 'engine-update-001',
    }));
    const oldRequest = prepareStoredRequest(harness, {
      suffix: '003',
      expectedEngineRevision: 0,
    });
    const old = harness.resultService.receiveResult(
      oldRequest.requestId,
      successEnvelope(oldRequest),
    );
    assert.equal(old.reasonCode, 'old_revision');

    const gapRequest = prepareStoredRequest(harness, {
      suffix: '004',
      expectedEngineRevision: 2,
    });
    const gap = harness.resultService.receiveResult(
      gapRequest.requestId,
      successEnvelope(gapRequest, { currentRevision: 2 }),
    );
    assert.equal(gap.reasonCode, 'revision_gap');
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);
  });
});

test('four Engine errors persist exact terminal handling without automatic retry', () => {
  withHarness((harness) => {
    const codes = Object.keys(FIRST_ROUND_ERROR_RULES);
    codes.forEach((code, index) => {
      const suffix = String(index + 1).padStart(3, '0');
      const request = prepareStoredRequest(harness, { suffix });
      const result = harness.resultService.receiveResult(
        request.requestId,
        errorEnvelope(request, code, {
          currentEngineRevision: code === 'REVISION_CONFLICT' ? 4 : null,
        }),
      );
      assert.equal(result.processingStage, 'terminal_error');
      assert.equal(
        result.disposition,
        code === 'REVISION_CONFLICT' ? 'reassemble' : 'never',
      );
      assert.equal(result.envelope.requestId, request.requestId);
    });
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_engine_state_projection_versions',
      ).get().count,
      0,
    );
  });
});

test('all four terminal Engine errors recover unchanged after SQLite restart', () => {
  const testDatabase = createTestDatabasePath();
  let harness = createHarness(testDatabase.databasePath);
  const expected = new Map();
  try {
    seedFirstRoundPlatformFacts(harness.connection);
    Object.keys(FIRST_ROUND_ERROR_RULES).forEach((code, index) => {
      const suffix = String(index + 1).padStart(3, '0');
      const request = prepareStoredRequest(harness, { suffix });
      const envelope = errorEnvelope(request, code, {
        currentEngineRevision: code === 'REVISION_CONFLICT' ? 4 : null,
      });
      expected.set(request.requestId, harness.resultService.receiveResult(
        request.requestId,
        envelope,
      ));
    });
    harness.database.close();

    harness = createHarness(testDatabase.databasePath);
    for (const [requestId, outcomeValue] of expected) {
      const recovered = harness.resultService.submitStoredRequest(requestId);
      assert.deepEqual(recovered, outcomeValue);
      assert.equal(recovered.processingStage, 'terminal_error');
      assert.equal(recovered.envelope.operationId, null);
    }
    const firstRequest = harness.requestService.getStoredRequest('request-001');
    assert.throws(
      () => harness.resultService.receiveResult(
        firstRequest.requestId,
        successEnvelope(firstRequest),
      ),
      ConflictError,
    );
  } finally {
    harness.database.close();
    testDatabase.remove();
  }
});

for (const stage of [
  'after_result_saved',
  'after_projection_saved',
  'after_pointer_advanced',
]) {
  test(`SQLite restart recovers after ${stage} without another transport call`, () => {
    const testDatabase = createTestDatabasePath();
    let triggered = false;
    const transport = createFirstRoundFixtureTransport((request) => successEnvelope(request, {
      currentRevision: 1,
      changed: true,
      engineUpdateId: `engine-update-${stage}`,
    }));
    let harness = createHarness(testDatabase.databasePath);
    seedFirstRoundPlatformFacts(harness.connection);
    const baseline = prepareStoredRequest(harness);
    harness.resultService.receiveResult(baseline.requestId, successEnvelope(baseline));
    harness.database.close();

    harness = createHarness(testDatabase.databasePath, {
      transport,
      faultInjector(name) {
        if (name === stage && !triggered) {
          triggered = true;
          throw new Error(`simulated ${stage}`);
        }
      },
    });
    try {
      const request = prepareStoredRequest(harness, { suffix: '002' });
      assert.throws(() => harness.resultService.submitStoredRequest(request.requestId));
      harness.database.close();

      harness = createHarness(testDatabase.databasePath);
      const recovered = harness.resultService.submitStoredRequest(request.requestId);
      assert.equal(recovered.processingStage, 'completed');
      assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);
      assert.equal(transport.callCount, 1);
    } finally {
      harness.database.close();
      testDatabase.remove();
    }
  });
}

for (const stage of ['after_projection_saved', 'after_pointer_advanced']) {
  test(`revision zero head initialization recovers after ${stage}`, () => {
    const testDatabase = createTestDatabasePath();
    let triggered = false;
    const transport = createFirstRoundFixtureTransport((request) => successEnvelope(request));
    let harness = createHarness(testDatabase.databasePath, {
      transport,
      faultInjector(name) {
        if (name === stage && !triggered) {
          triggered = true;
          throw new Error(`simulated initialization ${stage}`);
        }
      },
    });
    try {
      seedFirstRoundPlatformFacts(harness.connection);
      const request = prepareStoredRequest(harness);
      assert.throws(() => harness.resultService.submitStoredRequest(request.requestId));
      const headBeforeRestart = harness.resultService.getProjectionHead('subject-001');
      if (stage === 'after_projection_saved') {
        assert.equal(headBeforeRestart, null);
      } else {
        assert.equal(headBeforeRestart.currentRevision, 0);
      }
      harness.database.close();

      harness = createHarness(testDatabase.databasePath);
      const recovered = harness.resultService.submitStoredRequest(request.requestId);
      assert.equal(recovered.processingStage, 'completed');
      const head = harness.resultService.getProjectionHead('subject-001');
      assert.equal(head.currentRevision, 0);
      assert.equal(head.currentRequestId, request.requestId);
      assert.equal(transport.callCount, 1);
    } finally {
      harness.database.close();
      testDatabase.remove();
    }
  });
}

test('a failed projection transaction leaves no partial projection and can resume', () => {
  const testDatabase = createTestDatabasePath();
  const transport = createFirstRoundFixtureTransport((request) => successEnvelope(request));
  let harness = createHarness(testDatabase.databasePath, {
    transport,
    decorateResultRepository(repository) {
      return Object.freeze({
        ...repository,
        insertReceipt() {
          throw new Error('simulated receipt persistence failure');
        },
      });
    },
  });
  try {
    seedFirstRoundPlatformFacts(harness.connection);
    const request = prepareStoredRequest(harness);
    assert.throws(() => harness.resultService.submitStoredRequest(request.requestId));
    assert.equal(
      harness.connection.prepare(
        'SELECT COUNT(*) AS count FROM continuity_engine_state_projection_versions',
      ).get().count,
      0,
    );
    assert.equal(
      harness.resultRepository.findResultByRequestId(request.requestId).processingStage,
      'received',
    );
    harness.database.close();

    harness = createHarness(testDatabase.databasePath);
    const recovered = harness.resultService.submitStoredRequest(request.requestId);
    assert.equal(recovered.processingStage, 'completed');
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 0);
    assert.equal(transport.callCount, 1);
  } finally {
    harness.database.close();
    testDatabase.remove();
  }
});

test('V2 creates no network call, Engine Event, StateMutation or legacy state update', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('network access is forbidden');
  };
  try {
    withHarness((harness) => {
      const request = prepareStoredRequest(harness);
      const eventCount = harness.connection.prepare('SELECT COUNT(*) AS count FROM events')
        .get().count;
      harness.resultService.receiveResult(request.requestId, successEnvelope(request));
      assert.equal(
        harness.connection.prepare('SELECT COUNT(*) AS count FROM events').get().count,
        eventCount,
      );
      assert.equal(
        harness.connection.prepare('SELECT COUNT(*) AS count FROM subject_states').get().count,
        0,
      );
      assert.equal(
        harness.connection.prepare('SELECT COUNT(*) AS count FROM subject_state_heads')
          .get().count,
        0,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('migration 019 installs fresh and upgrades an existing 018 database', () => {
  const root = mkdtempSync(join(tmpdir(), 'vio-v2-migration-'));
  const pre019 = join(root, 'pre019');
  mkdirSync(pre019);
  const allMigrations = resolve('./migrations');
  let after = null;
  try {
    for (const filename of readdirSync(allMigrations)) {
      if (/^\d+_.+\.sql$/.test(filename) && !filename.startsWith('019_')) {
        cpSync(join(allMigrations, filename), join(pre019, filename));
      }
    }
    const databasePath = join(root, 'existing.sqlite');
    const before = createSqliteDatabase({ databasePath, migrationsPath: pre019 });
    assert.equal(
      before.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      18,
    );
    before.close();
    after = createSqliteDatabase({ databasePath, migrationsPath: allMigrations });
    assert.equal(
      after.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      19,
    );
    assert.equal(
      after.connection.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'continuity_first_round_results',
          'continuity_engine_state_projection_versions',
          'continuity_engine_state_projection_receipts',
          'continuity_engine_state_projection_heads',
          'continuity_first_round_result_incidents'
        )
      `).get().count,
      5,
    );
    assert.equal(
      after.connection.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'index' AND name IN (
          'idx_continuity_first_round_results_operation',
          'idx_continuity_first_round_results_response',
          'idx_continuity_first_round_results_stage',
          'idx_continuity_projection_receipts_engine_update',
          'idx_continuity_projection_receipts_revision',
          'idx_continuity_result_incidents_request_time'
        )
      `).get().count,
      6,
    );
    assert.equal(
      after.connection.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'validate_continuity_result_request_hash',
          'prevent_continuity_result_identity_update',
          'prevent_continuity_result_delete',
          'prevent_continuity_projection_version_update',
          'prevent_continuity_projection_version_delete',
          'prevent_continuity_projection_receipt_update',
          'prevent_continuity_projection_receipt_delete',
          'validate_continuity_projection_head_insert',
          'validate_continuity_projection_head_update',
          'prevent_continuity_projection_head_delete'
        )
      `).get().count,
      10,
    );
    assert.deepEqual(after.connection.prepare('PRAGMA foreign_key_check').all(), []);
    after.close();
    after = null;
  } finally {
    after?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('strict migration constraints and triggers preserve immutable V2 records', () => {
  withHarness((harness) => {
    const request = prepareStoredRequest(harness);
    harness.resultService.receiveResult(request.requestId, successEnvelope(request));
    assert.throws(() => harness.connection.prepare(`
      UPDATE continuity_first_round_results
      SET envelope_json = '{}'
      WHERE request_id = 'request-001'
    `).run(), /result envelope is immutable/);
    assert.throws(() => harness.connection.prepare(`
      UPDATE continuity_engine_state_projection_versions
      SET state_hash = state_hash
      WHERE subject_id = 'subject-001' AND current_revision = 0
    `).run(), /projection versions are immutable/);
    assert.throws(() => harness.connection.prepare(`
      UPDATE continuity_engine_state_projection_heads
      SET current_revision = -1
      WHERE subject_id = 'subject-001'
    `).run());
    assert.deepEqual(harness.connection.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

test('generic envelope validator accepts only exact success or fixed terminal error status', () => {
  const request = {
    requestId: 'request-001',
    requestHash: `sha256:${'1'.repeat(64)}`,
    expectedEngineRevision: 0,
    identity: { subjectId: 'subject-001', bindingId: 'binding-001', bindingVersion: 1 },
    observations: [{ observationId: 'observation-001' }],
  };
  assert.equal(validateFirstRoundEngineEnvelope(successEnvelope(request)).type, 'success');
  assert.equal(
    validateFirstRoundEngineEnvelope(errorEnvelope(request, 'SCHEMA_INVALID')).type,
    'error',
  );
  assert.throws(() => validateFirstRoundEngineEnvelope({ status: 'processing' }));
});
