import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse as parsePath, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LIVE_CHAT_SANDBOX,
  WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET,
  cleanupLiveChatSandbox,
  createLiveChatSandbox,
  inspectEnginePersistencePathBudget,
  inspectLiveChatSandbox,
  planLiveChatSandboxCleanup,
  readAndValidateLiveChatSandboxManifest,
} from '../src/modules/continuity-integration/live-chat-sandbox-service.js';
import { doctorLiveChat } from '../src/modules/continuity-integration/live-chat-preparation-service.js';
import {
  EXPECTED_BINDING_FIXTURE_HASH,
  fixedSubjectBindingFixture,
} from '../src/modules/continuity-integration/first-round-contract.js';

const backendRoot = fileURLToPath(new URL('..', import.meta.url));
const repositoryRoot = resolve(backendRoot, '..');
const engineRoot = resolve(repositoryRoot, '..', 'continuity-engine');

function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'vs4-'));
  return Object.freeze({
    directory,
    root: join(directory, 's'),
    remove() { rmSync(directory, { recursive: true, force: true }); },
  });
}

function rootForBudget(predicate) {
  const directory = mkdtempSync(join(tmpdir(), 'vpb-'));
  const canonicalDirectory = realpathSync.native(directory);
  for (let length = 1; length <= 180; length += 1) {
    const root = join(canonicalDirectory, `r${'x'.repeat(length)}`);
    const budget = inspectEnginePersistencePathBudget(join(root, 'engine-data'), {
      platform: 'win32',
    });
    if (predicate(budget)) {
      return Object.freeze({
        directory,
        root,
        budget,
        remove() { rmSync(directory, { recursive: true, force: true }); },
      });
    }
  }
  rmSync(directory, { recursive: true, force: true });
  throw new Error('Unable to construct a path for the requested budget case.');
}

function materializeLegacyManifest(sourceSandbox, targetRoot) {
  const canonicalRoot = resolve(targetRoot);
  const bindingFile = join(canonicalRoot, 'binding.json');
  const vioDatabasePath = join(canonicalRoot, 'vio-data', 'vio-live.sqlite');
  const engineDataDir = join(canonicalRoot, 'engine-data');
  const manifestPath = join(canonicalRoot, 'sandbox.manifest.json');
  mkdirSync(dirname(vioDatabasePath), { recursive: true });
  mkdirSync(engineDataDir);
  writeFileSync(bindingFile, readFileSync(sourceSandbox.bindingFile));
  const manifest = JSON.parse(readFileSync(sourceSandbox.manifestPath, 'utf8'));
  writeFileSync(manifestPath, `${JSON.stringify({
    ...manifest,
    canonicalSandboxRoot: canonicalRoot,
    canonicalBindingFile: bindingFile,
    canonicalVioDatabasePath: vioDatabasePath,
    canonicalEngineDataDir: engineDataDir,
  }, null, 2)}\n`, 'utf8');
  return Object.freeze({
    manifestPath,
    bindingFile,
    vioDatabasePath,
    engineDataDir,
  });
}

function environment(sandbox, overrides = {}) {
  return {
    VIO_LIVE_SANDBOX_MANIFEST: sandbox.manifestPath,
    VIO_LIVE_BINDING_FILE: sandbox.bindingFile,
    VIO_BACKEND_DB_PATH: sandbox.vioDatabasePath,
    VIO_LIVE_ENGINE_DATA_DIR: sandbox.engineDataDir,
    VIO_LIVE_ENGINE_CYCLE_ID: LIVE_CHAT_SANDBOX.cycleId,
    ...overrides,
  };
}

function runPnpm(script, args) {
  return spawnSync('pnpm', ['run', script, '--', ...args], {
    cwd: backendRoot,
    env: { ...process.env },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

function parseJsonOutput(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  assert.ok(start >= 0 && end > start, output);
  return JSON.parse(output.slice(start, end + 1));
}

test('create builds a strict disposable identity sandbox without business data or secrets', () => {
  const fixture = temporary();
  try {
    const created = createLiveChatSandbox({
      root: fixture.root,
      clock: () => new Date('2026-08-14T00:00:00Z'),
      uuid: () => '12345678-1234-4123-8123-123456789abc',
    });
    const validated = readAndValidateLiveChatSandboxManifest(created.manifestPath);
    assert.equal(created.purpose, 's4-live-acceptance');
    assert.equal(created.identityClass, 'disposable_test');
    assert.equal(created.promotionAllowed, false);
    assert.equal(created.userId, 'user-001');
    assert.equal(created.assistantId, 'assistant-001');
    assert.equal(created.subjectId, 'subject-001');
    assert.equal(created.conversationId, 'conversation-001');
    assert.equal(created.bindingId, 'binding-001');
    assert.equal(created.bindingVersion, 1);
    assert.equal(created.bindingFixtureHash, EXPECTED_BINDING_FIXTURE_HASH);
    assert.equal(created.cycleId, LIVE_CHAT_SANDBOX.cycleId);
    assert.equal(created.externalCall, 'not_performed');
    assert.equal(created.providerCharge, 'not_incurred');
    assert.equal(inspectEnginePersistencePathBudget(created.engineDataDir).safe, true);
    assert.deepEqual(validated.binding, fixedSubjectBindingFixture());
    assert.equal(existsSync(created.vioDatabasePath), false);
    assert.deepEqual(validated.manifest.protectedPaths.includes(repositoryRoot), true);
    assert.deepEqual(validated.manifest.protectedPaths.includes(engineRoot), true);
    const persisted = `${readFileSync(created.manifestPath, 'utf8')}\n${readFileSync(created.bindingFile, 'utf8')}`;
    assert.doesNotMatch(persisted, /api.?key|authorization|service.?token|message.?content/iu);
  } finally { fixture.remove(); }
});

test('Windows budget models the incident WakeSession and atomic temporary paths exactly', () => {
  const incidentEngineDataDir = 'C:\\Users\\Administrator\\Documents\\VioRuntime\\s4-live-sandboxes\\4e0cbb0a-926e-4c68-a158-c31573261113\\engine-data';
  const windows = inspectEnginePersistencePathBudget(incidentEngineDataDir, {
    platform: 'win32',
  });
  assert.equal(incidentEngineDataDir.length, 110);
  assert.equal(windows.maximumPathLength, 240);
  assert.equal(windows.wakeSessionPathLength, 264);
  assert.equal(windows.atomicTemporaryPathLength, 273);
  assert.equal(windows.safe, false);
  const nonWindows = inspectEnginePersistencePathBudget(incidentEngineDataDir, {
    platform: 'linux',
  });
  assert.equal(nonWindows.applies, false);
  assert.equal(nonWindows.safe, true);
});

test('create rejects a WakeSession final path over budget before leaving a sandbox root', () => {
  const fixture = rootForBudget(({ wakeSessionPathLength }) => (
    wakeSessionPathLength > WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET.maximumPathLength
  ));
  try {
    assert.equal(fixture.budget.wakeSessionPathLength > 240, true);
    if (process.platform === 'win32') {
      assert.throws(
        () => createLiveChatSandbox({ root: fixture.root }),
        (error) => error.status === 'unsafe'
          && error.reason === 'engine_persistence_path_budget_exceeded',
      );
      assert.equal(existsSync(fixture.root), false);
    }
  } finally { fixture.remove(); }
});

test('create rejects an atomic temporary path over budget even when the final path fits', () => {
  const fixture = rootForBudget(({ wakeSessionPathLength, atomicTemporaryPathLength }) => (
    wakeSessionPathLength <= WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET.maximumPathLength
    && atomicTemporaryPathLength > WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET.maximumPathLength
  ));
  try {
    assert.equal(fixture.budget.wakeSessionPathLength <= 240, true);
    assert.equal(fixture.budget.atomicTemporaryPathLength > 240, true);
    if (process.platform === 'win32') {
      assert.throws(
        () => createLiveChatSandbox({ root: fixture.root }),
        (error) => error.status === 'unsafe'
          && error.reason === 'engine_persistence_path_budget_exceeded',
      );
      assert.equal(existsSync(fixture.root), false);
    }
  } finally { fixture.remove(); }
});

test('legacy over-budget manifest and doctor fail closed as unsafe', () => {
  const source = temporary();
  const target = rootForBudget(({ atomicTemporaryPathLength }) => (
    atomicTemporaryPathLength > WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET.maximumPathLength
  ));
  try {
    const sourceSandbox = createLiveChatSandbox({ root: source.root });
    const legacy = materializeLegacyManifest(sourceSandbox, target.root);
    assert.throws(
      () => readAndValidateLiveChatSandboxManifest(legacy.manifestPath, {
        platform: 'win32',
      }),
      (error) => error.status === 'unsafe'
        && error.reason === 'engine_persistence_path_budget_exceeded',
    );
    const env = {
      ...environment({
        ...legacy,
        manifestPath: legacy.manifestPath,
      }),
    };
    const inspection = inspectLiveChatSandbox(env, { platform: 'win32' });
    assert.deepEqual(inspection, {
      status: 'unsafe',
      reason: 'engine_persistence_path_budget_exceeded',
    });
    const doctor = doctorLiveChat({
      connection: null,
      environment: env,
      sandboxInspectionOptions: { platform: 'win32' },
    });
    assert.equal(doctor.status, 'unsafe');
    assert.deepEqual(
      doctor.items.find(({ component }) => component === 's4_live_sandbox'),
      {
        component: 's4_live_sandbox',
        status: 'unsafe',
        reason: 'engine_persistence_path_budget_exceeded',
      },
    );
    assert.equal(doctor.modelCall, 'not_performed');
    assert.equal(doctor.providerCharge, 'not_incurred');
  } finally {
    source.remove();
    target.remove();
  }
});

test('create rejects existing, non-empty, repository and protected roots', () => {
  const fixture = temporary();
  try {
    assert.throws(() => createLiveChatSandbox({ root: fixture.directory }), /must not already exist/u);
    writeFileSync(join(fixture.directory, 'canary.txt'), 'keep', 'utf8');
    assert.throws(() => createLiveChatSandbox({ root: fixture.directory }), /must not already exist/u);
    for (const root of [
      repositoryRoot,
      join(repositoryRoot, 'runtime-sandbox'),
      engineRoot,
      join(engineRoot, '.continuity-data'),
      resolve(repositoryRoot, 'backend', 'data', 'vio-live.dev.sqlite'),
      resolve(repositoryRoot, 'backend', 'data'),
      resolve(repositoryRoot, '..'),
      resolve(repositoryRoot, '..', '..'),
      resolve(repositoryRoot, '..', '..', '..'),
      parsePath(repositoryRoot).root,
    ]) {
      assert.throws(() => createLiveChatSandbox({ root }), /protected|must not already exist|outside repositories|canonicalized/iu);
    }
  } finally { fixture.remove(); }
});

test('create refuses symlink, junction or reparse ancestors', { skip: process.platform !== 'win32' }, () => {
  const fixture = temporary();
  const real = join(fixture.directory, 'real');
  const link = join(fixture.directory, 'junction');
  try {
    createLiveChatSandbox({ root: real });
    rmSync(real, { recursive: true, force: true });
    const target = join(fixture.directory, 'target');
    createLiveChatSandbox({ root: target });
    symlinkSync(target, link, 'junction');
    assert.throws(() => createLiveChatSandbox({ root: join(link, 'nested') }), /reparse|symlink|junction/iu);
  } finally { fixture.remove(); }
});

test('strict manifest rejects unknown, duplicate, tampered and mismatched paths', () => {
  const scenarios = [
    (manifest) => ({ ...manifest, unknown: true }),
    (manifest) => ({ ...manifest, promotionAllowed: true }),
    (manifest) => ({ ...manifest, purpose: 'production' }),
    (manifest) => ({ ...manifest, bindingFixtureHash: `sha256:${'0'.repeat(64)}` }),
    (manifest) => ({ ...manifest, canonicalBindingFile: join(manifest.canonicalSandboxRoot, 'other.json') }),
  ];
  for (const change of scenarios) {
    const fixture = temporary();
    try {
      const sandbox = createLiveChatSandbox({ root: fixture.root });
      const manifest = JSON.parse(readFileSync(sandbox.manifestPath, 'utf8'));
      writeFileSync(sandbox.manifestPath, JSON.stringify(change(manifest), null, 2), 'utf8');
      assert.throws(() => readAndValidateLiveChatSandboxManifest(sandbox.manifestPath));
    } finally { fixture.remove(); }
  }
  const fixture = temporary();
  try {
    const sandbox = createLiveChatSandbox({ root: fixture.root });
    const text = readFileSync(sandbox.manifestPath, 'utf8');
    writeFileSync(sandbox.manifestPath, text.replace(
      '"schemaVersion": "vio-live-s4-live-sandbox/v1",',
      '"schemaVersion": "vio-live-s4-live-sandbox/v1",\n  "schemaVersion": "vio-live-s4-live-sandbox/v1",',
    ), 'utf8');
    assert.throws(() => readAndValidateLiveChatSandboxManifest(sandbox.manifestPath), /Duplicate JSON property/);
  } finally { fixture.remove(); }
});

test('doctor sandbox gate is ready only for one exact root and fails closed outside it', () => {
  const fixture = temporary();
  try {
    const sandbox = createLiveChatSandbox({ root: fixture.root });
    assert.deepEqual(inspectLiveChatSandbox(environment(sandbox)), {
      status: 'ready', reason: null, sandboxId: sandbox.sandboxId,
    });
    assert.equal(inspectLiveChatSandbox({}).status, 'missing');
    assert.equal(inspectLiveChatSandbox(environment(sandbox, {
      VIO_BACKEND_DB_PATH: join(fixture.directory, 'outside.sqlite'),
    })).status, 'unsafe');
    assert.equal(inspectLiveChatSandbox(environment(sandbox, {
      VIO_LIVE_ENGINE_DATA_DIR: join(fixture.directory, 'outside-engine'),
    })).status, 'unsafe');
    assert.equal(inspectLiveChatSandbox(environment(sandbox, {
      VIO_LIVE_ENGINE_CYCLE_ID: 'other-cycle',
    })).status, 'conflict');
  } finally { fixture.remove(); }
});

test('cleanup plan is read-only and apply requires both destructive acknowledgements', () => {
  const fixture = temporary();
  try {
    const sandbox = createLiveChatSandbox({ root: fixture.root });
    const beforeManifest = readFileSync(sandbox.manifestPath);
    const beforeBinding = readFileSync(sandbox.bindingFile);
    const plan = planLiveChatSandboxCleanup({ manifestPath: sandbox.manifestPath });
    assert.deepEqual(plan.deleteTargets, [sandbox.sandboxRoot]);
    assert.equal(plan.externalCall, 'not_performed');
    assert.deepEqual(readFileSync(sandbox.manifestPath), beforeManifest);
    assert.deepEqual(readFileSync(sandbox.bindingFile), beforeBinding);
    for (const values of [
      {},
      { acknowledgeServicesStopped: true },
      { acknowledgeDestroyEntireSandbox: true },
    ]) {
      assert.throws(() => cleanupLiveChatSandbox({ manifestPath: sandbox.manifestPath, ...values }), /acknowledgements/);
      assert.equal(existsSync(sandbox.sandboxRoot), true);
    }
  } finally { fixture.remove(); }
});

test('cleanup removes only the complete sandbox root and preserves sibling/protected canaries', () => {
  const fixture = temporary();
  const sibling = join(fixture.directory, 'sibling-canary.txt');
  const protectedCanary = join(repositoryRoot, 'README.md');
  const protectedBefore = readFileSync(protectedCanary);
  try {
    const sandbox = createLiveChatSandbox({ root: fixture.root });
    writeFileSync(sibling, 'keep sibling', 'utf8');
    writeFileSync(sandbox.vioDatabasePath, 'sandbox database placeholder', 'utf8');
    const result = cleanupLiveChatSandbox({
      manifestPath: sandbox.manifestPath,
      acknowledgeServicesStopped: true,
      acknowledgeDestroyEntireSandbox: true,
    });
    assert.equal(result.sandboxRemoved, true);
    assert.equal(result.deletedRoot, sandbox.sandboxRoot);
    assert.deepEqual(result.protectedPathsTargeted, []);
    assert.deepEqual(result.repositoryFilesTargeted, []);
    assert.equal(existsSync(sandbox.sandboxRoot), false);
    assert.equal(readFileSync(sibling, 'utf8'), 'keep sibling');
    assert.deepEqual(readFileSync(protectedCanary), protectedBefore);
  } finally {
    fixture.remove();
  }
});

test('cleanup fails safely when the sandbox root is occupied on Windows', { skip: process.platform !== 'win32' }, async () => {
  const fixture = temporary();
  let child;
  try {
    const sandbox = createLiveChatSandbox({ root: fixture.root });
    writeFileSync(sandbox.vioDatabasePath, 'occupied', 'utf8');
    child = spawn(process.execPath, ['-e', 'process.chdir(process.argv[1]); setTimeout(() => {}, 10000)', sandbox.sandboxRoot], {
      windowsHide: true,
      stdio: 'ignore',
    });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    assert.equal(child.exitCode, null);
    assert.throws(() => cleanupLiveChatSandbox({
      manifestPath: sandbox.manifestPath,
      acknowledgeServicesStopped: true,
      acknowledgeDestroyEntireSandbox: true,
    }), /in use/);
    assert.equal(existsSync(sandbox.sandboxRoot), true);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fixture.remove();
  }
});

test('public CLI performs create, read-only plan and whole-root apply with no narrow deletion option', () => {
  const fixture = temporary();
  try {
    const create = runPnpm('create:live-chat-sandbox', ['--root', fixture.root]);
    assert.equal(create.status, 0, create.stderr);
    const created = parseJsonOutput(create.stdout);
    assert.equal(created.identityClass, 'disposable_test');
    const manifestPath = created.manifestPath;

    const plan = runPnpm('cleanup:live-chat-sandbox', ['--manifest', manifestPath, '--plan']);
    assert.equal(plan.status, 0, plan.stderr);
    assert.deepEqual(parseJsonOutput(plan.stdout).deleteTargets, [created.sandboxRoot]);
    assert.equal(existsSync(fixture.root), true);

    for (const unsupported of ['--subject', '--revision', '--json', '--database-row']) {
      const rejected = runPnpm('cleanup:live-chat-sandbox', [
        '--manifest', manifestPath, '--apply',
        '--acknowledge-services-stopped', '--acknowledge-destroy-entire-sandbox', unsupported,
      ]);
      assert.equal(rejected.status, 2);
      assert.equal(existsSync(fixture.root), true);
    }
    const cleaned = runPnpm('cleanup:live-chat-sandbox', [
      '--manifest', manifestPath, '--apply',
      '--acknowledge-services-stopped', '--acknowledge-destroy-entire-sandbox',
    ]);
    assert.equal(cleaned.status, 0, cleaned.stderr);
    assert.equal(parseJsonOutput(cleaned.stdout).sandboxRemoved, true);
    assert.equal(existsSync(fixture.root), false);
  } finally { fixture.remove(); }
});
