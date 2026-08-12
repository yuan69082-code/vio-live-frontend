import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOpenAiCompatibleModelExecutor } from '../src/integrations/model-providers/openai-compatible-model-executor.js';
import { createHttpContinuityIntegrationTransport } from '../src/integrations/continuity-engine/http-continuity-integration-transport.js';
import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import { loadConfig } from '../src/config.js';
import {
  CAPABILITY_REQUEST_SCHEMA_ID,
  CAPABILITY_RESULT_SCHEMA_ID,
  CAPABILITY_MODEL_OUTPUT_SCHEMA_ID,
} from '../src/modules/continuity-integration/capability-contract.js';
import { CAPABILITY_SCHEMA_REGISTRY } from '../src/modules/continuity-integration/capability-schema-registry.js';
import {
  validateCapabilityRequest,
  validateCapabilityRequiredEnvelope,
} from '../src/modules/continuity-integration/capability-validator.js';
import { validateCapabilityFailedEnvelope } from '../src/modules/continuity-integration/continuity-capability-service.js';
import { validateFirstRoundEngineEnvelope } from '../src/modules/continuity-integration/first-round-result-validator.js';
import { canonicalizeJson, sha256Hash } from '../src/modules/continuity-integration/first-round-hashing.js';
import {
  capabilityRequiredEnvelope,
  completedEnvelope,
  configureV4Execution,
  createEngineTransportDouble,
  createV4Application,
  prepareV1Request,
  SERVICE_TOKEN,
  seedV4Platform,
} from '../test-support/continuity-capability-v4-fixtures.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

async function startProvider() {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      const body = Buffer.from(JSON.stringify({
        choices: [{ message: { content: 'Provider candidate.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }));
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
      response.end(body);
    });
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolvePromise) => server.close(resolvePromise));
    },
  };
}

function engineCapabilityRequiredLiteral(request) {
  const input = {
    instruction: 'Reply helpfully using the supplied message fact.',
    messageFactId: request.platformFactPackage.facts[0].factId,
    observationId: request.observations[0].observationId,
    messageContent: request.platformFactPackage.facts[0].content,
    perceptionId: 'perception-engine-literal-001',
    perceptionSummary: 'The user sent a message.',
    currentFocus: 'Respond to the current user message.',
    sourceRevision: request.expectedEngineRevision,
    outputSchemaVersion: 'continuity-model-output/v1',
    maximumOutputCharacters: 4096,
  };
  const capabilityRequest = {
    contractVersion: 'continuity-capability/v1',
    schemaVersion: 'continuity-capability-request/v1',
    capabilityRequestId: 'capability-request-engine-literal-001',
    operationId: 'operation-engine-literal-001',
    requestId: request.requestId,
    requestHash: request.requestHash,
    subjectId: request.identity.subjectId,
    bindingId: request.identity.bindingId,
    bindingVersion: request.identity.bindingVersion,
    originatingSessionType: 'thinking',
    originatingSessionId: 'thinking-engine-literal-001',
    capabilityType: 'model.generate',
    taskType: 'conversation_response',
    inputSchemaVersion: 'continuity-model-input/v1',
    input,
    inputHash: sha256Hash(canonicalizeJson(input)),
    permissionRef: 'engine-permission:model.generate:subject-001',
    resourceRef: 'engine-resource:thinking:operation-engine-literal-001',
    riskLevel: 'MEDIUM',
    deadlineAt: '2099-08-10T00:10:00Z',
    idempotencyKey: `sha256:${'2'.repeat(64)}`,
    createdAt: '2026-08-10T00:00:01Z',
  };
  return {
    contractVersion: 'continuity-capability/v1',
    schemaVersion: 'continuity-capability-required/v1',
    status: 'capability_required',
    requestId: request.requestId,
    requestHash: request.requestHash,
    operationId: 'operation-engine-literal-001',
    subjectId: request.identity.subjectId,
    capabilityRequest,
    updatedAt: '2026-08-10T00:00:02Z',
  };
}

function configureModel(application, baseUrl) {
  const provider = application.apiProviderService.createProvider('user-001', {
    displayName: 'Local controlled provider', providerType: 'custom', baseUrl,
    interfaceFormat: 'openai_compatible', status: 'enabled',
  });
  const model = application.modelService.createModel('user-001', provider.providerId, {
    modelName: 'v4-local-model', modelType: 'chat', capabilities: ['chat'], costDescription: '',
  });
  application.permissionService.createPermission('user-001', {
    subjectId: 'assistant-001', resourceType: 'api', resourceId: provider.providerId,
    action: 'manage', permissionLevel: 'always_allow', status: 'active',
  });
  const pending = application.apiProviderService.bindCredentialReference('user-001', provider.providerId, {
    subjectId: 'assistant-001', secretRef: 'env:VIO_MODEL_API_KEY_TEST',
  });
  assert.equal(pending.operationStatus, 'confirmation_required');
  application.confirmationService.decideConfirmation(
    'user-001', pending.security.confirmation.confirmationId, { decision: 'approve' },
  );
  const bound = application.apiProviderService.bindCredentialReference('user-001', provider.providerId, {
    subjectId: 'assistant-001', secretRef: 'env:VIO_MODEL_API_KEY_TEST',
    confirmationId: pending.security.confirmation.confirmationId,
  });
  assert.equal(bound.operationStatus, 'completed');
  application.permissionService.createPermission('user-001', {
    subjectId: 'assistant-001', resourceType: 'api', resourceId: provider.providerId,
    action: 'execute', permissionLevel: 'always_allow', status: 'active',
  });
  application.proactiveInteractionService.upsertTokenBudget('user-001', 'assistant-001', {
    dailyTokenLimit: 1_000_000, sessionTokenLimit: 100_000,
    overagePolicy: 'block', status: 'enabled',
  });
  return { provider, model };
}

test('V4 registry contains the exact three fixed capability schema identifiers', () => {
  assert.deepEqual(new Set(CAPABILITY_SCHEMA_REGISTRY.schemaIds), new Set([
    CAPABILITY_REQUEST_SCHEMA_ID, CAPABILITY_RESULT_SCHEMA_ID,
    CAPABILITY_MODEL_OUTPUT_SCHEMA_ID,
  ]));
  for (const id of CAPABILITY_SCHEMA_REGISTRY.schemaIds) {
    assert.equal(CAPABILITY_SCHEMA_REGISTRY.getSchema(id).$id, id);
  }
});

test('Engine E5-A literal envelope versions stay distinct from completed v1.1 results', () => {
  const testDatabase = createTestDatabasePath();
  const { application } = createV4Application(testDatabase.databasePath, {
    modelExecutor: { execute() {} },
  });
  try {
    seedV4Platform(application.database.connection);
    const request = prepareV1Request(application, 'request-engine-literal-001');
    const required = engineCapabilityRequiredLiteral(request);
    assert.doesNotThrow(() => validateCapabilityRequiredEnvelope(required, request));
    assert.throws(() => validateCapabilityRequiredEnvelope({
      ...required,
      contractVersion: 'continuity-integration/v1.1',
    }, request), /version is unsupported/);

    const failed = {
      contractVersion: 'continuity-capability/v1',
      schemaVersion: 'continuity-capability-failed/v1',
      status: 'capability_failed',
      requestId: request.requestId,
      requestHash: request.requestHash,
      operationId: required.operationId,
      subjectId: request.identity.subjectId,
      capabilityRequestId: required.capabilityRequest.capabilityRequestId,
      failureStatus: 'FAILED_TERMINAL',
      errorCode: 'PROVIDER_REJECTED',
      retryClass: 'never',
      updatedAt: '2026-08-10T00:00:05Z',
    };
    assert.doesNotThrow(() => validateCapabilityFailedEnvelope(
      failed,
      required.capabilityRequest,
    ));
    assert.throws(() => validateCapabilityFailedEnvelope({
      ...failed,
      contractVersion: 'continuity-integration/v1.1',
    }, required.capabilityRequest), /does not match/);

    const completed = completedEnvelope(request, required.operationId);
    assert.doesNotThrow(() => validateFirstRoundEngineEnvelope(completed));
    assert.throws(() => validateFirstRoundEngineEnvelope({
      ...completed,
      contractVersion: 'continuity-capability/v1',
    }), /contractVersion/);
  } finally {
    void application.stop();
    testDatabase.remove();
  }
});

test('production transport posts the unwrapped canonical CapabilityResult over loopback HTTP', async () => {
  const received = {};
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.method = request.method;
      received.url = request.url;
      received.authorization = request.headers.authorization;
      received.connection = request.headers.connection;
      received.contentType = request.headers['content-type'];
      received.body = Buffer.concat(chunks);
      const body = Buffer.from(JSON.stringify({ status: 'capability_required' }));
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': body.length,
      });
      response.end(body);
    });
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  try {
    const transport = createHttpContinuityIntegrationTransport({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      serviceToken: SERVICE_TOKEN,
      connectTimeoutMs: 200,
      responseTimeoutMs: 500,
      maxResponseBytes: 64 * 1024,
    });
    const canonicalBody = Buffer.from('{"schemaVersion":"continuity-capability-result/v1"}', 'utf8');
    const result = await transport.submitCapabilityResult(canonicalBody);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.payload, { status: 'capability_required' });
    assert.equal(received.method, 'POST');
    assert.equal(received.url, '/internal/v1/continuity/capability-results');
    assert.equal(received.authorization, `Bearer ${SERVICE_TOKEN}`);
    assert.equal(received.connection, 'close');
    assert.equal(received.contentType, 'application/json; charset=utf-8');
    assert.deepEqual(received.body, canonicalBody);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('CapabilityRequest rejects unknown fields, invalid hash, invalid fixed values and deadline ordering', () => {
  const testDatabase = createTestDatabasePath();
  const { application } = createV4Application(testDatabase.databasePath, { modelExecutor: { execute() {} } });
  try {
    seedV4Platform(application.database.connection);
    const request = prepareV1Request(application);
    const valid = capabilityRequiredEnvelope(request).capabilityRequest;
    assert.doesNotThrow(() => validateCapabilityRequest(valid));
    assert.throws(() => validateCapabilityRequest({ ...valid, extra: true }), /unknown field/);
    assert.throws(() => validateCapabilityRequest({ ...valid, inputHash: `sha256:${'0'.repeat(64)}` }), /does not match/);
    assert.throws(() => validateCapabilityRequest({ ...valid, capabilityType: 'tool.execute' }), /must equal/);
    assert.throws(() => validateCapabilityRequest({ ...valid, deadlineAt: valid.createdAt }), /later than/);
    assert.throws(() => validateCapabilityRequest({ ...valid, deadlineAt: '2026-02-31T00:00:00Z' }), /RFC 3339/);
  } finally {
    void application.stop();
    testDatabase.remove();
  }
});

test('migration 021 creates the durable V4 ledger on a fresh database', () => {
  const testDatabase = createTestDatabasePath();
  const database = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: testDatabase.databasePath }));
  try {
    const tables = database.connection.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'continuity_capability_%' ORDER BY name`).all().map(({ name }) => name);
    assert.deepEqual(tables, [
      'continuity_capability_decisions', 'continuity_capability_incidents',
      'continuity_capability_model_executions', 'continuity_capability_requests',
      'continuity_capability_result_attempts', 'continuity_capability_result_outbox',
      'continuity_capability_results', 'continuity_capability_usage_facts',
    ]);
    assert.equal(database.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(database.connection.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version='021_create_continuity_capability_execution_ledger.sql'").get().count, 1);
    const executionColumns = database.connection.prepare("PRAGMA table_info('continuity_capability_model_executions')").all().map(({ name }) => name);
    const resultColumns = database.connection.prepare("PRAGMA table_info('continuity_capability_results')").all().map(({ name }) => name);
    const usageColumns = database.connection.prepare("PRAGMA table_info('continuity_capability_usage_facts')").all().map(({ name }) => name);
    assert.ok(executionColumns.includes('execution_number'));
    assert.ok(resultColumns.includes('execution_id'));
    assert.ok(usageColumns.includes('execution_id'));
    const successIndex = database.connection.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_continuity_capability_one_success'").get();
    assert.match(successIndex.sql, /WHERE status = 'SUCCEEDED'/);
  } finally { database.close(); testDatabase.remove(); }
});

test('an existing 001-020 database upgrades to 021 without changing old facts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vio-v4-upgrade-'));
  const migrations020 = join(directory, 'migrations-020');
  const databasePath = join(directory, 'upgrade.sqlite');
  cpSync(resolve('migrations'), migrations020, { recursive: true });
  const { rmSync: remove } = { rmSync };
  remove(join(migrations020, '021_create_continuity_capability_execution_ledger.sql'));
  remove(join(migrations020, '022_create_continuity_conversation_turn_ledger.sql'));
  const old = createSqliteDatabase({ databasePath, migrationsPath: migrations020 });
  old.connection.prepare(`INSERT INTO users (user_id,primary_email,display_name,status,created_at,updated_at) VALUES ('kept-user','kept@example.com','Kept','active',?,?)`).run('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  old.close();
  const upgraded = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: databasePath }));
  try {
    assert.equal(upgraded.connection.prepare("SELECT display_name FROM users WHERE user_id='kept-user'").get().display_name, 'Kept');
    assert.equal(upgraded.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { upgraded.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a failing 021 migration rolls back without partial V4 tables or migration record', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vio-v4-rollback-'));
  const migrations020 = join(directory, 'migrations-020');
  const brokenMigrations = join(directory, 'migrations-broken');
  const databasePath = join(directory, 'rollback.sqlite');
  cpSync(resolve('migrations'), migrations020, { recursive: true });
  rmSync(join(migrations020, '021_create_continuity_capability_execution_ledger.sql'));
  rmSync(join(migrations020, '022_create_continuity_conversation_turn_ledger.sql'));
  const before = createSqliteDatabase({ databasePath, migrationsPath: migrations020 });
  before.close();
  cpSync(resolve('migrations'), brokenMigrations, { recursive: true });
  const migration021 = join(brokenMigrations, '021_create_continuity_capability_execution_ledger.sql');
  writeFileSync(migration021, `${readFileSync(migration021, 'utf8')}\nTHIS IS INVALID SQL;\n`, 'utf8');
  assert.throws(() => createSqliteDatabase({ databasePath, migrationsPath: brokenMigrations }), /021_create_continuity/);
  const inspected = new DatabaseSync(databasePath);
  try {
    assert.equal(inspected.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version LIKE '021_%'").get().count, 0);
    assert.equal(inspected.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'continuity_capability_%'").get().count, 0);
  } finally { inspected.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('V1 -> V3 -> capability -> real loopback Provider -> V2 closes with durable usage', async () => {
  const provider = await startProvider();
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const executor = createOpenAiCompatibleModelExecutor({
    allowLoopbackHttp: true, connectTimeoutMs: 200, responseTimeoutMs: 500,
  });
  const { application } = createV4Application(testDatabase.databasePath, { transport, modelExecutor: executor });
  try {
    seedV4Platform(application.database.connection, 'hello capability');
    configureModel(application, provider.baseUrl);
    const request = prepareV1Request(application);
    const first = await application.continuityDeliveryService.submitStoredRequest(request.requestId);
    assert.equal(first.delivery.status, 'outcome_unknown');
    assert.equal(transport.state.resultPosts, 0);
    const confirmation = application.database.connection.prepare(`SELECT confirmation_id FROM security_confirmations WHERE resource_type='api' AND action='execute' AND status='pending' ORDER BY requested_at DESC LIMIT 1`).get();
    application.confirmationService.decideConfirmation('user-001', confirmation.confirmation_id, { decision: 'approve' });
    const completed = await application.continuityDeliveryService.resumeCapability('capability-request-001', {
      securityConfirmationId: confirmation.confirmation_id,
    });
    assert.equal(completed.delivery.status, 'completed');
    assert.equal(completed.result.processingStage, 'completed');
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0].headers.authorization, 'Bearer test-credential-value');
    assert.equal(provider.requests[0].body.model, 'v4-local-model');
    assert.equal(transport.state.resultPosts, 1);
    assert.equal(transport.state.capabilityResult.status, 'SUCCEEDED');
    assert.deepEqual(transport.state.capabilityResult.actualUsage, { inputTokens: 8, outputTokens: 3, totalTokens: 11 });
    const connection = application.database.connection;
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_capability_requests').get().count, 1);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_capability_results').get().count, 1);
    assert.equal(connection.prepare("SELECT total_tokens FROM continuity_capability_usage_facts WHERE usage_status='provider_reported'").get().total_tokens, 11);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_first_round_results').get().count, 1);
    assert.equal(connection.prepare('SELECT current_revision FROM continuity_engine_state_projection_heads').get().current_revision, 0);
  } finally {
    await application.stop();
    await provider.close();
    testDatabase.remove();
  }
});

test('Engine permissionRef cannot bypass a missing Vio API permission', async () => {
  let providerCalls = 0;
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const { application } = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: { async execute() { providerCalls += 1; throw new Error('must not run'); } },
  });
  try {
    seedV4Platform(application.database.connection);
    const provider = application.apiProviderService.createProvider('user-001', {
      displayName: 'No permission provider', providerType: 'custom', baseUrl: 'https://provider.invalid', interfaceFormat: 'openai_compatible',
    });
    application.modelService.createModel('user-001', provider.providerId, {
      modelName: 'model', modelType: 'chat', capabilities: ['chat'], costDescription: '',
    });
    application.proactiveInteractionService.upsertTokenBudget('user-001', 'assistant-001', {
      dailyTokenLimit: 100000, sessionTokenLimit: 10000, overagePolicy: 'block', status: 'enabled',
    });
    const request = prepareV1Request(application);
    const outcome = await application.continuityCapabilityService.handleCapabilityRequired(capabilityRequiredEnvelope(request), request);
    assert.equal(outcome.status, 'capability_failed');
    assert.equal(providerCalls, 0);
    assert.equal(transport.state.capabilityResult.errorCode, 'VIO_PERMISSION_DENIED');
  } finally { await application.stop(); testDatabase.remove(); }
});

test('external model execution security snapshot uses privacy access and trusted private-record classification', async () => {
  let providerCalls = 0;
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const { application } = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: { async execute() { providerCalls += 1; throw new Error('must wait'); } },
  });
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const request = prepareV1Request(application);
    await application.continuityDeliveryService.submitStoredRequest(request.requestId);
    assert.equal(providerCalls, 0);
    const audit = application.database.connection.prepare(`
      SELECT operation_type, resource_type, action, risk_level
      FROM audit_logs
      WHERE resource_type='api' AND action='execute'
      ORDER BY occurred_at DESC, audit_log_id DESC LIMIT 1
    `).get();
    assert.deepEqual({ ...audit }, {
      operation_type: 'privacy_access_request',
      resource_type: 'api',
      action: 'execute',
      risk_level: 'high',
    });
    const decision = JSON.parse(application.database.connection.prepare(`
      SELECT decision_json FROM continuity_capability_decisions
      ORDER BY created_at DESC, decision_id DESC LIMIT 1
    `).get().decision_json);
    assert.deepEqual(decision.externalOperation, {
      operationType: 'privacy_access_request',
      resourceType: 'api',
      action: 'execute',
      sensitiveDataCategories: ['private_record'],
    });
  } finally { await application.stop(); testDatabase.remove(); }
});

test('Capability inbox rejects cross-subject and operation identity mismatches', async () => {
  const testDatabase = createTestDatabasePath();
  const { application } = createV4Application(testDatabase.databasePath, { modelExecutor: { execute() {} } });
  try {
    seedV4Platform(application.database.connection);
    const request = prepareV1Request(application);
    const wrongSubject = capabilityRequiredEnvelope(request, { capabilityRequest: { subjectId: 'subject-other' } });
    await assert.rejects(() => application.continuityCapabilityService.handleCapabilityRequired(wrongSubject, request), /subjectId/);
    const wrongOperation = capabilityRequiredEnvelope(request, { envelope: { operationId: 'other-operation' } });
    await assert.rejects(() => application.continuityCapabilityService.handleCapabilityRequired(wrongOperation, request), /operationId/);
    assert.equal(application.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_requests').get().count, 0);
  } finally { await application.stop(); testDatabase.remove(); }
});

test('credential reference API rejects raw secret fields and never exposes secretRef', async () => {
  const testDatabase = createTestDatabasePath();
  const { application } = createV4Application(testDatabase.databasePath, { modelExecutor: { execute() {} } });
  try {
    seedV4Platform(application.database.connection);
    const provider = application.apiProviderService.createProvider('user-001', {
      displayName: 'Credential provider', providerType: 'custom', baseUrl: 'https://provider.invalid', interfaceFormat: 'openai_compatible',
    });
    assert.throws(() => application.apiProviderService.bindCredentialReference('user-001', provider.providerId, {
      subjectId: 'assistant-001', apiKey: 'raw-key',
    }), /credentials are not accepted/);
    assert.throws(() => application.apiProviderService.bindCredentialReference('user-001', provider.providerId, {
      subjectId: 'assistant-001', secretRef: 'env:OTHER_SECRET',
    }), /VIO_MODEL_API_KEY/);
    assert.equal(JSON.stringify(application.apiProviderService.getProvider('user-001', provider.providerId)).includes('secretRef'), false);
  } finally { await application.stop(); testDatabase.remove(); }
});

test('credential reference rotation preserves history and exposes only configured status', async () => {
  const testDatabase = createTestDatabasePath();
  const { application } = createV4Application(testDatabase.databasePath, { modelExecutor: { execute() {} } });
  try {
    seedV4Platform(application.database.connection);
    const { provider } = configureV4Execution(application);
    const pending = application.apiProviderService.bindCredentialReference('user-001', provider.providerId, {
      subjectId: 'assistant-001', secretRef: 'env:VIO_MODEL_API_KEY_ROTATED',
    });
    application.confirmationService.decideConfirmation(
      'user-001', pending.security.confirmation.confirmationId, { decision: 'approve' },
    );
    const rotated = application.apiProviderService.bindCredentialReference('user-001', provider.providerId, {
      subjectId: 'assistant-001', secretRef: 'env:VIO_MODEL_API_KEY_ROTATED',
      confirmationId: pending.security.confirmation.confirmationId,
    });
    assert.equal(rotated.operationStatus, 'completed');
    const rows = application.database.connection.prepare(`
      SELECT secret_ref, status FROM api_provider_credential_bindings
      WHERE owner_user_id=? AND provider_id=? ORDER BY created_at, credential_binding_id
    `).all('user-001', provider.providerId);
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((row) => row.status)), new Set(['superseded', 'active']));
    assert.equal(rows.find((row) => row.status === 'active').secret_ref, 'env:VIO_MODEL_API_KEY_ROTATED');
    assert.throws(() => application.database.connection.exec(`
      UPDATE api_provider_credential_bindings SET status='active', superseded_at=NULL
      WHERE status='superseded'
    `), /lifecycle is immutable/);
    const publicProvider = application.apiProviderService.getProvider('user-001', provider.providerId);
    assert.equal(publicProvider.credentials.apiKey.status, 'configured');
    assert.equal(JSON.stringify(publicProvider).includes('VIO_MODEL_API_KEY'), false);
  } finally { await application.stop(); testDatabase.remove(); }
});
