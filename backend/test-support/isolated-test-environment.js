import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OWNER_FILE = 'vio-test-environment.json';
const ROOT_PREFIX = 'vio-tests-';

export function pathsForTestRoot(root) {
  const userHome = join(root, 'home');
  const documentsDirectory = join(userHome, 'Documents');
  const repositoryRoot = join(documentsDirectory, 'vio');
  const engineRepositoryRoot = join(documentsDirectory, 'external-runtime');
  return Object.freeze({
    repositoryRoot,
    engineRepositoryRoot,
    defaultVioDatabasePath: join(repositoryRoot, 'backend', 'data', 'vio-live.dev.sqlite'),
    defaultEngineDataDir: join(engineRepositoryRoot, '.continuity-data'),
    userHome,
    documentsDirectory,
  });
}

export function requireIsolatedTestPaths() {
  const root = process.env.VIO_TEST_PATHS_ROOT;
  assert.ok(root && isAbsolute(root), 'Use the backend test launcher; no real-path fallback is allowed.');
  assert.ok(basename(root).startsWith(ROOT_PREFIX), 'Invalid test root.');
  assert.equal(lstatSync(root).isSymbolicLink(), false);
  assert.equal(realpathSync.native(root), root);
  assert.deepEqual(JSON.parse(readFileSync(join(root, OWNER_FILE), 'utf8')), {
    purpose: 'vio-default-tests', root,
  });
  const missingEngine = join(root, 'absent-rfc-engine');
  assert.equal(process.env.VIO_CONTINUITY_ENGINE_PATH, missingEngine);
  assert.equal(existsSync(missingEngine), false, 'RFC placeholder must remain absent.');
  return pathsForTestRoot(root);
}

// Copy only execution prerequisites, never ambient application credentials,
// Engine locations, NODE_OPTIONS, proxy settings or live runtime configuration.
export function createIsolatedTestEnvironment(sourceEnvironment = process.env) {
  const tempRoot = realpathSync.native(tmpdir());
  const root = realpathSync.native(mkdtempSync(join(tempRoot, ROOT_PREFIX)));
  const paths = pathsForTestRoot(root);
  const environment = {};
  const allowed = new Set([
    'path', 'pathext', 'systemroot', 'windir', 'comspec', 'systemdrive',
    'temp', 'tmp', 'tmpdir', 'userprofile', 'home', 'homedrive', 'homepath',
    'appdata', 'localappdata', 'pnpm_home', 'lang', 'lc_all', 'tz',
  ]);
  for (const name of Object.keys(sourceEnvironment)) {
    if (allowed.has(name.toLowerCase())) environment[name] = sourceEnvironment[name];
  }
  try {
    mkdirSync(join(paths.repositoryRoot, 'backend', 'data'), { recursive: true });
    mkdirSync(paths.defaultEngineDataDir, { recursive: true });
    writeFileSync(join(root, OWNER_FILE), JSON.stringify({ purpose: 'vio-default-tests', root }), { flag: 'wx' });
    writeFileSync(join(paths.repositoryRoot, 'README.md'), 'Protected Vio repository canary.\n', { flag: 'wx' });
    writeFileSync(join(paths.engineRepositoryRoot, 'canary.txt'), 'Protected external repository canary.\n', { flag: 'wx' });
    writeFileSync(join(paths.defaultEngineDataDir, 'canary.txt'), 'Protected default data canary.\n', { flag: 'wx' });
    environment.VIO_TEST_PATHS_ROOT = root;
    // Process-local trust for this Vio source checkout only. Do not inherit
    // arbitrary Git configuration and never write user/global Git config.
    environment.GIT_CONFIG_COUNT = '1';
    environment.GIT_CONFIG_KEY_0 = 'safe.directory';
    environment.GIT_CONFIG_VALUE_0 = resolve(import.meta.dirname, '..', '..').replaceAll('\\', '/');
    environment.VIO_CONTINUITY_ENGINE_PATH = join(root, 'absent-rfc-engine');
    assert.equal(existsSync(environment.VIO_CONTINUITY_ENGINE_PATH), false);
    environment.NODE_OPTIONS = `--import=${pathToFileURL(join(import.meta.dirname, 'register-test-paths.js')).href}`;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({
    root, paths, environment: Object.freeze(environment),
    remove() {
      // Only this newly created, owned, direct child of the system temp dir.
      const child = relative(tempRoot, root);
      assert.equal(child, basename(root));
      assert.ok(child.startsWith(ROOT_PREFIX));
      assert.equal(lstatSync(root).isSymbolicLink(), false);
      assert.equal(realpathSync.native(root), root);
      assert.deepEqual(JSON.parse(readFileSync(join(root, OWNER_FILE), 'utf8')), {
        purpose: 'vio-default-tests', root,
      });
      rmSync(root, { recursive: true, force: false });
      assert.equal(existsSync(root), false);
    },
  });
}
