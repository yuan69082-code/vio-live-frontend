import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

import { createApplication } from '../../backend/src/app.js';
import { loadConfig } from '../../backend/src/config.js';
import {
  LOCAL_STATE_SCHEMA_VERSION,
  assertSupportedNode,
  createControlServer,
  createFrontendServer,
  readStartupConfig,
  removeOwnedState,
  writeRuntimeState,
} from './local-runtime.js';

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--startup-config') throw Object.assign(new Error('runtime-host requires one startup config path.'), { code: 'STARTUP_ARGUMENT_INVALID' });
  return argv[1];
}

function sanitizedEnvironment(startup) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('VIO_CONTINUITY_ENGINE_') || key.startsWith('VIO_MODEL_API_KEY_')) delete environment[key];
  }
  return {
    ...environment,
    VIO_BACKEND_HOST: '127.0.0.1',
    VIO_BACKEND_PORT: String(startup.backendPort),
    VIO_BACKEND_DB_PATH: startup.databasePath,
    VIO_PERSONAL_ALLOWED_ORIGIN: `http://127.0.0.1:${startup.frontendPort}`,
    VIO_CONTINUITY_ENGINE_ENABLED: 'false',
  };
}

assertSupportedNode();
const startupPath = parseArguments(process.argv.slice(2));
const startup = readStartupConfig(startupPath);
if (
  process.env.VIO_LOCAL_RUNTIME_TEST_MODE !== 'true'
  && startup.databasePath !== join(startup.repositoryRoot, 'backend', 'data', 'vio-live.dev.sqlite')
) throw Object.assign(new Error('The daily launcher only accepts the personal database bound to this repository.'), { code: 'PERSONAL_DATABASE_BINDING_INVALID' });
if (!existsSync(startup.databasePath)) throw Object.assign(new Error('The bound personal database is missing; Vio will not create a different empty database.'), { code: 'PERSONAL_DATABASE_MISSING' });
mkdirSync(startup.runtimeRoot, { recursive: true });

const config = loadConfig(sanitizedEnvironment(startup));
const application = createApplication({ config });
const frontend = createFrontendServer({
  distRoot: startup.distRoot,
  backendOrigin: `http://127.0.0.1:${startup.backendPort}`,
  buildInputHash: startup.buildInputHash,
});
let stopping = false;
let control;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    if (frontend.listening) await new Promise((resolvePromise) => frontend.close(resolvePromise));
    await application.stop();
    if (control?.listening) await new Promise((resolvePromise) => control.close(resolvePromise));
  } finally {
    removeOwnedState(startup.statePath, startup.instanceId);
  }
}

process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));

try {
  await application.start();
  await new Promise((resolvePromise, rejectPromise) => {
    frontend.once('error', rejectPromise);
    frontend.listen(startup.frontendPort, '127.0.0.1', resolvePromise);
  });
  control = createControlServer({
    pipePath: startup.controlPipe,
    controlToken: startup.controlToken,
    status: () => ({
      status: 'ready',
      instanceId: startup.instanceId,
      pid: process.pid,
      repositoryRoot: startup.repositoryRoot,
      databasePath: startup.databasePath,
      buildInputHash: startup.buildInputHash,
    }),
    stop: () => void shutdown().finally(() => process.exit(0)),
  });
  await new Promise((resolvePromise, rejectPromise) => {
    control.once('error', rejectPromise);
    control.listen(startup.controlPipe, resolvePromise);
  });
  writeRuntimeState(startup.statePath, {
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    instanceId: startup.instanceId,
    repositoryRoot: startup.repositoryRoot,
    databasePath: startup.databasePath,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    controlPipe: startup.controlPipe,
    controlToken: startup.controlToken,
    buildInputHash: startup.buildInputHash,
    backendOrigin: `http://127.0.0.1:${startup.backendPort}`,
    frontendOrigin: `http://127.0.0.1:${startup.frontendPort}`,
    status: 'ready',
  });
} catch (error) {
  await shutdown();
  throw error;
}

// Keep the process alive through the backend, frontend and named-pipe servers.
