import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { createApplication } from '../../backend/src/app.js';
import { loadConfig } from '../../backend/src/config.js';
import {
  acquireOperationLock,
  canListen,
  defaultRuntimePaths,
  isolatedTestRuntimePaths,
  readRuntimeConfig,
  readRuntimeState,
  repositoryRootFromModule,
} from './local-runtime.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const INVITATION_FILE = /^personal-initialization-invitation-[0-9TZ-]+-[0-9a-f-]{36}\.txt$/u;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function samePath(left, right) {
  const normalize = (value) => resolve(value).replace(/^\\\\\?\\/u, '').toLowerCase();
  return normalize(left) === normalize(right);
}

function validateExistingDatabase(paths, config) {
  if (!samePath(config.repositoryRoot, paths.repositoryRoot)
      || !samePath(config.databasePath, paths.databasePath)) {
    fail('RUNTIME_BINDING_CONFLICT', 'The local runtime is not bound to this Vio checkout and personal database.');
  }
  if (!existsSync(paths.databasePath)) {
    fail('PERSONAL_DATABASE_MISSING', 'The bound personal database is missing. First-time initialization will not create an empty replacement.');
  }
  const stats = lstatSync(paths.databasePath);
  if (!stats.isFile() || stats.isSymbolicLink() || !samePath(realpathSync(paths.databasePath), paths.databasePath)) {
    fail('PERSONAL_DATABASE_UNSAFE', 'The bound personal database must be one real file, not a link or redirected path.');
  }
  let database;
  try {
    database = new DatabaseSync(paths.databasePath, { readOnly: true });
    for (const table of ['schema_migrations', 'personal_installation', 'personal_initialization_invitations']) {
      const row = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (row?.name !== table) fail('PERSONAL_DATABASE_INVALID', 'The bound file is not a prepared Vio personal database.');
    }
  } catch (error) {
    if (error?.code === 'PERSONAL_DATABASE_INVALID') throw error;
    fail('PERSONAL_DATABASE_INVALID', 'The bound Vio personal database could not be validated.');
  } finally {
    database?.close();
  }
}

function ensurePrivateRoot(paths) {
  mkdirSync(paths.privateRoot, { recursive: true, mode: 0o700 });
  const stats = lstatSync(paths.privateRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink() || !samePath(realpathSync(paths.privateRoot), paths.privateRoot)) {
    fail('PERSONAL_PRIVATE_DIRECTORY_UNSAFE', 'The Vio private invitation directory is linked or redirected.');
  }
}

function invitationFiles(paths) {
  if (!existsSync(paths.privateRoot)) return [];
  const result = [];
  for (const name of readdirSync(paths.privateRoot)) {
    if (!INVITATION_FILE.test(name)) continue;
    const path = join(paths.privateRoot, name);
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink() || !samePath(realpathSync(path), path)) {
      fail('INVITATION_FILE_CONFLICT', 'A Vio invitation filename is occupied by an unsafe file or link.');
    }
    const source = readFileSync(path, 'utf8');
    if (!/^[A-Za-z0-9_-]{43}(?:\r?\n)?$/u.test(source)) {
      fail('INVITATION_FILE_CONFLICT', 'An existing Vio invitation file has unexpected content and was not changed.');
    }
    result.push({ path, invitation: source.trim() });
  }
  return result;
}

function newInvitationPath(paths, now = () => new Date(), uuid = randomUUID) {
  const timestamp = now().toISOString().replaceAll(':', '').replaceAll('.', '-');
  return join(paths.privateRoot, `personal-initialization-invitation-${timestamp}-${uuid()}.txt`);
}

async function openInvitationLocally(path, environment = process.env) {
  if (environment.VIO_LOCAL_RUNTIME_TEST_MODE === 'true') return 'not_opened_in_test';
  return new Promise((resolvePromise) => {
    const child = spawn('notepad.exe', [path], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', () => resolvePromise('open_the_local_file_manually'));
    child.once('spawn', () => {
      child.unref();
      resolvePromise('opened_locally');
    });
  });
}

function safeError(error) {
  const allowed = new Set([
    'LOCAL_OPERATION_IN_PROGRESS',
    'LOCALAPPDATA_MISSING',
    'RUNTIME_CONFIG_MISSING',
    'RUNTIME_CONFIG_UNREADABLE',
    'RUNTIME_CONFIG_INVALID_JSON',
    'RUNTIME_BINDING_CONFLICT',
    'LOCAL_RUNTIME_INVALID',
    'PERSONAL_RUNTIME_ACTIVE',
    'PERSONAL_DATABASE_MISSING',
    'PERSONAL_DATABASE_UNSAFE',
    'PERSONAL_DATABASE_INVALID',
    'PERSONAL_PRIVATE_DIRECTORY_UNSAFE',
    'INVITATION_FILE_CONFLICT',
    'PERSONAL_OWNER_EXISTS',
    'PERSONAL_INITIALIZATION_ARGUMENT_INVALID',
  ]);
  const code = allowed.has(error?.code) ? error.code : 'PERSONAL_INITIALIZATION_FAILED';
  const message = allowed.has(error?.code)
    ? error.message
    : 'Personal initialization could not be completed safely; no invitation value was printed.';
  return { status: 'error', code, message, externalCall: 'not_performed', providerCharge: 'not_incurred' };
}

let application;
let release;
let createdInvitationPath = null;
let createdInvitationOwned = false;
let invitationDeliveryCommitted = false;
try {
  if (process.argv.length !== 2) fail('PERSONAL_INITIALIZATION_ARGUMENT_INVALID', 'This entry does not accept command-line values.');
  const repositoryRoot = repositoryRootFromModule();
  const paths = process.env.VIO_LOCAL_RUNTIME_TEST_MODE === 'true'
    ? isolatedTestRuntimePaths(repositoryRoot)
    : defaultRuntimePaths(repositoryRoot);
  // Missing/invalid configuration must remain a read-only failure. Once the
  // path is known to exist, take the shared launcher lock and validate it again
  // so start/stop/preparation cannot race initialization.
  readRuntimeConfig(paths);
  release = acquireOperationLock(paths.operationLockPath);
  const config = readRuntimeConfig(paths);
  validateExistingDatabase(paths, config);
  if (readRuntimeState(paths)
      || !await canListen('127.0.0.1', paths.backendPort)
      || !await canListen('127.0.0.1', paths.frontendPort)) {
    fail('PERSONAL_RUNTIME_ACTIVE', 'Vio is running or its stopped state cannot be proven. Double-click "停止 Vio.cmd" first, then initialize again.');
  }

  application = createApplication({
    config: loadConfig({ VIO_BACKEND_DB_PATH: paths.databasePath, VIO_BACKEND_PORT: '0' }),
    environment: {},
    logger: { error() {} },
  });
  if (application.personalIdentityService.access().status !== 'initialization_required') {
    fail('PERSONAL_OWNER_EXISTS', 'The personal space is already initialized. Use the access passphrase on the Vio page; no new invitation was generated.');
  }

  ensurePrivateRoot(paths);
  const candidates = invitationFiles(paths)
    .map((file) => ({ ...file, state: application.personalIdentityService.describeInitializationInvitation(file.invitation) }))
    .filter((file) => file.state.status === 'active');
  if (candidates.length > 1) {
    fail('INVITATION_FILE_CONFLICT', 'More than one active invitation file was found. No file or database fact was changed.');
  }

  let selectedPath = candidates[0]?.path ?? null;
  const result = application.personalIdentityService.deliverInitializationInvitation({
    existingInvitation: candidates[0]?.invitation ?? null,
    deliver(invitation) {
      createdInvitationPath = newInvitationPath(paths);
      let descriptor;
      try {
        descriptor = openSync(createdInvitationPath, 'wx', 0o600);
        createdInvitationOwned = true;
        writeFileSync(descriptor, `${invitation}\n`, 'utf8');
      } catch (error) {
        if (error?.code === 'EEXIST') fail('INVITATION_FILE_CONFLICT', 'The new private invitation filename already exists and was not overwritten.');
        throw error;
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
      selectedPath = createdInvitationPath;
    },
  });
  invitationDeliveryCommitted = true;
  const invitationView = await openInvitationLocally(selectedPath);
  process.stdout.write(`${JSON.stringify({
    status: 'invitation_ready',
    action: result.action,
    invitationFile: selectedPath,
    expiresAt: result.expiresAt,
    invitationView,
    passphrase: 'set_in_browser_only',
    passphraseLength: '12_to_256_characters',
    externalCall: 'not_performed',
    providerCharge: 'not_incurred',
  })}\n`);
} catch (error) {
  if (createdInvitationOwned && !invitationDeliveryCommitted && createdInvitationPath && existsSync(createdInvitationPath)) {
    try { unlinkSync(createdInvitationPath); } catch { /* Keep the private file if ownership cannot be proved by this process. */ }
  }
  process.stderr.write(`${JSON.stringify(safeError(error))}\n`);
  process.exitCode = 1;
} finally {
  await application?.stop();
  release?.();
}
