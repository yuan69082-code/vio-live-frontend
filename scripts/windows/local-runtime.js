import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect as connectSocket, createServer as createSocketServer } from 'node:net';

export const LOCAL_RUNTIME_SCHEMA_VERSION = 'vio-windows-local-runtime/v1';
export const LOCAL_BUILD_SCHEMA_VERSION = 'vio-windows-local-build/v1';
export const LOCAL_STATE_SCHEMA_VERSION = 'vio-windows-local-state/v1';
export const EXPECTED_NODE_RANGE = '>=22.23.1 <23.0.0';
export const EXPECTED_PNPM = 'pnpm@11.9.0';
export const BACKEND_HOST = '127.0.0.1';
export const BACKEND_PORT = 8787;
export const FRONTEND_HOST = '127.0.0.1';
export const FRONTEND_PORT = 5173;

const HASH_INPUTS = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'index.html',
  'vite.config.ts',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'src',
  'backend/package.json',
  'backend/src',
  'backend/migrations',
  'scripts/windows/local-runtime.js',
  'scripts/windows/runtime-host.js',
  'scripts/windows/vio-local.js',
]);

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactKeys(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('LOCAL_RUNTIME_INVALID', `${path} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('LOCAL_RUNTIME_INVALID', `${path} contains missing or unknown fields.`);
  }
}

function requireString(value, path, { min = 1, max = 4096 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail('LOCAL_RUNTIME_INVALID', `${path} must be a string between ${min} and ${max} characters.`);
  }
  return value;
}

function requirePort(value, path) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    fail('LOCAL_RUNTIME_INVALID', `${path} must be a valid TCP port.`);
  }
  return value;
}

export function repositoryRootFromModule() {
  return resolve(import.meta.dirname, '..', '..');
}

export function assertSupportedNode(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) fail('NODE_VERSION_UNSUPPORTED', `Unsupported Node.js version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major !== 22 || minor < 23 || (minor === 23 && patch < 1)) {
    fail('NODE_VERSION_UNSUPPORTED', `Vio requires Node.js ${EXPECTED_NODE_RANGE}; found ${version}.`);
  }
  return version;
}

export function canonicalAbsolutePath(value, pathName) {
  requireString(value, pathName);
  if (!isAbsolute(value)) fail('LOCAL_RUNTIME_INVALID', `${pathName} must be absolute.`);
  return resolve(value);
}

export function defaultRuntimePaths(repositoryRoot = repositoryRootFromModule(), environment = process.env) {
  const localAppData = environment.LOCALAPPDATA?.trim();
  if (!localAppData || !isAbsolute(localAppData)) {
    fail('LOCALAPPDATA_MISSING', 'LOCALAPPDATA must be an absolute Windows user directory.');
  }
  const canonicalRepositoryRoot = resolve(repositoryRoot);
  const runtimeRoot = join(resolve(localAppData), 'VioLive', 'runtime');
  return Object.freeze({
    repositoryRoot: canonicalRepositoryRoot,
    databasePath: join(canonicalRepositoryRoot, 'backend', 'data', 'vio-live.dev.sqlite'),
    distRoot: join(canonicalRepositoryRoot, 'dist'),
    buildManifestPath: join(canonicalRepositoryRoot, 'dist', 'vio-local-build.json'),
    runtimeRoot,
    configPath: join(runtimeRoot, 'local-runtime.json'),
    statePath: join(runtimeRoot, 'runtime-state.json'),
    operationLockPath: join(runtimeRoot, 'operation.lock'),
    logsRoot: join(resolve(localAppData), 'VioLive', 'logs'),
    privateRoot: join(resolve(localAppData), 'VioLive', 'private'),
    backendPort: BACKEND_PORT,
    frontendPort: FRONTEND_PORT,
    backendOrigin: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
    frontendOrigin: `http://${FRONTEND_HOST}:${FRONTEND_PORT}`,
  });
}

export function isolatedTestRuntimePaths(repositoryRoot, environment = process.env) {
  if (environment.VIO_LOCAL_RUNTIME_TEST_MODE !== 'true') {
    fail('TEST_ONLY', 'Isolated runtime path overrides are disabled outside tests.');
  }
  const runtimeRoot = canonicalAbsolutePath(environment.VIO_LOCAL_RUNTIME_TEST_ROOT, 'VIO_LOCAL_RUNTIME_TEST_ROOT');
  const databasePath = canonicalAbsolutePath(environment.VIO_LOCAL_RUNTIME_TEST_DATABASE, 'VIO_LOCAL_RUNTIME_TEST_DATABASE');
  const distRoot = join(dirname(runtimeRoot), 'dist');
  const backendPort = requirePort(Number(environment.VIO_LOCAL_RUNTIME_TEST_BACKEND_PORT), 'VIO_LOCAL_RUNTIME_TEST_BACKEND_PORT');
  const frontendPort = requirePort(Number(environment.VIO_LOCAL_RUNTIME_TEST_FRONTEND_PORT), 'VIO_LOCAL_RUNTIME_TEST_FRONTEND_PORT');
  if (backendPort === frontendPort) fail('LOCAL_RUNTIME_INVALID', 'Isolated backend and frontend ports must differ.');
  const base = defaultRuntimePaths(repositoryRoot, environment);
  return Object.freeze({
    ...base,
    databasePath,
    distRoot,
    buildManifestPath: join(distRoot, 'vio-local-build.json'),
    runtimeRoot,
    configPath: join(runtimeRoot, 'local-runtime.json'),
    statePath: join(runtimeRoot, 'runtime-state.json'),
    operationLockPath: join(runtimeRoot, 'operation.lock'),
    logsRoot: join(runtimeRoot, 'logs'),
    privateRoot: join(dirname(runtimeRoot), 'private'),
    backendPort,
    frontendPort,
    backendOrigin: `http://${BACKEND_HOST}:${backendPort}`,
    frontendOrigin: `http://${FRONTEND_HOST}:${frontendPort}`,
  });
}

function walkFiles(root, entry, output) {
  const absolute = join(root, entry);
  if (!existsSync(absolute)) fail('BUILD_INPUT_MISSING', `Required build input is missing: ${entry}`);
  const stats = statSync(absolute, { throwIfNoEntry: true });
  if (stats.isSymbolicLink()) fail('BUILD_INPUT_UNSAFE', `Build input cannot be a symbolic link: ${entry}`);
  if (stats.isFile()) {
    output.push(entry.replaceAll('\\', '/'));
    return;
  }
  if (!stats.isDirectory()) fail('BUILD_INPUT_UNSAFE', `Build input is not a file or directory: ${entry}`);
  for (const child of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (child.isSymbolicLink()) fail('BUILD_INPUT_UNSAFE', `Build input cannot be a symbolic link: ${join(entry, child.name)}`);
    walkFiles(root, join(entry, child.name), output);
  }
}

export function calculateBuildInputHash(repositoryRoot = repositoryRootFromModule()) {
  const root = resolve(repositoryRoot);
  const files = [];
  for (const input of HASH_INPUTS) walkFiles(root, input, files);
  files.sort((left, right) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const filename of files) {
    const content = readFileSync(join(root, filename));
    hash.update(String(Buffer.byteLength(filename)), 'utf8');
    hash.update(':', 'utf8');
    hash.update(filename, 'utf8');
    hash.update(':', 'utf8');
    hash.update(String(content.length), 'utf8');
    hash.update(':', 'utf8');
    hash.update(content);
  }
  return `sha256:${hash.digest('hex')}`;
}

export function readRootPackage(repositoryRoot = repositoryRootFromModule()) {
  const packagePath = join(resolve(repositoryRoot), 'package.json');
  let value;
  try {
    value = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    fail('PACKAGE_INVALID', 'Root package.json is not valid JSON.');
  }
  if (value.packageManager !== EXPECTED_PNPM || value.engines?.node !== EXPECTED_NODE_RANGE) {
    fail('PACKAGE_VERSION_MISMATCH', `Root package.json must pin ${EXPECTED_PNPM} and Node.js ${EXPECTED_NODE_RANGE}.`);
  }
  return value;
}

export function assertPreparedDependencies(repositoryRoot = repositoryRootFromModule()) {
  const root = resolve(repositoryRoot);
  const required = [
    'node_modules/typescript/bin/tsc',
    'node_modules/vite/bin/vite.js',
    'node_modules/vitest/vitest.mjs',
    'node_modules/react/package.json',
    'node_modules/react-dom/package.json',
  ];
  const missing = required.filter((entry) => !existsSync(join(root, entry)));
  if (missing.length > 0) {
    fail('DEPENDENCIES_NOT_PREPARED', `Local dependencies are incomplete (${missing.join(', ')}). Run the explicit first-time preparation; daily start never installs packages.`);
  }
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  renameSync(temporaryPath, path);
}

function readJson(path, code, {
  unreadableCode = code,
  invalidJsonCode = code,
} = {}) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail(code, `${basename(path)} is missing.`);
    fail(unreadableCode, `${basename(path)} could not be read with the current Windows user.`);
  }
  try {
    return JSON.parse(source);
  } catch {
    fail(invalidJsonCode, `${basename(path)} is not valid JSON.`);
  }
}

export function validateRuntimeConfig(value) {
  exactKeys(value, [
    'schemaVersion', 'repositoryRoot', 'databasePath', 'backendOrigin', 'frontendOrigin', 'createdAt',
  ], 'runtime config');
  if (value.schemaVersion !== LOCAL_RUNTIME_SCHEMA_VERSION) fail('LOCAL_RUNTIME_INVALID', 'Unsupported runtime config version.');
  const repositoryRoot = canonicalAbsolutePath(value.repositoryRoot, 'repositoryRoot');
  const databasePath = canonicalAbsolutePath(value.databasePath, 'databasePath');
  let backend;
  let frontend;
  try {
    backend = new URL(value.backendOrigin);
    frontend = new URL(value.frontendOrigin);
  } catch {
    fail('LOCAL_RUNTIME_INVALID', 'Runtime origins must be valid loopback URLs.');
  }
  for (const [origin, path] of [[backend, 'backendOrigin'], [frontend, 'frontendOrigin']]) {
    if (origin.protocol !== 'http:' || origin.hostname !== BACKEND_HOST || origin.pathname !== '/'
        || origin.username || origin.password || origin.search || origin.hash) {
      fail('LOCAL_RUNTIME_INVALID', `${path} must be one credential-free 127.0.0.1 HTTP origin.`);
    }
    requirePort(Number(origin.port), path);
  }
  if (backend.port === frontend.port) fail('LOCAL_RUNTIME_INVALID', 'Runtime backend and frontend ports must differ.');
  requireString(value.createdAt, 'createdAt', { max: 64 });
  if (Number.isNaN(Date.parse(value.createdAt))) fail('LOCAL_RUNTIME_INVALID', 'createdAt must be an RFC 3339 timestamp.');
  return Object.freeze({ ...value, repositoryRoot, databasePath });
}

export function ensureRuntimeConfig(paths, now = () => new Date()) {
  const expected = Object.freeze({
    schemaVersion: LOCAL_RUNTIME_SCHEMA_VERSION,
    repositoryRoot: resolve(paths.repositoryRoot),
    databasePath: resolve(paths.databasePath),
    backendOrigin: paths.backendOrigin,
    frontendOrigin: paths.frontendOrigin,
    createdAt: now().toISOString(),
  });
  if (existsSync(paths.configPath)) {
    const existing = validateRuntimeConfig(readJson(paths.configPath, 'RUNTIME_CONFIG_MISSING', {
      unreadableCode: 'RUNTIME_CONFIG_UNREADABLE',
      invalidJsonCode: 'RUNTIME_CONFIG_INVALID_JSON',
    }));
    for (const key of ['repositoryRoot', 'databasePath', 'backendOrigin', 'frontendOrigin']) {
      if (existing[key] !== expected[key]) {
        fail('RUNTIME_BINDING_CONFLICT', `Existing local runtime is bound to a different ${key}; Vio will not open another checkout or database implicitly.`);
      }
    }
    return Object.freeze({ action: 'reused', config: existing });
  }
  atomicWriteJson(paths.configPath, expected);
  return Object.freeze({ action: 'created', config: expected });
}

export function readRuntimeConfig(paths) {
  const config = validateRuntimeConfig(readJson(paths.configPath, 'RUNTIME_CONFIG_MISSING', {
    unreadableCode: 'RUNTIME_CONFIG_UNREADABLE',
    invalidJsonCode: 'RUNTIME_CONFIG_INVALID_JSON',
  }));
  if (config.repositoryRoot !== resolve(paths.repositoryRoot)
      || config.databasePath !== resolve(paths.databasePath)
      || config.backendOrigin !== paths.backendOrigin
      || config.frontendOrigin !== paths.frontendOrigin) {
    fail('RUNTIME_BINDING_CONFLICT', 'Local runtime is bound to a different repository, database or loopback endpoint.');
  }
  return config;
}

export function validateBuildManifest(value) {
  exactKeys(value, [
    'schemaVersion', 'repositoryRoot', 'buildInputHash', 'preparedAt', 'nodeVersion', 'pnpmVersion',
  ], 'build manifest');
  if (value.schemaVersion !== LOCAL_BUILD_SCHEMA_VERSION) fail('BUILD_NOT_PREPARED', 'Unsupported local build manifest.');
  const repositoryRoot = canonicalAbsolutePath(value.repositoryRoot, 'build.repositoryRoot');
  if (!/^sha256:[0-9a-f]{64}$/.test(value.buildInputHash)) fail('BUILD_NOT_PREPARED', 'Invalid build input hash.');
  requireString(value.preparedAt, 'build.preparedAt', { max: 64 });
  requireString(value.nodeVersion, 'build.nodeVersion', { max: 32 });
  if (value.pnpmVersion !== EXPECTED_PNPM.slice('pnpm@'.length)) fail('BUILD_NOT_PREPARED', 'Build used an unsupported pnpm version.');
  return Object.freeze({ ...value, repositoryRoot });
}

export function writeBuildManifest(paths, buildInputHash, now = () => new Date()) {
  const manifest = Object.freeze({
    schemaVersion: LOCAL_BUILD_SCHEMA_VERSION,
    repositoryRoot: resolve(paths.repositoryRoot),
    buildInputHash,
    preparedAt: now().toISOString(),
    nodeVersion: process.versions.node,
    pnpmVersion: EXPECTED_PNPM.slice('pnpm@'.length),
  });
  atomicWriteJson(paths.buildManifestPath, manifest);
  return manifest;
}

export function readAndVerifyBuild(paths) {
  if (!existsSync(join(paths.distRoot, 'index.html'))) fail('BUILD_NOT_PREPARED', 'dist/index.html is missing. Run first-time preparation.');
  const manifest = validateBuildManifest(readJson(paths.buildManifestPath, 'BUILD_NOT_PREPARED'));
  const actualHash = calculateBuildInputHash(paths.repositoryRoot);
  if (manifest.repositoryRoot !== resolve(paths.repositoryRoot) || manifest.buildInputHash !== actualHash) {
    fail('BUILD_STALE', 'The prepared frontend does not match this repository. Run first-time preparation again.');
  }
  return manifest;
}

export function validateRuntimeState(value) {
  exactKeys(value, [
    'schemaVersion', 'instanceId', 'repositoryRoot', 'databasePath', 'pid', 'startedAt',
    'controlPipe', 'controlToken', 'buildInputHash', 'backendOrigin', 'frontendOrigin', 'status',
  ], 'runtime state');
  if (value.schemaVersion !== LOCAL_STATE_SCHEMA_VERSION || value.status !== 'ready') fail('RUNTIME_STATE_INVALID', 'Runtime state is not ready.');
  if (!/^[0-9a-f-]{36}$/.test(value.instanceId)) fail('RUNTIME_STATE_INVALID', 'Invalid runtime instance id.');
  const repositoryRoot = canonicalAbsolutePath(value.repositoryRoot, 'state.repositoryRoot');
  const databasePath = canonicalAbsolutePath(value.databasePath, 'state.databasePath');
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) fail('RUNTIME_STATE_INVALID', 'Invalid runtime process id.');
  requireString(value.startedAt, 'state.startedAt', { max: 64 });
  if (!value.controlPipe.startsWith('\\\\.\\pipe\\vio-live-')) fail('RUNTIME_STATE_INVALID', 'Invalid runtime control pipe.');
  if (!/^[0-9a-f]{64}$/.test(value.controlToken)) fail('RUNTIME_STATE_INVALID', 'Invalid runtime control token.');
  if (!/^sha256:[0-9a-f]{64}$/.test(value.buildInputHash)) fail('RUNTIME_STATE_INVALID', 'Invalid runtime build hash.');
  let backend;
  let frontend;
  try {
    backend = new URL(value.backendOrigin);
    frontend = new URL(value.frontendOrigin);
  } catch {
    fail('RUNTIME_STATE_INVALID', 'Runtime state origins are invalid.');
  }
  if (backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1' || backend.pathname !== '/' || backend.search || backend.hash) fail('RUNTIME_STATE_INVALID', 'Invalid backend origin.');
  if (frontend.protocol !== 'http:' || frontend.hostname !== '127.0.0.1' || frontend.pathname !== '/' || frontend.search || frontend.hash) fail('RUNTIME_STATE_INVALID', 'Invalid frontend origin.');
  requirePort(Number(backend.port), 'state.backendPort');
  requirePort(Number(frontend.port), 'state.frontendPort');
  return Object.freeze({ ...value, repositoryRoot, databasePath });
}

export function readRuntimeState(paths) {
  if (!existsSync(paths.statePath)) return null;
  return validateRuntimeState(readJson(paths.statePath, 'RUNTIME_STATE_INVALID'));
}

export function writeRuntimeState(path, state) {
  validateRuntimeState(state);
  atomicWriteJson(path, state);
}

export function removeOwnedState(path, instanceId) {
  if (!existsSync(path)) return;
  try {
    const state = validateRuntimeState(readJson(path, 'RUNTIME_STATE_INVALID'));
    if (state.instanceId === instanceId) unlinkSync(path);
  } catch {
    // Never remove state that cannot be proven to belong to this runtime.
  }
}

export function createInstance() {
  const instanceId = randomUUID();
  return Object.freeze({
    instanceId,
    controlToken: randomBytes(32).toString('hex'),
    controlPipe: `\\\\.\\pipe\\vio-live-${instanceId}`,
  });
}

function tokensEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createControlServer({ pipePath, controlToken, status, stop }) {
  return createSocketServer((socket) => {
    socket.setEncoding('utf8');
    let body = '';
    socket.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) socket.destroy();
      const newline = body.indexOf('\n');
      if (newline === -1) return;
      let command;
      try {
        command = JSON.parse(body.slice(0, newline));
      } catch {
        socket.end(`${JSON.stringify({ ok: false, code: 'INVALID_CONTROL_REQUEST' })}\n`);
        return;
      }
      if (!tokensEqual(command?.token, controlToken)) {
        socket.end(`${JSON.stringify({ ok: false, code: 'CONTROL_ACCESS_DENIED' })}\n`);
        return;
      }
      if (command?.command === 'status') {
        socket.end(`${JSON.stringify({ ok: true, ...status() })}\n`);
        return;
      }
      if (command?.command === 'stop') {
        socket.end(`${JSON.stringify({ ok: true, status: 'stopping' })}\n`);
        setImmediate(stop);
        return;
      }
      socket.end(`${JSON.stringify({ ok: false, code: 'UNKNOWN_CONTROL_COMMAND' })}\n`);
    });
  });
}

export function sendControl(state, command, timeoutMs = 3000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connectSocket(state.controlPipe);
    let settled = false;
    let body = '';
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      callback(value);
    };
    const timer = setTimeout(() => finish(rejectPromise, Object.assign(new Error('Runtime control timed out.'), { code: 'CONTROL_TIMEOUT' })), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('error', (error) => finish(rejectPromise, error));
    socket.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) finish(rejectPromise, Object.assign(new Error('Runtime control response is too large.'), { code: 'CONTROL_INVALID' }));
      const newline = body.indexOf('\n');
      if (newline === -1) return;
      try {
        finish(resolvePromise, JSON.parse(body.slice(0, newline)));
      } catch {
        finish(rejectPromise, Object.assign(new Error('Runtime control response is invalid.'), { code: 'CONTROL_INVALID' }));
      }
    });
    socket.once('connect', () => socket.write(`${JSON.stringify({ command, token: state.controlToken })}\n`));
  });
}

export async function verifyManagedRuntime(paths, state, buildInputHash) {
  if (!state) return false;
  if (
    state.repositoryRoot !== resolve(paths.repositoryRoot)
    || state.databasePath !== resolve(paths.databasePath)
    || state.backendOrigin !== paths.backendOrigin
    || state.frontendOrigin !== paths.frontendOrigin
    || state.buildInputHash !== buildInputHash
  ) return false;
  try {
    const response = await sendControl(state, 'status');
    return response?.ok === true
      && response.instanceId === state.instanceId
      && response.pid === state.pid
      && response.repositoryRoot === state.repositoryRoot
      && response.databasePath === state.databasePath
      && response.buildInputHash === state.buildInputHash
      && response.status === 'ready';
  } catch {
    return false;
  }
}

export function httpJson(url, { timeoutMs = 3000, maxBytes = 131072 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
      rejectPromise(Object.assign(new Error('Only 127.0.0.1 HTTP health checks are allowed.'), { code: 'HEALTH_TARGET_UNSAFE' }));
      return;
    }
    const request = httpRequest(parsed, { method: 'GET', headers: { connection: 'close' } }, (response) => {
      const chunks = [];
      let length = 0;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length > maxBytes) request.destroy(Object.assign(new Error('Health response is too large.'), { code: 'HEALTH_RESPONSE_TOO_LARGE' }));
        else chunks.push(chunk);
      });
      response.once('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { rejectPromise(Object.assign(new Error('Health response is not JSON.'), { code: 'HEALTH_RESPONSE_INVALID' })); return; }
        resolvePromise({ statusCode: response.statusCode, body });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('Health request timed out.'), { code: 'HEALTH_TIMEOUT' })));
    request.once('error', rejectPromise);
    request.end();
  });
}

export async function assertRuntimeHealthy(paths, buildInputHash) {
  const backend = await httpJson(`${paths.backendOrigin}/health`);
  if (backend.statusCode !== 200 || backend.body?.data?.status !== 'ok' || backend.body?.data?.database !== 'ok') {
    fail('BACKEND_NOT_READY', 'Vio backend health check did not report a ready database.');
  }
  const frontend = await httpJson(`${paths.frontendOrigin}/.vio-runtime/health`);
  if (
    frontend.statusCode !== 200
    || frontend.body?.status !== 'ready'
    || frontend.body?.buildInputHash !== buildInputHash
  ) fail('FRONTEND_NOT_READY', 'Vio frontend health check did not match the prepared build.');
  return Object.freeze({ backend: 'ready', frontend: 'ready' });
}

export function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function waitForReady(paths, buildInputHash, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await assertRuntimeHealthy(paths, buildInputHash); }
    catch (error) { lastError = error; await wait(150); }
  }
  throw Object.assign(new Error('Vio services did not become ready before the startup deadline.'), {
    code: 'STARTUP_TIMEOUT',
    cause: lastError,
  });
}

export function canListen(host, port) {
  return new Promise((resolvePromise) => {
    const server = createSocketServer();
    server.unref();
    server.once('error', () => resolvePromise(false));
    server.listen(port, host, () => server.close(() => resolvePromise(true)));
  });
}

function proxyRequest(incoming, outgoing, backendOrigin) {
  const requestTarget = incoming.url ?? '';
  if (!requestTarget.startsWith('/') || requestTarget.startsWith('//')) {
    outgoing.writeHead(400, { 'content-type': 'application/json; charset=utf-8', connection: 'close' });
    outgoing.end(`${JSON.stringify({ error: { code: 'LOCAL_PROXY_TARGET_INVALID', message: 'Only local origin-form requests are accepted.' } })}\n`);
    return;
  }
  const target = new URL(requestTarget, backendOrigin);
  if (target.origin !== new URL(backendOrigin).origin) {
    outgoing.writeHead(400, { 'content-type': 'application/json; charset=utf-8', connection: 'close' });
    outgoing.end(`${JSON.stringify({ error: { code: 'LOCAL_PROXY_TARGET_INVALID', message: 'Only the bound Vio backend may be requested.' } })}\n`);
    return;
  }
  const headers = { ...incoming.headers, host: new URL(backendOrigin).host, connection: 'close' };
  const proxy = httpRequest(target, { method: incoming.method, headers }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  proxy.setTimeout(65_000, () => proxy.destroy(new Error('Backend proxy timed out.')));
  proxy.once('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'application/json; charset=utf-8', connection: 'close' });
    outgoing.end(`${JSON.stringify({ error: { code: 'LOCAL_BACKEND_UNAVAILABLE', message: 'Vio local backend is unavailable.' } })}\n`);
  });
  incoming.pipe(proxy);
}

function safeStaticPath(distRoot, requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath); }
  catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const candidate = resolve(distRoot, `.${decoded}`);
  const root = resolve(distRoot);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  return candidate;
}

export function createFrontendServer({ distRoot, backendOrigin, buildInputHash }) {
  const root = resolve(distRoot);
  return createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      proxyRequest(request, response, backendOrigin);
      return;
    }
    if (url.pathname === '/.vio-runtime/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
      response.end(`${JSON.stringify({ status: 'ready', buildInputHash })}\n`);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { allow: 'GET, HEAD', connection: 'close' });
      response.end();
      return;
    }
    let path = safeStaticPath(root, url.pathname === '/' ? '/index.html' : url.pathname);
    if (!path) {
      response.writeHead(400, { connection: 'close' });
      response.end();
      return;
    }
    if (!existsSync(path) || !statSync(path).isFile()) path = join(root, 'index.html');
    if (!existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
      response.end('Vio frontend has not been prepared.');
      return;
    }
    const stats = statSync(path);
    response.writeHead(200, {
      'content-type': MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'content-length': stats.size,
      'cache-control': path.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      connection: 'close',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).pipe(response);
  });
}

export function strictStartupConfig(value) {
  exactKeys(value, [
    'schemaVersion', 'instanceId', 'controlToken', 'controlPipe', 'repositoryRoot', 'databasePath',
    'runtimeRoot', 'statePath', 'distRoot', 'buildInputHash', 'backendPort', 'frontendPort',
  ], 'startup config');
  if (value.schemaVersion !== LOCAL_STATE_SCHEMA_VERSION) fail('STARTUP_CONFIG_INVALID', 'Unsupported startup config.');
  if (!/^[0-9a-f-]{36}$/.test(value.instanceId) || !/^[0-9a-f]{64}$/.test(value.controlToken)) fail('STARTUP_CONFIG_INVALID', 'Invalid startup identity.');
  if (value.controlPipe !== `\\\\.\\pipe\\vio-live-${value.instanceId}`) fail('STARTUP_CONFIG_INVALID', 'Startup control pipe does not match its instance.');
  if (!/^sha256:[0-9a-f]{64}$/.test(value.buildInputHash)) fail('STARTUP_CONFIG_INVALID', 'Invalid startup build hash.');
  const normalized = {
    ...value,
    repositoryRoot: canonicalAbsolutePath(value.repositoryRoot, 'startup.repositoryRoot'),
    databasePath: canonicalAbsolutePath(value.databasePath, 'startup.databasePath'),
    runtimeRoot: canonicalAbsolutePath(value.runtimeRoot, 'startup.runtimeRoot'),
    statePath: canonicalAbsolutePath(value.statePath, 'startup.statePath'),
    distRoot: canonicalAbsolutePath(value.distRoot, 'startup.distRoot'),
    backendPort: requirePort(value.backendPort, 'startup.backendPort'),
    frontendPort: requirePort(value.frontendPort, 'startup.frontendPort'),
  };
  if (normalized.statePath !== join(normalized.runtimeRoot, 'runtime-state.json')) fail('STARTUP_CONFIG_INVALID', 'Startup state path must be inside its exact runtime directory.');
  const expectedDistRoot = process.env.VIO_LOCAL_RUNTIME_TEST_MODE === 'true'
    ? join(dirname(canonicalAbsolutePath(process.env.VIO_LOCAL_RUNTIME_TEST_ROOT, 'VIO_LOCAL_RUNTIME_TEST_ROOT')), 'dist')
    : join(normalized.repositoryRoot, 'dist');
  if (normalized.distRoot !== expectedDistRoot) fail('STARTUP_CONFIG_INVALID', 'Startup frontend path must be the exact prepared build for this runtime.');
  return Object.freeze(normalized);
}

export function readStartupConfig(path) {
  const value = strictStartupConfig(readJson(path, 'STARTUP_CONFIG_INVALID'));
  unlinkSync(path);
  return value;
}

export function writeStartupConfig(path, value) {
  strictStartupConfig(value);
  atomicWriteJson(path, value);
}

export function acquireOperationLock(path) {
  mkdirSync(dirname(path), { recursive: true });
  const token = `${process.pid}:${randomBytes(16).toString('hex')}`;
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeFileSync(descriptor, token, 'utf8');
  } catch (error) {
    if (error.code === 'EEXIST') fail('LOCAL_OPERATION_IN_PROGRESS', 'Another Vio start or stop operation is already in progress.');
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return () => {
    try {
      if (readFileSync(path, 'utf8') === token) unlinkSync(path);
    } catch {
      // Do not remove a lock that is not provably ours.
    }
  };
}

export function removeStaleState(paths, state) {
  if (!state) return;
  if (state.repositoryRoot !== resolve(paths.repositoryRoot) || state.databasePath !== resolve(paths.databasePath)) {
    fail('RUNTIME_BINDING_CONFLICT', 'Refusing to replace runtime state belonging to another repository or database.');
  }
  unlinkSync(paths.statePath);
}

export function makeStartupConfig(paths, manifest, instance, overrides = {}) {
  return Object.freeze({
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    instanceId: instance.instanceId,
    controlToken: instance.controlToken,
    controlPipe: instance.controlPipe,
    repositoryRoot: resolve(paths.repositoryRoot),
    databasePath: resolve(paths.databasePath),
    runtimeRoot: resolve(paths.runtimeRoot),
    statePath: resolve(paths.statePath),
    distRoot: resolve(paths.distRoot),
    buildInputHash: manifest.buildInputHash,
    backendPort: overrides.backendPort ?? paths.backendPort ?? BACKEND_PORT,
    frontendPort: overrides.frontendPort ?? paths.frontendPort ?? FRONTEND_PORT,
  });
}

export function redactError(error) {
  return Object.freeze({
    status: 'error',
    code: typeof error?.code === 'string' ? error.code : 'LOCAL_RUNTIME_FAILED',
    message: typeof error?.message === 'string' ? error.message : 'Vio local runtime failed.',
    externalCall: 'not_performed',
  });
}

export function removeTestRuntimeRoot(path) {
  if (!process.env.VIO_LOCAL_RUNTIME_TEST_MODE) fail('TEST_ONLY', 'Test cleanup is disabled outside the isolated test process.');
  rmSync(path, { recursive: true, force: true });
}
