import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createOpenAiCompatibleModelExecutor } from '../src/integrations/model-providers/openai-compatible-model-executor.js';
import {
  EXPECTED_BINDING_FIXTURE_HASH,
  fixedSubjectBindingFixture,
} from '../src/modules/continuity-integration/first-round-contract.js';
import {
  LIVE_CHAT_CONFIGURATION,
  doctorLiveChat,
  inspectLiveChatEnvironment,
  inspectLiveChatRuntime,
} from '../src/modules/continuity-integration/live-chat-preparation-service.js';
import { createLiveChatSandbox } from '../src/modules/continuity-integration/live-chat-sandbox-service.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

const backendRoot = fileURLToPath(new URL('..', import.meta.url));
const scripts = Object.freeze({
  prepare: join(backendRoot, 'scripts', 'prepare-live-chat.js'),
  doctor: join(backendRoot, 'scripts', 'doctor-live-chat.js'),
  exportBinding: join(backendRoot, 'scripts', 'export-local-chat-binding.js'),
});

const LIVE_CHAT_ENVIRONMENT_NAMES = Object.freeze([
  'VIO_LIVE_PROVIDER_BASE_URL',
  'VIO_LIVE_MODEL_NAME',
  'VIO_LIVE_DAILY_TOKEN_LIMIT',
  'VIO_LIVE_SESSION_TOKEN_LIMIT',
  'VIO_MODEL_API_KEY_LIVE',
  'VIO_LIVE_SANDBOX_MANIFEST',
  'VIO_LIVE_BINDING_FILE',
  'VIO_LIVE_ENGINE_DATA_DIR',
  'VIO_LIVE_ENGINE_CYCLE_ID',
  'VIO_LIVE_ENGINE_THINKING_MODE',
  'VIO_CONTINUITY_ENGINE_ENABLED',
  'VIO_CONTINUITY_ENGINE_BASE_URL',
  'VIO_CONTINUITY_ENGINE_TOKEN',
  'CONTINUITY_ENGINE_INTEGRATION_TOKEN',
]);

function createShortSandboxFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'vs4-'));
  return Object.freeze({
    sandbox: createLiveChatSandbox({ root: join(directory, 's') }),
    remove() { rmSync(directory, { recursive: true, force: true }); },
  });
}

function environment(databasePath, overrides = {}) {
  return {
    ...process.env,
    VIO_BACKEND_DB_PATH: databasePath,
    VIO_LIVE_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
    VIO_LIVE_MODEL_NAME: 'vio-live-chat-model',
    VIO_LIVE_DAILY_TOKEN_LIMIT: '50000',
    VIO_LIVE_SESSION_TOKEN_LIMIT: '10000',
    VIO_MODEL_API_KEY_LIVE: randomBytes(32).toString('base64url'),
    ...overrides,
  };
}

function emptyLiveEnvironment(databasePath, overrides = {}) {
  const result = { ...process.env, VIO_BACKEND_DB_PATH: databasePath };
  for (const name of LIVE_CHAT_ENVIRONMENT_NAMES) delete result[name];
  return { ...result, ...overrides };
}

function clearLiveEnvironmentValues(environment) {
  const result = { ...environment };
  for (const name of LIVE_CHAT_ENVIRONMENT_NAMES) delete result[name];
  return result;
}

function createL1Application(databasePath, env) {
  return createApplication({
    config: loadConfig(env),
    environment: env,
    logger: { error() {} },
    modelExecutor: { async execute() { throw new Error('Provider must not be called by L1 preparation.'); } },
  });
}

function runScript(script, args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: backendRoot,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function runPnpm(scriptName, args, env) {
  return spawnSync('pnpm', [
    'run', scriptName, '--', ...args,
  ], {
    cwd: backendRoot,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

function runPnpmWithoutSeparator(scriptName, env) {
  return spawnSync('pnpm', ['run', scriptName], {
    cwd: backendRoot,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

function parseCommandJson(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  assert.notEqual(start, -1);
  assert.ok(end >= start);
  return JSON.parse(stdout.slice(start, end + 1));
}

function count(connection, table) {
  return connection.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
}

function apply(application) {
  return application.liveChatPreparationService.apply({
    acknowledgeExternalProvider: true,
    acknowledgePossibleCharges: true,
  });
}

test('L1 plan is read-only, performs no network and redacts the environment credential', async () => {
  const database = createTestDatabasePath();
  const env = environment(database.databasePath);
  const application = createL1Application(database.databasePath, env);
  await application.stop();
  const before = readFileSync(database.databasePath);
  const beforeMtime = statSync(database.databasePath).mtimeMs;
  const result = runScript(scripts.prepare, ['--plan'], env);
  try {
    assert.equal(result.status, 2);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, 'plan');
    assert.equal(output.status, 'missing');
    assert.equal(output.items.find(({ component }) => component === 'provider_api_key').status, 'present');
    assert.equal(result.stdout.includes(env.VIO_MODEL_API_KEY_LIVE), false);
    assert.equal(result.stderr.includes(env.VIO_MODEL_API_KEY_LIVE), false);
    assert.deepEqual(readFileSync(database.databasePath), before);
    assert.equal(statSync(database.databasePath).mtimeMs, beforeMtime);
  } finally {
    database.remove();
  }
});

test('L1 prepare refuses missing settings, unsafe URLs and either missing acknowledgement', () => {
  const database = createTestDatabasePath();
  try {
    for (const overrides of [
      { VIO_LIVE_PROVIDER_BASE_URL: '' },
      { VIO_LIVE_MODEL_NAME: '' },
      { VIO_MODEL_API_KEY_LIVE: '' },
      { VIO_LIVE_PROVIDER_BASE_URL: 'http://provider.example.test/v1' },
      { VIO_LIVE_PROVIDER_BASE_URL: 'https://user:pass@provider.example.test/v1' },
      { VIO_LIVE_PROVIDER_BASE_URL: 'https://provider.example.test/v1?key=x' },
      { VIO_LIVE_PROVIDER_BASE_URL: 'https://provider.example.test/v1#fragment' },
    ]) {
      const result = runScript(scripts.prepare, ['--apply', '--acknowledge-external-provider', '--acknowledge-possible-charges'], environment(database.databasePath, overrides));
      assert.equal(result.status, 2);
      assert.equal(existsSync(database.databasePath), false);
    }
    for (const args of [
      ['--apply', '--acknowledge-external-provider'],
      ['--apply', '--acknowledge-possible-charges'],
    ]) {
      const result = runScript(scripts.prepare, args, environment(database.databasePath));
      assert.equal(result.status, 2);
      assert.equal(existsSync(database.databasePath), false);
    }
  } finally {
    database.remove();
  }
});

test('L1 apply creates exact configuration through services and a second apply is exact reuse', async () => {
  const database = createTestDatabasePath();
  const env = environment(database.databasePath);
  const application = createL1Application(database.databasePath, env);
  try {
    const first = apply(application);
    assert.equal(first.status, 'configured');
    assert.equal(first.externalCall, 'not_performed');
    assert.equal(first.providerCharge, 'not_incurred');
    const connection = application.database.connection;
    const counts = {
      providers: count(connection, 'api_providers'),
      models: count(connection, 'models'),
      routes: count(connection, 'model_routing_rules'),
      permissions: count(connection, 'permissions'),
      budgets: count(connection, 'token_budgets'),
      credentials: count(connection, 'api_provider_credential_bindings'),
      confirmations: count(connection, 'security_confirmations'),
      audits: count(connection, 'audit_logs'),
    };
    assert.deepEqual(counts, {
      providers: 1, models: 1, routes: 1, permissions: 2, budgets: 1,
      credentials: 1, confirmations: 1, audits: 6,
    });
    assert.deepEqual({ ...connection.prepare('SELECT daily_token_limit, session_token_limit, overage_policy, status FROM token_budgets').get() }, {
      daily_token_limit: 50000,
      session_token_limit: 10000,
      overage_policy: 'block',
      status: 'enabled',
    });
    assert.deepEqual({ ...connection.prepare('SELECT status, user_choice, consumed_at IS NOT NULL consumed FROM security_confirmations').get() }, {
      status: 'consumed', user_choice: 'approve', consumed: 1,
    });

    const second = apply(application);
    assert.equal(second.providerId, first.providerId);
    assert.equal(second.modelId, first.modelId);
    assert.deepEqual({
      providers: count(connection, 'api_providers'),
      models: count(connection, 'models'),
      routes: count(connection, 'model_routing_rules'),
      permissions: count(connection, 'permissions'),
      budgets: count(connection, 'token_budgets'),
      credentials: count(connection, 'api_provider_credential_bindings'),
      confirmations: count(connection, 'security_confirmations'),
      audits: count(connection, 'audit_logs'),
    }, counts);
  } finally {
    await application.stop();
    database.remove();
  }
});

test('L1 conflicts fail closed for the fixed Profile, Provider, Model, route, Permission, Budget and credential', async (t) => {
  async function scenario(name, mutate) {
    await t.test(name, async () => {
      const database = createTestDatabasePath();
      const env = environment(database.databasePath);
      const application = createL1Application(database.databasePath, env);
      try {
        apply(application);
        mutate(application);
        assert.throws(() => apply(application), /conflict/i);
        assert.equal(count(application.database.connection, 'continuity_capability_model_executions'), 0);
      } finally {
        await application.stop();
        database.remove();
      }
    });
  }
  await scenario('fixed Profile', ({ database }) => database.connection.prepare("UPDATE assistant_global_settings SET relationship_definition='changed'").run());
  await scenario('Provider', ({ database }) => database.connection.prepare('UPDATE api_providers SET base_url=?').run('https://different.example.test/v1'));
  await scenario('Model', ({ database }) => database.connection.prepare('UPDATE models SET model_name=?').run('different-model'));
  await scenario('route', ({ database }) => database.connection.prepare("UPDATE model_routing_rules SET status='disabled'").run());
  await scenario('Permission', ({ database }) => database.connection.prepare("UPDATE permissions SET permission_level='denied' WHERE action='execute'").run());
  await scenario('Budget', ({ database }) => database.connection.prepare('UPDATE token_budgets SET daily_token_limit=49999').run());
  await scenario('credential', ({ database }) => {
    database.connection.exec('DROP TRIGGER protect_api_provider_credential_binding_identity;');
    database.connection.prepare("UPDATE api_provider_credential_bindings SET secret_ref='env:VIO_MODEL_API_KEY_OTHER'").run();
  });
});

test('L1 never stores or prints the API key and creates no execution, usage, result, Turn or Message', async () => {
  const database = createTestDatabasePath();
  const env = environment(database.databasePath);
  const secret = env.VIO_MODEL_API_KEY_LIVE;
  const result = runScript(scripts.prepare, [
    '--apply', '--acknowledge-external-provider', '--acknowledge-possible-charges',
  ], env);
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
    const bytes = readFileSync(database.databasePath);
    assert.equal(bytes.includes(Buffer.from(secret)), false);
    const application = createL1Application(database.databasePath, env);
    try {
      const connection = application.database.connection;
      assert.equal(connection.prepare('SELECT secret_ref FROM api_provider_credential_bindings').get().secret_ref, LIVE_CHAT_CONFIGURATION.credentialSecretRef);
      for (const table of [
        'continuity_capability_model_executions', 'continuity_capability_usage_facts',
        'continuity_capability_results', 'continuity_capability_result_outbox',
        'continuity_conversation_turns', 'messages',
      ]) assert.equal(count(connection, table), 0, table);
    } finally {
      await application.stop();
    }
  } finally {
    database.remove();
  }
});

test('Binding export is the formal fixture, exact hash, idempotent and refuses mismatched overwrite', () => {
  const database = createTestDatabasePath();
  const target = join(database.directory, 'binding.json');
  try {
    const first = runScript(scripts.exportBinding, ['--output', target], process.env);
    assert.equal(first.status, 0, first.stderr);
    const output = JSON.parse(first.stdout);
    assert.equal(output.bindingFixtureHash, EXPECTED_BINDING_FIXTURE_HASH);
    assert.deepEqual(output.fixture, fixedSubjectBindingFixture());
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), fixedSubjectBindingFixture());
    const second = runScript(scripts.exportBinding, ['--output', target], process.env);
    assert.equal(second.status, 0);
    assert.equal(JSON.parse(second.stdout).action, 'reused');
    writeFileSync(target, '{}\n', 'utf8');
    const conflict = runScript(scripts.exportBinding, ['--output', target], process.env);
    assert.notEqual(conflict.status, 0);
    assert.equal(readFileSync(target, 'utf8'), '{}\n');
    const relativeTarget = runScript(scripts.exportBinding, ['--output', 'binding.json'], process.env);
    assert.notEqual(relativeTarget.status, 0);
    const repositoryTarget = runScript(
      scripts.exportBinding,
      ['--output', resolve(import.meta.dirname, '..', 'binding.json')],
      process.env,
    );
    assert.notEqual(repositoryTarget.status, 0);
    assert.equal(existsSync(resolve(import.meta.dirname, '..', 'binding.json')), false);
  } finally {
    database.remove();
  }
});

test('documented pnpm separators reach export, plan and apply without weakening their behavior', async () => {
  const database = createTestDatabasePath();
  const target = join(database.directory, 'pnpm-binding.json');
  const env = environment(database.databasePath);
  try {
    const exported = runPnpm('export:local-chat-binding', ['--output', target], env);
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(exported.stdout.includes('Unsupported argument: --'), false);
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), fixedSubjectBindingFixture());
    assert.match(exported.stdout, new RegExp(EXPECTED_BINDING_FIXTURE_HASH.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

    const planned = runPnpm('prepare:live-chat', ['--plan'], env);
    assert.equal(planned.status, 2);
    assert.equal(planned.stdout.includes('"mode": "plan"'), true);
    assert.equal(planned.stdout.includes('Unsupported argument: --'), false);
    assert.equal(planned.stderr.includes('Unsupported argument: --'), false);

    const applied = runPnpm('prepare:live-chat', [
      '--apply',
      '--acknowledge-external-provider',
      '--acknowledge-possible-charges',
    ], env);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(applied.stdout.includes('"mode": "apply"'), true);
    assert.equal(applied.stdout.includes('Unsupported argument: --'), false);
    assert.equal(applied.stderr.includes('Unsupported argument: --'), false);
    const application = createL1Application(database.databasePath, env);
    assert.equal(count(application.database.connection, 'api_providers'), 1);
    assert.equal(count(application.database.connection, 'models'), 1);
    assert.equal(count(application.database.connection, 'model_routing_rules'), 1);
    assert.equal(count(application.database.connection, 'token_budgets'), 1);
    assert.equal(count(application.database.connection, 'api_provider_credential_bindings'), 1);
    await application.stop();
  } finally {
    database.remove();
  }
});

test('direct arguments remain supported while unknown, duplicate and multiple separators fail closed', () => {
  const database = createTestDatabasePath();
  const env = environment(database.databasePath);
  const directTarget = join(database.directory, 'direct-binding.json');
  try {
    assert.equal(runScript(scripts.exportBinding, ['--output', directTarget], env).status, 0);
    assert.equal(runScript(scripts.prepare, ['--plan'], env).status, 2);

    for (const args of [
      ['--unknown'],
      ['--plan', '--plan'],
      ['--', '--', '--plan'],
    ]) {
      const result = runScript(scripts.prepare, args, env);
      assert.notEqual(result.status, 0);
    }
    for (const args of [
      ['--'],
      ['--', '--', '--output', join(database.directory, 'multiple.json')],
      ['--', '--output'],
      ['--', '--unknown', directTarget],
    ]) {
      const result = runScript(scripts.exportBinding, args, env);
      assert.notEqual(result.status, 0);
    }
  } finally {
    database.remove();
  }
});

function initializeEngineRuntime(root, cycleId) {
  const integration = join(root, 'integration');
  mkdirSync(integration, { recursive: true });
  writeFileSync(join(integration, 'subject-binding.runtime-v1.json'), JSON.stringify({
    bindingPersistenceFormatVersion: 1,
    binding: {
      ...fixedSubjectBindingFixture(),
      cycleId,
      bindingFixtureHash: EXPECTED_BINDING_FIXTURE_HASH,
    },
  }), 'utf8');
  const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
  const subjectState = join(root, 'subject-state');
  mkdirSync(subjectState, { recursive: true });
  writeFileSync(join(subjectState, `${hash('subject-001')}.json`), JSON.stringify({
    schema_version: 1,
    revision: 0,
    subject_id: 'subject-001',
  }), 'utf8');
  const cycles = join(root, 'awakening', 'cycles');
  mkdirSync(cycles, { recursive: true });
  writeFileSync(join(cycles, `${hash(cycleId)}.json`), JSON.stringify({
    cycle_id: cycleId,
    subject_id: 'subject-001',
    mode: 'manual',
  }), 'utf8');
  writeFileSync(join(integration, 'result-ledger.first-round-v1.json'), JSON.stringify({
    ledgerPersistenceFormatVersion: 1,
    results: [],
  }), 'utf8');
  writeFileSync(join(integration, 'operation-journal.first-round-v1.json'), JSON.stringify({
    operationJournalFormatVersion: 3,
    operations: [],
  }), 'utf8');
  writeFileSync(join(integration, 'capability-ledger.v1.json'), JSON.stringify({
    capabilityLedgerFormatVersion: 1,
    requests: [],
    attempts: [],
  }), 'utf8');
}

test('doctor reports ready, missing, conflict and unsafe without displaying secrets', async () => {
  const database = createTestDatabasePath();
  const sandboxFixture = createShortSandboxFixture();
  const sandbox = sandboxFixture.sandbox;
  const bindingFile = sandbox.bindingFile;
  const engineData = sandbox.engineDataDir;
  const cycleId = 'vio-live-first-chat-cycle-001';
  const token = randomBytes(32).toString('hex');
  const env = environment(sandbox.vioDatabasePath, {
    VIO_LIVE_SANDBOX_MANIFEST: sandbox.manifestPath,
    VIO_LIVE_BINDING_FILE: bindingFile,
    VIO_LIVE_ENGINE_DATA_DIR: engineData,
    VIO_LIVE_ENGINE_CYCLE_ID: cycleId,
    VIO_LIVE_ENGINE_THINKING_MODE: 'capability',
    VIO_CONTINUITY_ENGINE_ENABLED: 'true',
    VIO_CONTINUITY_ENGINE_BASE_URL: 'http://127.0.0.1:8766',
    VIO_CONTINUITY_ENGINE_TOKEN: token,
    CONTINUITY_ENGINE_INTEGRATION_TOKEN: token,
  });
  const application = createL1Application(database.databasePath, env);
  try {
    apply(application);
    initializeEngineRuntime(engineData, cycleId);
    const ready = doctorLiveChat({ connection: application.database.connection, environment: env });
    assert.equal(ready.status, 'ready');
    const output = JSON.stringify(ready);
    assert.equal(output.includes(token), false);
    assert.equal(output.includes(env.VIO_MODEL_API_KEY_LIVE), false);

    assert.equal(doctorLiveChat({ connection: application.database.connection, environment: { ...env, VIO_MODEL_API_KEY_LIVE: '' } }).status, 'missing');
    assert.equal(doctorLiveChat({ connection: application.database.connection, environment: { ...env, CONTINUITY_ENGINE_INTEGRATION_TOKEN: `${token}x` } }).status, 'conflict');
    assert.equal(doctorLiveChat({ connection: application.database.connection, environment: { ...env, VIO_CONTINUITY_ENGINE_BASE_URL: 'http://0.0.0.0:8766' } }).status, 'unsafe');
    assert.equal(doctorLiveChat({ connection: application.database.connection, environment: { ...env, VIO_LIVE_DAILY_TOKEN_LIMIT: 'unlimited' } }).status, 'unsafe');
  } finally {
    await application.stop();
    sandboxFixture.remove();
    database.remove();
  }
});

test('an entirely absent or whitespace-only live environment is missing and stays read-only', () => {
  for (const whitespace of [undefined, '']) {
    const database = createTestDatabasePath();
    const overrides = whitespace === undefined
      ? {}
      : Object.fromEntries(LIVE_CHAT_ENVIRONMENT_NAMES
        .filter((name) => name !== 'VIO_BACKEND_DB_PATH')
        .map((name) => [name, whitespace]));
    const env = emptyLiveEnvironment(database.databasePath, overrides);
    try {
      const plan = runPnpm('prepare:live-chat', ['--plan'], env);
      assert.equal(plan.status, 2);
      assert.equal(existsSync(database.databasePath), false);
      assert.equal(plan.stdout.includes('Unsupported argument: --'), false);
      assert.equal(plan.stderr.includes('Unsupported argument: --'), false);
      const planOutput = parseCommandJson(plan.stdout);
      assert.equal(planOutput.status, 'missing');
      assert.equal(planOutput.mode, 'plan');

      const doctor = runPnpmWithoutSeparator('doctor:live-chat', env);
      assert.equal(doctor.status, 2);
      assert.equal(existsSync(database.databasePath), false);
      const doctorOutput = parseCommandJson(doctor.stdout);
      assert.equal(doctorOutput.status, 'missing');
      assert.equal(doctorOutput.modelCall, 'not_performed');
      assert.equal(doctorOutput.providerCharge, 'not_incurred');
      assert.equal(doctorOutput.items.every(({ status }) => status === 'missing'), true);
    } finally {
      database.remove();
    }
  }
});

test('Provider environment distinguishes missing values from unsafe supplied values without exposing secrets', () => {
  const missing = inspectLiveChatEnvironment({
    VIO_LIVE_PROVIDER_BASE_URL: ' ',
    VIO_LIVE_MODEL_NAME: '',
    VIO_MODEL_API_KEY_LIVE: '   ',
  });
  assert.deepEqual(missing.issues, [
    'provider_base_url_missing',
    'model_name_missing',
    'provider_key_missing',
  ]);
  assert.equal(missing.keyStatus, 'missing');

  for (const baseUrl of [
    'not-a-url',
    'http://provider.example.test/v1',
    'https://user:password@provider.example.test/v1',
    'https://provider.example.test/v1?secret=value',
    'https://provider.example.test/v1#fragment',
  ]) {
    const inspected = inspectLiveChatEnvironment({
      VIO_LIVE_PROVIDER_BASE_URL: baseUrl,
      VIO_LIVE_MODEL_NAME: 'model',
      VIO_MODEL_API_KEY_LIVE: 'credential',
    });
    assert.equal(inspected.issues.includes('provider_base_url_unsafe'), true);
  }

  const longModelName = inspectLiveChatEnvironment({
    VIO_LIVE_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
    VIO_LIVE_MODEL_NAME: 'm'.repeat(161),
    VIO_MODEL_API_KEY_LIVE: 'credential',
  });
  assert.equal(longModelName.issues.includes('model_name_invalid'), true);
  assert.equal(longModelName.issues.includes('model_name_missing'), false);

  const unsafeKey = `credential\nnot-safe`;
  const keyResult = inspectLiveChatEnvironment({
    VIO_LIVE_PROVIDER_BASE_URL: 'https://provider.example.test/v1',
    VIO_LIVE_MODEL_NAME: 'model',
    VIO_MODEL_API_KEY_LIVE: unsafeKey,
  });
  assert.equal(keyResult.keyStatus, 'unsafe');
  assert.equal(JSON.stringify(keyResult).includes(unsafeKey), false);
});

test('Engine runtime readiness distinguishes absent, unsafe and conflicting supplied values', () => {
  const absent = inspectLiveChatRuntime({});
  assert.equal(absent.every(({ status }) => status === 'missing'), true);
  const whitespace = inspectLiveChatRuntime(Object.fromEntries([
    'VIO_LIVE_BINDING_FILE',
    'VIO_LIVE_ENGINE_DATA_DIR',
    'VIO_LIVE_ENGINE_CYCLE_ID',
    'VIO_LIVE_ENGINE_THINKING_MODE',
    'VIO_CONTINUITY_ENGINE_ENABLED',
    'VIO_CONTINUITY_ENGINE_BASE_URL',
    'VIO_CONTINUITY_ENGINE_TOKEN',
    'CONTINUITY_ENGINE_INTEGRATION_TOKEN',
  ].map((name) => [name, '   '])));
  assert.equal(whitespace.every(({ status }) => status === 'missing'), true);

  const conflicting = inspectLiveChatRuntime({
    VIO_LIVE_BINDING_FILE: 'C:\\does-not-exist\\binding.json',
    VIO_LIVE_ENGINE_DATA_DIR: 'C:\\does-not-exist\\engine-data',
    VIO_LIVE_ENGINE_CYCLE_ID: 'c'.repeat(129),
    VIO_LIVE_ENGINE_THINKING_MODE: 'deterministic',
    VIO_CONTINUITY_ENGINE_ENABLED: 'false',
    VIO_CONTINUITY_ENGINE_TOKEN: 'only-one-side'.repeat(3),
  });
  assert.equal(conflicting.find(({ component }) => component === 'binding_file').status, 'conflict');
  assert.equal(conflicting.find(({ component }) => component === 'engine_data_dir').status, 'conflict');
  assert.equal(conflicting.find(({ component }) => component === 'engine_cycle_id').status, 'conflict');
  assert.equal(conflicting.find(({ component }) => component === 'engine_thinking_mode').status, 'conflict');
  assert.equal(conflicting.find(({ component }) => component === 'continuity_enabled').status, 'conflict');
  assert.equal(conflicting.find(({ component }) => component === 'engine_base_url').status, 'missing');
  assert.equal(conflicting.find(({ component }) => component === 'service_tokens').status, 'conflict');

  for (const baseUrl of [
    'not-a-url',
    'https://127.0.0.1:8766',
    'http://localhost:8766',
    'http://127.0.0.1:8766?secret=value',
    'http://127.0.0.1:8766#fragment',
    'http://user:password@127.0.0.1:8766',
  ]) {
    const item = inspectLiveChatRuntime({ VIO_CONTINUITY_ENGINE_BASE_URL: baseUrl })
      .find(({ component }) => component === 'engine_base_url');
    assert.equal(item.status, 'unsafe');
  }
  assert.equal(inspectLiveChatRuntime({ VIO_CONTINUITY_ENGINE_BASE_URL: 'http://127.0.0.1:8766' })
    .find(({ component }) => component === 'engine_base_url').status, 'ready');
});

test('doctor applies unsafe over conflict over missing over ready without leaking credentials', async () => {
  const database = createTestDatabasePath();
  const token = randomBytes(32).toString('hex');
  const key = randomBytes(32).toString('base64url');
  try {
    const application = createL1Application(database.databasePath, environment(database.databasePath));
    const connection = application.database.connection;
    const missing = doctorLiveChat({ connection, environment: emptyLiveEnvironment(database.databasePath) });
    assert.equal(missing.status, 'missing');

    const conflict = doctorLiveChat({ connection, environment: emptyLiveEnvironment(database.databasePath, {
      VIO_LIVE_ENGINE_THINKING_MODE: 'deterministic',
    }) });
    assert.equal(conflict.status, 'conflict');

    const unsafe = doctorLiveChat({ connection, environment: emptyLiveEnvironment(database.databasePath, {
      VIO_LIVE_ENGINE_THINKING_MODE: 'deterministic',
      VIO_CONTINUITY_ENGINE_BASE_URL: 'http://0.0.0.0:8766',
      VIO_CONTINUITY_ENGINE_TOKEN: token,
      CONTINUITY_ENGINE_INTEGRATION_TOKEN: `${token}x`,
      VIO_MODEL_API_KEY_LIVE: key,
    }) });
    assert.equal(unsafe.status, 'unsafe');
    const output = JSON.stringify(unsafe);
    assert.equal(output.includes(token), false);
    assert.equal(output.includes(key), false);
    assert.equal(output.includes('authorization'), false);
    assert.equal(output.includes('length'), false);
    assert.equal(output.includes('digest'), false);
    await application.stop();
  } finally {
    database.remove();
  }
});

test('doctor remains accurate after database restart', async () => {
  const database = createTestDatabasePath();
  const sandboxFixture = createShortSandboxFixture();
  const sandbox = sandboxFixture.sandbox;
  const bindingFile = sandbox.bindingFile;
  const engineData = sandbox.engineDataDir;
  const cycleId = 'vio-live-first-chat-cycle-001';
  const token = randomBytes(32).toString('hex');
  const env = environment(sandbox.vioDatabasePath, {
    VIO_LIVE_SANDBOX_MANIFEST: sandbox.manifestPath,
    VIO_LIVE_BINDING_FILE: bindingFile,
    VIO_LIVE_ENGINE_DATA_DIR: engineData,
    VIO_LIVE_ENGINE_CYCLE_ID: cycleId,
    VIO_LIVE_ENGINE_THINKING_MODE: 'capability',
    VIO_CONTINUITY_ENGINE_ENABLED: 'true',
    VIO_CONTINUITY_ENGINE_BASE_URL: 'http://127.0.0.1:8766',
    VIO_CONTINUITY_ENGINE_TOKEN: token,
    CONTINUITY_ENGINE_INTEGRATION_TOKEN: token,
  });
  let application = createL1Application(database.databasePath, env);
  try {
    apply(application);
    initializeEngineRuntime(engineData, cycleId);
    await application.stop();
    application = createL1Application(database.databasePath, env);
    assert.equal(doctorLiveChat({ connection: application.database.connection, environment: env }).status, 'ready');
  } finally {
    await application.stop();
    sandboxFixture.remove();
    database.remove();
  }
});

test('formal openai_compatible adapter still uses real loopback HTTP without public network', async () => {
  const requests = [];
  const apiKey = randomBytes(24).toString('hex');
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { content: 'Loopback candidate.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const executor = createOpenAiCompatibleModelExecutor({ allowLoopbackHttp: true });
    const result = await executor.execute({
      provider: { interfaceFormat: 'openai_compatible', baseUrl: `http://127.0.0.1:${address.port}/v1` },
      model: { modelName: 'loopback-model' },
      apiKey,
      capabilityRequest: {
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        input: { instruction: 'Reply.', messageContent: 'hello', perceptionSummary: '', currentFocus: '', maximumOutputCharacters: 1000 },
      },
    });
    assert.equal(result.status, 'SUCCEEDED');
    assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].authorization, `Bearer ${apiKey}`);
    assert.equal(requests[0].body.model, 'loopback-model');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('command output uses failing exit codes for missing doctor inputs without leaking inference', () => {
  const database = createTestDatabasePath();
  try {
    const env = clearLiveEnvironmentValues(environment(database.databasePath));
    const result = runScript(scripts.doctor, [], env);
    assert.equal(result.status, 2);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, 'missing');
    assert.equal(output.items.find(({ component }) => component === 'provider_api_key').status, 'missing');
    assert.equal(Object.hasOwn(output.items.find(({ component }) => component === 'provider_api_key'), 'length'), false);
  } finally {
    database.remove();
  }
});

test('L1 source and persisted fixture contain no generated credential value', async () => {
  const database = createTestDatabasePath();
  const env = environment(database.databasePath);
  const fingerprint = createHash('sha256').update(env.VIO_MODEL_API_KEY_LIVE).digest('hex');
  const application = createL1Application(database.databasePath, env);
  try {
    apply(application);
    assert.equal(readFileSync(database.databasePath).includes(Buffer.from(env.VIO_MODEL_API_KEY_LIVE)), false);
    assert.equal(readFileSync(database.databasePath).includes(Buffer.from(fingerprint)), false);
  } finally {
    await application.stop();
    database.remove();
  }
});
