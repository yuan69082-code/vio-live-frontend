import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { discoverRuntimePaths } from '../src/integrations/filesystem/runtime-paths.js';
import { parseCliJsonOutput } from '../test-support/cli-json-output.js';
import {
  createIsolatedTestEnvironment,
  requireIsolatedTestPaths,
} from '../test-support/isolated-test-environment.js';

const backendRoot = resolve(import.meta.dirname, '..');
const testPaths = requireIsolatedTestPaths();
assert.deepEqual(discoverRuntimePaths(), testPaths);
const pathModuleUrl = new URL('../src/integrations/filesystem/runtime-paths.js', import.meta.url).href;

function nodeChild(source, environment = process.env) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: backendRoot, env: environment, encoding: 'utf8', windowsHide: true,
  });
}

function pnpm(script, args) {
  return spawnSync('pnpm', ['run', script, '--', ...args], {
    cwd: backendRoot, env: { ...process.env }, encoding: 'utf8',
    shell: process.platform === 'win32', windowsHide: true,
  });
}

function jsonOutput(result, status = 0) {
  assert.equal(result.status, status, result.stderr);
  const text = status === 0 ? result.stdout : result.stderr;
  return parseCliJsonOutput(text);
}

test('CLI JSON extraction tolerates pnpm diagnostics but rejects missing, malformed or multiple results', () => {
  const warning = '[WARN] Unsupported engine: wanted: {"node":">=22.23.1 <23.0.0"}'
    + ' (current: {"node":"v24.19.0","pnpm":"11.19.0"})\n';
  const expected = { status: 'missing', nested: { externalCall: 'not_performed' } };
  const result = `${JSON.stringify(expected, null, 2)}\n`;
  assert.deepEqual(parseCliJsonOutput(result), expected);
  assert.deepEqual(parseCliJsonOutput(`${warning}$ node scripts/doctor-live-chat.js\n${result}`), expected);
  assert.deepEqual(parseCliJsonOutput(`${warning}${result}[ELIFECYCLE] Command failed with exit code 2.\n`), expected);
  assert.deepEqual(parseCliJsonOutput(`${warning}${result}`.replaceAll('\n', '\r\n')), expected);
  assert.throws(() => parseCliJsonOutput(warning), assert.AssertionError);
  assert.throws(() => parseCliJsonOutput(`${result}${result}`), assert.AssertionError);
  assert.throws(() => parseCliJsonOutput(`${result}{}\n`), assert.AssertionError);
  assert.throws(() => parseCliJsonOutput('{\n  "status":\n}\n'), SyntaxError);
  assert.throws(() => parseCliJsonOutput('{\n  "status": "missing"\n'), assert.AssertionError);
});

function assertRuntimeRejectedBeforeWork(version, missingHooks = false) {
  const launcherUrl = new URL('../scripts/run-tests.js', import.meta.url).href;
  const child = nodeChild(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import childProcess from 'node:child_process';
    import nodeModule from 'node:module';
    const calls = { temporaryDirectories: 0, testChildren: 0 };
    fs.mkdtempSync = () => {
      calls.temporaryDirectories += 1;
      throw new Error('Unsupported runtime must not create a temporary directory.');
    };
    childProcess.spawn = () => {
      calls.testChildren += 1;
      throw new Error('Unsupported runtime must not start tests, isolated or otherwise.');
    };
    Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });
    if (${missingHooks}) nodeModule.registerHooks = undefined;
    nodeModule.syncBuiltinESMExports();
    await import(${JSON.stringify(launcherUrl)});
    assert.equal(process.exitCode, 2);
    assert.deepEqual(calls, { temporaryDirectories: 0, testChildren: 0 });
    process.stdout.write(JSON.stringify(calls));
  `);
  assert.equal(child.status, 2, child.stderr);
  assert.match(child.stderr, /UNSUPPORTED_TEST_RUNTIME: Backend tests require Node\.js >=22\.23\.1 <23\.0\.0/u);
  assert.match(child.stderr, /node:module\.registerHooks; refusing to run without isolation/u);
  assert.deepEqual(JSON.parse(child.stdout), { temporaryDirectories: 0, testChildren: 0 });
}

test('backend Node support is limited to the verified 22.x baseline in package and README', () => {
  const pkg = JSON.parse(readFileSync(join(backendRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '>=22.23.1 <23.0.0');
  const readme = readFileSync(join(backendRoot, 'README.md'), 'utf8');
  assert.match(readme, /Node\.js `>=22\.23\.1 <23\.0\.0`/u);
  assert.match(readme, /node:module\.registerHooks/u);
});

test('unsupported Node versions exit before temporary directories or test children without fallback', () => {
  for (const version of [
    '20.19.0', '22.5.0', '22.14.0', '22.15.0', '22.23.0',
    '23.0.0', '24.0.0', '22.23.1-rc.1', 'invalid',
  ]) assertRuntimeRejectedBeforeWork(version);
});

test('missing registerHooks fails closed even on the supported Node version', () => {
  assertRuntimeRejectedBeforeWork('22.23.1', true);
});

test('default launcher preserves the full original glob and Node default concurrency/isolation', () => {
  const pkg = JSON.parse(readFileSync(join(backendRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.js');
  const source = readFileSync(join(backendRoot, 'scripts', 'run-tests.js'), 'utf8');
  assert.match(source, /requested\.length === 0 \? \['tests\/\*\.test\.js'\]/u);
  assert.match(source, /spawn\(process\.execPath, \['--test', \.\.\.files\]/u);
  assert.doesNotMatch(source, /--test-(?:concurrency|isolation|name-pattern|skip-pattern)|--max-old-space-size/u);
});

test('test discovery and default database stay in owned temporary canaries; RFC path remains absent', () => {
  assert.deepEqual(discoverRuntimePaths(), testPaths);
  assert.equal(loadConfig({}).databasePath, testPaths.defaultVioDatabasePath);
  assert.equal(existsSync(testPaths.defaultVioDatabasePath), false);
  assert.equal(existsSync(testPaths.engineRepositoryRoot), true);
  assert.equal(existsSync(testPaths.defaultEngineDataDir), true);
  assert.equal(process.env.VIO_CONTINUITY_ENGINE_PATH,
    join(process.env.VIO_TEST_PATHS_ROOT, 'absent-rfc-engine'));
  assert.equal(existsSync(process.env.VIO_CONTINUITY_ENGINE_PATH), false);
});

test('production discovery ignores test environment without the explicit test loader and does no probing', () => {
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  // This only computes path strings in the production dependency. It never
  // checks whether the actual external repository/home/data paths exist.
  const child = nodeChild(`
    import assert from 'node:assert/strict';
    import { homedir } from 'node:os';
    import { join, resolve } from 'node:path';
    import { discoverRuntimePaths } from ${JSON.stringify(pathModuleUrl)};
    const repositoryRoot = ${JSON.stringify(resolve(backendRoot, '..'))};
    const engineRepositoryRoot = resolve(repositoryRoot, '..', 'continuity-engine');
    assert.deepEqual(discoverRuntimePaths(), {
      repositoryRoot, engineRepositoryRoot,
      defaultVioDatabasePath: join(repositoryRoot, 'backend', 'data', 'vio-live.dev.sqlite'),
      defaultEngineDataDir: join(engineRepositoryRoot, '.continuity-data'),
      userHome: homedir(), documentsDirectory: join(homedir(), 'Documents'),
    });
    process.stdout.write('production-defaults-unchanged');
  `, environment);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'production-defaults-unchanged');
});

test('Node children and grandchildren inherit path substitution and the absent RFC location', () => {
  const grandchildSource = `
    import { discoverRuntimePaths } from ${JSON.stringify(pathModuleUrl)};
    process.stdout.write(JSON.stringify({ paths: discoverRuntimePaths(), rfc: process.env.VIO_CONTINUITY_ENGINE_PATH }));
  `;
  const child = nodeChild(`
    import { spawnSync } from 'node:child_process';
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(grandchildSource)}], {
      env: { ...process.env }, encoding: 'utf8', windowsHide: true,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.status ?? 1;
  `);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    paths: testPaths, rfc: process.env.VIO_CONTINUITY_ENGINE_PATH,
  });
});

test('test launcher does not read or forward ambient secrets, external paths or Node overrides', () => {
  const source = { PATH: process.env.PATH };
  for (const key of ['VIO_MODEL_API_KEY_LIVE', 'VIO_LIVE_ENGINE_DATA_DIR',
    'CONTINUITY_ENGINE_REPO', 'VIO_CONTINUITY_ENGINE_PATH', 'NODE_OPTIONS', 'HTTPS_PROXY']) {
    Object.defineProperty(source, key, {
      enumerable: true,
      get() { throw new Error('Forbidden ambient value read.'); },
    });
  }
  const fixture = createIsolatedTestEnvironment(source);
  try {
    assert.equal(fixture.environment.VIO_MODEL_API_KEY_LIVE, undefined);
    assert.equal(fixture.environment.CONTINUITY_ENGINE_REPO, undefined);
    assert.equal(fixture.environment.VIO_LIVE_ENGINE_DATA_DIR, undefined);
    assert.equal(fixture.environment.HTTPS_PROXY, undefined);
    assert.equal(fixture.environment.VIO_CONTINUITY_ENGINE_PATH, join(fixture.root, 'absent-rfc-engine'));
    assert.match(fixture.environment.NODE_OPTIONS, /^--import=file:/u);
  } finally { fixture.remove(); }
  assert.equal(existsSync(fixture.root), false);
});

test('formal pnpm CLI preserves protected repositories/data, whole-root cleanup and all canaries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vi-'));
  const root = join(directory, 's');
  const sibling = join(directory, 'sibling.txt');
  const canaries = [
    join(testPaths.repositoryRoot, 'README.md'),
    join(testPaths.engineRepositoryRoot, 'canary.txt'),
    join(testPaths.defaultEngineDataDir, 'canary.txt'),
  ];
  const before = canaries.map((path) => readFileSync(path));
  try {
    writeFileSync(sibling, 'keep sibling');
    const created = jsonOutput(pnpm('create:live-chat-sandbox', ['--root', root]));
    const manifestBefore = readFileSync(created.manifestPath);
    const plan = jsonOutput(pnpm('cleanup:live-chat-sandbox', ['--manifest', created.manifestPath, '--plan']));
    for (const path of Object.values(testPaths)) assert.ok(plan.protectedPaths.includes(path), path);
    assert.deepEqual(plan.deleteTargets, [created.sandboxRoot]);
    assert.deepEqual(readFileSync(created.manifestPath), manifestBefore);
    for (const protectedRoot of [testPaths.repositoryRoot, testPaths.engineRepositoryRoot,
      testPaths.defaultEngineDataDir, testPaths.defaultVioDatabasePath]) {
      const rejected = jsonOutput(pnpm('create:live-chat-sandbox', ['--root', protectedRoot]), 2);
      assert.equal(rejected.status, 'unsafe');
      assert.equal(rejected.details.reason, 'protected_path_targeted');
    }
    for (const flags of [[], ['--acknowledge-services-stopped'], ['--acknowledge-destroy-entire-sandbox']]) {
      const rejected = jsonOutput(pnpm('cleanup:live-chat-sandbox', [
        '--manifest', created.manifestPath, '--apply', ...flags,
      ]), 2);
      assert.equal(rejected.details.reason, 'cleanup_acknowledgements_required');
      assert.equal(existsSync(root), true);
    }
    const cleaned = jsonOutput(pnpm('cleanup:live-chat-sandbox', [
      '--manifest', created.manifestPath, '--apply',
      '--acknowledge-services-stopped', '--acknowledge-destroy-entire-sandbox',
    ]));
    assert.equal(cleaned.sandboxRemoved, true);
    assert.equal(existsSync(root), false);
    assert.equal(readFileSync(sibling, 'utf8'), 'keep sibling');
    canaries.forEach((path, index) => assert.deepEqual(readFileSync(path), before[index]));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('formal plan/doctor without live configuration use an absent temporary default DB without creating it', () => {
  for (const [script, args] of [['prepare:live-chat', ['--plan']], ['doctor:live-chat', []]]) {
    const result = pnpm(script, args);
    assert.equal(result.status, 2, result.stderr);
    const output = parseCliJsonOutput(result.stdout);
    assert.equal(output.status, 'missing');
    assert.equal(output.database, 'missing');
    assert.equal(existsSync(testPaths.defaultVioDatabasePath), false);
  }
});
