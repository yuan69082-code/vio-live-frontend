import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ConflictError } from '../src/core/errors.js';
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
  calculateContentHash,
  calculateRequestHash,
} from '../src/modules/continuity-integration/first-round-hashing.js';
import { createFirstRoundContinuityRequestService } from '../src/modules/continuity-integration/first-round-request-service.js';
import { createFirstRoundContinuityResultService } from '../src/modules/continuity-integration/first-round-result-service.js';
import {
  createContinuityJsonlRunnerTransport,
  requireContinuityEngineRepository,
} from '../test-support/continuity-jsonl-runner-transport.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(TEST_DIRECTORY, '..');
const VIO_ROOT = resolve(BACKEND_ROOT, '..');
const ENGINE_ROOT = requireContinuityEngineRepository();
const ENGINE_BASELINE = '7a32a99e60330782c1caf6d6adda5d08d0077a6c';
const PLATFORM_TIME = '2026-07-30T00:00:00Z';
const RECEIVE_TIME = '2026-08-02T00:00:00Z';

function git(...args) {
  return execFileSync('git', ['-c', `safe.directory=${ENGINE_ROOT}`, ...args], {
    cwd: ENGINE_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function scalar(connection, sql, ...parameters) {
  return connection.prepare(sql).get(...parameters).value;
}

function createHarness(databasePath) {
  const database = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: databasePath }));
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
    clock: () => new Date(PLATFORM_TIME),
  });
  const resultRepository = createSqliteContinuityResultRepository(connection);
  const resultService = createFirstRoundContinuityResultService({
    requestService,
    resultRepository,
    runInTransaction: database.runInTransaction,
    clock: () => new Date(RECEIVE_TIME),
  });
  return { database, connection, requestService, resultRepository, resultService };
}

function seedFixedScope(connection) {
  connection.prepare(`
    INSERT INTO users (
      user_id, primary_email, display_name, status, created_at, updated_at
    ) VALUES ('user-001', 'shared@example.com', 'Shared User', 'active', ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES ('assistant-001', 'user-001', 'Shared Assistant', NULL, '{}',
      'active', ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO conversations (
      conversation_id, user_id, subject_id, title, status,
      created_at, updated_at, last_activity_at
    ) VALUES ('conversation-001', 'user-001', 'assistant-001',
      'Shared continuity acceptance', 'active', ?, ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME, PLATFORM_TIME);
}

function insertMessageFact(connection, suffix, content, sequenceNumber) {
  const messageId = `message-${suffix}`;
  const messageVersionId = `message-version-${suffix}`;
  const sourceEventId = `event-${suffix}`;
  connection.prepare(`
    INSERT INTO messages (
      message_id, user_id, subject_id, conversation_id, sender_type,
      status, sequence_number, current_version_id, created_at, updated_at
    ) VALUES (?, 'user-001', 'assistant-001', 'conversation-001', 'user',
      'active', ?, NULL, ?, ?)
  `).run(messageId, sequenceNumber, PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO message_versions (
      message_version_id, user_id, subject_id, conversation_id, message_id,
      version_number, sender_type, change_reason, content, parent_version_id,
      created_at
    ) VALUES (?, 'user-001', 'assistant-001', 'conversation-001', ?,
      1, 'user', 'original', ?, NULL, ?)
  `).run(messageVersionId, messageId, content, PLATFORM_TIME);
  connection.prepare(`
    UPDATE messages SET current_version_id = ? WHERE message_id = ?
  `).run(messageVersionId, messageId);
  connection.prepare(`
    INSERT INTO events (
      event_id, user_id, subject_id, event_type, source_type, source_ref,
      occurred_at, recorded_at, event_data_json, summary, status
    ) VALUES (?, 'user-001', 'assistant-001', 'message_created',
      'message-service', ?, ?, ?, ?, 'A conversation message was created.', 'pending')
  `).run(
    sourceEventId,
    messageId,
    PLATFORM_TIME,
    PLATFORM_TIME,
    JSON.stringify({
      conversationId: 'conversation-001',
      messageId,
      messageVersionId,
      senderType: 'user',
    }),
  );
  return { messageId, messageVersionId, sourceEventId };
}

function prepareRequest(harness, {
  suffix,
  content,
  sequenceNumber,
  expectedEngineRevision,
  requestId = `request-${suffix}`,
}) {
  const references = insertMessageFact(
    harness.connection,
    suffix,
    content,
    sequenceNumber,
  );
  harness.requestService.prepareFixedBindingFixtureForTests();
  return harness.requestService.constructAndStoreRequest({
    requestId,
    userId: 'user-001',
    assistantId: 'assistant-001',
    conversationId: 'conversation-001',
    messageId: references.messageId,
    messageVersionId: references.messageVersionId,
    observationId: `observation-${suffix}`,
    sourceEventId: references.sourceEventId,
    factId: `fact-${suffix}`,
    expectedEngineRevision,
  });
}

function readEngineState(dataDir) {
  const stateDirectory = join(dataDir, 'subject-state');
  const file = readdirSync(stateDirectory)
    .map((name) => join(stateDirectory, name))
    .find((path) => statSync(path).isFile() && path.endsWith('.json'));
  assert.ok(file, 'Engine SubjectState file must exist');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  return {
    state: document.state ?? document,
    updates: document.updates ?? [],
  };
}

function databaseCounts(connection) {
  return {
    results: scalar(connection, 'SELECT COUNT(*) AS value FROM continuity_first_round_results'),
    projections: scalar(
      connection,
      'SELECT COUNT(*) AS value FROM continuity_engine_state_projection_versions',
    ),
    receipts: scalar(
      connection,
      'SELECT COUNT(*) AS value FROM continuity_engine_state_projection_receipts',
    ),
    heads: scalar(
      connection,
      'SELECT COUNT(*) AS value FROM continuity_engine_state_projection_heads',
    ),
    legacyStates: scalar(connection, 'SELECT COUNT(*) AS value FROM subject_states'),
    legacyHeads: scalar(connection, 'SELECT COUNT(*) AS value FROM subject_state_heads'),
  };
}

async function closeRunner(runner) {
  try {
    await runner.close();
  } catch (error) {
    await runner.terminate();
    throw error;
  }
}

test('shared prerequisites pin both clean baselines and parse the same three schemas', () => {
  assert.throws(
    () => requireContinuityEngineRepository(''),
    /CONTINUITY_ENGINE_REPO is required/,
  );
  assert.equal(git('rev-parse', 'HEAD'), ENGINE_BASELINE);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('rev-parse', '@{upstream}'), ENGINE_BASELINE);
  assert.equal(git('status', '--porcelain'), '');

  const names = [
    'continuity-interaction-request.first-round-v1.schema.json',
    'platform-observation.message-created.first-round-v1.schema.json',
    'platform-fact.message-version.first-round-v1.schema.json',
  ];
  for (const name of names) {
    const engineSchema = JSON.parse(readFileSync(join(
      ENGINE_ROOT,
      'src',
      'continuity_engine',
      'interfaces',
      'schemas',
      name,
    ), 'utf8'));
    const vioSchema = JSON.parse(readFileSync(join(
      BACKEND_ROOT,
      'src',
      'modules',
      'continuity-integration',
      'schemas',
      name,
    ), 'utf8'));
    assert.deepEqual(vioSchema, engineSchema, `${name} must be structurally identical`);
  }
});

test('real A/B/C flow persists unchanged, changed and unchanged projections across both restarts', async () => {
  const vio = createTestDatabasePath();
  const engineData = mkdtempSync(join(tmpdir(), 'continuity-shared-engine-'));
  let harness = createHarness(vio.databasePath);
  seedFixedScope(harness.connection);
  let runner = createContinuityJsonlRunnerTransport({ dataDir: engineData });
  try {
    const requestA = prepareRequest(harness, {
      suffix: 'shared-a',
      content: 'hello',
      sequenceNumber: 1,
      expectedEngineRevision: 0,
    });
    const resultA = await runner.submit(harness.requestService.getStoredRequest(requestA.requestId));
    const savedA = harness.resultService.receiveResult(requestA.requestId, resultA);
    assert.equal(savedA.processingStage, 'completed');
    assert.equal(resultA.stateProjection.changed, false);
    assert.equal(resultA.stateProjection.previousRevision, 0);
    assert.equal(resultA.stateProjection.currentRevision, 0);
    assert.equal(resultA.stateProjection.engineUpdateId, null);
    assert.equal(resultA.response.role, 'subject');
    assert.ok(resultA.response.content.length > 0);
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 0);

    const requestB = prepareRequest(harness, {
      suffix: 'shared-b',
      content: 'remember continuity test focus',
      sequenceNumber: 2,
      expectedEngineRevision: 0,
    });
    const resultB = await runner.submit(harness.requestService.getStoredRequest(requestB.requestId));
    const savedB = harness.resultService.receiveResult(requestB.requestId, resultB);
    assert.equal(savedB.processingStage, 'completed');
    assert.equal(resultB.stateProjection.changed, true);
    assert.equal(resultB.stateProjection.previousRevision, 0);
    assert.equal(resultB.stateProjection.currentRevision, 1);
    assert.ok(resultB.stateProjection.engineUpdateId);
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);

    const sameProcessReplay = await runner.submit(
      harness.requestService.getStoredRequest(requestB.requestId),
    );
    assert.deepEqual(sameProcessReplay, resultB);
    assert.deepEqual(
      harness.resultService.receiveResult(requestB.requestId, sameProcessReplay).envelope,
      resultB,
    );
    assert.equal(sameProcessReplay.operationId, resultB.operationId);
    assert.equal(sameProcessReplay.response.responseId, resultB.response.responseId);
    assert.equal(sameProcessReplay.completedAt, resultB.completedAt);

    const requestC = prepareRequest(harness, {
      suffix: 'shared-c',
      content: 'continue with the current focus',
      sequenceNumber: 3,
      expectedEngineRevision: 1,
    });
    const resultC = await runner.submit(harness.requestService.getStoredRequest(requestC.requestId));
    harness.resultService.receiveResult(requestC.requestId, resultC);
    assert.equal(resultC.stateProjection.changed, false);
    assert.equal(resultC.stateProjection.previousRevision, 1);
    assert.equal(resultC.stateProjection.currentRevision, 1);
    assert.equal(resultC.stateProjection.engineUpdateId, null);
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);

    const engineBeforeRestart = readEngineState(engineData);
    assert.equal(engineBeforeRestart.state.revision, 1);
    assert.equal(engineBeforeRestart.updates.length, 1);
    assert.equal(
      engineBeforeRestart.updates[0].update_id,
      resultB.stateProjection.engineUpdateId,
    );
    assert.notEqual(
      engineBeforeRestart.updates[0].event.event_id,
      requestB.observations[0].sourceEventId,
    );
    assert.deepEqual(databaseCounts(harness.connection), {
      results: 3,
      projections: 2,
      receipts: 3,
      heads: 1,
      legacyStates: 0,
      legacyHeads: 0,
    });
    assert.equal(
      scalar(
        harness.connection,
        "SELECT COUNT(*) AS value FROM continuity_first_round_results WHERE publication_status != 'not_published'",
      ),
      0,
    );
    assert.equal(
      scalar(harness.connection, 'SELECT COUNT(*) AS value FROM events'),
      3,
      'Vio must retain only the three source message_created Events',
    );

    await closeRunner(runner);
    harness.database.close();
    runner = createContinuityJsonlRunnerTransport({ dataDir: engineData });
    harness = createHarness(vio.databasePath);
    const persistedB = harness.requestService.getStoredRequest(requestB.requestId);
    const restartReplay = await runner.submit(persistedB);
    assert.deepEqual(restartReplay, resultB);
    assert.deepEqual(
      harness.resultService.receiveResult(requestB.requestId, restartReplay).envelope,
      resultB,
    );
    const submissionCount = runner.submissionCount;
    assert.deepEqual(
      harness.resultService.submitStoredRequest(requestB.requestId).envelope,
      resultB,
    );
    assert.equal(runner.submissionCount, submissionCount, 'local checkpoint must not call Runner');
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);
    assert.deepEqual(databaseCounts(harness.connection), {
      results: 3,
      projections: 2,
      receipts: 3,
      heads: 1,
      legacyStates: 0,
      legacyHeads: 0,
    });
    const engineAfterRestart = readEngineState(engineData);
    assert.equal(engineAfterRestart.state.revision, 1);
    assert.equal(engineAfterRestart.updates.length, 1);
    assert.equal(runner.stderr, '');
  } finally {
    await runner.terminate();
    harness.database.close();
    vio.remove();
    rmSync(engineData, { recursive: true, force: true });
  }
});

test('real Runner errors persist exact terminal semantics without retry or state movement', async () => {
  const vio = createTestDatabasePath();
  const engineData = mkdtempSync(join(tmpdir(), 'continuity-shared-errors-'));
  let harness = createHarness(vio.databasePath);
  seedFixedScope(harness.connection);
  let runner = createContinuityJsonlRunnerTransport({ dataDir: engineData });
  try {
    const requestA = prepareRequest(harness, {
      suffix: 'errors-a', content: 'hello', sequenceNumber: 1, expectedEngineRevision: 0,
    });
    harness.resultService.receiveResult(requestA.requestId, await runner.submit(requestA));
    const requestB = prepareRequest(harness, {
      suffix: 'errors-b',
      content: 'remember continuity test focus',
      sequenceNumber: 2,
      expectedEngineRevision: 0,
    });
    harness.resultService.receiveResult(requestB.requestId, await runner.submit(requestB));
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);

    const schemaRequest = prepareRequest(harness, {
      suffix: 'error-schema', content: 'schema check', sequenceNumber: 3, expectedEngineRevision: 1,
    });
    const schemaCopy = structuredClone(schemaRequest);
    schemaCopy.unknown = true;
    const schemaError = await runner.submit(schemaCopy);
    assert.equal(schemaError.error.code, 'SCHEMA_INVALID');
    assert.equal(schemaError.error.retryClass, 'never');
    assert.equal(schemaError.operationId, null);
    const terminalOutcomes = new Map();
    terminalOutcomes.set(
      schemaRequest.requestId,
      harness.resultService.receiveResult(schemaRequest.requestId, schemaError),
    );
    assert.equal(terminalOutcomes.get(schemaRequest.requestId).processingStage, 'terminal_error');

    const bindingRequest = prepareRequest(harness, {
      suffix: 'error-binding', content: 'binding check', sequenceNumber: 4, expectedEngineRevision: 1,
    });
    const bindingCopy = structuredClone(bindingRequest);
    for (const identity of [
      bindingCopy.identity,
      bindingCopy.observations[0].identity,
      bindingCopy.platformFactPackage.facts[0].identity,
    ]) identity.subjectId = 'subject-not-disclosed';
    bindingCopy.requestHash = calculateRequestHash(bindingCopy);
    const bindingError = await runner.submit(bindingCopy);
    assert.equal(bindingError.error.code, 'SUBJECT_BINDING_MISMATCH');
    assert.equal(bindingError.error.retryClass, 'never');
    assert.equal(bindingError.error.currentEngineRevision, null);
    assert.equal(bindingError.error.currentBindingVersion, null);
    terminalOutcomes.set(
      bindingRequest.requestId,
      harness.resultService.receiveResult(bindingRequest.requestId, bindingError),
    );

    const revisionRequest = prepareRequest(harness, {
      suffix: 'error-revision', content: 'revision check', sequenceNumber: 5, expectedEngineRevision: 0,
    });
    const persistedRevisionRequest = structuredClone(revisionRequest);
    const revisionError = await runner.submit(structuredClone(revisionRequest));
    assert.equal(revisionError.error.code, 'REVISION_CONFLICT');
    assert.equal(revisionError.error.retryClass, 'reassemble');
    assert.equal(revisionError.error.currentEngineRevision, 1);
    assert.equal(revisionError.operationId, null);
    const revisionOutcome = harness.resultService.receiveResult(
      revisionRequest.requestId,
      revisionError,
    );
    terminalOutcomes.set(revisionRequest.requestId, revisionOutcome);
    assert.equal(revisionOutcome.disposition, 'reassemble');
    assert.deepEqual(
      harness.requestService.getStoredRequest(revisionRequest.requestId),
      persistedRevisionRequest,
    );

    const idempotencyRequest = prepareRequest(harness, {
      suffix: 'error-idempotency',
      content: 'idempotency baseline',
      sequenceNumber: 6,
      expectedEngineRevision: 1,
    });
    const firstIdempotentResult = await runner.submit(idempotencyRequest);
    harness.resultService.receiveResult(idempotencyRequest.requestId, firstIdempotentResult);
    const reusedCopy = structuredClone(idempotencyRequest);
    reusedCopy.platformFactPackage.facts[0].content = 'different logical request';
    reusedCopy.platformFactPackage.facts[0].contentHash = calculateContentHash(
      reusedCopy.platformFactPackage.facts[0].content,
    );
    reusedCopy.requestHash = calculateRequestHash(reusedCopy);
    const reusedError = await runner.submit(reusedCopy);
    assert.equal(reusedError.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(reusedError.error.retryClass, 'never');
    assert.throws(
      () => harness.resultService.receiveResult(idempotencyRequest.requestId, reusedError),
      ConflictError,
    );
    assert.deepEqual(
      harness.resultService.getStoredResult(idempotencyRequest.requestId).envelope,
      firstIdempotentResult,
    );
    assert.equal(
      harness.resultService.getResultIncidents(idempotencyRequest.requestId)[0].reasonCode,
      'request_result_overwrite_attempt',
    );
    assert.equal(
      harness.resultService.getResultIncidents(idempotencyRequest.requestId)[0].disposition,
      'quarantined',
    );

    for (const requestId of [
      schemaRequest.requestId,
      bindingRequest.requestId,
      revisionRequest.requestId,
    ]) {
      const stored = harness.resultService.getStoredResult(requestId);
      assert.equal(stored.processingStage, 'terminal_error');
      assert.equal(stored.envelope.operationId, null);
      assert.equal(
        scalar(
          harness.connection,
          'SELECT COUNT(*) AS value FROM continuity_engine_state_projection_receipts WHERE request_id = ?',
          requestId,
        ),
        0,
      );
    }
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);
    assert.equal(readEngineState(engineData).state.revision, 1);
    assert.equal(readEngineState(engineData).updates.length, 1);

    await closeRunner(runner);
    harness.database.close();
    runner = createContinuityJsonlRunnerTransport({ dataDir: engineData });
    harness = createHarness(vio.databasePath);
    const before = runner.submissionCount;
    for (const requestId of [
      schemaRequest.requestId,
      bindingRequest.requestId,
      revisionRequest.requestId,
    ]) {
      assert.deepEqual(
        harness.resultService.submitStoredRequest(requestId),
        terminalOutcomes.get(requestId),
      );
    }
    assert.equal(runner.submissionCount, before);
    assert.equal(harness.resultService.getProjectionHead('subject-001').currentRevision, 1);
  } finally {
    await runner.terminate();
    harness.database.close();
    vio.remove();
    rmSync(engineData, { recursive: true, force: true });
  }
});

test('JSONL transport uses compact UTF-8 lines and keeps normal stdout and stderr clean', async () => {
  const vio = createTestDatabasePath();
  const engineData = mkdtempSync(join(tmpdir(), 'continuity-shared-utf8-'));
  const harness = createHarness(vio.databasePath);
  seedFixedScope(harness.connection);
  const runner = createContinuityJsonlRunnerTransport({ dataDir: engineData });
  try {
    const request = prepareRequest(harness, {
      suffix: 'utf8',
      content: '你好，连续性 🌱',
      sequenceNumber: 1,
      expectedEngineRevision: 0,
    });
    const envelope = await runner.submit(harness.requestService.getStoredRequest(request.requestId));
    harness.resultService.receiveResult(request.requestId, envelope);
    assert.equal(runner.inputLines.length, 1);
    assert.equal(runner.outputLines.length, 1);
    assert.ok(runner.inputLines[0].includes('你好，连续性 🌱'));
    assert.ok(!runner.inputLines[0].includes('\n'));
    assert.ok(!runner.inputLines[0].includes('\r'));
    assert.deepEqual(JSON.parse(runner.inputLines[0]), request);
    assert.deepEqual(JSON.parse(runner.outputLines[0]), envelope);
    await closeRunner(runner);
    assert.equal(runner.stderr, '');
  } finally {
    await runner.terminate();
    harness.database.close();
    vio.remove();
    rmSync(engineData, { recursive: true, force: true });
  }
});

test('Runner process errors, timeouts and illegal output fail explicitly', async () => {
  const cases = [
    {
      name: 'illegal-output',
      source: "import sys\nif hasattr(sys.stdout, 'reconfigure'):\n    sys.stdout.reconfigure(newline='\\n')\nfor _ in sys.stdin:\n    print('not-json', flush=True)\n",
      expected: /stdout line was not valid JSON/,
      timeoutMs: 2_000,
    },
    {
      name: 'stderr-failure',
      source: "import sys\nsys.stderr.write('controlled failure\\n')\nsys.stderr.flush()\nraise SystemExit(2)\n",
      expected: /stderr was not empty/,
      timeoutMs: 2_000,
    },
    {
      name: 'timeout',
      source: "import sys, time\nfor _ in sys.stdin:\n    time.sleep(10)\n",
      expected: /did not answer within 100ms/,
      timeoutMs: 100,
    },
  ];

  for (const item of cases) {
    const fakeRepository = mkdtempSync(join(tmpdir(), `continuity-fake-${item.name}-`));
    const dataDir = mkdtempSync(join(tmpdir(), `continuity-fake-data-${item.name}-`));
    const moduleDirectory = join(fakeRepository, 'tests', 'shared');
    mkdirSync(join(fakeRepository, 'src'), { recursive: true });
    mkdirSync(moduleDirectory, { recursive: true });
    writeFileSync(join(fakeRepository, 'tests', '__init__.py'), '', 'utf8');
    writeFileSync(join(moduleDirectory, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(moduleDirectory, 'continuity_contract_jsonl_runner.py'),
      item.source,
      'utf8',
    );
    const runner = createContinuityJsonlRunnerTransport({
      dataDir,
      engineRepository: fakeRepository,
      timeoutMs: item.timeoutMs,
    });
    try {
      await assert.rejects(runner.submit({ requestId: `request-${item.name}` }), item.expected);
    } finally {
      await runner.terminate();
      rmSync(fakeRepository, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});

test('shared bridge remains test-only and absent from application, HTTP and frontend wiring', () => {
  function collect(directory, files = []) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) collect(path, files);
      else files.push(path);
    }
    return files;
  }
  const applicationFiles = [
    ...collect(join(BACKEND_ROOT, 'src')),
    ...collect(join(VIO_ROOT, 'src')),
  ];
  for (const file of applicationFiles) {
    const content = readFileSync(file, 'utf8');
    assert.ok(!content.includes('continuity-jsonl-runner-transport'));
    assert.ok(!content.includes('continuity_contract_jsonl_runner'));
    assert.ok(!content.includes('CONTINUITY_ENGINE_REPO'));
    assert.ok(!content.includes("from 'node:child_process'"));
  }
  assert.ok(!readFileSync(join(BACKEND_ROOT, 'src', 'app.js'), 'utf8').includes('Runner'));
});
