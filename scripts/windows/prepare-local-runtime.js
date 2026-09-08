import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  EXPECTED_PNPM,
  assertPreparedDependencies,
  assertSupportedNode,
  calculateBuildInputHash,
  canListen,
  defaultRuntimePaths,
  ensureRuntimeConfig,
  isolatedTestRuntimePaths,
  readRootPackage,
  repositoryRootFromModule,
  writeBuildManifest,
} from './local-runtime.js';

function runNode(repositoryRoot, entry, args = []) {
  const result = spawnSync(process.execPath, [join(repositoryRoot, entry), ...args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Object.assign(new Error(`${entry} failed with exit code ${result.status}.`), { code: 'PREPARATION_COMMAND_FAILED' });
}

function runPinnedOfflineInstall(repositoryRoot) {
  const environment = { ...process.env, COREPACK_ENABLE_NETWORK: '0' };
  const commandProcessor = process.env.ComSpec || 'cmd.exe';
  const version = spawnSync(commandProcessor, ['/d', '/c', 'corepack pnpm --version'], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (version.error) throw version.error;
  if (version.status !== 0 || version.stdout.trim() !== EXPECTED_PNPM.slice('pnpm@'.length)) {
    throw Object.assign(new Error(`First-time preparation requires cached ${EXPECTED_PNPM}; no download or version fallback is allowed.`), { code: 'PNPM_VERSION_UNAVAILABLE' });
  }
  const install = spawnSync(commandProcessor, [
    '/d', '/c', 'corepack pnpm install --offline --frozen-lockfile --force',
  ], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (install.error) throw install.error;
  if (install.status !== 0) {
    throw Object.assign(new Error(`Offline dependency preparation failed with exit code ${install.status}; no online fallback was attempted.`), { code: 'OFFLINE_INSTALL_FAILED' });
  }
}

const plan = process.argv.slice(2).includes('--plan');
if (process.argv.slice(2).some((argument) => argument !== '--plan') || process.argv.slice(2).filter((argument) => argument === '--plan').length > 1) {
  throw Object.assign(new Error('Supported arguments: --plan'), { code: 'PREPARATION_ARGUMENT_INVALID' });
}

const repositoryRoot = repositoryRootFromModule();
const paths = process.env.VIO_LOCAL_RUNTIME_TEST_MODE === 'true'
  ? isolatedTestRuntimePaths(repositoryRoot)
  : defaultRuntimePaths(repositoryRoot);
assertSupportedNode();
readRootPackage(repositoryRoot);
if (!existsSync(paths.databasePath)) {
  throw Object.assign(new Error(`The existing personal database is missing: ${paths.databasePath}. Preparation will not create or substitute an empty database.`), { code: 'PERSONAL_DATABASE_MISSING' });
}
const buildInputHash = calculateBuildInputHash(repositoryRoot);

if (plan) {
  assertPreparedDependencies(repositoryRoot);
  process.stdout.write(`${JSON.stringify({
    status: 'ready_to_prepare',
    repositoryRoot: paths.repositoryRoot,
    databasePath: paths.databasePath,
    buildInputHash,
    packageManager: EXPECTED_PNPM,
    dependencyInstall: 'not_performed',
    externalCall: 'not_performed',
  })}\n`);
} else {
  if (!await canListen('127.0.0.1', paths.backendPort) || !await canListen('127.0.0.1', paths.frontendPort)) {
    throw Object.assign(new Error('Stop the managed Vio runtime before preparing a new build.'), { code: 'LOCAL_RUNTIME_RUNNING' });
  }
  runPinnedOfflineInstall(repositoryRoot);
  assertPreparedDependencies(repositoryRoot);
  runNode(repositoryRoot, 'node_modules/typescript/bin/tsc', ['-b']);
  runNode(repositoryRoot, 'node_modules/vite/bin/vite.js', ['build']);
  const manifest = writeBuildManifest(paths, calculateBuildInputHash(repositoryRoot));
  const binding = ensureRuntimeConfig(paths);
  process.stdout.write(`${JSON.stringify({
    status: 'prepared',
    configAction: binding.action,
    repositoryRoot: paths.repositoryRoot,
    databasePath: paths.databasePath,
    buildInputHash: manifest.buildInputHash,
    packageManager: EXPECTED_PNPM,
    dependencyInstall: 'offline_frozen_rebuilt',
    externalCall: 'not_performed',
  })}\n`);
}
