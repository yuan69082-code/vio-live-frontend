import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  ContinuityTransportError,
  createHttpContinuityIntegrationTransport,
} from '../src/integrations/continuity-engine/http-continuity-integration-transport.js';
import { createOpenAiCompatibleModelExecutor } from '../src/integrations/model-providers/openai-compatible-model-executor.js';
import { createEnvironmentApiCredentialStore } from '../src/integrations/secrets/environment-api-credential-store.js';
import { validateCapabilityRequiredEnvelope } from '../src/modules/continuity-integration/capability-validator.js';
import { canonicalizeJson, sha256Hash } from '../src/modules/continuity-integration/first-round-hashing.js';
import { EXPECTED_BINDING_FIXTURE_HASH, fixedSubjectBindingFixture } from '../src/modules/continuity-integration/first-round-contract.js';
import {
  approveLatestExecutionConfirmation,
  configureV4Execution,
  prepareV1Request,
  seedV4Platform,
} from '../test-support/continuity-capability-v4-fixtures.js';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(TEST_DIRECTORY, '..');
const VIO_BASELINE = '7054577fb55bcc26a28a9c9a90201f5f07f0c0ee';
const ENGINE_BASELINE = '7a1dacae9401e1742aaf6ddbaa26f1b456880383';

function requireEngineRepository(value = process.env.CONTINUITY_ENGINE_REPO) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('CONTINUITY_ENGINE_REPO is required for the S4 Capability shared test.');
  }
  const root = resolve(value);
  const server = join(root, 'src', 'continuity_engine', 'integration_server.py');
  if (!statSync(root).isDirectory() || !statSync(server).isFile()) {
    throw new Error('CONTINUITY_ENGINE_REPO does not contain the E5-A integration server.');
  }
  return root;
}

function git(root, ...args) {
  return execFileSync('git', ['-c', `safe.directory=${root}`, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  }).trim();
}

function assertGitAncestor(root, ancestor, descendant = 'HEAD') {
  assert.doesNotThrow(() => execFileSync('git', [
    '-c', `safe.directory=${root}`, 'merge-base', '--is-ancestor', ancestor, descendant,
  ], { cwd: root, windowsHide: true }));
}

function assertCapabilitySchemasMatch(engineRoot) {
  const names = [
    'capability-request.v1.schema.json',
    'capability-result.v1.schema.json',
    'capability-model-output.v1.schema.json',
  ];
  for (const name of names) {
    const local = JSON.parse(readFileSync(join(
      BACKEND_ROOT, 'src', 'modules', 'continuity-integration', 'schemas', name,
    ), 'utf8'));
    const engine = JSON.parse(execFileSync('git', [
      '-c', `safe.directory=${engineRoot}`, 'show',
      `${ENGINE_BASELINE}:src/continuity_engine/interfaces/schemas/${name}`,
    ], { cwd: engineRoot, encoding: 'utf8', windowsHide: true }));
    assert.deepEqual(local, engine, `${name} must match Engine E5-A exactly after JSON parsing`);
  }
}

function pythonEnvironment(engineRoot, serviceToken = null) {
  const environment = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: [join(engineRoot, 'src'), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
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
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  return port;
}

function initializeEngine({ engineRoot, dataDir, bindingFile, pythonCommand }) {
  const output = execFileSync(pythonCommand, [
    '-m', 'continuity_engine.integration_server', 'init',
    '--data-dir', dataDir,
    '--binding-file', bindingFile,
    '--binding-fixture-hash', EXPECTED_BINDING_FIXTURE_HASH,
    '--cycle-id', 's4-capability-cycle-001',
  ], {
    cwd: engineRoot,
    env: pythonEnvironment(engineRoot),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.match(output, /local integration data is initialized/);
}

async function startEngine({ engineRoot, dataDir, port, serviceToken, pythonCommand }) {
  const child = spawn(pythonCommand, [
    '-m', 'continuity_engine.integration_server', 'serve',
    '--data-dir', dataDir,
    '--port', String(port),
    '--thinking-mode', 'capability',
  ], {
    cwd: engineRoot,
    env: pythonEnvironment(engineRoot, serviceToken),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
  const closed = once(child, 'close');
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`E5-A exited before readiness: ${output}`);
    try {
      const live = await fetch(`${baseUrl}/health/live`);
      const ready = await fetch(`${baseUrl}/health/ready`);
      if (live.status === 200 && ready.status === 200) break;
    } catch {
      // The loopback listener may not yet have bound the reserved port.
    }
    if (Date.now() >= deadline) throw new Error(`E5-A did not become ready: ${output}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return {
    baseUrl,
    get output() { return output; },
    async stop() {
      if (child.exitCode === null) child.kill();
      await closed;
    },
  };
}

async function startProvider(sequence) {
  const calls = [];
  const secret = `s4_${randomBytes(24).toString('hex')}`;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const index = calls.length;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
      calls.push({
        path: request.url,
        method: request.method,
        authorizationMatches: request.headers.authorization === `Bearer ${secret}`,
        model: body?.model,
        stream: body?.stream,
        messageCount: body?.messages?.length,
      });
      const kind = sequence[Math.min(index, sequence.length - 1)];
      if (kind === 'retryable') {
        response.writeHead(429, { 'content-type': 'application/json', connection: 'close' });
        response.end('{"error":"rate_limited"}');
        return;
      }
      if (kind === 'terminal') {
        response.writeHead(400, { 'content-type': 'application/json', connection: 'close' });
        response.end('{"error":"invalid_request"}');
        return;
      }
      if (kind === 'unknown') {
        response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        response.write('{"choices":[{"message":{"content":"uncertain');
        response.socket?.destroy();
        return;
      }
      const payload = Buffer.from(JSON.stringify({
        choices: [{ message: { content: 'Provider candidate accepted only through Engine.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }));
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': payload.length,
        connection: 'close',
      });
      response.end(payload);
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    secret,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

function config({ databasePath, baseUrl, serviceToken }) {
  return loadConfig({
    VIO_BACKEND_HOST: '127.0.0.1',
    VIO_BACKEND_PORT: '0',
    VIO_BACKEND_DB_PATH: databasePath,
    VIO_CONTINUITY_ENGINE_ENABLED: 'true',
    VIO_CONTINUITY_ENGINE_BASE_URL: baseUrl,
    VIO_CONTINUITY_ENGINE_TOKEN: serviceToken,
    VIO_CONTINUITY_ENGINE_CONNECT_TIMEOUT_MS: '2000',
    VIO_CONTINUITY_ENGINE_RESPONSE_TIMEOUT_MS: '20000',
  });
}

function realTransport(values) {
  return createHttpContinuityIntegrationTransport({
    baseUrl: values.baseUrl,
    serviceToken: values.serviceToken,
    connectTimeoutMs: 2_000,
    responseTimeoutMs: 20_000,
    maxResponseBytes: 2_097_152,
  });
}

function droppedCapabilityResponseTransport(base, state) {
  return Object.freeze({
    mode: 's4-test-only-response-loss-wrapper',
    testOnly: true,
    checkReady: (...args) => base.checkReady(...args),
    submitCanonicalRequest: (...args) => base.submitCanonicalRequest(...args),
    queryRequest: (...args) => base.queryRequest(...args),
    async submitCapabilityResult(...args) {
      const response = await base.submitCapabilityResult(...args);
      if (!state.dropped) {
        state.dropped = true;
        throw new ContinuityTransportError('S4 discarded an already received loopback response.', {
          transportCode: 'response_timeout', outcomeUnknown: true,
        });
      }
      return response;
    },
  });
}

async function createEnvironment(name, sequence, { dropCapabilityResponse = false } = {}) {
  const engineRoot = requireEngineRepository();
  assert.equal(git(engineRoot, 'rev-parse', 'HEAD'), ENGINE_BASELINE);
  assert.equal(git(engineRoot, 'status', '--short'), '');
  const pythonCommand = process.env.PYTHON || 'python';
  const root = mkdtempSync(join(tmpdir(), `vio-s4-${name}-`));
  const engineData = join(root, 'engine-data');
  const bindingFile = join(root, 'binding.json');
  const databasePath = join(root, 'vio.sqlite');
  const serviceToken = randomBytes(32).toString('hex');
  const enginePort = await reserveLoopbackPort();
  const provider = await startProvider(sequence);
  writeFileSync(bindingFile, JSON.stringify(fixedSubjectBindingFixture()), 'utf8');
  initializeEngine({ engineRoot, dataDir: engineData, bindingFile, pythonCommand });
  let engine = await startEngine({ engineRoot, dataDir: engineData, port: enginePort, serviceToken, pythonCommand });
  const lossState = { dropped: false };
  let application;

  async function startVio(seed = false) {
    const base = realTransport({ baseUrl: engine.baseUrl, serviceToken });
    const transport = dropCapabilityResponse ? droppedCapabilityResponseTransport(base, lossState) : base;
    const credentialStore = createEnvironmentApiCredentialStore({ VIO_MODEL_API_KEY_TEST: provider.secret });
    const modelExecutor = createOpenAiCompatibleModelExecutor({
      allowLoopbackHttp: true,
      connectTimeoutMs: 1_000,
      responseTimeoutMs: 2_000,
    });
    application = createApplication({
      config: config({ databasePath, baseUrl: engine.baseUrl, serviceToken }),
      logger: { error() {} },
      continuityTransport: transport,
      credentialStore,
      modelExecutor,
    });
    if (seed) {
      seedV4Platform(application.database.connection, `S4 ${name}`);
      configureV4Execution(application, { baseUrl: provider.baseUrl });
    }
    await application.start();
    return application;
  }

  await startVio(true);
  return {
    engineRoot, root, engineData, databasePath, serviceToken, provider, lossState,
    get application() { return application; },
    get engine() { return engine; },
    normalTransport() { return realTransport({ baseUrl: engine.baseUrl, serviceToken }); },
    async restartVio() {
      await application.stop();
      return startVio(false);
    },
    async restartEngine() {
      await engine.stop();
      engine = await startEngine({ engineRoot, dataDir: engineData, port: enginePort, serviceToken, pythonCommand });
      return engine;
    },
    async cleanup() {
      await application?.stop();
      await engine?.stop();
      await provider.close();
      assertSecretsAbsent(root, [serviceToken, provider.secret]);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function assertSecretsAbsent(root, secrets) {
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else {
        const content = readFileSync(path);
        for (const secret of secrets) assert.ok(!content.includes(Buffer.from(secret, 'utf8')));
      }
    }
  };
  visit(root);
}

function one(connection, sql, ...parameters) {
  return connection.prepare(sql).get(...parameters);
}

function count(connection, table) {
  return one(connection, `SELECT COUNT(*) AS count FROM ${table}`).count;
}

function vioSnapshot(connection) {
  const head = one(connection, 'SELECT current_revision FROM continuity_engine_state_projection_heads');
  return {
    requests: count(connection, 'continuity_first_round_requests'),
    capabilityRequests: count(connection, 'continuity_capability_requests'),
    executions: count(connection, 'continuity_capability_model_executions'),
    capabilityResults: count(connection, 'continuity_capability_results'),
    usage: count(connection, 'continuity_capability_usage_facts'),
    v2Results: count(connection, 'continuity_first_round_results'),
    projections: count(connection, 'continuity_engine_state_projection_versions'),
    receipts: count(connection, 'continuity_engine_state_projection_receipts'),
    head: head?.current_revision ?? null,
    subjectMessages: one(connection, "SELECT COUNT(*) AS count FROM messages WHERE sender_type='subject'").count,
    legacyStates: count(connection, 'subject_states'),
    legacyHeads: count(connection, 'subject_state_heads'),
  };
}

function inspectEngine(environment) {
  const source = [
    'import json, sys',
    'from continuity_engine.domain.capability import IntegrationThinkingMode',
    'from continuity_engine.interfaces.local_integration_app import build_local_integration_app',
    'from continuity_engine.storage.json_thinking_repository import JsonThinkingRepository',
    'app = build_local_integration_app(sys.argv[1], thinking_mode=IntegrationThinkingMode.CAPABILITY)',
    'state = app.subject_states.load(app.binding.subject_id)',
    'updates = app.subject_states.get_update_history(app.binding.subject_id)',
    'operations = app.ledger.list_operations()',
    'wake = app.awakening_repository.list_sessions(app.binding.subject_id)',
    'thinking = JsonThinkingRepository(app.data_dir).list_think_sessions(app.binding.subject_id)',
    'capability_requests = [app.ledger.find_capability_request_by_operation(item.operation_id) for item in operations]',
    'attempts = [attempt for req in capability_requests if req is not None for attempt in app.ledger.list_capability_attempts(req.capability_request_id)]',
    'print(json.dumps({',
    '  "revision": state.revision,',
    '  "updateCount": len(updates),',
    '  "eventIds": [item.event.event_id for item in updates],',
    '  "operationCount": len(operations),',
    '  "completedCount": len(app.ledger.list_completed()),',
    '  "wakeCount": len(wake),',
    '  "thinkingCount": len(thinking),',
    '  "capabilityRequestCount": len([item for item in capability_requests if item is not None]),',
    '  "capabilityAttemptCount": len(attempts),',
    '  "operations": [item.to_dict() for item in operations],',
    '  "attempts": [item.to_dict() for item in attempts],',
    '}))',
  ].join('\n');
  return JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', source, environment.engineData], {
    cwd: environment.engineRoot,
    env: pythonEnvironment(environment.engineRoot),
    encoding: 'utf8',
    windowsHide: true,
  }));
}

async function beginCapability(environment, requestId = 'request-001') {
  const request = prepareV1Request(environment.application, requestId);
  const outcome = await environment.application.continuityDeliveryService.submitStoredRequest(request.requestId);
  assert.equal(outcome.delivery.status, 'outcome_unknown');
  const capability = one(environment.application.database.connection,
    'SELECT * FROM continuity_capability_requests WHERE request_id=?', requestId);
  assert.ok(capability);
  assert.equal(environment.provider.calls.length, 0);
  return { request, capability };
}

async function approveAndResume(environment, capabilityRequestId, extra = {}) {
  const confirmationId = approveLatestExecutionConfirmation(environment.application);
  return environment.application.continuityDeliveryService.resumeCapability(capabilityRequestId, {
    securityConfirmationId: confirmationId,
    ...extra,
  });
}

async function approveRetryAndResume(environment, capabilityRequestId) {
  const waiting = await environment.application.continuityDeliveryService.resumeCapability(capabilityRequestId, {
    retryApproved: true,
  });
  assert.equal(waiting.delivery.status, 'outcome_unknown');
  const confirmationId = approveLatestExecutionConfirmation(environment.application);
  return environment.application.continuityDeliveryService.resumeCapability(capabilityRequestId, {
    retryApproved: true,
    securityConfirmationId: confirmationId,
  });
}

async function rawPostResult(environment, payload) {
  const response = await fetch(`${environment.engine.baseUrl}/internal/v1/continuity/capability-results`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${environment.serviceToken}`,
      'content-type': 'application/json; charset=utf-8',
      connection: 'close',
    },
    body: JSON.stringify(payload),
  });
  return { statusCode: response.status, payload: await response.json() };
}

function invalidSucceededResult(capabilityRequest, overrides = {}) {
  const output = {
    schemaVersion: 'continuity-model-output/v1',
    responseCandidate: 'Negative-boundary candidate.',
    metadata: { finishReason: 'stop' },
  };
  const startedAt = new Date(Date.parse(capabilityRequest.createdAt) + 1_000).toISOString();
  return {
    contractVersion: 'continuity-capability/v1',
    schemaVersion: 'continuity-capability-result/v1',
    capabilityResultId: 's4-boundary-result-001',
    capabilityRequestId: capabilityRequest.capabilityRequestId,
    operationId: capabilityRequest.operationId,
    requestId: capabilityRequest.requestId,
    requestHash: capabilityRequest.requestHash,
    subjectId: capabilityRequest.subjectId,
    bindingId: capabilityRequest.bindingId,
    bindingVersion: capabilityRequest.bindingVersion,
    status: 'SUCCEEDED',
    capabilityType: 'model.generate',
    provider: { providerType: 'model', providerId: 's4-boundary-provider', modelName: 's4-boundary-model' },
    output,
    contentHash: sha256Hash(canonicalizeJson(output)),
    startedAt,
    completedAt: new Date(Date.parse(startedAt) + 1_000).toISOString(),
    actualUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    vioLedgerEntryId: 's4-boundary-ledger-001',
    errorCode: null,
    retryClass: null,
    auditRef: 's4-boundary-audit-001',
    executionFact: true,
    ...overrides,
  };
}

test('S4 Vio V4 x Continuity Engine E5-A formal local Capability shared acceptance', async (t) => {
  const engineRoot = requireEngineRepository();
  assertGitAncestor(BACKEND_ROOT, VIO_BASELINE);
  assert.equal(git(engineRoot, 'rev-parse', 'HEAD'), ENGINE_BASELINE);
  assert.equal(git(engineRoot, 'rev-parse', 'origin/main'), ENGINE_BASELINE);
  assert.equal(git(engineRoot, 'status', '--short'), '');

  await t.test('S4-A starts the real capability server with aligned schemas and clean baselines', async () => {
    const environment = await createEnvironment('startup', ['success']);
    try {
      const live = await fetch(`${environment.engine.baseUrl}/health/live`);
      const ready = await fetch(`${environment.engine.baseUrl}/health/ready`);
      assert.equal(live.status, 200);
      assert.equal(ready.status, 200);
      assert.match(environment.engine.baseUrl, /^http:\/\/127\.0\.0\.1:/);
      assert.ok(!environment.engine.output.includes(environment.serviceToken));
      assertCapabilitySchemasMatch(environment.engineRoot);
      assert.equal(inspectEngine(environment).revision, 0);
    } finally { await environment.cleanup(); }
  });

  await t.test('S4-B/C completes the real loopback model path and preserves exact replay across restarts', async () => {
    const environment = await createEnvironment('success', ['success']);
    try {
      const { request, capability } = await beginCapability(environment);
      const completed = await approveAndResume(environment, capability.capability_request_id);
      assert.equal(completed.delivery.status, 'completed');
      assert.equal(environment.provider.calls.length, 1);
      assert.deepEqual(environment.provider.calls[0], {
        path: '/chat/completions', method: 'POST', authorizationMatches: true,
        model: 'v4-model', stream: false, messageCount: 1,
      });
      assert.equal(completed.result.envelope.response.content, 'Provider candidate accepted only through Engine.');
      assert.equal(completed.result.envelope.stateProjection.changed, false);
      assert.equal(completed.result.envelope.stateProjection.currentRevision, 0);
      const before = vioSnapshot(environment.application.database.connection);
      assert.deepEqual(before, {
        requests: 1, capabilityRequests: 1, executions: 1, capabilityResults: 1,
        usage: 1, v2Results: 1, projections: 1, receipts: 1, head: 0,
        subjectMessages: 0, legacyStates: 0, legacyHeads: 0,
      });
      const usage = one(environment.application.database.connection,
        'SELECT usage_status,total_tokens,cost_status,cost_amount_micros FROM continuity_capability_usage_facts');
      assert.deepEqual({ ...usage }, {
        usage_status: 'provider_reported', total_tokens: 19,
        cost_status: 'not_reported', cost_amount_micros: null,
      });
      assert.equal(one(environment.application.database.connection,
        'SELECT status FROM continuity_capability_result_outbox').status, 'completed');
      const decision = JSON.parse(one(environment.application.database.connection,
        'SELECT decision_json FROM continuity_capability_decisions ORDER BY created_at DESC, decision_id DESC LIMIT 1').decision_json);
      assert.equal(decision.externalOperation.operationType, 'privacy_access_request');
      const engineBeforeReplay = inspectEngine(environment);
      assert.equal(engineBeforeReplay.operations[0].domainProgress.stage, 'action_completed');
      const resultRow = one(environment.application.database.connection,
        'SELECT result_json FROM continuity_capability_results');
      const firstResult = JSON.parse(resultRow.result_json);
      const exact = await environment.normalTransport().submitCapabilityResult(canonicalizeJson(firstResult));
      assert.equal(exact.payload.status, 'completed');
      assert.equal(exact.payload.operationId, completed.result.envelope.operationId);
      const initialQuery = await environment.normalTransport().queryRequest(request.requestId);
      assert.equal(initialQuery.payload.status, 'completed');
      assert.equal(initialQuery.payload.result.operationId, completed.result.envelope.operationId);
      const changed = structuredClone(firstResult);
      changed.output.responseCandidate = 'different';
      changed.contentHash = sha256Hash(canonicalizeJson(changed.output));
      await assert.rejects(
        () => environment.normalTransport().submitCapabilityResult(canonicalizeJson(changed)),
        (error) => error instanceof ContinuityTransportError && error.httpStatus === 409,
      );
      await environment.restartVio();
      const localReplay = await environment.application.continuityDeliveryService.submitStoredRequest(request.requestId);
      assert.equal(localReplay.delivery.status, 'completed');
      assert.equal(environment.provider.calls.length, 1);
      await environment.restartEngine();
      const query = await environment.normalTransport().queryRequest(request.requestId);
      assert.equal(query.payload.status, 'completed');
      assert.equal(query.payload.result.operationId, completed.result.envelope.operationId);
      const restartedReplay = await environment.normalTransport().submitCapabilityResult(canonicalizeJson(firstResult));
      assert.equal(restartedReplay.payload.status, 'completed');
      assert.equal(environment.provider.calls.length, 1);
      assert.deepEqual(vioSnapshot(environment.application.database.connection), before);
      const engine = inspectEngine(environment);
      assert.deepEqual(engine, engineBeforeReplay);
      assert.equal(engine.revision, 0);
      assert.equal(engine.operationCount, 1);
      assert.equal(engine.completedCount, 1);
      assert.equal(engine.wakeCount, 1);
      assert.equal(engine.thinkingCount, 1);
      assert.equal(engine.capabilityRequestCount, 1);
      assert.equal(engine.capabilityAttemptCount, 1);
      assert.equal(engine.updateCount, 0);
    } finally { await environment.cleanup(); }
  });

  await t.test('S4-D accepts retryable facts and calls Provider again only after explicit retry approval', async () => {
    const environment = await createEnvironment('retry', ['retryable', 'success']);
    try {
      const { capability } = await beginCapability(environment);
      const first = await approveAndResume(environment, capability.capability_request_id);
      assert.equal(first.delivery.status, 'outcome_unknown');
      assert.equal(environment.provider.calls.length, 1);
      assert.equal(one(environment.application.database.connection,
        'SELECT status FROM continuity_capability_requests').status, 'waiting_retry');
      await environment.application.continuityDeliveryService.resumeCapability(capability.capability_request_id);
      assert.equal(environment.provider.calls.length, 1);
      await environment.restartVio();
      await environment.restartEngine();
      assert.equal(environment.provider.calls.length, 1);
      const second = await approveRetryAndResume(environment, capability.capability_request_id);
      assert.equal(second.delivery.status, 'completed');
      assert.equal(environment.provider.calls.length, 2);
      const connection = environment.application.database.connection;
      assert.deepEqual(connection.prepare(
        'SELECT status FROM continuity_capability_results ORDER BY created_at, capability_result_id').all().map(({ status }) => status),
      ['FAILED_RETRYABLE', 'SUCCEEDED']);
      assert.equal(count(connection, 'continuity_capability_model_executions'), 2);
      assert.equal(count(connection, 'continuity_capability_usage_facts'), 2);
      assert.equal(count(connection, 'continuity_first_round_results'), 1);
      assert.equal(count(connection, 'continuity_engine_state_projection_versions'), 1);
      assert.equal(count(connection, 'continuity_engine_state_projection_receipts'), 1);
      assert.deepEqual(connection.prepare(
        'SELECT status FROM continuity_capability_result_outbox ORDER BY created_at, capability_result_id').all().map(({ status }) => status).sort(),
      ['accepted', 'completed']);
      assert.equal(connection.prepare(
        'SELECT COUNT(DISTINCT capability_result_id) AS count FROM continuity_capability_results').get().count, 2);
      const engine = inspectEngine(environment);
      assert.equal(engine.capabilityAttemptCount, 2);
      assert.equal(engine.wakeCount, 1);
      assert.equal(engine.thinkingCount, 1);
      assert.equal(engine.revision, 0);
      await assert.rejects(
        () => environment.application.continuityDeliveryService.resumeCapability(capability.capability_request_id, { retryApproved: true }),
        /not waiting for an internal resume/,
      );
      assert.equal(environment.provider.calls.length, 2);
    } finally { await environment.cleanup(); }
  });

  await t.test('S4-E maps Provider 400 to terminal capability_failed without a V2 success', async () => {
    const environment = await createEnvironment('terminal', ['terminal']);
    try {
      const { request, capability } = await beginCapability(environment);
      const failed = await approveAndResume(environment, capability.capability_request_id);
      assert.equal(failed.delivery.status, 'completed');
      assert.equal(environment.provider.calls.length, 1);
      const connection = environment.application.database.connection;
      assert.equal(one(connection, 'SELECT status FROM continuity_capability_results').status, 'FAILED_TERMINAL');
      assert.equal(count(connection, 'continuity_first_round_results'), 0);
      assert.equal(count(connection, 'continuity_engine_state_projection_versions'), 0);
      assert.equal(count(connection, 'continuity_engine_state_projection_receipts'), 0);
      assert.equal(one(connection, 'SELECT status FROM continuity_capability_result_outbox').status, 'failed');
      assert.equal(one(connection, 'SELECT status FROM continuity_capability_requests').status, 'failed');
      const query = await environment.normalTransport().queryRequest(request.requestId);
      assert.equal(query.payload.status, 'capability_failed');
      await assert.rejects(
        () => environment.application.continuityDeliveryService.resumeCapability(capability.capability_request_id, { retryApproved: true }),
        /not waiting for an internal resume/,
      );
      await environment.restartVio();
      await environment.restartEngine();
      await environment.application.continuityDeliveryService.submitStoredRequest(request.requestId);
      assert.equal(environment.provider.calls.length, 1);
      const engine = inspectEngine(environment);
      assert.equal(engine.capabilityAttemptCount, 1);
      assert.equal(engine.completedCount, 0);
      assert.equal(engine.revision, 0);
      assert.equal(engine.updateCount, 0);
    } finally { await environment.cleanup(); }
  });

  await t.test('S4-F keeps Provider UNKNOWN fail closed and recovers lost callback only by query/exact replay', async () => {
    const unknown = await createEnvironment('unknown', ['unknown']);
    try {
      const { capability } = await beginCapability(unknown);
      const outcome = await approveAndResume(unknown, capability.capability_request_id);
      assert.equal(outcome.delivery.status, 'outcome_unknown');
      assert.equal(unknown.provider.calls.length, 1);
      assert.equal(one(unknown.application.database.connection,
        'SELECT status FROM continuity_capability_results').status, 'UNKNOWN');
      assert.equal(one(unknown.application.database.connection,
        'SELECT status FROM continuity_capability_requests').status, 'provider_outcome_unknown');
      assert.deepEqual({ ...one(unknown.application.database.connection,
        'SELECT usage_status,total_tokens,cost_status,cost_amount_micros FROM continuity_capability_usage_facts') }, {
        usage_status: 'unknown', total_tokens: 0,
        cost_status: 'not_reported', cost_amount_micros: null,
      });
      assert.equal(one(unknown.application.database.connection,
        'SELECT status FROM continuity_capability_result_outbox').status, 'accepted');
      await assert.rejects(
        () => unknown.application.continuityDeliveryService.resumeCapability(capability.capability_request_id),
        /not waiting for an internal resume/,
      );
      await unknown.restartVio();
      await unknown.restartEngine();
      await unknown.application.continuityDeliveryService.submitStoredRequest('request-001');
      assert.equal(unknown.provider.calls.length, 1);
      assert.equal(count(unknown.application.database.connection, 'continuity_capability_results'), 1);
      assert.equal(inspectEngine(unknown).capabilityAttemptCount, 1);
    } finally { await unknown.cleanup(); }

    const lost = await createEnvironment('callback-loss', ['success'], { dropCapabilityResponse: true });
    try {
      const { request, capability } = await beginCapability(lost);
      const first = await approveAndResume(lost, capability.capability_request_id);
      assert.equal(first.delivery.status, 'outcome_unknown');
      assert.equal(lost.lossState.dropped, true);
      assert.equal(lost.provider.calls.length, 1);
      const recovered = await lost.application.continuityDeliveryService.submitStoredRequest(request.requestId);
      assert.equal(recovered.delivery.status, 'completed');
      assert.equal(lost.provider.calls.length, 1);
      assert.equal(count(lost.application.database.connection, 'continuity_capability_results'), 1);
      assert.equal(count(lost.application.database.connection, 'continuity_first_round_results'), 1);
      assert.equal(one(lost.application.database.connection,
        'SELECT status FROM continuity_capability_result_outbox').status, 'completed');
      assert.equal(inspectEngine(lost).capabilityAttemptCount, 1);
    } finally { await lost.cleanup(); }
  });

  await t.test('S4-G rejects unknown fields and identity conflicts without side effects', async () => {
    const environment = await createEnvironment('boundaries', ['success']);
    try {
      const { request, capability } = await beginCapability(environment);
      const envelope = JSON.parse(capability.envelope_json);
      assert.throws(() => validateCapabilityRequiredEnvelope({ ...envelope, unknown: true }, request), /invalid fields/);
      assert.throws(() => validateCapabilityRequiredEnvelope({
        ...envelope,
        capabilityRequest: { ...envelope.capabilityRequest, unknown: true },
      }, request), /unknown field/);
      const capabilityRequest = JSON.parse(capability.request_json);
      const before = inspectEngine(environment);
      const mismatches = [
        { requestId: 'request-other', capabilityResultId: 's4-wrong-request-result' },
        { requestHash: `sha256:${'f'.repeat(64)}`, capabilityResultId: 's4-wrong-hash-result' },
        { operationId: 'operation-other', capabilityResultId: 's4-wrong-operation-result' },
        { subjectId: 'subject-other', capabilityResultId: 's4-wrong-subject-result' },
        { bindingId: 'binding-other', capabilityResultId: 's4-wrong-binding-result' },
        { bindingVersion: 2, capabilityResultId: 's4-wrong-binding-version-result' },
        { capabilityRequestId: 'capability-request-other', capabilityResultId: 's4-wrong-capability-result' },
      ];
      for (const mismatch of mismatches) {
        const rejection = await rawPostResult(environment, invalidSucceededResult(capabilityRequest, mismatch));
        assert.ok([400, 404].includes(rejection.statusCode));
        assert.deepEqual(Object.keys(rejection.payload), ['error']);
        assert.ok(!JSON.stringify(rejection.payload).includes(environment.serviceToken));
        assert.ok(!JSON.stringify(rejection.payload).includes(environment.provider.secret));
      }
      const unknownField = invalidSucceededResult(capabilityRequest, {
        capabilityResultId: 's4-unknown-field-result',
      });
      unknownField.unknown = true;
      const invalidShape = await rawPostResult(environment, unknownField);
      assert.equal(invalidShape.statusCode, 400);
      assert.deepEqual(Object.keys(invalidShape.payload), ['error']);
      const after = inspectEngine(environment);
      assert.equal(after.capabilityAttemptCount, before.capabilityAttemptCount);
      assert.equal(after.revision, before.revision);
      assert.equal(after.updateCount, before.updateCount);
      assert.equal(environment.provider.calls.length, 0);
      const completed = await approveAndResume(environment, capability.capability_request_id);
      assert.equal(completed.delivery.status, 'completed');
      assert.equal(environment.provider.calls.length, 1);
    } finally { await environment.cleanup(); }
  });
});
