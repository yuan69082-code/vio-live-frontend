import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  EXPECTED_NODE_RANGE,
  EXPECTED_PNPM,
  LOCAL_STATE_SCHEMA_VERSION,
  acquireOperationLock,
  assertPreparedDependencies,
  assertSupportedNode,
  calculateBuildInputHash,
  createFrontendServer,
  defaultRuntimePaths,
  ensureRuntimeConfig,
  isolatedTestRuntimePaths,
  readAndVerifyBuild,
  readRootPackage,
  readRuntimeConfig,
  readRuntimeState,
  repositoryRootFromModule,
  writeBuildManifest,
  writeRuntimeState,
} from './local-runtime.js';
import { createApplication } from '../../backend/src/app.js';
import { loadConfig } from '../../backend/src/config.js';
import { createSqliteDatabase } from '../../backend/src/integrations/database/sqlite-database.js';

const repositoryRoot = repositoryRootFromModule();
let nextTestPort = 41_000 + ((process.pid % 1_000) * 10);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vio-local-runtime-'));
  const databasePath = join(root, 'data', 'personal.sqlite');
  const runtimeRoot = join(root, 'runtime');
  const backendPort = nextTestPort++;
  const frontendPort = nextTestPort++;
  mkdirSync(join(root, 'data'), { recursive: true });
  const environment = {
    ...process.env,
    VIO_LOCAL_RUNTIME_TEST_MODE: 'true',
    VIO_LOCAL_RUNTIME_TEST_ROOT: runtimeRoot,
    VIO_LOCAL_RUNTIME_TEST_DATABASE: databasePath,
    VIO_LOCAL_RUNTIME_TEST_BACKEND_PORT: String(backendPort),
    VIO_LOCAL_RUNTIME_TEST_FRONTEND_PORT: String(frontendPort),
  };
  const paths = isolatedTestRuntimePaths(repositoryRoot, environment);
  return {
    root,
    paths,
    environment,
    remove() { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); },
  };
}

function runNode(arguments_, environment = process.env) {
  return spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    timeout: 45_000,
    windowsHide: true,
  });
}

function runWrapper(filename, arguments_, environment) {
  return spawnSync('cmd.exe', ['/d', '/c', `call "${resolve(repositoryRoot, filename)}" ${arguments_.join(' ')}`], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    timeout: 45_000,
    windowsVerbatimArguments: true,
    windowsHide: true,
  });
}

function runWrapperAsync(filename, arguments_, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('cmd.exe', ['/d', '/c', `call "${resolve(repositoryRoot, filename)}" ${arguments_.join(' ')}`], {
      cwd: repositoryRoot,
      env: environment,
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('exit', (code) => resolvePromise({ status: code, stdout, stderr }));
  });
}

function lastJson(stdout) {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function migrationCount(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count; }
  finally { database.close(); }
}

function createDataCanary(path) {
  const database = new DatabaseSync(path);
  try {
    database.exec('CREATE TABLE launcher_data_canary (value TEXT NOT NULL)');
    database.prepare('INSERT INTO launcher_data_canary (value) VALUES (?)').run('preserved-across-restarts');
  } finally { database.close(); }
}

function readDataCanary(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare('SELECT value FROM launcher_data_canary').get().value; }
  finally { database.close(); }
}

function preparePersonalDatabase(path) {
  const database = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: path }));
  database.close();
}

function prepareTestBuild(paths) {
  mkdirSync(paths.distRoot, { recursive: true });
  writeFileSync(join(paths.distRoot, 'index.html'), '<!doctype html><title>Vio</title>', { flag: 'wx' });
  writeBuildManifest(paths, calculateBuildInputHash(paths.repositoryRoot));
}

function invitationCounts(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      total: database.prepare('SELECT count(*) AS n FROM personal_initialization_invitations').get().n,
      active: database.prepare('SELECT count(*) AS n FROM personal_initialization_invitations WHERE consumed_at IS NULL AND expires_at>?').get(new Date().toISOString()).n,
    };
  } finally { database.close(); }
}

function listen(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address().port));
  });
}

function requestFrontend(port, path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest({ host: '127.0.0.1', port, method: 'GET', path }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () => resolvePromise({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', rejectPromise);
    request.end();
  });
}

test('root runtime pins the verified Node and pnpm versions and has complete prepared entries', () => {
  assert.equal(assertSupportedNode(), process.versions.node);
  const packageJson = readRootPackage(repositoryRoot);
  assert.equal(packageJson.engines.node, EXPECTED_NODE_RANGE);
  assert.equal(packageJson.packageManager, EXPECTED_PNPM);
  assert.doesNotThrow(() => assertPreparedDependencies(repositoryRoot));
  assert.match(calculateBuildInputHash(repositoryRoot), /^sha256:[0-9a-f]{64}$/u);
});

test('runtime config binds one exact repository and existing personal database without silent replacement', () => {
  const f = fixture();
  try {
    writeFileSync(f.paths.databasePath, '', { flag: 'wx' });
    assert.equal(ensureRuntimeConfig(f.paths).action, 'created');
    assert.equal(ensureRuntimeConfig(f.paths).action, 'reused');
    assert.throws(
      () => ensureRuntimeConfig({ ...f.paths, databasePath: join(f.root, 'different.sqlite') }),
      (error) => error.code === 'RUNTIME_BINDING_CONFLICT',
    );
  } finally { f.remove(); }
});

test('runtime config reports missing, unreadable and invalid JSON separately and status validates it', () => {
  const f = fixture();
  try {
    writeFileSync(f.paths.databasePath, '', { flag: 'wx' });
    let result = runNode(['scripts/windows/vio-local.js', 'status'], f.environment);
    assert.equal(result.status, 1);
    assert.equal(lastJson(result.stdout).code, 'RUNTIME_CONFIG_MISSING');
    result = runWrapper('Initialize Personal Vio.cmd', [], f.environment);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /RUNTIME_CONFIG_MISSING/u);
    assert.equal(existsSync(f.paths.runtimeRoot), false);

    mkdirSync(f.paths.runtimeRoot, { recursive: true });
    writeFileSync(f.paths.configPath, '{not-json', { flag: 'wx' });
    result = runNode(['scripts/windows/vio-local.js', 'status'], f.environment);
    assert.equal(result.status, 1);
    assert.equal(lastJson(result.stdout).code, 'RUNTIME_CONFIG_INVALID_JSON');

    rmSync(f.paths.configPath);
    mkdirSync(f.paths.configPath);
    result = runNode(['scripts/windows/vio-local.js', 'status'], f.environment);
    assert.equal(result.status, 1);
    assert.equal(lastJson(result.stdout).code, 'RUNTIME_CONFIG_UNREADABLE');
  } finally { f.remove(); }
});

test('operation lock is exclusive and only its creator can release it', () => {
  const f = fixture();
  try {
    const release = acquireOperationLock(f.paths.operationLockPath);
    assert.throws(() => acquireOperationLock(f.paths.operationLockPath), (error) => error.code === 'LOCAL_OPERATION_IN_PROGRESS');
    release();
    const secondRelease = acquireOperationLock(f.paths.operationLockPath);
    secondRelease();
  } finally { f.remove(); }
});

test('daily open path contains no package installation, Corepack or build command', () => {
  const wrapper = readFileSync(join(repositoryRoot, '打开 Vio.cmd'), 'utf8');
  assert.equal(wrapper, readFileSync(join(repositoryRoot, 'Open Vio.cmd'), 'utf8'));
  assert.equal(readFileSync(join(repositoryRoot, '停止 Vio.cmd'), 'utf8'), readFileSync(join(repositoryRoot, 'Stop Vio.cmd'), 'utf8'));
  assert.equal(readFileSync(join(repositoryRoot, '首次准备 Vio.cmd'), 'utf8'), readFileSync(join(repositoryRoot, 'Prepare Vio.cmd'), 'utf8'));
  assert.equal(readFileSync(join(repositoryRoot, '初始化个人空间 Vio.cmd'), 'utf8'), readFileSync(join(repositoryRoot, 'Initialize Personal Vio.cmd'), 'utf8'));
  const launcher = readFileSync(join(repositoryRoot, 'scripts', 'windows', 'vio-local.js'), 'utf8');
  assert.doesNotMatch(wrapper, /\b(?:corepack|pnpm|npm|install|build)\b/iu);
  assert.doesNotMatch(launcher, /spawn(?:Sync)?\([^\n]*(?:corepack|pnpm|npm|install|vite|tsc)/iu);
  assert.match(launcher, /key\.startsWith\('VIO_CONTINUITY_ENGINE_'\).*key\.startsWith\('VIO_MODEL_API_KEY_'\)/u);
  const readyIndex = launcher.indexOf('await waitForReady(paths, manifest.buildInputHash, 30_000)');
  const browserIndex = launcher.indexOf('if (!noBrowser) openBrowser', readyIndex);
  assert.ok(readyIndex >= 0 && browserIndex > readyIndex, 'browser launch must follow both readiness checks');
});

test('desktop personal initialization writes one reusable private invitation and recovers a lost file', async () => {
  const f = fixture();
  try {
    preparePersonalDatabase(f.paths.databasePath);
    ensureRuntimeConfig(f.paths);

    const first = runWrapper('Initialize Personal Vio.cmd', [], f.environment);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const firstReport = lastJson(first.stdout);
    assert.equal(firstReport.status, 'invitation_ready');
    assert.equal(firstReport.action, 'created');
    assert.equal(firstReport.invitationView, 'not_opened_in_test');
    assert.equal(firstReport.passphrase, 'set_in_browser_only');
    const firstToken = readFileSync(firstReport.invitationFile, 'utf8').trim();
    assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(first.stdout.includes(firstToken), false);
    assert.equal(first.stderr.includes(firstToken), false);

    const repeated = runWrapper('初始化个人空间 Vio.cmd', [], f.environment);
    assert.equal(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);
    const repeatedReport = lastJson(repeated.stdout);
    assert.equal(repeatedReport.action, 'reused');
    assert.equal(repeatedReport.invitationFile, firstReport.invitationFile);

    let inspected = new DatabaseSync(f.paths.databasePath);
    inspected.prepare("UPDATE personal_initialization_invitations SET expires_at='2000-01-01T00:00:00.000Z' WHERE consumed_at IS NULL").run();
    inspected.close();
    const renewed = runWrapper('Initialize Personal Vio.cmd', [], f.environment);
    assert.equal(renewed.status, 0, `${renewed.stdout}\n${renewed.stderr}`);
    const renewedReport = lastJson(renewed.stdout);
    assert.equal(renewedReport.action, 'created');
    const renewedToken = readFileSync(renewedReport.invitationFile, 'utf8').trim();
    assert.notEqual(renewedToken, firstToken);

    unlinkSync(renewedReport.invitationFile);
    const recovered = runWrapper('Initialize Personal Vio.cmd', [], f.environment);
    assert.equal(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    const recoveredReport = lastJson(recovered.stdout);
    assert.equal(recoveredReport.action, 'created');
    const recoveredToken = readFileSync(recoveredReport.invitationFile, 'utf8').trim();
    assert.notEqual(recoveredToken, renewedToken);
    assert.equal(invitationCounts(f.paths.databasePath).active, 1);

    const app = createApplication({
      config: loadConfig({ VIO_BACKEND_DB_PATH: f.paths.databasePath, VIO_BACKEND_PORT: '0' }),
      environment: {},
      logger: { error() {} },
    });
    try {
      app.personalIdentityService.initialize({
        invitation: recoveredToken,
        passphrase: 'isolated-personal-passphrase',
        agreementVersion: 'personal-use/v1',
      }, 'isolated-initialization-key');
    } finally { await app.stop(); }

    const alreadyInitialized = runWrapper('Initialize Personal Vio.cmd', [], f.environment);
    assert.equal(alreadyInitialized.status, 1);
    assert.match(alreadyInitialized.stderr, /PERSONAL_OWNER_EXISTS/u);
    assert.equal(alreadyInitialized.stderr.includes(recoveredToken), false);
  } finally { f.remove(); }
});

test('desktop personal initialization refuses active runtime state and unsafe invitation files without database mutation', () => {
  const f = fixture();
  try {
    preparePersonalDatabase(f.paths.databasePath);
    ensureRuntimeConfig(f.paths);
    writeRuntimeState(f.paths.statePath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      instanceId: '10000000-0000-4000-8000-000000000000',
      repositoryRoot,
      databasePath: f.paths.databasePath,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      controlPipe: '\\\\.\\pipe\\vio-live-10000000-0000-4000-8000-000000000000',
      controlToken: 'b'.repeat(64),
      buildInputHash: `sha256:${'b'.repeat(64)}`,
      backendOrigin: f.paths.backendOrigin,
      frontendOrigin: f.paths.frontendOrigin,
      status: 'ready',
    });
    let result = runWrapper('Initialize Personal Vio.cmd', [], f.environment);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PERSONAL_RUNTIME_ACTIVE/u);
    assert.equal(invitationCounts(f.paths.databasePath).total, 0);

    rmSync(f.paths.statePath);
    mkdirSync(f.paths.privateRoot, { recursive: true });
    writeFileSync(join(f.paths.privateRoot, 'personal-initialization-invitation-2026-09-08T000000-000Z-00000000-0000-4000-8000-000000000000.txt'), 'unexpected', { flag: 'wx' });
    result = runWrapper('Initialize Personal Vio.cmd', [], f.environment);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /INVITATION_FILE_CONFLICT/u);
    assert.equal(invitationCounts(f.paths.databasePath).total, 0);
  } finally { f.remove(); }
});

test('double-click wrappers preserve failures as non-zero exit codes', () => {
  const preparation = runWrapper('Prepare Vio.cmd', ['--unsupported'], process.env);
  assert.equal(preparation.status, 1);
  assert.match(preparation.stderr, /PREPARATION_ARGUMENT_INVALID/u);
  assert.match(preparation.stdout, /first-time preparation did not complete/u);
  const open = runWrapper('Open Vio.cmd', ['--unsupported'], process.env);
  assert.equal(open.status, 1);
  assert.match(open.stdout, /daily start never installs dependencies/u);
});

test('first-time preparation pins cached pnpm and forbids network or lockfile drift', () => {
  const preparation = readFileSync(join(repositoryRoot, 'scripts', 'windows', 'prepare-local-runtime.js'), 'utf8');
  assert.match(preparation, /COREPACK_ENABLE_NETWORK:\s*'0'/u);
  assert.match(preparation, /corepack pnpm install --offline --frozen-lockfile --force/u);
  assert.match(preparation, /stdout\.trim\(\)\s*!==\s*EXPECTED_PNPM\.slice/u);
  assert.doesNotMatch(preparation, /--no-frozen-lockfile|--latest|\bupdate\b/iu);
});

test('frontend proxy rejects absolute-form targets instead of forwarding them', async () => {
  const f = fixture();
  const distRoot = join(f.root, 'dist');
  mkdirSync(distRoot, { recursive: true });
  writeFileSync(join(distRoot, 'index.html'), '<!doctype html><title>Vio</title>');
  const frontend = createFrontendServer({
    distRoot,
    backendOrigin: 'http://127.0.0.1:1',
    buildInputHash: `sha256:${'a'.repeat(64)}`,
  });
  try {
    const port = await listen(frontend);
    const response = await requestFrontend(port, 'http://127.0.0.1:1/api/v1/private');
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error.code, 'LOCAL_PROXY_TARGET_INVALID');
  } finally {
    if (frontend.listening) await new Promise((resolvePromise) => frontend.close(resolvePromise));
    f.remove();
  }
});

test('invalid ownership state fails closed and stop does not remove it or terminate a process', () => {
  const f = fixture();
  try {
    writeFileSync(f.paths.databasePath, '', { flag: 'wx' });
    ensureRuntimeConfig(f.paths);
    prepareTestBuild(f.paths);
    const build = readAndVerifyBuild(f.paths);
    writeRuntimeState(f.paths.statePath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      instanceId: '00000000-0000-4000-8000-000000000000',
      repositoryRoot,
      databasePath: f.paths.databasePath,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      controlPipe: '\\\\.\\pipe\\vio-live-00000000-0000-4000-8000-000000000000',
      controlToken: 'a'.repeat(64),
      buildInputHash: build.buildInputHash,
      backendOrigin: f.paths.backendOrigin,
      frontendOrigin: f.paths.frontendOrigin,
      status: 'ready',
    });
    const result = runNode(['scripts/windows/vio-local.js', 'stop'], f.environment);
    assert.equal(result.status, 1);
    assert.equal(lastJson(result.stdout).code, 'RUNTIME_OWNERSHIP_FAILED');
    assert.equal(existsSync(f.paths.statePath), true);
  } finally { f.remove(); }
});

test('port owned by an unknown process is rejected without starting or stopping it', async () => {
  const f = fixture();
  const blocker = createServer();
  try {
    writeFileSync(f.paths.databasePath, '', { flag: 'wx' });
    ensureRuntimeConfig(f.paths);
    prepareTestBuild(f.paths);
    await new Promise((resolvePromise, rejectPromise) => {
      blocker.once('error', rejectPromise);
      blocker.listen(f.paths.frontendPort, '127.0.0.1', resolvePromise);
    });
    const result = runNode(['scripts/windows/vio-local.js', 'start', '--no-browser'], f.environment);
    assert.equal(result.status, 1);
    assert.equal(lastJson(result.stdout).code, 'LOCAL_PORT_CONFLICT');
    assert.equal(blocker.listening, true);
    assert.equal(existsSync(f.paths.statePath), false);
  } finally {
    if (blocker.listening) await new Promise((resolvePromise) => blocker.close(resolvePromise));
    f.remove();
  }
});

test('double-click entry starts once, reuses one runtime, stops, restarts and preserves isolated data', async () => {
  const f = fixture();
  try {
    writeFileSync(f.paths.databasePath, '', { flag: 'wx' });
    createDataCanary(f.paths.databasePath);
    ensureRuntimeConfig(f.paths);
    prepareTestBuild(f.paths);

    const [first, second] = await Promise.all([
      runWrapperAsync('Open Vio.cmd', ['--no-browser'], f.environment),
      runWrapperAsync('Open Vio.cmd', ['--no-browser'], f.environment),
    ]);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const statuses = [lastJson(first.stdout).status, lastJson(second.stdout).status].sort();
    assert.deepEqual(statuses, ['already_running', 'started']);
    const firstState = readRuntimeState(f.paths);
    assert.ok(firstState);
    const countAfterFirstStart = migrationCount(f.paths.databasePath);
    assert.ok(countAfterFirstStart > 0);

    const third = runWrapper('Open Vio.cmd', ['--no-browser'], f.environment);
    assert.equal(third.status, 0, `${third.stdout}\n${third.stderr}`);
    assert.equal(lastJson(third.stdout).status, 'already_running');
    assert.equal(readRuntimeState(f.paths).instanceId, firstState.instanceId);

    const stopped = runWrapper('Stop Vio.cmd', [], f.environment);
    assert.equal(stopped.status, 0, `${stopped.stdout}\n${stopped.stderr}`);
    assert.equal(lastJson(stopped.stdout).status, 'stopped');
    assert.equal(lastJson(stopped.stdout).databasePreserved, true);
    assert.equal(existsSync(f.paths.statePath), false);
    assert.equal(migrationCount(f.paths.databasePath), countAfterFirstStart);
    assert.equal(readDataCanary(f.paths.databasePath), 'preserved-across-restarts');

    const restarted = runWrapper('Open Vio.cmd', ['--no-browser'], f.environment);
    assert.equal(restarted.status, 0, `${restarted.stdout}\n${restarted.stderr}`);
    assert.equal(lastJson(restarted.stdout).status, 'started');
    const secondState = readRuntimeState(f.paths);
    assert.notEqual(secondState.instanceId, firstState.instanceId);
    assert.equal(migrationCount(f.paths.databasePath), countAfterFirstStart);
    assert.equal(readDataCanary(f.paths.databasePath), 'preserved-across-restarts');

    const finalStop = runWrapper('Stop Vio.cmd', [], f.environment);
    assert.equal(finalStop.status, 0, `${finalStop.stdout}\n${finalStop.stderr}`);
    assert.equal(lastJson(finalStop.stdout).status, 'stopped');
    assert.equal(migrationCount(f.paths.databasePath), countAfterFirstStart);
    assert.equal(readDataCanary(f.paths.databasePath), 'preserved-across-restarts');
  } finally {
    if (existsSync(f.paths.statePath)) runNode(['scripts/windows/vio-local.js', 'stop'], f.environment);
    f.remove();
  }
});

test('formal first-time preparation plan is read-only and reports no install or external call', () => {
  const f = fixture();
  try {
    writeFileSync(f.paths.databasePath, '', { flag: 'wx' });
    const configExisted = existsSync(f.paths.configPath);
    const result = runNode(['scripts/windows/prepare-local-runtime.js', '--plan'], f.environment);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = lastJson(result.stdout);
    assert.equal(report.status, 'ready_to_prepare');
    assert.equal(report.databasePath, f.paths.databasePath);
    assert.equal(report.dependencyInstall, 'not_performed');
    assert.equal(report.externalCall, 'not_performed');
    assert.equal(existsSync(f.paths.configPath), configExisted);
  } finally { f.remove(); }
});
