import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication as createLegacyTestApplication } from '../test-support/legacy-test-application.js';
import { startPersonalTestApplication, sealTestCredential } from '../test-support/personal-test-application.js';

const DAY = 86400000;
const PASSPHRASE = 'controlled-personal-test-passphrase';
const START = Date.parse('2026-09-05T00:00:00.000Z');

async function fixture(t, options = {}, supportOptions = {}) {
  let now = START;
  const f = await startPersonalTestApplication(
    t,
    { ...options, personalClock: () => new Date(now) },
    supportOptions,
  );
  return { f, advance: amount => { now += amount; }, set: value => { now = value; } };
}

function count(f, table) {
  assert.match(table, /^[a-z_]+$/);
  return f.app.database.connection.prepare(`SELECT count(*) n FROM ${table}`).get().n;
}

async function requestDeletion(f, key = 'delete-personal-space-once') {
  const response = await f.secured('/deletions', 'POST', {}, key);
  assert.equal(response.deletion.status, 'waiting');
  assert.equal(response.deletion.externalCall, 'not_performed');
  assert.equal(response.deletion.providerCharge, 'not_incurred');
  return response.deletion;
}

async function cancel(f, passphrase = PASSPHRASE) {
  return f.call('/deletions/current/cancellation', 'POST', { passphrase, deviceName: 'Controlled restored browser' });
}

test('R2 deletion confirmation rejects and explicit cancellation leave the owner and histories untouched', async t => {
  const { f } = await fixture(t);
  await f.initialize();
  const key = 'rejected-deletion';
  const waiting = await f.call('/deletions', 'POST', {}, { 'idempotency-key': key });
  assert.equal(waiting.status, 200);
  assert.equal(waiting.data.operationStatus, 'confirmation_required');
  const confirmation = waiting.data.security.confirmation;
  const storedConfirmation = f.app.database.connection.prepare('SELECT subject_id,resource_type,operation_type FROM security_confirmations WHERE confirmation_id=?').get(confirmation.confirmationId);
  assert.equal(storedConfirmation.subject_id, null, 'account deletion must not invent an assistant');
  assert.equal(storedConfirmation.resource_type, 'identity');
  assert.equal(storedConfirmation.operation_type, 'data_deletion');
  assert.equal(count(f, 'subjects'), 0);
  const repeated = await f.call('/deletions', 'POST', {}, { 'idempotency-key': key });
  assert.equal(repeated.data.security.confirmation.confirmationId, confirmation.confirmationId);
  assert.equal(count(f, 'personal_deletion_tasks'), 0);
  const rejected = await f.call(`/confirmations/${confirmation.confirmationId}/decision`, 'POST', { decision: 'reject' });
  assert.equal(rejected.status, 200);
  const attempt = await f.call('/deletions', 'POST', { confirmationId: confirmation.confirmationId }, { 'idempotency-key': key });
  assert.equal(attempt.status, 200);
  assert.equal(attempt.data.operationStatus, 'denied');
  const cancelled = await f.call('/operation-cancellations', 'POST', { operation: 'delete-personal-space', key });
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal((await f.call('/deletions', 'POST', {}, { 'idempotency-key': key })).data.operationStatus, 'cancelled');
  assert.equal((await f.call('/session')).status, 200);
  assert.equal(count(f, 'users'), 1);
  assert.equal(count(f, 'subjects'), 0);
  assert.equal(count(f, 'personal_deletion_tasks'), 0);
});

test('R2 accepted deletion immediately revokes business access and lost response is recoverable only as limited access', async t => {
  const { f } = await fixture(t);
  const initial = await f.initialize();
  const oldCookie = f.state.cookie;
  const oldCsrf = f.state.csrf;
  const waiting = await requestDeletion(f);
  assert.equal(waiting.cancellableUntil, new Date(START + 7 * DAY).toISOString());
  assert.equal(waiting.onlineData, 'pending');
  assert.ok(waiting.scope.rowCount > 0);
  assert.ok(waiting.scope.tableCount > 0);
  assert.equal(count(f, 'personal_deletion_tasks'), 1);
  assert.equal((await f.call('/session', 'GET', undefined, { cookie: oldCookie })).status, 401);
  assert.equal((await f.call('/deletions', 'POST', {}, { cookie: oldCookie, 'x-vio-csrf': oldCsrf, 'idempotency-key': 'delete-personal-space-once' })).status, 401);
  assert.equal((await f.call('/profile')).status, 401);
  assert.equal((await f.call('/providers')).status, 401);
  assert.equal((await f.call('/assistants', 'POST', { name: 'Forbidden', avatar: null, settings: {} }, { 'idempotency-key': 'forbidden' })).status, 401);
  assert.equal((await f.call('/vault')).status, 401);
  assert.equal((await f.call('/sessions', 'POST', { passphrase: PASSPHRASE, deviceName: 'Business login while deleting' })).status, 401);
  const limited = await f.call('/deletions/current');
  assert.equal(limited.status, 200);
  assert.equal(limited.data.deletion.deletionId, waiting.deletionId);
  assert.equal((await f.call('/deletions/not-the-authorized-task')).status, 404);
  assert.equal((await f.call('/deletions/current/retry', 'POST', {}, { 'x-vio-csrf': 'forged' })).status, 403);
  assert.equal((await f.call('/deletions/current/retry', 'POST', {})).error.code, 'DELETION_NOT_DUE');
  assert.equal(count(f, 'personal_deletion_attempts'), 0);
  assert.equal(f.app.personalVault.status(initial.data.user.userId), 'locked');
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_sessions WHERE revoked_at IS NULL').get().n, 0);

  // Losing the accepted HTTP response loses its cookie, not the persisted task.
  f.state.cookie = ''; f.state.csrf = '';
  assert.equal((await f.call('/deletions/current')).status, 401);
  assert.equal((await f.call('/deletion-access', 'POST', { passphrase: 'wrong-controlled-deletion-passphrase' })).status, 401);
  const recovered = await f.call('/deletion-access', 'POST', { passphrase: PASSPHRASE });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.deletion.deletionId, waiting.deletionId);
  assert.equal((await f.call('/profile')).status, 401);
  assert.equal(count(f, 'personal_deletion_tasks'), 1);
  const serialized = JSON.stringify(recovered);
  for (const forbidden of [PASSPHRASE, 'wrong-controlled-deletion-passphrase', oldCookie, initial.data.user.userId, f.temp.databasePath]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  await f.restart();
  assert.equal((await f.call('/deletions/current')).data.deletion.deletionId, waiting.deletionId);
  assert.equal((await f.call('/access')).data.status, 'deletion_authentication_required');
});

test('R2 cancellation just before seven days requires owner proof and a fresh login without reviving revoked facts', async t => {
  const { f, advance } = await fixture(t);
  const initial = await f.initialize();
  const oldCookie = f.state.cookie;
  const oldSessionId = initial.data.session.sessionId;
  const owner = initial.data.user.userId;
  const provider = await f.secured('/providers', 'POST', {
    displayName: 'Isolated revoked provider', providerType: 'custom', baseUrl: 'https://controlled-provider.example',
    interfaceFormat: 'openai_compatible', status: 'enabled',
  }, 'deletion-provider');
  const providerId = provider.provider.providerId;
  const transport = (await f.call('/vault')).data.transport;
  await f.secured(`/providers/${providerId}/credential`, 'PUT', sealTestCredential(transport, 'isolated-revoked-fixture'), 'deletion-credential');
  await f.secured(`/providers/${providerId}/credential`, 'DELETE', {}, 'deletion-revocation');
  const permission = f.app.permissionService.createPermission(owner, {
    subjectId: null, resourceType: 'api', resourceId: providerId, action: 'read', permissionLevel: 'always_allow',
  });
  f.app.permissionService.deletePermission(owner, permission.permissionId);
  await requestDeletion(f);
  advance(7 * DAY - 1);
  const wrong = await cancel(f, 'incorrect-cancellation-test-phrase');
  assert.equal(wrong.status, 403);
  assert.equal(wrong.error.code, 'DELETION_VERIFICATION_FAILED');
  assert.equal((await f.call('/deletions/current')).data.deletion.status, 'waiting');
  const result = await cancel(f);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { status: 'cancelled', reauthenticationRequired: true });
  assert.equal((await f.call('/session')).status, 401);
  assert.equal((await f.call('/session', 'GET', undefined, { cookie: oldCookie })).status, 401);
  const login = await f.call('/sessions', 'POST', { passphrase: PASSPHRASE, deviceName: 'New legitimate session' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.userId, owner);
  assert.notEqual(login.data.session.sessionId, oldSessionId);
  assert.equal((await f.call('/session', 'GET', undefined, { cookie: oldCookie })).status, 401);
  assert.equal(f.app.database.connection.prepare('SELECT status FROM permissions WHERE permission_id=?').get(permission.permissionId).status, 'deleted');
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_credential_secrets WHERE status=\'active\'').get().n, 0);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_credential_secrets WHERE status=\'revoked\'').get().n, 1);
  assert.deepEqual(f.app.personalDeletionService.sweep(), []);
});

test('R2 exact seven-day boundary rejects cancellation and execution produces an honest limited deletion receipt', async t => {
  const { f, advance } = await fixture(t);
  const initial = await f.initialize();
  const oldCookie = f.state.cookie;
  const waiting = await requestDeletion(f);
  advance(7 * DAY);
  const denied = await cancel(f);
  assert.equal(denied.status, 409);
  assert.equal(denied.error.code, 'DELETION_NOT_CANCELLABLE');
  assert.equal((await f.call('/deletions/current')).data.deletion.status, 'waiting', 'time alone must not claim deletion');
  const results = f.app.personalDeletionService.sweep();
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'completed');
  const after = await f.call(`/deletions/${waiting.deletionId}`);
  assert.equal(after.status, 200);
  assert.equal(after.data.deletion.onlineData, 'deleted');
  assert.equal(after.data.deletion.onlineDeletedAt, new Date(START + 7 * DAY).toISOString());
  assert.equal(after.data.deletion.backupDeadlineAt, new Date(START + 21 * DAY).toISOString());
  assert.equal(after.data.deletion.receiptExpiresAt, new Date(START + 37 * DAY).toISOString());
  assert.deepEqual(after.data.deletion.managedFiles, { status: 'completed', remaining: 0 });
  assert.deepEqual(after.data.deletion.managedBackups, { status: 'completed', remaining: 0 });
  assert.equal(after.data.deletion.storage.sqlite, 'logical_rows_deleted');
  assert.equal(after.data.deletion.storage.wal, 'checkpoint_completed');
  assert.equal(after.data.deletion.storage.physicalErasure, 'not_claimed');
  assert.equal(after.data.deletion.storage.userCopies, 'not_managed');
  assert.equal(count(f, 'users'), 0);
  assert.equal(count(f, 'personal_identities'), 0);
  assert.equal(count(f, 'personal_sessions'), 0);
  assert.equal((await f.call('/session', 'GET', undefined, { cookie: oldCookie })).status, 401);
  assert.equal((await f.call('/profile')).status, 401);
  assert.equal((await cancel(f)).error.code, 'DELETION_NOT_CANCELLABLE');
  assert.equal(JSON.stringify(after).includes(initial.data.user.userId), false);
  assert.deepEqual(f.app.database.connection.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(f.app.personalDeletionService.process(waiting.deletionId).status, 'completed');
  assert.equal(count(f, 'personal_deletion_attempts'), 1);
});

test('R2 failed online deletion is atomic and resumes the same task after database restart', async t => {
  let injected = true;
  const { f, advance } = await fixture(t, {
    personalDeletionBeforeOnlineDelete: () => { if (injected) { injected = false; throw new Error('isolated failure detail must not be public'); } },
  });
  const initial = await f.initialize();
  const waiting = await requestDeletion(f);
  advance(7 * DAY);
  const failed = f.app.personalDeletionService.sweep()[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.onlineData, 'pending');
  assert.equal(failed.onlineDeletedAt, null);
  assert.equal(failed.reason, 'online_deletion_failed');
  assert.equal(f.app.database.connection.prepare('SELECT status FROM users WHERE user_id=?').get(initial.data.user.userId).status, 'deletion_pending');
  assert.equal(count(f, 'personal_deletion_tombstones'), 0);
  const visible = await f.call('/deletions/current');
  assert.equal(visible.data.deletion.status, 'failed');
  assert.equal(JSON.stringify(visible).includes('isolated failure detail must not be public'), false);
  assert.equal((await cancel(f)).error.code, 'DELETION_NOT_CANCELLABLE');
  await f.restart();
  const recovered = await f.call('/deletions/current');
  assert.equal(recovered.data.deletion.deletionId, waiting.deletionId);
  assert.equal(recovered.data.deletion.status, 'completed');
  assert.equal(count(f, 'users'), 0);
  assert.equal(count(f, 'personal_deletion_tasks'), 1);
  assert.equal(count(f, 'personal_deletion_tombstones'), 1);
  assert.equal(count(f, 'personal_deletion_attempts'), 2);
  const attempts = f.app.database.connection.prepare('SELECT result FROM personal_deletion_attempts ORDER BY rowid').all().map(r => r.result);
  assert.deepEqual(attempts, ['failed', 'completed']);
  const retried = await f.call('/deletions/current/retry', 'POST', {});
  assert.equal(retried.data.deletion.status, 'completed');
  assert.equal(count(f, 'personal_deletion_attempts'), 2);
  assert.deepEqual(f.app.personalDeletionService.sweep(), []);
});

test('R2 scoped deletion removes cyclic immutable message history while preserving a different owner and normal protection', async t => {
  const { f, advance } = await fixture(t, {}, { applicationFactory: createLegacyTestApplication });
  const initial = await f.initialize();
  const owner = initial.data.user.userId;
  const onboarding = await f.call('/onboarding', 'POST', {
    displayName: 'Disposable deletion owner', avatar: null, assistant: { name: 'Disposable assistant', avatar: null, settings: {} },
    preferences: { storagePreference: 'local', contextMode: 'balanced' },
  }, { 'idempotency-key': 'deletion-onboarding' });
  assert.equal(onboarding.status, 200);
  const assistantId = onboarding.data.currentAssistantId;
  const conversationPath = `/api/v1/users/${owner}/subjects/${assistantId}/conversations`;
  const conversation = await f.call(conversationPath, 'POST', { title: 'Isolated deletion history' });
  assert.equal(conversation.status, 201);
  const message = await f.call(`${conversationPath}/${conversation.data.conversationId}/messages`, 'POST', { senderType: 'user', content: 'Isolated body must not enter the deletion receipt.' });
  assert.equal(message.status, 201);
  const versionId = message.data.currentVersionId;
  const db = f.app.database.connection;
  assert.throws(() => db.prepare('DELETE FROM message_versions WHERE message_version_id=?').run(versionId), /governed retention/);
  assert.throws(() => db.prepare('UPDATE message_versions SET content=? WHERE message_version_id=?').run('Forbidden mutation', versionId), /immutable/);
  const otherOwner = randomUUID();
  db.prepare('INSERT INTO users VALUES(?,NULL,?,?,?,?)').run(otherOwner, 'Other owner remains', 'active', new Date(START).toISOString(), new Date(START).toISOString());
  const otherProvider = f.app.apiProviderService.createProvider(otherOwner, {
    displayName: 'Other owner configuration', providerType: 'custom', baseUrl: 'https://other-controlled.example',
    interfaceFormat: 'openai_compatible', status: 'enabled',
  });
  const beforeOther = { user: db.prepare('SELECT * FROM users WHERE user_id=?').get(otherOwner), provider: db.prepare('SELECT * FROM api_providers WHERE api_provider_id=?').get(otherProvider.providerId) };
  const waiting = await requestDeletion(f);
  const inventory = JSON.parse(db.prepare('SELECT inventory_json FROM personal_deletion_tasks WHERE deletion_id=?').get(waiting.deletionId).inventory_json);
  assert.ok(inventory.rows.some(row => row.table === 'message_versions'));
  assert.ok(inventory.rows.some(row => row.table === 'messages'));
  assert.ok(inventory.dependencies.some(row => row.table === 'message_versions'));
  assert.equal(JSON.stringify(inventory).includes('Isolated body must not enter the deletion receipt.'), false);
  advance(7 * DAY);
  assert.equal(f.app.personalDeletionService.sweep()[0].status, 'completed');
  assert.equal(count(f, 'messages'), 0);
  assert.equal(count(f, 'message_versions'), 0);
  assert.equal(count(f, 'conversations'), 0);
  assert.equal(count(f, 'subjects'), 0);
  assert.deepEqual(db.prepare('SELECT * FROM users WHERE user_id=?').get(otherOwner), beforeOther.user);
  assert.deepEqual(db.prepare('SELECT * FROM api_providers WHERE api_provider_id=?').get(otherProvider.providerId), beforeOther.provider);
  assert.equal(count(f, 'users'), 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare("SELECT vio_owner_deletion_authorized('message_versions',1) allowed").get().allowed, 0);
  const receipt = db.prepare('SELECT owner_user_id,inventory_json FROM personal_deletion_tasks WHERE deletion_id=?').get(waiting.deletionId);
  assert.equal(receipt.owner_user_id, null);
  assert.equal(receipt.inventory_json, null);
});

test('R2 cancellation wins before the deadline and cannot be followed by a delayed delete', async t => {
  let executions = 0;
  const { f, advance } = await fixture(t, { personalDeletionBeforeOnlineDelete: () => { executions += 1; } });
  const initial = await f.initialize();
  const waiting = await requestDeletion(f);
  advance(7 * DAY - 1);
  assert.equal((await cancel(f)).data.status, 'cancelled');
  advance(2);
  assert.deepEqual(f.app.personalDeletionService.sweep(), []);
  assert.equal(f.app.personalDeletionService.process(waiting.deletionId).status, 'cancelled');
  assert.equal(executions, 0);
  assert.equal(f.app.database.connection.prepare('SELECT status FROM users WHERE user_id=?').get(initial.data.user.userId).status, 'active');
  assert.equal(count(f, 'personal_deletion_attempts'), 0);
  assert.equal(count(f, 'personal_deletion_tombstones'), 0);
});

test('R2 deletion receipt lasts thirty days after actual deletion and is then unavailable and purged', async t => {
  const { f, advance } = await fixture(t);
  await f.initialize();
  const waiting = await requestDeletion(f);
  advance(7 * DAY);
  assert.equal(f.app.personalDeletionService.sweep()[0].status, 'completed');
  advance(30 * DAY - 1);
  assert.equal((await f.call(`/deletions/${waiting.deletionId}`)).status, 200);
  assert.equal(count(f, 'personal_deletion_tasks'), 1);
  advance(1);
  const expired = await f.call('/deletions/current');
  assert.equal(expired.status, 410);
  assert.equal(expired.error.code, 'DELETION_RECEIPT_EXPIRED');
  assert.deepEqual(f.app.personalDeletionService.sweep(), []);
  for (const table of ['personal_deletion_tasks', 'personal_deletion_access', 'personal_deletion_tombstones', 'personal_deletion_attempts']) assert.equal(count(f, table), 0, table);
  assert.equal((await f.call('/deletions/current')).status, 401);
  assert.equal((await f.call('/deletion-access', 'POST', { passphrase: PASSPHRASE })).status, 401);
  assert.deepEqual(f.app.database.connection.prepare('PRAGMA foreign_key_check').all(), []);
});

test('R2 wrong cancellation proofs persist audit failures and are rate limited without restoring business access',async t=>{
  const {f}=await fixture(t);await f.initialize();await requestDeletion(f);
  for(let i=0;i<10;i++) {
    const result=await cancel(f,'controlled-but-wrong-passphrase');
    assert.equal(result.status,403);assert.equal(result.error.code,'DELETION_VERIFICATION_FAILED');
  }
  assert.equal(f.app.database.connection.prepare("SELECT count(*) n FROM personal_access_events WHERE event_type='login_failed'").get().n,10);
  assert.equal((await cancel(f)).status,429);
  assert.equal((await f.call('/deletions/current')).data.deletion.status,'waiting');
  assert.equal((await f.call('/session')).status,401);
});

test('R2 cancelled deletion key stays cancelled after login and receipt purge without revoking the new session',async t=>{
  const {f,advance}=await fixture(t);await f.initialize();await requestDeletion(f,'old-delete-key');
  assert.equal((await cancel(f)).status,200);
  assert.equal((await f.call('/sessions','POST',{passphrase:PASSPHRASE,deviceName:'New session'})).status,200);
  const current=f.state.cookie;
  const replay=()=>f.call('/deletions','POST',{}, {'idempotency-key':'old-delete-key'});
  assert.equal((await replay()).data.operationStatus,'cancelled');assert.equal(f.state.cookie,current);
  assert.equal((await f.call('/session')).status,200);
  advance(30*DAY);f.app.personalDeletionService.sweep();
  assert.equal((await f.call('/sessions','POST',{passphrase:PASSPHRASE,deviceName:'After receipt retention'})).status,200);
  const fresh=f.state.cookie;
  assert.equal((await replay()).data.operationStatus,'cancelled');assert.equal(f.state.cookie,fresh);
  assert.equal((await f.call('/session')).status,200);assert.equal(count(f,'personal_deletion_tasks'),0);
});

for (const [boundary, trigger] of [
  ['removed copy registry deletion', `CREATE TEMP TRIGGER interrupt_deletion_finalization
    BEFORE DELETE ON main.personal_managed_copies
    BEGIN SELECT RAISE(ABORT,'controlled finalization interruption'); END`],
  ['attempt completion after registry deletion', `CREATE TEMP TRIGGER interrupt_deletion_finalization
    BEFORE UPDATE OF result ON main.personal_deletion_attempts WHEN NEW.result='completed'
    BEGIN SELECT RAISE(ABORT,'controlled finalization interruption'); END`],
]) {
  test(`R2 finalization interruption at ${boundary} rolls back the terminal bundle and recovers after restart`, async t => {
    const managedRoot = mkdtempSync(join(tmpdir(), 'vio-r2-finalization-'));
    t.after(() => rmSync(managedRoot, { recursive: true, force: true }));
    const { f, advance } = await fixture(t, { personalManagedRoot: managedRoot });
    const initial = await f.initialize();
    const owner = initial.data.user.userId;
    const backup = join(managedRoot, 'controlled.backup');
    const canary = join(managedRoot, 'unregistered-canary.txt');
    writeFileSync(backup, 'Controlled disposable backup content.');
    writeFileSync(canary, 'Unregistered canary must remain.');
    const { copyId } = f.app.personalManagedCopies.register({
      ownerUserId: owner, kind: 'backup', rootPath: managedRoot, relativePath: 'controlled.backup',
    });
    const waiting = await requestDeletion(f);
    const db = f.app.database.connection;
    // Test-only connection-local SQL interruption at the exact former crash
    // window. No production failpoint or immutable protection is changed.
    db.exec(trigger);
    advance(7 * DAY);
    const failed = f.app.personalDeletionService.sweep()[0];
    assert.equal(failed.status, 'cleanup_pending');
    assert.equal(failed.reason, 'managed_cleanup_failed');
    assert.equal(failed.onlineData, 'deleted');
    assert.equal(existsSync(backup), false, 'completed physical cleanup is not repeated or rolled back');
    assert.equal(readFileSync(canary, 'utf8'), 'Unregistered canary must remain.');
    const pending = db.prepare('SELECT status,owner_user_id,online_deleted_at FROM personal_deletion_tasks WHERE deletion_id=?').get(waiting.deletionId);
    assert.equal(pending.status, 'cleanup_pending');
    assert.equal(pending.owner_user_id, owner, 'resumable cleanup retains its exact owner until atomic finalization');
    assert.equal(pending.online_deleted_at, new Date(START + 7 * DAY).toISOString());
    const removed = db.prepare('SELECT owner_user_id,status FROM personal_managed_copies WHERE copy_id=?').get(copyId);
    assert.equal(removed.owner_user_id, owner);
    assert.equal(removed.status, 'removed', 'registry deletion rolls back together with the completed receipt');
    const firstAttempt = db.prepare('SELECT result,completed_at FROM personal_deletion_attempts').get();
    assert.equal(firstAttempt.result, 'failed');
    assert.equal(firstAttempt.completed_at, new Date(START + 7 * DAY).toISOString());
    assert.equal(count(f, 'users'), 0);
    assert.equal(count(f, 'personal_deletion_tombstones'), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const visible = await f.call('/deletions/current');
    assert.equal(visible.data.deletion.status, 'cleanup_pending');
    assert.equal(JSON.stringify(visible).includes('controlled finalization interruption'), false);
    assert.equal(JSON.stringify(visible).includes(managedRoot), false);

    // A real same-database restart removes the test-only TEMP trigger. Startup
    // recovery must finalize the existing task, not create another deletion.
    await f.restart();
    const recovered = await f.call('/deletions/current');
    assert.equal(recovered.data.deletion.status, 'completed');
    assert.equal(recovered.data.deletion.deletionId, waiting.deletionId);
    assert.equal(recovered.data.deletion.onlineDeletedAt, pending.online_deleted_at);
    assert.equal(recovered.data.deletion.receiptExpiresAt, new Date(START + 37 * DAY).toISOString());
    assert.equal(count(f, 'personal_managed_copies'), 0, 'no owner-linked copy metadata is stranded behind a completed task');
    assert.equal(count(f, 'personal_deletion_tasks'), 1);
    assert.equal(count(f, 'personal_deletion_tombstones'), 1);
    assert.deepEqual(f.app.database.connection.prepare('SELECT result FROM personal_deletion_attempts ORDER BY rowid').all().map(row => row.result), ['failed', 'completed']);
    assert.equal(f.app.database.connection.prepare('SELECT owner_user_id FROM personal_deletion_tasks').get().owner_user_id, null);
    assert.deepEqual(f.app.personalDeletionService.sweep(), []);
    assert.equal(readFileSync(canary, 'utf8'), 'Unregistered canary must remain.');
    advance(30 * DAY);
    f.app.personalDeletionService.sweep();
    for (const table of ['personal_deletion_tasks', 'personal_deletion_access', 'personal_deletion_tombstones', 'personal_deletion_attempts', 'personal_managed_copies']) {
      assert.equal(count(f, table), 0, table);
    }
    assert.deepEqual(f.app.database.connection.prepare('PRAGMA foreign_key_check').all(), []);
  });
}
