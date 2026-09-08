import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  LOCAL_STATE_SCHEMA_VERSION,
  acquireOperationLock,
  assertPreparedDependencies,
  assertRuntimeHealthy,
  assertSupportedNode,
  canListen,
  createInstance,
  defaultRuntimePaths,
  isolatedTestRuntimePaths,
  makeStartupConfig,
  readAndVerifyBuild,
  readRootPackage,
  readRuntimeConfig,
  readRuntimeState,
  redactError,
  removeStaleState,
  repositoryRootFromModule,
  sendControl,
  verifyManagedRuntime,
  wait,
  waitForReady,
  writeStartupConfig,
} from './local-runtime.js';

function parseArguments(argv) {
  if (argv.length === 0 || !['start', 'stop', 'status'].includes(argv[0])) {
    throw Object.assign(new Error('Usage: vio-local.js start|stop|status [--no-browser]'), { code: 'LOCAL_ARGUMENT_INVALID' });
  }
  const action = argv[0];
  let noBrowser = false;
  for (const argument of argv.slice(1)) {
    if (argument === '--no-browser' && !noBrowser) noBrowser = true;
    else throw Object.assign(new Error(`Unsupported or repeated argument: ${argument}`), { code: 'LOCAL_ARGUMENT_INVALID' });
  }
  return Object.freeze({ action, noBrowser });
}

function openBrowser(url) {
  const child = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function logPath(paths) {
  mkdirSync(paths.logsRoot, { recursive: true });
  return join(paths.logsRoot, `runtime-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}.log`);
}

function runtimeHostEnvironment(environment = process.env) {
  const sanitized = { ...environment };
  for (const key of Object.keys(sanitized)) {
    if (key.startsWith('VIO_CONTINUITY_ENGINE_') || key.startsWith('VIO_MODEL_API_KEY_')) delete sanitized[key];
  }
  return sanitized;
}

async function start(paths, noBrowser) {
  assertSupportedNode();
  readRootPackage(paths.repositoryRoot);
  assertPreparedDependencies(paths.repositoryRoot);
  readRuntimeConfig(paths);
  const manifest = readAndVerifyBuild(paths);
  let state = readRuntimeState(paths);
  if (await verifyManagedRuntime(paths, state, manifest.buildInputHash)) {
    await assertRuntimeHealthy(paths, manifest.buildInputHash);
    if (!noBrowser) openBrowser(`${paths.frontendOrigin}/`);
    output({ status: 'already_running', instanceId: state.instanceId, browserOpened: !noBrowser, externalCall: 'not_performed' });
    return;
  }

  let release;
  try { release = acquireOperationLock(paths.operationLockPath); }
  catch (error) {
    if (error.code !== 'LOCAL_OPERATION_IN_PROGRESS') throw error;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await wait(150);
      try {
        state = readRuntimeState(paths);
        if (await verifyManagedRuntime(paths, state, manifest.buildInputHash)) {
          await assertRuntimeHealthy(paths, manifest.buildInputHash);
          if (!noBrowser) openBrowser(`${paths.frontendOrigin}/`);
          output({ status: 'already_running', instanceId: state.instanceId, browserOpened: !noBrowser, externalCall: 'not_performed' });
          return;
        }
      } catch { /* Keep waiting for the first launcher. */ }
    }
    throw error;
  }

  let child;
  let startupPath;
  try {
    state = readRuntimeState(paths);
    if (await verifyManagedRuntime(paths, state, manifest.buildInputHash)) {
      await assertRuntimeHealthy(paths, manifest.buildInputHash);
      if (!noBrowser) openBrowser(`${paths.frontendOrigin}/`);
      output({ status: 'already_running', instanceId: state.instanceId, browserOpened: !noBrowser, externalCall: 'not_performed' });
      return;
    }
    const backendFree = await canListen('127.0.0.1', paths.backendPort);
    const frontendFree = await canListen('127.0.0.1', paths.frontendPort);
    if (!backendFree || !frontendFree) throw Object.assign(new Error(`Port ${paths.backendPort} or ${paths.frontendPort} is occupied by a runtime that Vio cannot prove it owns.`), { code: 'LOCAL_PORT_CONFLICT' });
    if (state) removeStaleState(paths, state);

    const instance = createInstance();
    const startup = makeStartupConfig(paths, manifest, instance);
    mkdirSync(paths.runtimeRoot, { recursive: true });
    startupPath = join(paths.runtimeRoot, `startup-${instance.instanceId}.json`);
    writeStartupConfig(startupPath, startup);
    const file = logPath(paths);
    const descriptor = openSync(file, 'a');
    try {
      child = spawn(process.execPath, [
        join(paths.repositoryRoot, 'scripts', 'windows', 'runtime-host.js'),
        '--startup-config', startupPath,
      ], {
        cwd: paths.repositoryRoot,
        detached: true,
        env: runtimeHostEnvironment(),
        stdio: ['ignore', descriptor, descriptor],
        windowsHide: true,
      });
    } finally {
      closeSync(descriptor);
    }
    child.unref();
    await waitForReady(paths, manifest.buildInputHash, 30_000);
    state = readRuntimeState(paths);
    if (!await verifyManagedRuntime(paths, state, manifest.buildInputHash)) throw Object.assign(new Error('Started runtime did not provide a valid ownership proof.'), { code: 'RUNTIME_OWNERSHIP_FAILED' });
    if (!noBrowser) openBrowser(`${paths.frontendOrigin}/`);
    output({ status: 'started', instanceId: state.instanceId, browserOpened: !noBrowser, databasePath: paths.databasePath, externalCall: 'not_performed' });
  } catch (error) {
    if (child && child.exitCode === null) child.kill();
    throw error;
  } finally {
    if (startupPath && existsSync(startupPath)) {
      try { unlinkSync(startupPath); } catch { /* Runtime may own the startup file. */ }
    }
    release();
  }
}

async function stop(paths) {
  const release = acquireOperationLock(paths.operationLockPath);
  try {
    let state;
    try { state = readRuntimeState(paths); }
    catch (error) { throw Object.assign(new Error('Runtime ownership state is invalid; no process was stopped.'), { code: 'RUNTIME_OWNERSHIP_FAILED', cause: error }); }
    if (!state) {
      output({ status: 'not_running', stopped: false, externalCall: 'not_performed' });
      return;
    }
    if (state.repositoryRoot !== resolve(paths.repositoryRoot) || state.databasePath !== resolve(paths.databasePath)) {
      throw Object.assign(new Error('Runtime state belongs to another repository or database; no process was stopped.'), { code: 'RUNTIME_BINDING_CONFLICT' });
    }
    let response;
    try { response = await sendControl(state, 'stop'); }
    catch (error) { throw Object.assign(new Error('The stored runtime did not prove ownership; no process was stopped.'), { code: 'RUNTIME_OWNERSHIP_FAILED', cause: error }); }
    if (response?.ok !== true || response.status !== 'stopping') throw Object.assign(new Error('The runtime refused the owned stop request.'), { code: 'RUNTIME_STOP_REJECTED' });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && existsSync(paths.statePath)) await wait(100);
    if (existsSync(paths.statePath)) throw Object.assign(new Error('The owned runtime did not stop before the deadline.'), { code: 'RUNTIME_STOP_TIMEOUT' });
    output({ status: 'stopped', stopped: true, instanceId: state.instanceId, databasePreserved: existsSync(paths.databasePath), externalCall: 'not_performed' });
  } finally {
    release();
  }
}

async function status(paths) {
  readRuntimeConfig(paths);
  const manifest = readAndVerifyBuild(paths);
  const state = readRuntimeState(paths);
  const managed = await verifyManagedRuntime(paths, state, manifest.buildInputHash);
  output({ status: managed ? 'running' : 'not_running', managed, externalCall: 'not_performed' });
}

try {
  const options = parseArguments(process.argv.slice(2));
  const repositoryRoot = repositoryRootFromModule();
  const paths = process.env.VIO_LOCAL_RUNTIME_TEST_MODE === 'true'
    ? isolatedTestRuntimePaths(repositoryRoot)
    : defaultRuntimePaths(repositoryRoot);
  if (options.action === 'start') await start(paths, options.noBrowser);
  else if (options.action === 'stop') await stop(paths);
  else await status(paths);
} catch (error) {
  output(redactError(error));
  process.exitCode = 1;
}
