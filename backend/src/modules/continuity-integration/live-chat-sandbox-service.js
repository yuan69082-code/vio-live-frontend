import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  openSync,
  closeSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  EXPECTED_BINDING_FIXTURE_HASH,
  fixedSubjectBindingFixture,
} from './first-round-contract.js';
import { calculateBindingFixtureHash } from './first-round-hashing.js';
import { validateFixedSubjectBindingFixture } from './first-round-validator.js';

export const LIVE_CHAT_SANDBOX = Object.freeze({
  schemaVersion: 'vio-live-s4-live-sandbox/v1',
  purpose: 's4-live-acceptance',
  identityClass: 'disposable_test',
  promotionAllowed: false,
  cleanupPolicy: 'delete_entire_sandbox_only',
  cycleId: 'vio-live-first-chat-cycle-001',
  conversationId: 'conversation-001',
  engineCommitSha: '7a1dacae9401e1742aaf6ddbaa26f1b456880383',
});

const MANIFEST_FILE = 'sandbox.manifest.json';
const BINDING_FILE = 'binding.json';
const VIO_DATA_DIRECTORY = 'vio-data';
const VIO_DATABASE_FILE = 'vio-live.sqlite';
const ENGINE_DATA_DIRECTORY = 'engine-data';
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET = Object.freeze({
  maximumPathLength: 240,
  subjectHashLength: 64,
  sessionHashLength: 64,
  temporaryRandomNameLength: 8,
});

const MANIFEST_FIELDS = Object.freeze([
  'schemaVersion',
  'sandboxId',
  'purpose',
  'identityClass',
  'promotionAllowed',
  'createdAt',
  'canonicalSandboxRoot',
  'canonicalBindingFile',
  'canonicalVioDatabasePath',
  'canonicalEngineDataDir',
  'userId',
  'assistantId',
  'subjectId',
  'conversationId',
  'bindingId',
  'bindingVersion',
  'bindingFixtureHash',
  'cycleId',
  'vioCommitSha',
  'engineCommitSha',
  'protectedPaths',
  'cleanupPolicy',
]);

export class LiveChatSandboxError extends Error {
  constructor(message, { status = 'conflict', reason = 'sandbox_invalid' } = {}) {
    super(message);
    this.name = 'LiveChatSandboxError';
    this.status = status;
    this.reason = reason;
  }
}

function fail(message, options) {
  throw new LiveChatSandboxError(message, options);
}

function comparisonPath(path) {
  const normalized = resolve(path).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return comparisonPath(left) === comparisonPath(right);
}

function isInside(path, parent) {
  const child = comparisonPath(path);
  const root = comparisonPath(parent);
  return child !== root && child.startsWith(`${root}${sep}`);
}

function canonicalizeProspectivePath(path) {
  if (!isAbsolute(path)) {
    fail('Sandbox paths must be absolute.', { status: 'unsafe', reason: 'path_not_absolute' });
  }
  const absolute = resolve(path);
  const missing = [];
  let existing = absolute;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      fail('No existing ancestor was found for the sandbox path.', {
        status: 'unsafe',
        reason: 'path_ancestor_missing',
      });
    }
    missing.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    existing = parent;
  }
  let canonical = realpathSync.native(existing);
  for (const segment of missing) canonical = join(canonical, segment);
  return resolve(canonical);
}

function existingAncestors(path) {
  const values = [];
  let current = resolve(path);
  while (true) {
    if (existsSync(current)) values.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return values;
}

function assertNoReparseAncestors(path) {
  for (const value of existingAncestors(path)) {
    if (lstatSync(value).isSymbolicLink()) {
      fail('Sandbox paths must not traverse symlinks, junctions, or reparse points.', {
        status: 'unsafe',
        reason: 'reparse_point_forbidden',
      });
    }
  }
}

function assertNoReparseTree(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const info = lstatSync(current);
    if (info.isSymbolicLink()) {
      fail('Sandbox content contains a symlink, junction, or reparse point.', {
        status: 'unsafe',
        reason: 'reparse_point_forbidden',
      });
    }
    if (info.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    }
  }
}

function repositoryRoot() {
  return resolve(import.meta.dirname, '..', '..', '..', '..');
}

function engineRepositoryRoot() {
  return resolve(repositoryRoot(), '..', 'continuity-engine');
}

function defaultVioDatabasePath() {
  return resolve(repositoryRoot(), 'backend', 'data', 'vio-live.dev.sqlite');
}

function protectedPaths() {
  const repo = canonicalizeProspectivePath(repositoryRoot());
  const engine = canonicalizeProspectivePath(engineRepositoryRoot());
  let home;
  let documents;
  try { home = canonicalizeProspectivePath(homedir()); } catch { home = resolve(homedir()); }
  try { documents = canonicalizeProspectivePath(join(homedir(), 'Documents')); } catch {
    documents = resolve(homedir(), 'Documents');
  }
  const values = [
    repo,
    engine,
    canonicalizeProspectivePath(defaultVioDatabasePath()),
    canonicalizeProspectivePath(join(engine, '.continuity-data')),
    home,
    documents,
    parsePath(repo).root,
    parsePath(engine).root,
    parsePath(home).root,
    parsePath(documents).root,
  ];
  return Object.freeze(values.filter((value, index) => (
    values.findIndex((candidate) => samePath(candidate, value)) === index
  )));
}

function assertSafeSandboxRoot(root, protectedValues = protectedPaths()) {
  const repo = repositoryRoot();
  const engine = engineRepositoryRoot();
  const defaultEngineData = join(engine, '.continuity-data');
  const defaultDatabase = defaultVioDatabasePath();
  if (
    samePath(root, repo) || isInside(root, repo)
    || samePath(root, engine) || isInside(root, engine)
    || samePath(root, defaultEngineData) || isInside(root, defaultEngineData)
    || samePath(root, defaultDatabase)
  ) {
    fail('Sandbox root must remain outside repositories and default data paths.', {
      status: 'unsafe',
      reason: 'protected_path_targeted',
    });
  }
  for (const protectedPath of protectedValues) {
    if (samePath(root, protectedPath) || isInside(protectedPath, root)) {
      fail('Sandbox root equals or contains a protected path.', {
        status: 'unsafe',
        reason: 'protected_path_targeted',
      });
    }
  }
}

function exactObjectFields(value, expectedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Sandbox manifest must be a JSON object.', { reason: 'manifest_type_invalid' });
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    fail('Sandbox manifest fields do not match the strict schema.', {
      reason: 'manifest_fields_invalid',
    });
  }
}

function strictJsonParse(text) {
  let index = 0;
  function whitespace() {
    while (/\s/u.test(text[index] ?? '')) index += 1;
  }
  function string() {
    if (text[index] !== '"') fail('Invalid JSON string.', { reason: 'manifest_json_invalid' });
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === '"') {
        index += 1;
        try { return JSON.parse(text.slice(start, index)); } catch {
          fail('Invalid JSON string.', { reason: 'manifest_json_invalid' });
        }
      }
      if (text[index] === '\\') index += 2;
      else index += 1;
    }
    fail('Unterminated JSON string.', { reason: 'manifest_json_invalid' });
  }
  function value() {
    whitespace();
    const current = text[index];
    if (current === '{') {
      index += 1;
      const object = {};
      const keys = new Set();
      whitespace();
      if (text[index] === '}') { index += 1; return object; }
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail('Duplicate JSON property is forbidden.', { reason: 'manifest_duplicate_field' });
        keys.add(key);
        whitespace();
        if (text[index] !== ':') fail('Invalid JSON object.', { reason: 'manifest_json_invalid' });
        index += 1;
        object[key] = value();
        whitespace();
        if (text[index] === '}') { index += 1; return object; }
        if (text[index] !== ',') fail('Invalid JSON object.', { reason: 'manifest_json_invalid' });
        index += 1;
      }
    }
    if (current === '[') {
      index += 1;
      const array = [];
      whitespace();
      if (text[index] === ']') { index += 1; return array; }
      while (true) {
        array.push(value());
        whitespace();
        if (text[index] === ']') { index += 1; return array; }
        if (text[index] !== ',') fail('Invalid JSON array.', { reason: 'manifest_json_invalid' });
        index += 1;
      }
    }
    if (current === '"') return string();
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, index)) { index += literal.length; return parsed; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
    if (match) { index += match[0].length; return Number(match[0]); }
    fail('Invalid JSON value.', { reason: 'manifest_json_invalid' });
  }
  const result = value();
  whitespace();
  if (index !== text.length) fail('Unexpected content follows the JSON value.', { reason: 'manifest_json_invalid' });
  return result;
}

function currentVioCommitSha() {
  const value = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot(),
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  if (!SHA_PATTERN.test(value)) fail('Vio commit SHA cannot be resolved.', { reason: 'vio_commit_unavailable' });
  return value;
}

function expectedPaths(root) {
  return Object.freeze({
    canonicalSandboxRoot: root,
    canonicalBindingFile: join(root, BINDING_FILE),
    canonicalVioDatabasePath: join(root, VIO_DATA_DIRECTORY, VIO_DATABASE_FILE),
    canonicalEngineDataDir: join(root, ENGINE_DATA_DIRECTORY),
    manifestPath: join(root, MANIFEST_FILE),
  });
}

export function inspectEnginePersistencePathBudget(
  engineDataDir,
  {
    platform = process.platform,
    maximumPathLength = WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET.maximumPathLength,
  } = {},
) {
  if (typeof engineDataDir !== 'string' || engineDataDir.trim() === '') {
    throw new TypeError('engineDataDir must be a non-empty string.');
  }
  if (!Number.isSafeInteger(maximumPathLength) || maximumPathLength <= 0) {
    throw new TypeError('maximumPathLength must be a positive safe integer.');
  }
  const subjectHash = 's'.repeat(WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET.subjectHashLength);
  const sessionHash = 'w'.repeat(WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET.sessionHashLength);
  const sessionDirectory = join(
    engineDataDir,
    'awakening',
    'sessions',
    subjectHash,
  );
  const wakeSessionPath = join(sessionDirectory, `${sessionHash}.json`);
  const atomicTemporaryPath = join(
    sessionDirectory,
    `.${sessionHash}.${'t'.repeat(WINDOWS_ENGINE_PERSISTENCE_PATH_BUDGET.temporaryRandomNameLength)}.tmp`,
  );
  const applies = platform === 'win32';
  const wakeSessionPathLength = wakeSessionPath.length;
  const atomicTemporaryPathLength = atomicTemporaryPath.length;
  return Object.freeze({
    platform,
    applies,
    maximumPathLength,
    wakeSessionPathLength,
    atomicTemporaryPathLength,
    safe: !applies || (
      wakeSessionPathLength <= maximumPathLength
      && atomicTemporaryPathLength <= maximumPathLength
    ),
  });
}

function assertEnginePersistencePathBudget(engineDataDir, options) {
  const budget = inspectEnginePersistencePathBudget(engineDataDir, options);
  if (!budget.safe) {
    fail('Engine persistence paths exceed the Windows safety budget.', {
      status: 'unsafe',
      reason: 'engine_persistence_path_budget_exceeded',
    });
  }
  return budget;
}

function validateManifestValues(manifest, manifestPath, pathBudgetOptions) {
  exactObjectFields(manifest, MANIFEST_FIELDS);
  const binding = fixedSubjectBindingFixture();
  const canonicalManifestPath = canonicalizeProspectivePath(manifestPath);
  const root = canonicalizeProspectivePath(manifest.canonicalSandboxRoot);
  const paths = expectedPaths(root);
  const expectedProtected = protectedPaths();
  assertSafeSandboxRoot(root, expectedProtected);
  assertEnginePersistencePathBudget(paths.canonicalEngineDataDir, pathBudgetOptions);
  const exactValues = {
    schemaVersion: LIVE_CHAT_SANDBOX.schemaVersion,
    purpose: LIVE_CHAT_SANDBOX.purpose,
    identityClass: LIVE_CHAT_SANDBOX.identityClass,
    promotionAllowed: LIVE_CHAT_SANDBOX.promotionAllowed,
    canonicalSandboxRoot: paths.canonicalSandboxRoot,
    canonicalBindingFile: paths.canonicalBindingFile,
    canonicalVioDatabasePath: paths.canonicalVioDatabasePath,
    canonicalEngineDataDir: paths.canonicalEngineDataDir,
    userId: binding.userId,
    assistantId: binding.assistantId,
    subjectId: binding.subjectId,
    conversationId: LIVE_CHAT_SANDBOX.conversationId,
    bindingId: binding.bindingId,
    bindingVersion: binding.bindingVersion,
    bindingFixtureHash: EXPECTED_BINDING_FIXTURE_HASH,
    cycleId: LIVE_CHAT_SANDBOX.cycleId,
    engineCommitSha: LIVE_CHAT_SANDBOX.engineCommitSha,
    cleanupPolicy: LIVE_CHAT_SANDBOX.cleanupPolicy,
  };
  for (const [field, expected] of Object.entries(exactValues)) {
    if (!isDeepStrictEqual(manifest[field], expected)) {
      fail(`Sandbox manifest ${field} does not match.`, { reason: `manifest_${field}_mismatch` });
    }
  }
  if (!samePath(canonicalManifestPath, paths.manifestPath)) {
    fail('Manifest path does not match canonicalSandboxRoot.', {
      status: 'unsafe',
      reason: 'manifest_path_mismatch',
    });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(manifest.sandboxId)) {
    fail('sandboxId must be a UUID v4.', { reason: 'sandbox_id_invalid' });
  }
  if (!RFC3339_UTC_PATTERN.test(manifest.createdAt) || Number.isNaN(Date.parse(manifest.createdAt))) {
    fail('createdAt must be an RFC 3339 UTC timestamp.', { reason: 'created_at_invalid' });
  }
  if (!SHA_PATTERN.test(manifest.vioCommitSha)) {
    fail('vioCommitSha must be a full lowercase Git SHA.', { reason: 'vio_commit_invalid' });
  }
  if (!isDeepStrictEqual(manifest.protectedPaths, expectedProtected)) {
    fail('protectedPaths do not match the safety policy.', {
      status: 'unsafe',
      reason: 'protected_paths_mismatch',
    });
  }
  return Object.freeze({ manifest: structuredClone(manifest), paths, protectedPaths: expectedProtected });
}

function validateTopLevelEntries(root) {
  const allowed = new Set([MANIFEST_FILE, BINDING_FILE, VIO_DATA_DIRECTORY, ENGINE_DATA_DIRECTORY]);
  const unexpected = readdirSync(root).filter((entry) => !allowed.has(entry));
  if (unexpected.length > 0) {
    fail('Sandbox root contains unexpected top-level entries.', {
      status: 'unsafe',
      reason: 'unexpected_sandbox_content',
    });
  }
  const vioData = join(root, VIO_DATA_DIRECTORY);
  if (existsSync(vioData)) {
    const allowedVio = new Set([VIO_DATABASE_FILE, `${VIO_DATABASE_FILE}-wal`, `${VIO_DATABASE_FILE}-shm`]);
    if (readdirSync(vioData).some((entry) => !allowedVio.has(entry))) {
      fail('vio-data contains an unexpected file.', {
        status: 'unsafe',
        reason: 'unexpected_vio_data_content',
      });
    }
  }
}

export function readAndValidateLiveChatSandboxManifest(manifestPath, pathBudgetOptions) {
  if (typeof manifestPath !== 'string' || manifestPath.trim() === '' || !isAbsolute(manifestPath)) {
    fail('Sandbox manifest path must be an absolute path.', {
      status: manifestPath ? 'unsafe' : 'missing',
      reason: manifestPath ? 'manifest_path_not_absolute' : 'sandbox_manifest_missing',
    });
  }
  const canonicalManifestPath = canonicalizeProspectivePath(manifestPath.trim());
  assertNoReparseAncestors(canonicalManifestPath);
  if (!existsSync(canonicalManifestPath) || !statSync(canonicalManifestPath).isFile()) {
    fail('Sandbox manifest does not exist.', { status: 'missing', reason: 'sandbox_manifest_missing' });
  }
  const manifest = strictJsonParse(readFileSync(canonicalManifestPath, 'utf8'));
  const validated = validateManifestValues(
    manifest,
    canonicalManifestPath,
    pathBudgetOptions,
  );
  if (!existsSync(validated.paths.canonicalSandboxRoot)) {
    fail('Sandbox root does not exist.', { status: 'missing', reason: 'sandbox_root_missing' });
  }
  assertNoReparseTree(validated.paths.canonicalSandboxRoot);
  validateTopLevelEntries(validated.paths.canonicalSandboxRoot);
  for (const required of [
    validated.paths.canonicalBindingFile,
    dirname(validated.paths.canonicalVioDatabasePath),
    validated.paths.canonicalEngineDataDir,
  ]) {
    if (!existsSync(required)) fail('Sandbox structure is incomplete.', { reason: 'sandbox_structure_incomplete' });
  }
  let binding;
  try { binding = strictJsonParse(readFileSync(validated.paths.canonicalBindingFile, 'utf8')); } catch {
    fail('Sandbox Binding is invalid.', { reason: 'sandbox_binding_invalid' });
  }
  const hash = calculateBindingFixtureHash(binding);
  validateFixedSubjectBindingFixture(binding, hash);
  if (hash !== EXPECTED_BINDING_FIXTURE_HASH) {
    fail('Sandbox Binding hash does not match.', { reason: 'sandbox_binding_hash_mismatch' });
  }
  return Object.freeze({ ...validated, binding: structuredClone(binding) });
}

export function createLiveChatSandbox({ root, clock = () => new Date(), uuid = randomUUID } = {}) {
  if (typeof root !== 'string' || root.trim() === '') {
    fail('Sandbox root is required.', { status: 'missing', reason: 'sandbox_root_missing' });
  }
  const requestedRoot = resolve(root.trim());
  assertNoReparseAncestors(requestedRoot);
  let canonicalRoot;
  try { canonicalRoot = canonicalizeProspectivePath(requestedRoot); } catch (error) {
    if (error instanceof LiveChatSandboxError) throw error;
    fail('Sandbox root cannot be canonicalized safely.', {
      status: 'unsafe',
      reason: 'sandbox_root_unavailable',
    });
  }
  assertNoReparseAncestors(canonicalRoot);
  const protectedValues = protectedPaths();
  assertSafeSandboxRoot(canonicalRoot, protectedValues);
  if (existsSync(canonicalRoot)) {
    fail('Sandbox root must not already exist.', { reason: 'sandbox_root_exists' });
  }
  const paths = expectedPaths(canonicalRoot);
  assertEnginePersistencePathBudget(paths.canonicalEngineDataDir);
  const binding = fixedSubjectBindingFixture();
  const hash = calculateBindingFixtureHash(binding);
  validateFixedSubjectBindingFixture(binding, hash);
  const createdAt = clock().toISOString();
  const manifest = Object.freeze({
    schemaVersion: LIVE_CHAT_SANDBOX.schemaVersion,
    sandboxId: uuid(),
    purpose: LIVE_CHAT_SANDBOX.purpose,
    identityClass: LIVE_CHAT_SANDBOX.identityClass,
    promotionAllowed: LIVE_CHAT_SANDBOX.promotionAllowed,
    createdAt,
    canonicalSandboxRoot: paths.canonicalSandboxRoot,
    canonicalBindingFile: paths.canonicalBindingFile,
    canonicalVioDatabasePath: paths.canonicalVioDatabasePath,
    canonicalEngineDataDir: paths.canonicalEngineDataDir,
    userId: binding.userId,
    assistantId: binding.assistantId,
    subjectId: binding.subjectId,
    conversationId: LIVE_CHAT_SANDBOX.conversationId,
    bindingId: binding.bindingId,
    bindingVersion: binding.bindingVersion,
    bindingFixtureHash: hash,
    cycleId: LIVE_CHAT_SANDBOX.cycleId,
    vioCommitSha: currentVioCommitSha(),
    engineCommitSha: LIVE_CHAT_SANDBOX.engineCommitSha,
    protectedPaths: protectedValues,
    cleanupPolicy: LIVE_CHAT_SANDBOX.cleanupPolicy,
  });
  validateManifestValues(manifest, paths.manifestPath);
  let created = false;
  try {
    mkdirSync(canonicalRoot);
    created = true;
    mkdirSync(dirname(paths.canonicalVioDatabasePath));
    mkdirSync(paths.canonicalEngineDataDir);
    writeFileSync(paths.canonicalBindingFile, `${JSON.stringify(binding, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    readAndValidateLiveChatSandboxManifest(paths.manifestPath);
  } catch (error) {
    if (created) rmSync(canonicalRoot, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({
    status: 'created',
    sandboxId: manifest.sandboxId,
    purpose: manifest.purpose,
    identityClass: manifest.identityClass,
    promotionAllowed: manifest.promotionAllowed,
    manifestPath: paths.manifestPath,
    sandboxRoot: paths.canonicalSandboxRoot,
    bindingFile: paths.canonicalBindingFile,
    vioDatabasePath: paths.canonicalVioDatabasePath,
    engineDataDir: paths.canonicalEngineDataDir,
    userId: manifest.userId,
    assistantId: manifest.assistantId,
    subjectId: manifest.subjectId,
    conversationId: manifest.conversationId,
    bindingId: manifest.bindingId,
    bindingVersion: manifest.bindingVersion,
    bindingFixtureHash: manifest.bindingFixtureHash,
    cycleId: manifest.cycleId,
    externalCall: 'not_performed',
    providerCharge: 'not_incurred',
  });
}

function environmentPath(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!isAbsolute(value.trim())) return 'unsafe';
  return canonicalizeProspectivePath(value.trim());
}

export function inspectLiveChatSandbox(environment = process.env, pathBudgetOptions) {
  const manifestPath = environment.VIO_LIVE_SANDBOX_MANIFEST?.trim() ?? '';
  if (!manifestPath) return Object.freeze({ status: 'missing', reason: 'sandbox_manifest_missing' });
  let validated;
  try {
    validated = readAndValidateLiveChatSandboxManifest(manifestPath, pathBudgetOptions);
  } catch (error) {
    return Object.freeze({
      status: error instanceof LiveChatSandboxError ? error.status : 'conflict',
      reason: error instanceof LiveChatSandboxError ? error.reason : 'sandbox_manifest_invalid',
    });
  }
  const checks = [
    ['VIO_LIVE_BINDING_FILE', validated.paths.canonicalBindingFile],
    ['VIO_BACKEND_DB_PATH', validated.paths.canonicalVioDatabasePath],
    ['VIO_LIVE_ENGINE_DATA_DIR', validated.paths.canonicalEngineDataDir],
  ];
  for (const [name, expected] of checks) {
    let actual;
    try { actual = environmentPath(environment, name); } catch {
      return Object.freeze({ status: 'unsafe', reason: `${name.toLowerCase()}_unsafe` });
    }
    if (actual === null) return Object.freeze({ status: 'missing', reason: `${name.toLowerCase()}_missing` });
    if (actual === 'unsafe' || !isInside(actual, validated.paths.canonicalSandboxRoot)) {
      return Object.freeze({ status: 'unsafe', reason: `${name.toLowerCase()}_outside_sandbox` });
    }
    if (!samePath(actual, expected)) {
      return Object.freeze({ status: 'conflict', reason: `${name.toLowerCase()}_mismatch` });
    }
  }
  const cycleId = environment.VIO_LIVE_ENGINE_CYCLE_ID?.trim() ?? '';
  if (!cycleId) return Object.freeze({ status: 'missing', reason: 'engine_cycle_id_missing' });
  if (cycleId !== validated.manifest.cycleId) {
    return Object.freeze({ status: 'conflict', reason: 'engine_cycle_id_mismatch' });
  }
  return Object.freeze({ status: 'ready', reason: null, sandboxId: validated.manifest.sandboxId });
}

export function planLiveChatSandboxCleanup({ manifestPath } = {}) {
  const validated = readAndValidateLiveChatSandboxManifest(manifestPath);
  return Object.freeze({
    status: 'ready',
    mode: 'plan',
    sandboxId: validated.manifest.sandboxId,
    deleteTargets: Object.freeze([validated.paths.canonicalSandboxRoot]),
    protectedPaths: validated.protectedPaths,
    validation: 'passed',
    externalCall: 'not_performed',
    providerCharge: 'not_incurred',
  });
}

function assertDeletionPreflight(root, databasePath) {
  const rootProbe = `${root}.vio-cleanup-probe-${randomUUID()}`;
  try {
    renameSync(root, rootProbe);
    renameSync(rootProbe, root);
  } catch (error) {
    if (existsSync(rootProbe) && !existsSync(root)) {
      try { renameSync(rootProbe, root); } catch {}
    }
    fail('Sandbox appears to be in use; stop all services before cleanup.', {
      status: 'conflict',
      reason: 'sandbox_in_use',
    });
  }
  if (existsSync(databasePath)) {
    let descriptor;
    try {
      descriptor = openSync(databasePath, 'r+');
    } catch {
      fail('Vio database appears to be in use; stop all services before cleanup.', {
        status: 'conflict',
        reason: 'sandbox_in_use',
      });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

export function cleanupLiveChatSandbox({
  manifestPath,
  acknowledgeServicesStopped = false,
  acknowledgeDestroyEntireSandbox = false,
} = {}) {
  if (!acknowledgeServicesStopped || !acknowledgeDestroyEntireSandbox) {
    fail('Both cleanup acknowledgements are required.', {
      reason: 'cleanup_acknowledgements_required',
    });
  }
  const validated = readAndValidateLiveChatSandboxManifest(manifestPath);
  const root = validated.paths.canonicalSandboxRoot;
  assertSafeSandboxRoot(root, validated.protectedPaths);
  assertDeletionPreflight(root, validated.paths.canonicalVioDatabasePath);
  rmSync(root, { recursive: true, force: false });
  if (existsSync(root)) fail('Sandbox cleanup did not remove the root.', { reason: 'sandbox_cleanup_incomplete' });
  return Object.freeze({
    status: 'completed',
    sandboxRemoved: true,
    deletedRoot: root,
    protectedPathsTargeted: Object.freeze([]),
    repositoryFilesTargeted: Object.freeze([]),
    externalCall: 'not_performed',
    providerCharge: 'not_incurred',
  });
}
