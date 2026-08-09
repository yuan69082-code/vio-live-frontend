import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ConflictError } from '../src/core/errors.js';
import { createHttpContinuityIntegrationTransport } from '../src/integrations/continuity-engine/http-continuity-integration-transport.js';
import { createSqliteContinuityDeliveryRepository } from '../src/integrations/database/sqlite-continuity-delivery-repository.js';
import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import {
  calculateContentHash,
  calculateRequestHash,
  canonicalizeJson,
} from '../src/modules/continuity-integration/first-round-hashing.js';
import {
  EXPECTED_BINDING_FIXTURE_HASH,
  fixedSubjectBindingFixture,
} from '../src/modules/continuity-integration/first-round-contract.js';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(TEST_DIRECTORY, '..');
const ENGINE_BASELINE = '189441f9bad2a34119b4ef10365a4385ed0949cc';
const PLATFORM_TIME = '2026-07-30T00:00:00Z';
const RECEIVE_TIME = '2026-08-08T00:00:00Z';

function requireEngineRepository(value = process.env.CONTINUITY_ENGINE_REPO) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('CONTINUITY_ENGINE_REPO is required for the S2 local HTTP shared test.');
  }
  const root = resolve(value);
  const server = join(root, 'src', 'continuity_engine', 'integration_server.py');
  if (!statSync(root).isDirectory() || !statSync(server).isFile()) {
    throw new Error('CONTINUITY_ENGINE_REPO does not contain the E4 integration server.');
  }
  return root;
}

function engineGit(root, ...args) {
  return execFileSync('git', ['-c', `safe.directory=${root}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function pythonEnvironment(engineRoot, serviceToken = null) {
  const environment = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: [join(engineRoot, 'src'), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(delimiter),
  };
  if (serviceToken === null) delete environment.CONTINUITY_ENGINE_INTEGRATION_TOKEN;
  else environment.CONTINUITY_ENGINE_INTEGRATION_TOKEN = serviceToken;
  return environment;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

function initializeEngine({ engineRoot, dataDir, bindingFile, pythonCommand }) {
  const stdout = execFileSync(pythonCommand, [
    '-m',
    'continuity_engine.integration_server',
    'init',
    '--data-dir',
    dataDir,
    '--binding-file',
    bindingFile,
    '--binding-fixture-hash',
    EXPECTED_BINDING_FIXTURE_HASH,
    '--cycle-id',
    's2-local-http-cycle-001',
  ], {
    cwd: engineRoot,
    env: pythonEnvironment(engineRoot),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.match(stdout, /local integration data is initialized/);
}

async function startEngineServer({ engineRoot, dataDir, port, serviceToken, pythonCommand }) {
  const child = spawn(pythonCommand, [
    '-m',
    'continuity_engine.integration_server',
    'serve',
    '--data-dir',
    dataDir,
    '--port',
    String(port),
  ], {
    cwd: engineRoot,
    env: pythonEnvironment(engineRoot, serviceToken),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const closed = once(child, 'close');
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('E4 formal HTTP service exited before liveness.');
    try {
      const live = await fetch(`${baseUrl}/health/live`);
      if (live.status === 200 && (await live.json()).status === 'live') break;
    } catch {
      // The loopback listener may not yet have bound the reserved port.
    }
    if (Date.now() >= deadline) throw new Error('E4 formal HTTP service did not become live.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return {
    baseUrl,
    get pid() { return child.pid; },
    get output() { return `${stdout}${stderr}`; },
    kill(signal = 'SIGKILL') {
      if (child.exitCode === null) return child.kill(signal);
      return false;
    },
    async waitForExit() {
      await closed;
    },
    async stop() {
      if (child.exitCode === null) child.kill();
      await closed;
    },
  };
}

function createTransport(config) {
  return createHttpContinuityIntegrationTransport({
    baseUrl: config.continuityEngine.baseUrl,
    serviceToken: config.continuityEngine.token,
    connectTimeoutMs: config.continuityEngine.connectTimeoutMs,
    responseTimeoutMs: config.continuityEngine.responseTimeoutMs,
    maxResponseBytes: config.continuityEngine.maxResponseBytes,
  });
}

function seedFixedScope(connection) {
  connection.prepare(`
    INSERT INTO users (
      user_id, primary_email, display_name, status, created_at, updated_at
    ) VALUES ('user-001', 's2@example.com', 'S2 User', 'active', ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES ('assistant-001', 'user-001', 'S2 Assistant', NULL, '{}',
      'active', ?, ?)
  `).run(PLATFORM_TIME, PLATFORM_TIME);
  connection.prepare(`
    INSERT INTO conversations (
      conversation_id, user_id, subject_id, title, status,
      created_at, updated_at, last_activity_at
    ) VALUES ('conversation-001', 'user-001', 'assistant-001',
      'S2 local HTTP acceptance', 'active', ?, ?, ?)
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

function prepareRequest(application, {
  suffix,
  content,
  sequenceNumber,
  expectedEngineRevision,
  requestId = `request-${suffix}`,
}) {
  const references = insertMessageFact(
    application.database.connection,
    suffix,
    content,
    sequenceNumber,
  );
  application.continuityRequestService.prepareFixedBindingFixtureForTests();
  return application.continuityRequestService.constructAndStoreRequest({
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

function scalar(connection, sql, ...parameters) {
  return connection.prepare(sql).get(...parameters).value;
}

function vioLedgerCounts(connection) {
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

function assertSuccessProjection(envelope, {
  previousRevision,
  currentRevision,
  changed,
}) {
  assert.equal(envelope.status, 'completed');
  assert.equal(envelope.stateProjection.previousRevision, previousRevision);
  assert.equal(envelope.stateProjection.currentRevision, currentRevision);
  assert.equal(envelope.stateProjection.changed, changed);
  if (changed) assert.ok(envelope.stateProjection.engineUpdateId);
  else assert.equal(envelope.stateProjection.engineUpdateId, null);
}

async function submitMachineError({ application, transport, request, mutate, code, retryClass }) {
  const candidate = structuredClone(request);
  mutate(candidate);
  const response = await transport.submitCanonicalRequest(canonicalizeJson(candidate));
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, 'failed_terminal');
  assert.equal(response.payload.operationId, null);
  assert.equal(response.payload.error.code, code);
  assert.equal(response.payload.error.retryClass, retryClass);
  return application.continuityResultService.receiveResult(request.requestId, response.payload);
}

function inspectEngine({ engineRoot, dataDir, pythonCommand }) {
  const source = [
    'import json, sys',
    'from continuity_engine.interfaces.local_integration_app import build_local_integration_app',
    'from continuity_engine.storage.json_thinking_repository import JsonThinkingRepository',
    'app = build_local_integration_app(sys.argv[1])',
    'state = app.subject_states.load(app.binding.subject_id)',
    'updates = app.subject_states.get_update_history(app.binding.subject_id)',
    'operations = app.ledger.list_operations()',
    'results = app.ledger.list_completed()',
    'wake = app.awakening_repository.list_sessions(app.binding.subject_id)',
    'thinking = JsonThinkingRepository(app.data_dir).list_think_sessions(app.binding.subject_id)',
    'print(json.dumps({',
    '  "revision": state.revision,',
    '  "updates": [{"updateId": item.update_id, "eventId": item.event.event_id} for item in updates],',
    '  "eventCount": len({item.event.event_id for item in updates}),',
    '  "wakeCount": len(wake),',
    '  "thinkingCount": len(thinking),',
    '  "operationCount": len(operations),',
    '  "completedCount": len(results),',
    '  "operations": [item.to_dict() for item in operations],',
    '  "results": [item.to_dict() for item in results],',
    '}))',
  ].join('\n');
  return JSON.parse(execFileSync(pythonCommand, ['-c', source, dataDir], {
    cwd: engineRoot,
    env: pythonEnvironment(engineRoot),
    encoding: 'utf8',
    windowsHide: true,
  }));
}

function assertSecretAbsent(root, secret) {
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else assert.ok(!readFileSync(path).includes(Buffer.from(secret, 'utf8')));
    }
  };
  visit(root);
}

function s3Config({ databasePath, baseUrl, serviceToken, responseTimeoutMs = 20_000 }) {
  return loadConfig({
    VIO_BACKEND_HOST: '127.0.0.1',
    VIO_BACKEND_PORT: '0',
    VIO_BACKEND_DB_PATH: databasePath,
    VIO_CONTINUITY_ENGINE_ENABLED: 'true',
    VIO_CONTINUITY_ENGINE_BASE_URL: baseUrl,
    VIO_CONTINUITY_ENGINE_TOKEN: serviceToken,
    VIO_CONTINUITY_ENGINE_CONNECT_TIMEOUT_MS: '2000',
    VIO_CONTINUITY_ENGINE_RESPONSE_TIMEOUT_MS: String(responseTimeoutMs),
  });
}

async function startVio({
  databasePath,
  baseUrl,
  serviceToken,
  responseTimeoutMs = 20_000,
  seed = false,
}) {
  const application = createApplication({
    config: s3Config({ databasePath, baseUrl, serviceToken, responseTimeoutMs }),
    logger: { error() {} },
  });
  if (seed) seedFixedScope(application.database.connection);
  await application.start();
  return application;
}

async function createS3Environment(name, { responseTimeoutMs = 20_000 } = {}) {
  const engineRoot = requireEngineRepository();
  const pythonCommand = process.env.PYTHON || 'python';
  const root = mkdtempSync(join(tmpdir(), `vio-s3-${name}-`));
  const engineData = join(root, 'engine-data');
  const bindingFile = join(root, 'binding.json');
  const databasePath = join(root, 'vio.sqlite');
  const serviceToken = randomBytes(32).toString('hex');
  const port = await reserveLoopbackPort();
  writeFileSync(bindingFile, JSON.stringify(fixedSubjectBindingFixture()), 'utf8');
  initializeEngine({ engineRoot, dataDir: engineData, bindingFile, pythonCommand });
  let engine = await startEngineServer({
    engineRoot,
    dataDir: engineData,
    port,
    serviceToken,
    pythonCommand,
  });
  let application = await startVio({
    databasePath,
    baseUrl: engine.baseUrl,
    serviceToken,
    responseTimeoutMs,
    seed: true,
  });
  return {
    engineRoot,
    pythonCommand,
    root,
    engineData,
    databasePath,
    serviceToken,
    port,
    get engine() { return engine; },
    get application() { return application; },
    normalTransport() {
      return createTransport(s3Config({
        databasePath,
        baseUrl: `http://127.0.0.1:${port}`,
        serviceToken,
      }));
    },
    async stopVio() {
      if (application) {
        await application.stop();
        application = null;
      }
    },
    async restartVio({ timeoutMs = 20_000 } = {}) {
      if (application) await application.stop();
      application = await startVio({
        databasePath,
        baseUrl: `http://127.0.0.1:${port}`,
        serviceToken,
        responseTimeoutMs: timeoutMs,
      });
      return application;
    },
    async stopEngine(signal = 'SIGTERM') {
      if (engine) {
        engine.kill(signal);
        await engine.waitForExit();
        engine = null;
      }
    },
    async restartEngine() {
      if (engine) await engine.stop();
      engine = await startEngineServer({
        engineRoot,
        dataDir: engineData,
        port,
        serviceToken,
        pythonCommand,
      });
      return engine;
    },
    inspect() {
      return inspectEngine({ engineRoot, dataDir: engineData, pythonCommand });
    },
    async cleanup() {
      if (application) await application.stop();
      if (engine) await engine.stop();
      assertSecretAbsent(root, serviceToken);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function waitForQuery(transport, requestId, expectedStatus, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    try {
      latest = await transport.queryRequest(requestId);
      if (latest.kind === 'query' && latest.payload.status === expectedStatus) return latest;
    } catch {
      // A real process restart or a still-running request can temporarily make the query unavailable.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Engine query did not reach ${expectedStatus}; last kind was ${latest?.kind}.`);
}

function readOperation(engineData, requestId) {
  const path = join(
    engineData,
    'integration',
    'operation-journal.first-round-v1.json',
  );
  try {
    const journal = JSON.parse(readFileSync(path, 'utf8'));
    return journal.operations.find((item) => item.requestId === requestId) ?? null;
  } catch {
    return null;
  }
}

async function killEngineAtNonterminalOperation({
  engine,
  engineData,
  requestId,
  pythonCommand,
}) {
  const journalPath = join(
    engineData,
    'integration',
    'operation-journal.first-round-v1.json',
  );
  const source = [
    'import json, os, signal, sys, time',
    'path, request_id, pid_text = sys.argv[1:]',
    'deadline = time.monotonic() + 15',
    'while time.monotonic() < deadline:',
    '    try:',
    '        with open(path, "r", encoding="utf-8") as handle:',
    '            document = json.load(handle)',
    '        operation = next((item for item in document["operations"] if item["requestId"] == request_id), None)',
    '        if operation is not None and operation["stage"] != "completed":',
    '            print(json.dumps(operation), flush=True)',
    '            os.kill(int(pid_text), signal.SIGTERM)',
    '            raise SystemExit(0)',
    '        if operation is not None:',
    '            raise SystemExit(3)',
    '    except (OSError, KeyError, json.JSONDecodeError):',
    '        pass',
    'raise SystemExit(4)',
  ].join('\n');
  const monitor = spawn(pythonCommand, [
    '-c',
    source,
    journalPath,
    requestId,
    String(engine.pid),
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  monitor.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  monitor.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const [code] = await once(monitor, 'close');
  if (code === 3) {
    throw new Error('Engine operation completed before the external crash could be injected.');
  }
  if (code !== 0) {
    throw new Error(`A persisted nonterminal Engine operation was not observed (${code}).`);
  }
  assert.equal(stderr, '');
  await engine.waitForExit();
  return JSON.parse(stdout);
}

function markOutcomeUnknown(connection, request, operationId = null) {
  const repository = createSqliteContinuityDeliveryRepository(connection);
  let outbox = repository.ensureOutbox({
    requestId: request.requestId,
    requestHash: request.requestHash,
    createdAt: RECEIVE_TIME,
  });
  outbox = repository.transitionOutbox({
    requestId: request.requestId,
    expectedStatus: outbox.status,
    status: 'in_flight',
    updatedAt: RECEIVE_TIME,
  });
  return repository.transitionOutbox({
    requestId: request.requestId,
    expectedStatus: outbox.status,
    status: 'outcome_unknown',
    operationId,
    transportResult: 's3_test_checkpoint',
    recoveryReason: 's3_test_checkpoint',
    updatedAt: RECEIVE_TIME,
  });
}

async function runVioCrashWorker({ databasePath, baseUrl, serviceToken, requestId }) {
  const workerPath = join(
    BACKEND_ROOT,
    'test-support',
    'continuity-local-http-vio-crash-worker.js',
  );
  const child = spawn(process.execPath, [workerPath], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      S3_VIO_DATABASE_PATH: databasePath,
      S3_ENGINE_BASE_URL: baseUrl,
      S3_ENGINE_SERVICE_TOKEN: serviceToken,
      S3_REQUEST_ID: requestId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
  const [code] = await once(child, 'close');
  assert.equal(code, 86);
  assert.ok(!output.includes(serviceToken));
  return output;
}

async function initializeS3RevisionZero(application, suffix) {
  const request = prepareRequest(application, {
    suffix,
    content: 'hello',
    sequenceNumber: 1,
    expectedEngineRevision: 0,
  });
  const outcome = await application.continuityDeliveryService.submitStoredRequest(request.requestId);
  assert.equal(outcome.delivery.status, 'completed');
  assertSuccessProjection(outcome.result.envelope, {
    previousRevision: 0,
    currentRevision: 0,
    changed: false,
  });
  assert.equal(
    application.continuityResultService.getProjectionHead('subject-001').currentRevision,
    0,
  );
  return { request, result: outcome.result.envelope };
}

test('S2 formal local HTTP/JSON shared connection acceptance', async (t) => {
  const engineRoot = requireEngineRepository();
  const pythonCommand = process.env.PYTHON || 'python';
  const root = mkdtempSync(join(tmpdir(), 'vio-s2-local-http-'));
  const engineData = join(root, 'engine-data');
  const bindingFile = join(root, 'binding.json');
  const vioDatabasePath = join(root, 'vio.sqlite');
  const serviceToken = randomBytes(32).toString('hex');
  const port = await reserveLoopbackPort();
  writeFileSync(bindingFile, JSON.stringify(fixedSubjectBindingFixture()), 'utf8');

  let engine = null;
  let application = null;
  let engineInspection = null;
  try {
    await t.test('pins clean Engine E4 and starts formal loopback init/serve endpoints', async () => {
      assert.equal(engineGit(engineRoot, 'rev-parse', 'HEAD'), ENGINE_BASELINE);
      assert.equal(engineGit(engineRoot, 'rev-parse', '@{upstream}'), ENGINE_BASELINE);
      assert.equal(engineGit(engineRoot, 'status', '--porcelain'), '');
      initializeEngine({ engineRoot, dataDir: engineData, bindingFile, pythonCommand });
      engine = await startEngineServer({
        engineRoot,
        dataDir: engineData,
        port,
        serviceToken,
        pythonCommand,
      });
      const live = await fetch(`${engine.baseUrl}/health/live`);
      const ready = await fetch(`${engine.baseUrl}/health/ready`);
      assert.deepEqual([live.status, await live.json()], [200, { status: 'live' }]);
      assert.deepEqual([ready.status, await ready.json()], [200, { status: 'ready' }]);
      assert.match(engine.output, new RegExp(`listening on 127\\.0\\.0\\.1:${port}`));
      assert.ok(!engine.output.includes(serviceToken));

      const config = loadConfig({
        VIO_BACKEND_HOST: '127.0.0.1',
        VIO_BACKEND_PORT: '0',
        VIO_BACKEND_DB_PATH: vioDatabasePath,
        VIO_CONTINUITY_ENGINE_ENABLED: 'true',
        VIO_CONTINUITY_ENGINE_BASE_URL: engine.baseUrl,
        VIO_CONTINUITY_ENGINE_TOKEN: serviceToken,
        VIO_CONTINUITY_ENGINE_CONNECT_TIMEOUT_MS: '2000',
        VIO_CONTINUITY_ENGINE_RESPONSE_TIMEOUT_MS: '20000',
      });
      application = createApplication({ config, logger: { error() {} } });
      seedFixedScope(application.database.connection);
      await application.start();
      assert.equal(application.continuityDeliveryService.enabled, true);
      assert.equal(application.continuityDeliveryService.getHealthStatus(), 'ready');
      t.diagnostic(`formal E4 endpoint: ${engine.baseUrl}`);
    });

    const config = loadConfig({
      VIO_BACKEND_DB_PATH: vioDatabasePath,
      VIO_CONTINUITY_ENGINE_ENABLED: 'true',
      VIO_CONTINUITY_ENGINE_BASE_URL: engine.baseUrl,
      VIO_CONTINUITY_ENGINE_TOKEN: serviceToken,
    });
    const transport = createTransport(config);
    const connection = application.database.connection;
    let requestB;
    let resultB;

    await t.test('A/B/C traverse V1, V3 HTTP, formal E4 and V2 with revisions 0 to 1', async () => {
      const requestA = prepareRequest(application, {
        suffix: 's2-a',
        content: 'hello',
        sequenceNumber: 1,
        expectedEngineRevision: 0,
      });
      const outcomeA = await application.continuityDeliveryService.submitStoredRequest(
        requestA.requestId,
      );
      assert.equal(outcomeA.delivery.status, 'completed');
      assert.equal(outcomeA.delivery.lastHttpStatus, 200);
      assert.equal(outcomeA.result.processingStage, 'completed');
      assertSuccessProjection(outcomeA.result.envelope, {
        previousRevision: 0,
        currentRevision: 0,
        changed: false,
      });
      assert.equal(
        application.continuityResultService.getProjectionHead('subject-001').currentRevision,
        0,
      );

      requestB = prepareRequest(application, {
        suffix: 's2-b',
        content: 'remember continuity test focus',
        sequenceNumber: 2,
        expectedEngineRevision: 0,
      });
      const outcomeB = await application.continuityDeliveryService.submitStoredRequest(
        requestB.requestId,
      );
      resultB = outcomeB.result.envelope;
      assert.equal(outcomeB.delivery.status, 'completed');
      assertSuccessProjection(resultB, {
        previousRevision: 0,
        currentRevision: 1,
        changed: true,
      });
      assert.equal(
        application.continuityResultService.getProjectionHead('subject-001').currentRevision,
        1,
      );

      const requestC = prepareRequest(application, {
        suffix: 's2-c',
        content: 'continue with the current focus',
        sequenceNumber: 3,
        expectedEngineRevision: 1,
      });
      const outcomeC = await application.continuityDeliveryService.submitStoredRequest(
        requestC.requestId,
      );
      assert.equal(outcomeC.delivery.status, 'completed');
      assertSuccessProjection(outcomeC.result.envelope, {
        previousRevision: 1,
        currentRevision: 1,
        changed: false,
      });
      assert.equal(
        application.continuityResultService.getProjectionHead('subject-001').currentRevision,
        1,
      );
      assert.deepEqual(vioLedgerCounts(connection), {
        results: 3,
        projections: 2,
        receipts: 3,
        heads: 1,
        legacyStates: 0,
        legacyHeads: 0,
      });
    });

    await t.test('all four E4 machine errors stay HTTP 200 and obey V2 terminal semantics', async () => {
      const schemaRequest = prepareRequest(application, {
        suffix: 's2-error-schema',
        content: 'schema check',
        sequenceNumber: 4,
        expectedEngineRevision: 1,
      });
      const schemaOutcome = await submitMachineError({
        application,
        transport,
        request: schemaRequest,
        mutate: (candidate) => { candidate.unknown = true; },
        code: 'SCHEMA_INVALID',
        retryClass: 'never',
      });
      assert.equal(schemaOutcome.processingStage, 'terminal_error');

      const bindingRequest = prepareRequest(application, {
        suffix: 's2-error-binding',
        content: 'binding check',
        sequenceNumber: 5,
        expectedEngineRevision: 1,
      });
      const bindingOutcome = await submitMachineError({
        application,
        transport,
        request: bindingRequest,
        mutate: (candidate) => {
          for (const identity of [
            candidate.identity,
            candidate.observations[0].identity,
            candidate.platformFactPackage.facts[0].identity,
          ]) identity.subjectId = 'subject-not-disclosed';
          candidate.requestHash = calculateRequestHash(candidate);
        },
        code: 'SUBJECT_BINDING_MISMATCH',
        retryClass: 'never',
      });
      assert.equal(bindingOutcome.envelope.error.currentEngineRevision, null);
      assert.equal(bindingOutcome.envelope.error.currentBindingVersion, null);

      const revisionRequest = prepareRequest(application, {
        suffix: 's2-error-revision',
        content: 'revision check',
        sequenceNumber: 6,
        expectedEngineRevision: 0,
      });
      const revisionOutcome = await application.continuityDeliveryService.submitStoredRequest(
        revisionRequest.requestId,
      );
      assert.equal(revisionOutcome.delivery.status, 'completed');
      assert.equal(revisionOutcome.result.processingStage, 'terminal_error');
      assert.equal(revisionOutcome.result.envelope.error.code, 'REVISION_CONFLICT');
      assert.equal(revisionOutcome.result.envelope.error.retryClass, 'reassemble');
      assert.equal(revisionOutcome.result.envelope.error.currentEngineRevision, 1);
      const revisionAttempts = application.continuityDeliveryService.listAttempts(
        revisionRequest.requestId,
      );
      assert.equal(revisionAttempts.length, 1);
      await application.continuityDeliveryService.submitStoredRequest(revisionRequest.requestId);
      assert.equal(
        application.continuityDeliveryService.listAttempts(revisionRequest.requestId).length,
        1,
      );

      for (const requestId of [schemaRequest.requestId, bindingRequest.requestId]) {
        const recovered = await application.continuityDeliveryService.submitStoredRequest(requestId);
        assert.equal(recovered.result.processingStage, 'terminal_error');
        assert.equal(application.continuityDeliveryService.listAttempts(requestId).length, 0);
      }

      const idempotencyRequest = prepareRequest(application, {
        suffix: 's2-error-idempotency',
        content: 'idempotency baseline',
        sequenceNumber: 7,
        expectedEngineRevision: 1,
      });
      const first = await application.continuityDeliveryService.submitStoredRequest(
        idempotencyRequest.requestId,
      );
      assert.equal(first.result.processingStage, 'completed');
      const reused = structuredClone(idempotencyRequest);
      reused.platformFactPackage.facts[0].content = 'different logical request';
      reused.platformFactPackage.facts[0].contentHash = calculateContentHash(
        reused.platformFactPackage.facts[0].content,
      );
      reused.requestHash = calculateRequestHash(reused);
      const reusedResponse = await transport.submitCanonicalRequest(canonicalizeJson(reused));
      assert.equal(reusedResponse.statusCode, 200);
      assert.equal(reusedResponse.payload.error.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal(reusedResponse.payload.error.retryClass, 'never');
      assert.equal(reusedResponse.payload.operationId, null);
      assert.throws(
        () => application.continuityResultService.receiveResult(
          idempotencyRequest.requestId,
          reusedResponse.payload,
        ),
        ConflictError,
      );
      assert.deepEqual(
        application.continuityResultService.getStoredResult(idempotencyRequest.requestId).envelope,
        first.result.envelope,
      );
      const incidents = application.continuityResultService.getResultIncidents(
        idempotencyRequest.requestId,
      );
      assert.equal(incidents.length, 1);
      assert.equal(incidents[0].disposition, 'quarantined');
      assert.equal(
        application.continuityResultService.getProjectionHead('subject-001').currentRevision,
        1,
      );
    });

    await t.test('completed and not_found query paths use the V3 parser without duplicate V2 state', async () => {
      const queryRequest = prepareRequest(application, {
        suffix: 's2-query',
        content: 'query recovery check',
        sequenceNumber: 8,
        expectedEngineRevision: 1,
      });
      const initial = await transport.submitCanonicalRequest(canonicalizeJson(queryRequest));
      assert.equal(initial.statusCode, 200);
      assert.equal(initial.payload.status, 'completed');
      assert.equal(
        application.continuityResultService.getStoredResult(queryRequest.requestId),
        null,
        'the query envelope itself must not enter V2',
      );
      const directQuery = await transport.queryRequest(queryRequest.requestId);
      assert.equal(directQuery.statusCode, 200);
      assert.equal(directQuery.kind, 'query');
      assert.equal(directQuery.payload.status, 'completed');
      assert.equal(directQuery.payload.requestId, queryRequest.requestId);
      assert.equal(directQuery.payload.requestHash, queryRequest.requestHash);
      assert.equal(directQuery.payload.operationId, initial.payload.operationId);
      assert.deepEqual(directQuery.payload.result, initial.payload);
      assert.equal(application.continuityResultService.getStoredResult(queryRequest.requestId), null);

      const deliveryRepository = createSqliteContinuityDeliveryRepository(connection);
      let outbox = deliveryRepository.ensureOutbox({
        requestId: queryRequest.requestId,
        requestHash: queryRequest.requestHash,
        createdAt: RECEIVE_TIME,
      });
      outbox = deliveryRepository.transitionOutbox({
        requestId: queryRequest.requestId,
        expectedStatus: outbox.status,
        status: 'in_flight',
        updatedAt: RECEIVE_TIME,
      });
      deliveryRepository.transitionOutbox({
        requestId: queryRequest.requestId,
        expectedStatus: outbox.status,
        status: 'outcome_unknown',
        operationId: initial.payload.operationId,
        transportResult: 's2_completed_before_local_checkpoint',
        recoveryReason: 's2_query_parser_acceptance',
        updatedAt: RECEIVE_TIME,
      });
      const recovered = await application.continuityDeliveryService.submitStoredRequest(
        queryRequest.requestId,
      );
      assert.equal(recovered.delivery.status, 'completed');
      assert.deepEqual(recovered.result.envelope, initial.payload);
      assert.deepEqual(
        application.continuityResultService.receiveResult(
          queryRequest.requestId,
          directQuery.payload.result,
        ).envelope,
        initial.payload,
      );

      const missing = await transport.queryRequest('request-s2-not-found');
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.kind, 'not_found');
      assert.deepEqual(missing.payload, { error: 'not_found' });
      assert.equal(
        application.continuityResultService.getProjectionHead('subject-001').currentRevision,
        1,
      );
    });

    await t.test('final Vio ledger preserves projection boundary and legacy state remains untouched', () => {
      assert.deepEqual(
        connection.prepare(`
          SELECT current_revision FROM continuity_engine_state_projection_versions
          WHERE subject_id = 'subject-001' ORDER BY current_revision
        `).all().map(({ current_revision: revision }) => revision),
        [0, 1],
      );
      assert.equal(
        application.continuityResultService.getProjectionHead('subject-001').currentRevision,
        1,
      );
      assert.equal(
        scalar(
          connection,
          'SELECT COUNT(*) AS value FROM continuity_engine_state_projection_receipts',
        ),
        5,
      );
      assert.equal(scalar(connection, 'SELECT COUNT(*) AS value FROM subject_states'), 0);
      assert.equal(scalar(connection, 'SELECT COUNT(*) AS value FROM subject_state_heads'), 0);
      assert.equal(resultB.stateProjection.engineUpdateId.length > 0, true);
    });

    await application.stop();
    application = null;
    await engine.stop();

    await t.test('formal Engine persistence ends at revision 1 with one isolated internal Event', () => {
      engineInspection = inspectEngine({ engineRoot, dataDir: engineData, pythonCommand });
      assert.equal(engineInspection.revision, 1);
      assert.equal(engineInspection.updates.length, 1);
      assert.equal(engineInspection.updates[0].updateId, resultB.stateProjection.engineUpdateId);
      assert.notEqual(engineInspection.updates[0].eventId, requestB.observations[0].sourceEventId);
      assert.ok(engineInspection.operationCount >= 5);
      assert.equal(engineInspection.completedCount, 5);
    });

    await t.test('the formal network boundary stays loopback-only and does not persist its token', () => {
      assert.match(engine.output, new RegExp(`listening on 127\\.0\\.0\\.1:${port}`));
      assert.ok(!engine.output.includes(serviceToken));
      assertSecretAbsent(root, serviceToken);
      assert.equal(engineGit(engineRoot, 'rev-parse', 'HEAD'), ENGINE_BASELINE);
      assert.equal(engineGit(engineRoot, 'status', '--porcelain'), '');
      assert.ok(!readFileSync(join(BACKEND_ROOT, 'src', 'app.js'), 'utf8').includes('JSONL'));
    });
  } finally {
    if (application) await application.stop();
    if (engine) await engine.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('S3 formal HTTP failure, crash, restart and recovery acceptance', async (t) => {
  await t.test('lost POST response is recovered by completed query without a second operation', async () => {
    const environment = await createS3Environment('response-lost');
    try {
      await initializeS3RevisionZero(environment.application, 's3-lost-a');
      await environment.restartVio({ timeoutMs: 1 });
      const request = prepareRequest(environment.application, {
        suffix: 's3-lost-b',
        content: 'remember continuity test focus',
        sequenceNumber: 2,
        expectedEngineRevision: 0,
      });
      const original = structuredClone(request);
      const lost = await environment.application.continuityDeliveryService.submitStoredRequest(
        request.requestId,
      );
      assert.equal(lost.delivery.status, 'outcome_unknown');
      assert.equal(lost.result, null);
      assert.equal(
        environment.application.continuityDeliveryService.listAttempts(request.requestId).length,
        1,
      );

      const completed = await waitForQuery(
        environment.normalTransport(),
        request.requestId,
        'completed',
      );
      const stable = completed.payload.result;
      assert.equal(completed.payload.requestHash, request.requestHash);
      assert.equal(completed.payload.operationId, stable.operationId);
      assertSuccessProjection(stable, {
        previousRevision: 0,
        currentRevision: 1,
        changed: true,
      });

      await environment.restartVio();
      const recovered = environment.application.continuityResultService.getStoredResult(
        request.requestId,
      );
      assert.deepEqual(recovered.envelope, stable);
      assert.equal(
        environment.application.continuityDeliveryService.getOutbox(request.requestId).status,
        'completed',
      );
      assert.deepEqual(
        environment.application.continuityDeliveryService
          .listAttempts(request.requestId)
          .map(({ operationType }) => operationType),
        ['post', 'query'],
      );
      assert.deepEqual(environment.application.continuityRequestService.getStoredRequest(
        request.requestId,
      ), original);

      const reused = structuredClone(request);
      reused.platformFactPackage.facts[0].content = 'different recovery request';
      reused.platformFactPackage.facts[0].contentHash = calculateContentHash(
        reused.platformFactPackage.facts[0].content,
      );
      reused.requestHash = calculateRequestHash(reused);
      const conflict = await environment.normalTransport().submitCanonicalRequest(
        canonicalizeJson(reused),
      );
      assert.equal(conflict.statusCode, 200);
      assert.equal(conflict.payload.error.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal(conflict.payload.error.retryClass, 'never');
      assert.throws(
        () => environment.application.continuityResultService.receiveResult(
          request.requestId,
          conflict.payload,
        ),
        ConflictError,
      );
      assert.deepEqual(
        environment.application.continuityResultService.getStoredResult(request.requestId).envelope,
        stable,
      );
      assert.equal(
        environment.application.continuityResultService
          .getResultIncidents(request.requestId)[0].disposition,
        'quarantined',
      );

      await environment.stopEngine();
      const inspection = environment.inspect();
      assert.equal(inspection.revision, 1);
      assert.equal(inspection.operationCount, 2);
      assert.equal(inspection.completedCount, 2);
      assert.equal(inspection.wakeCount, 2);
      assert.equal(inspection.thinkingCount, 2);
      assert.equal(inspection.eventCount, 1);
      assert.equal(inspection.updates.length, 1);
      const targetOperations = inspection.operations.filter(
        ({ requestId }) => requestId === request.requestId,
      );
      assert.equal(targetOperations.length, 1);
      const targetResults = inspection.results.filter(
        ({ requestId }) => requestId === request.requestId,
      );
      assert.equal(targetResults.length, 1);
      assert.equal(targetResults[0].operationId, stable.operationId);
      assert.equal(targetResults[0].stateProjection.engineUpdateId, stable.stateProjection.engineUpdateId);
      assert.equal(targetResults[0].completedAt, stable.completedAt);
      assert.deepEqual(vioLedgerCounts(environment.application.database.connection), {
        results: 2,
        projections: 2,
        receipts: 2,
        heads: 1,
        legacyStates: 0,
        legacyHeads: 0,
      });
    } finally {
      await environment.cleanup();
    }
  });

  await t.test('real Engine crash after nonterminal checkpoint returns recovery_required and resumes', async () => {
    const environment = await createS3Environment('engine-crash');
    try {
      await initializeS3RevisionZero(environment.application, 's3-engine-crash-a');
      const request = prepareRequest(environment.application, {
        suffix: 's3-engine-crash-b',
        content: 'remember continuity test focus',
        sequenceNumber: 2,
        expectedEngineRevision: 0,
      });
      const original = structuredClone(request);
      const originalCanonical = canonicalizeJson(original);
      const kill = killEngineAtNonterminalOperation({
        engine: environment.engine,
        engineData: environment.engineData,
        requestId: request.requestId,
        pythonCommand: environment.pythonCommand,
      });
      const delivery = environment.application.continuityDeliveryService.submitStoredRequest(
        request.requestId,
      );
      const [checkpoint, interrupted] = await Promise.all([kill, delivery]);
      assert.notEqual(checkpoint.stage, 'completed');
      assert.equal(checkpoint.requestId, request.requestId);
      assert.equal(checkpoint.requestHash, request.requestHash);
      assert.equal(interrupted.delivery.status, 'outcome_unknown');
      assert.equal(interrupted.result, null);
      t.diagnostic(`observed real E4 crash checkpoint: ${checkpoint.stage}`);

      await environment.restartEngine();
      const query = await environment.normalTransport().queryRequest(request.requestId);
      assert.equal(query.statusCode, 200);
      assert.equal(query.payload.status, 'recovery_required');
      assert.equal(query.payload.requestId, request.requestId);
      assert.equal(query.payload.requestHash, request.requestHash);
      assert.equal(query.payload.operationId, checkpoint.operationId);
      assert.equal(query.payload.result, null);

      const recovered = await environment.application.continuityDeliveryService.submitStoredRequest(
        request.requestId,
      );
      if (recovered.delivery.status !== 'completed') {
        let afterRecoveryQuery;
        try {
          afterRecoveryQuery = await environment.normalTransport().queryRequest(request.requestId);
        } catch (error) {
          afterRecoveryQuery = { transportError: error.transportCode ?? error.code ?? 'unknown' };
        }
        t.diagnostic(JSON.stringify({
          delivery: recovered.delivery,
          attempts: environment.application.continuityDeliveryService.listAttempts(
            request.requestId,
          ),
          afterRecoveryQuery,
          engineOutput: environment.engine.output,
        }));
        await environment.stopEngine();
        const failedRecoveryInspection = environment.inspect();
        t.diagnostic(JSON.stringify({
          revision: failedRecoveryInspection.revision,
          wakeCount: failedRecoveryInspection.wakeCount,
          thinkingCount: failedRecoveryInspection.thinkingCount,
          updates: failedRecoveryInspection.updates,
          operation: failedRecoveryInspection.operations.find(
            ({ requestId }) => requestId === request.requestId,
          ),
          completedResult: failedRecoveryInspection.results.find(
            ({ requestId }) => requestId === request.requestId,
          ) ?? null,
        }));
      }
      assert.equal(recovered.delivery.status, 'completed');
      assertSuccessProjection(recovered.result.envelope, {
        previousRevision: 0,
        currentRevision: 1,
        changed: true,
      });
      assert.equal(recovered.result.envelope.operationId, checkpoint.operationId);
      assert.deepEqual(
        environment.application.continuityRequestService.getStoredRequest(request.requestId),
        original,
      );
      assert.deepEqual(
        canonicalizeJson(environment.application.continuityRequestService.getStoredRequest(
          request.requestId,
        )),
        originalCanonical,
      );
      assert.deepEqual(
        environment.application.continuityDeliveryService
          .listAttempts(request.requestId)
          .map(({ operationType }) => operationType),
        ['post', 'query', 'post'],
      );

      await environment.stopEngine();
      const inspection = environment.inspect();
      assert.equal(inspection.revision, 1);
      assert.equal(inspection.operationCount, 2);
      assert.equal(inspection.completedCount, 2);
      assert.equal(inspection.wakeCount, 2);
      assert.equal(inspection.thinkingCount, 2);
      assert.equal(inspection.eventCount, 1);
      assert.equal(inspection.updates.length, 1);
      const operation = inspection.operations.find(({ requestId }) => requestId === request.requestId);
      const result = inspection.results.find(({ requestId }) => requestId === request.requestId);
      assert.equal(operation.operationId, checkpoint.operationId);
      assert.equal(operation.stage, 'completed');
      assert.ok(operation.domain);
      assert.ok(operation.evolution);
      assert.equal(result.operationId, checkpoint.operationId);
      assert.equal(result.stateProjection.engineUpdateId, operation.evolution.updateId);
    } finally {
      await environment.cleanup();
    }
  });

  await t.test('query connection failure remains outcome_unknown until the same Engine returns', async () => {
    const environment = await createS3Environment('query-unavailable');
    try {
      await initializeS3RevisionZero(environment.application, 's3-query-down-a');
      await environment.restartVio({ timeoutMs: 1 });
      const request = prepareRequest(environment.application, {
        suffix: 's3-query-down-b',
        content: 'remember continuity test focus',
        sequenceNumber: 2,
        expectedEngineRevision: 0,
      });
      const original = structuredClone(request);
      const lost = await environment.application.continuityDeliveryService.submitStoredRequest(
        request.requestId,
      );
      assert.equal(lost.delivery.status, 'outcome_unknown');
      const stable = (await waitForQuery(
        environment.normalTransport(),
        request.requestId,
        'completed',
      )).payload.result;

      await environment.stopEngine();
      const unavailable = await environment.application.continuityDeliveryService
        .submitStoredRequest(request.requestId);
      assert.equal(unavailable.delivery.status, 'outcome_unknown');
      assert.equal(unavailable.result, null);
      assert.equal(
        environment.application.continuityResultService.getStoredResult(request.requestId),
        null,
      );
      assert.deepEqual(
        environment.application.continuityDeliveryService
          .listAttempts(request.requestId)
          .map(({ operationType }) => operationType),
        ['post', 'query'],
      );
      assert.deepEqual(
        environment.application.continuityRequestService.getStoredRequest(request.requestId),
        original,
      );

      await environment.stopVio();
      await environment.restartEngine();
      await environment.restartVio();
      assert.deepEqual(
        environment.application.continuityResultService.getStoredResult(request.requestId).envelope,
        stable,
      );
      assert.equal(
        environment.application.continuityDeliveryService.getOutbox(request.requestId).status,
        'completed',
      );
      assert.deepEqual(
        environment.application.continuityDeliveryService
          .listAttempts(request.requestId)
          .map(({ operationType }) => operationType),
        ['post', 'query', 'query'],
      );
      await environment.stopEngine();
      const inspection = environment.inspect();
      assert.equal(inspection.revision, 1);
      assert.equal(inspection.operationCount, 2);
      assert.equal(inspection.completedCount, 2);
      assert.equal(inspection.wakeCount, 2);
      assert.equal(inspection.thinkingCount, 2);
      assert.equal(inspection.updates.length, 1);
    } finally {
      await environment.cleanup();
    }
  });

  await t.test('Vio process crash after V2 pointer persistence recovers locally without Engine POST', async () => {
    const environment = await createS3Environment('vio-crash');
    try {
      await initializeS3RevisionZero(environment.application, 's3-vio-crash-a');
      const request = prepareRequest(environment.application, {
        suffix: 's3-vio-crash-b',
        content: 'remember continuity test focus',
        sequenceNumber: 2,
        expectedEngineRevision: 0,
      });
      await environment.stopVio();
      await runVioCrashWorker({
        databasePath: environment.databasePath,
        baseUrl: environment.engine.baseUrl,
        serviceToken: environment.serviceToken,
        requestId: request.requestId,
      });

      const checkpointDatabase = createSqliteDatabase(loadConfig({
        VIO_BACKEND_DB_PATH: environment.databasePath,
      }));
      try {
        assert.equal(
          scalar(
            checkpointDatabase.connection,
            'SELECT processing_stage AS value FROM continuity_first_round_results WHERE request_id = ?',
            request.requestId,
          ),
          'pointer_applied',
        );
        assert.equal(
          scalar(
            checkpointDatabase.connection,
            'SELECT status AS value FROM continuity_first_round_delivery_outbox WHERE request_id = ?',
            request.requestId,
          ),
          'result_received',
        );
        assert.equal(
          scalar(
            checkpointDatabase.connection,
            'SELECT COUNT(*) AS value FROM continuity_engine_state_projection_receipts',
          ),
          2,
        );
        assert.equal(
          scalar(
            checkpointDatabase.connection,
            'SELECT current_revision AS value FROM continuity_engine_state_projection_heads WHERE subject_id = ?',
            'subject-001',
          ),
          1,
        );
      } finally {
        checkpointDatabase.close();
      }

      const stable = (await environment.normalTransport().queryRequest(request.requestId)).payload.result;
      const inspectionBefore = environment.inspect();
      const targetOperationsBefore = inspectionBefore.operations.filter(
        ({ requestId }) => requestId === request.requestId,
      );
      assert.equal(targetOperationsBefore.length, 1);
      assert.equal(targetOperationsBefore[0].operationId, stable.operationId);

      await environment.restartVio();
      const stored = environment.application.continuityResultService.getStoredResult(
        request.requestId,
      );
      assert.equal(stored.processingStage, 'completed');
      assert.deepEqual(stored.envelope, stable);
      assert.equal(
        environment.application.continuityDeliveryService.getOutbox(request.requestId).status,
        'completed',
      );
      assert.deepEqual(
        environment.application.continuityDeliveryService
          .listAttempts(request.requestId)
          .map(({ operationType }) => operationType),
        ['post'],
      );
      assert.deepEqual(vioLedgerCounts(environment.application.database.connection), {
        results: 2,
        projections: 2,
        receipts: 2,
        heads: 1,
        legacyStates: 0,
        legacyHeads: 0,
      });
      await environment.stopEngine();
      const inspectionAfter = environment.inspect();
      assert.deepEqual(inspectionAfter, inspectionBefore);
    } finally {
      await environment.cleanup();
    }
  });

  await t.test('simultaneous Vio and Engine restart restores the same completed result', async () => {
    const environment = await createS3Environment('both-restart');
    try {
      await initializeS3RevisionZero(environment.application, 's3-both-a');
      await environment.restartVio({ timeoutMs: 1 });
      const request = prepareRequest(environment.application, {
        suffix: 's3-both-b',
        content: 'remember continuity test focus',
        sequenceNumber: 2,
        expectedEngineRevision: 0,
      });
      const original = structuredClone(request);
      const lost = await environment.application.continuityDeliveryService.submitStoredRequest(
        request.requestId,
      );
      assert.equal(lost.delivery.status, 'outcome_unknown');
      const stable = (await waitForQuery(
        environment.normalTransport(),
        request.requestId,
        'completed',
      )).payload.result;
      await environment.stopVio();
      await environment.stopEngine();
      await environment.restartEngine();
      await environment.restartVio();

      const storedRequest = environment.application.continuityRequestService.getStoredRequest(
        request.requestId,
      );
      const storedResult = environment.application.continuityResultService.getStoredResult(
        request.requestId,
      );
      assert.deepEqual(storedRequest, original);
      assert.equal(storedRequest.requestId, original.requestId);
      assert.equal(storedRequest.requestHash, original.requestHash);
      assert.deepEqual(storedResult.envelope, stable);
      assert.equal(storedResult.envelope.operationId, stable.operationId);
      assert.equal(
        storedResult.envelope.stateProjection.engineUpdateId,
        stable.stateProjection.engineUpdateId,
      );
      assert.equal(
        environment.application.continuityResultService
          .getProjectionHead('subject-001').currentRevision,
        1,
      );
      assert.deepEqual(
        environment.application.continuityDeliveryService
          .listAttempts(request.requestId)
          .map(({ operationType }) => operationType),
        ['post', 'query'],
      );
      await environment.stopEngine();
      const inspection = environment.inspect();
      assert.equal(inspection.revision, 1);
      assert.equal(inspection.operationCount, 2);
      assert.equal(inspection.completedCount, 2);
      assert.equal(inspection.wakeCount, 2);
      assert.equal(inspection.thinkingCount, 2);
      assert.equal(inspection.eventCount, 1);
      assert.equal(inspection.updates.length, 1);
    } finally {
      await environment.cleanup();
    }
  });

  await t.test('real completed queries quarantine hash and operation drift without moving heads', async () => {
    const environment = await createS3Environment('query-conflicts');
    let hashApplication = null;
    let operationApplication = null;
    try {
      const requestId = 'request-s3-query-conflict';
      const originalRequest = prepareRequest(environment.application, {
        suffix: 's3-query-conflict',
        content: 'hello',
        sequenceNumber: 1,
        expectedEngineRevision: 0,
        requestId,
      });
      await environment.stopVio();
      const operationDatabasePath = join(environment.root, 'vio-operation-drift.sqlite');
      copyFileSync(environment.databasePath, operationDatabasePath);
      await environment.restartVio();
      const originalOutcome = await environment.application.continuityDeliveryService
        .submitStoredRequest(requestId);
      assert.equal(originalOutcome.delivery.status, 'completed');
      const stable = originalOutcome.result.envelope;

      const hashDatabasePath = join(environment.root, 'vio-hash-drift.sqlite');
      hashApplication = await startVio({
        databasePath: hashDatabasePath,
        baseUrl: environment.engine.baseUrl,
        serviceToken: environment.serviceToken,
        seed: true,
      });
      const hashRequest = prepareRequest(hashApplication, {
        suffix: 's3-query-conflict',
        content: 'different local logical request',
        sequenceNumber: 1,
        expectedEngineRevision: 0,
        requestId,
      });
      assert.notEqual(hashRequest.requestHash, originalRequest.requestHash);
      markOutcomeUnknown(hashApplication.database.connection, hashRequest);
      const hashOutcome = await hashApplication.continuityDeliveryService.submitStoredRequest(
        requestId,
      );
      assert.equal(hashOutcome.delivery.status, 'quarantined');
      assert.equal(hashOutcome.delivery.lastErrorCode, 'query_identity_mismatch');
      assert.equal(hashApplication.continuityResultService.getProjectionHead('subject-001'), null);
      assert.equal(hashApplication.continuityResultService.getStoredResult(requestId), null);

      operationApplication = await startVio({
        databasePath: operationDatabasePath,
        baseUrl: environment.engine.baseUrl,
        serviceToken: environment.serviceToken,
      });
      const operationRequest = operationApplication.continuityRequestService.getStoredRequest(
        requestId,
      );
      assert.deepEqual(operationRequest, originalRequest);
      markOutcomeUnknown(
        operationApplication.database.connection,
        operationRequest,
        'operation-illegal-drift',
      );
      const operationOutcome = await operationApplication.continuityDeliveryService
        .submitStoredRequest(requestId);
      assert.equal(operationOutcome.delivery.status, 'quarantined');
      assert.equal(operationOutcome.delivery.lastErrorCode, 'operation_id_mismatch');
      assert.equal(
        operationApplication.continuityResultService.getProjectionHead('subject-001'),
        null,
      );

      const idempotency = await environment.normalTransport().submitCanonicalRequest(
        canonicalizeJson(hashRequest),
      );
      assert.equal(idempotency.statusCode, 200);
      assert.equal(idempotency.payload.error.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal(idempotency.payload.error.retryClass, 'never');
      const errorRecord = hashApplication.continuityResultService.receiveResult(
        requestId,
        idempotency.payload,
      );
      assert.equal(errorRecord.processingStage, 'terminal_error');
      assert.deepEqual(
        environment.application.continuityResultService.getStoredResult(requestId).envelope,
        stable,
      );
      assert.equal(
        environment.application.continuityResultService.getProjectionHead('subject-001')
          .currentRevision,
        0,
      );

      await environment.stopEngine();
      const inspection = environment.inspect();
      assert.equal(inspection.revision, 0);
      assert.equal(inspection.operationCount, 1);
      assert.equal(inspection.completedCount, 1);
      assert.equal(inspection.wakeCount, 1);
      assert.equal(inspection.thinkingCount, 1);
      assert.equal(inspection.eventCount, 0);
      assert.equal(inspection.updates.length, 0);
    } finally {
      if (hashApplication) await hashApplication.stop();
      if (operationApplication) await operationApplication.stop();
      await environment.cleanup();
    }
  });
});
