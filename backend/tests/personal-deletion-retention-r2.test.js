import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startPersonalTestApplication} from '../test-support/personal-test-application.js';
import {createTestDatabasePath} from '../test-support/test-application.js';
import {createApplication} from '../src/app.js';
import {loadConfig} from '../src/config.js';

const DAY=86400000;
async function deletion(f) {
 const p=await f.call('/deletions','POST',{}, {'idempotency-key':'delete-retention'});
 assert.equal(p.status,200);assert.equal(p.data.operationStatus,'confirmation_required');
 const id=p.data.security.confirmation.confirmationId;
 assert.equal((await f.call(`/confirmations/${id}/decision`,'POST',{decision:'approve'})).status,200);
 const r=await f.call('/deletions','POST',{confirmationId:id},{'idempotency-key':'delete-retention'});
 assert.equal(r.status,200);return r.data.deletion;
}

test('R2 managed backup deadline is fourteen days after actual online deletion, never a false completed result',async t=>{
 const root=mkdtempSync(join(tmpdir(),'vio-r2-retention-'));const managed=join(root,'managed');mkdirSync(managed);
 // Registered after the application hook, so its cleanup runs before this root.
 let now=new Date('2026-09-05T00:00:00Z');
 const f=await startPersonalTestApplication(t,{personalClock:()=>now,personalManagedRoot:managed});
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {data}=await f.initialize();const owner=data.user.userId;
 const path=join(managed,'controlled.backup');writeFileSync(path,'isolated single-owner backup');
 const {copyId}=f.app.personalManagedCopies.register({ownerUserId:owner,kind:'backup',rootPath:managed,relativePath:'controlled.backup'});
 const first=await deletion(f);assert.equal(first.scope.managedBackupCount,1);
 assert.throws(()=>f.app.personalManagedCopies.assertRestoreAllowed(copyId),e=>e.code==='MANAGED_COPY_RESTORE_BLOCKED');
 writeFileSync(path,'replaced content must never be erased');
 now=new Date(Date.parse(first.cancellableUntil));
 let result=await f.call('/deletions/current/retry','POST',{});
 assert.equal(result.status,200);assert.equal(result.data.deletion.onlineData,'deleted');assert.equal(result.data.deletion.status,'cleanup_pending');
 const actual=Date.parse(result.data.deletion.onlineDeletedAt);
 assert.equal(Date.parse(result.data.deletion.backupDeadlineAt),actual+14*DAY);
 assert.equal(Date.parse(result.data.deletion.receiptExpiresAt),actual+30*DAY);
 assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM users WHERE user_id=?').get(owner).n,0);
 now=new Date(actual+14*DAY-1);result=await f.call('/deletions/current/retry','POST',{});
 assert.equal(result.data.deletion.reason,'managed_copy_hash_conflict');
 now=new Date(actual+14*DAY);result=await f.call('/deletions/current/retry','POST',{});
 assert.equal(result.data.deletion.reason,'managed_backup_deadline_exceeded');assert.equal(result.data.deletion.status,'cleanup_pending');
 assert.equal(existsSync(path),true);await f.restart();
 assert.equal((await f.call('/deletions/current')).data.deletion.reason,'managed_backup_deadline_exceeded');
 writeFileSync(path,'isolated single-owner backup');
 result=await f.call('/deletions/current/retry','POST',{});
 assert.equal(result.data.deletion.status,'completed');assert.equal(result.data.deletion.managedBackups.remaining,0);assert.equal(existsSync(path),false);
 assert.throws(()=>f.app.personalManagedCopies.assertRestoreAllowed(copyId),e=>e.code==='MANAGED_COPY_NOT_FOUND');
 now=new Date(actual+30*DAY);f.app.personalDeletionService.sweep();
 assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_deletion_tasks').get().n,0);
 assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_deletion_tombstones').get().n,0);
 assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_managed_copies').get().n,0);
});

test('R2 a busy SQLite writer does not erase data or claim deletion and retry works when released',async t=>{
 let now=new Date('2026-09-05T00:00:00Z');const f=await startPersonalTestApplication(t,{personalClock:()=>now});
 const {data}=await f.initialize();const first=await deletion(f);now=new Date(first.cancellableUntil);
 const other=new DatabaseSync(f.temp.databasePath);
 // A real independent connection owns the write lock; do not disable FK,
 // triggers, isolation or default test concurrency to manufacture success.
 other.exec('BEGIN IMMEDIATE');
 try {
  const failed=await f.call('/deletions/current/retry','POST',{});
  assert.equal(failed.status,503);assert.equal(failed.error.code,'DELETION_DATABASE_BUSY');
  const state=await f.call('/deletions/current');assert.equal(state.data.deletion.onlineData,'pending');assert.equal(state.data.deletion.status,'waiting');
  assert.equal(other.prepare('SELECT count(*) n FROM users WHERE user_id=?').get(data.user.userId).n,1);
 }finally{other.exec('ROLLBACK');other.close();}
 assert.equal((await f.call('/deletions/current/retry','POST',{})).data.deletion.status,'completed');
});

test('R2 startup defers due deletion under a real writer lock and still exposes read-only task status',async()=>{
 const temp=createTestDatabasePath();let now=new Date('2026-09-05T00:00:00Z');const messages=[];
 const app=createApplication({config:loadConfig({VIO_BACKEND_DB_PATH:temp.databasePath,VIO_BACKEND_PORT:'0'}),environment:{},personalClock:()=>now,logger:{error:(_message,data)=>messages.push(data.code)}});
 let other;
 try {
  const invitation=app.personalIdentityService.issueInvitation();
  const session=app.personalIdentityService.initialize({invitation,passphrase:'controlled-personal-test-passphrase',agreementVersion:'personal-use/v1'},'startup-init');
  const pending=app.personalDeletionService.request(session.context,{},'startup-delete');
  const confirmationId=pending.security.confirmation.confirmationId;
  app.personalConfigurationService.decide(session.context,confirmationId,{decision:'approve'});
  const accepted=app.personalDeletionService.request(session.context,{confirmationId},'startup-delete');
  now=new Date(accepted.deletion.cancellableUntil);
  other=new DatabaseSync(temp.databasePath);other.exec('BEGIN IMMEDIATE');
  const address=await app.start();
  const response=await fetch(`http://127.0.0.1:${address.port}/api/v1/personal/deletions/current`,{headers:{cookie:`vio_deletion_access=${accepted.token}`}});
  assert.equal(response.status,200);assert.equal((await response.json()).data.deletion.status,'waiting');
  assert.ok(messages.includes('DELETION_MAINTENANCE_DEFERRED'));
  assert.ok(messages.includes('MEMORY_RECOVERY_DATABASE_BUSY'));
  assert.ok(messages.includes('PERSONAL_RECOVERY_DATABASE_BUSY'));
  other.exec('ROLLBACK');other.close();other=null;
  assert.equal(app.personalDeletionService.sweep()[0].status,'completed');
 }finally{if(other){other.exec('ROLLBACK');other.close();}await app.stop();temp.remove();}
});
