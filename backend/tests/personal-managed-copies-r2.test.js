import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { tmpdir,homedir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import { createPersonalManagedCopies } from '../src/modules/personal/personal-managed-copies.js';
import { digest } from '../src/modules/personal/personal-crypto.js';
import { ApplicationError } from '../src/core/errors.js';

const when='2026-09-05T00:00:00.000Z';
const fingerprint=owner=>digest(`vio-deleted-owner/v1/${owner}`);
const code=expected=>error=>error instanceof ApplicationError&&error.code===expected;

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'vio-r2-managed-'));const managed=join(root,'managed');mkdirSync(managed);
  const databasePath=join(root,'test.sqlite');let database=createSqliteDatabase({databasePath,migrationsPath:resolve('migrations')});
  for(const owner of ['owner-a','owner-b'])database.connection.prepare('INSERT INTO users(user_id,primary_email,display_name,status,created_at,updated_at) VALUES(?,NULL,NULL,?,?,?)').run(owner,'active',when,when);
  let current=when;
  const makeService=allowedRootRequired=>createPersonalManagedCopies({db:database.connection,clock:()=>new Date(current),allowedRootRequired});
  t.after(()=>{database.close();rmSync(root,{recursive:true,force:true});});
  return {
    root,managed,get db(){return database.connection;},service:()=>makeService(managed),withoutRoot:()=>makeService(null),
    clock:value=>{current=value;},
    file:(name,contents='non-secret controlled file')=>{const path=join(managed,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,contents);return path;},
    task(owner,{status='waiting',online=false}={}) {
      const id=`task-${owner}`;
      database.connection.prepare("INSERT INTO personal_deletion_tasks(deletion_id,owner_user_id,owner_fingerprint,idempotency_key,requested_at,cancellable_until,status,online_deleted_at,scope_json) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(id,owner,fingerprint(owner),'delete-once',when,'2026-09-12T00:00:00.000Z',status,online?'2026-09-12T00:00:00.000Z':null,'{}');
      return id;
    },
    deleteOnline(owner) {
      this.task(owner,{status:'cleanup_pending',online:true});
      database.connection.prepare('DELETE FROM users WHERE user_id=?').run(owner);
    },
    restart() {database.close();database=createSqliteDatabase({databasePath,migrationsPath:resolve('migrations')});},
  };
}

test('R2 no managed copies reports zero truthfully and no root is discovered or created',t=>{
  const f=fixture(t);const service=f.withoutRoot();
  const empty={files:{registered:0,remaining:0,removed:0},backups:{registered:0,remaining:0,removed:0}};
  assert.deepEqual(service.inventory('owner-a'),empty);
  assert.deepEqual(service.cleanup('owner-a'),{status:'completed',...empty,failures:[]});
  f.file('a.json');
  assert.throws(()=>service.register({ownerUserId:'owner-a',kind:'backup',rootPath:f.managed,relativePath:'a.json'}),code('MANAGED_COPY_UNSAFE_PATH'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM personal_managed_copies').get().n,0);
});

test('R2 registered single-owner copies are exact-reused and cannot be claimed by another owner',t=>{
  const f=fixture(t);const service=f.service();f.file('a.json');
  const input={ownerUserId:'owner-a',kind:'backup',rootPath:f.managed,relativePath:'a.json'};
  const first=service.register(input);assert.deepEqual(service.register(input),first);
  assert.throws(()=>service.register({...input,ownerUserId:'owner-b'}),code('MANAGED_COPY_SCOPE_CONFLICT'));
  assert.deepEqual(service.assertRestoreAllowed(first.copyId),{copyId:first.copyId,restoreAllowed:true});
  assert.deepEqual(service.inventory('owner-a'),{files:{registered:0,remaining:0,removed:0},backups:{registered:1,remaining:1,removed:0}});
  assert.equal(JSON.stringify(service.inventory('owner-a')).includes(f.managed),false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM personal_managed_copies').get().n,1);
});

test('R2 cleanup deletes only registered files after online deletion and preserves directories and other-owner canaries',t=>{
  const f=fixture(t);const service=f.service();
  const a=f.file('owner-a/a.txt');const backup=f.file('owner-a/a.backup');const b=f.file('owner-b/b.txt','other owner');const canary=f.file('unregistered.txt','protected canary');
  const sibling=join(f.root,'sibling.txt');writeFileSync(sibling,'sibling canary');
  const one=service.register({ownerUserId:'owner-a',kind:'file',rootPath:f.managed,relativePath:'owner-a/a.txt'});
  service.register({ownerUserId:'owner-a',kind:'backup',rootPath:f.managed,relativePath:'owner-a/a.backup'});
  service.register({ownerUserId:'owner-b',kind:'file',rootPath:f.managed,relativePath:'owner-b/b.txt'});
  assert.throws(()=>service.cleanup('owner-a'),code('MANAGED_COPY_DELETION_NOT_AUTHORIZED'));
  assert.equal(existsSync(a),true);assert.equal(existsSync(backup),true);
  f.deleteOnline('owner-a');f.clock('2026-09-12T00:00:00.000Z');
  const result=service.cleanup('owner-a');assert.equal(result.status,'completed');assert.deepEqual(result.failures,[]);
  assert.deepEqual(result.files,{registered:1,remaining:0,removed:1});assert.deepEqual(result.backups,{registered:1,remaining:0,removed:1});
  assert.equal(existsSync(a),false);assert.equal(existsSync(backup),false);assert.equal(existsSync(dirname(a)),true);
  assert.equal(readFileSync(b,'utf8'),'other owner');assert.equal(readFileSync(canary,'utf8'),'protected canary');assert.equal(readFileSync(sibling,'utf8'),'sibling canary');
  assert.deepEqual(service.cleanup('owner-a'),result);
  assert.throws(()=>service.assertRestoreAllowed(one.copyId),code('MANAGED_COPY_RESTORE_BLOCKED'));
  assert.equal(service.inventory('owner-b').files.remaining,1);
});

test('R2 replacement-content conflict remains pending and is safely resumable after correction',t=>{
  const f=fixture(t);const service=f.service();const path=f.file('a.backup','original controlled content');
  const one=service.register({ownerUserId:'owner-a',kind:'backup',rootPath:f.managed,relativePath:'a.backup'});
  f.deleteOnline('owner-a');writeFileSync(path,'changed controlled content');
  const failed=service.cleanup('owner-a');assert.equal(failed.status,'pending');
  assert.deepEqual(failed.failures,[{copyId:one.copyId,kind:'backup',reason:'MANAGED_COPY_HASH_CONFLICT'}]);
  assert.equal(failed.backups.remaining,1);assert.equal(existsSync(path),true);
  assert.equal(JSON.stringify(failed).includes(path),false);assert.equal(JSON.stringify(failed).includes('changed controlled content'),false);
  writeFileSync(path,'original controlled content');
  assert.equal(service.cleanup('owner-a').status,'completed');assert.equal(existsSync(path),false);
});

test('R2 registered copy cleanup survives same-database restart and already absent files are idempotently completed',t=>{
  const f=fixture(t);const path=f.file('restart.json');const first=f.service().register({ownerUserId:'owner-a',kind:'backup',rootPath:f.managed,relativePath:'restart.json'});
  f.deleteOnline('owner-a');rmSync(path);f.restart();
  const result=f.service().cleanup('owner-a');assert.equal(result.status,'completed');assert.equal(result.backups.removed,1);
  assert.equal(f.db.prepare('SELECT status FROM personal_managed_copies WHERE copy_id=?').get(first.copyId).status,'removed');
  assert.deepEqual(f.service().cleanup('owner-a'),result);
});

test('R2 copy registration rejects path escape, broad roots, absent owners and symbolic links or junctions',t=>{
  const f=fixture(t);const service=f.service();f.file('a.txt');const outside=join(f.root,'outside');mkdirSync(outside);writeFileSync(join(outside,'canary.txt'),'safe');
  for(const relativePath of ['../outside/canary.txt','..\\outside\\canary.txt','C:\\outside.txt','/absolute.txt','a.txt:stream','./a.txt','nested/../a.txt','a.txt ']) {
    assert.throws(()=>service.register({ownerUserId:'owner-a',kind:'file',rootPath:f.managed,relativePath}),code('MANAGED_COPY_UNSAFE_PATH'),relativePath);
  }
  for(const root of [homedir(),resolve('.'),f.root])assert.throws(()=>service.register({ownerUserId:'owner-a',kind:'file',rootPath:root,relativePath:'a.txt'}),code('MANAGED_COPY_UNSAFE_PATH'));
  for(const root of [homedir(),resolve('.')]) {
    const broad=createPersonalManagedCopies({db:f.db,allowedRootRequired:root});
    assert.throws(()=>broad.register({ownerUserId:'owner-a',kind:'file',rootPath:root,relativePath:'a.txt'}),code('MANAGED_COPY_UNSAFE_PATH'));
  }
  assert.throws(()=>service.register({ownerUserId:'unknown-owner',kind:'file',rootPath:f.managed,relativePath:'a.txt'}),code('MANAGED_COPY_OWNER_UNAVAILABLE'));
  const linked=join(f.managed,'linked');symlinkSync(outside,linked,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>service.register({ownerUserId:'owner-a',kind:'file',rootPath:f.managed,relativePath:'linked/canary.txt'}),code('MANAGED_COPY_UNSAFE_PATH'));
  assert.equal(readFileSync(join(outside,'canary.txt'),'utf8'),'safe');
  assert.equal(f.db.prepare('SELECT count(*) n FROM personal_managed_copies').get().n,0);
});

test('R2 restoration is blocked by pending deletion, owner status and tombstones; cancellation does not rewrite copy history',t=>{
  const f=fixture(t);const service=f.service();f.file('a.backup');
  const {copyId}=service.register({ownerUserId:'owner-a',kind:'backup',rootPath:f.managed,relativePath:'a.backup'});
  const before={...f.db.prepare('SELECT * FROM personal_managed_copies WHERE copy_id=?').get(copyId)};
  const deletionId=f.task('owner-a');
  assert.throws(()=>service.assertRestoreAllowed(copyId),code('MANAGED_COPY_RESTORE_BLOCKED'));
  assert.throws(()=>service.cleanup('owner-a'),code('MANAGED_COPY_DELETION_NOT_AUTHORIZED'));
  f.db.prepare("UPDATE personal_deletion_tasks SET status='cancelled' WHERE deletion_id=?").run(deletionId);
  assert.deepEqual(service.assertRestoreAllowed(copyId),{copyId,restoreAllowed:true});
  assert.deepEqual({...f.db.prepare('SELECT * FROM personal_managed_copies WHERE copy_id=?').get(copyId)},before);
  f.db.prepare("UPDATE users SET status='disabled' WHERE user_id='owner-a'").run();
  assert.throws(()=>service.assertRestoreAllowed(copyId),code('MANAGED_COPY_RESTORE_BLOCKED'));
  f.db.prepare("UPDATE users SET status='active' WHERE user_id='owner-a'").run();
  f.db.prepare('INSERT INTO personal_deletion_tombstones(owner_fingerprint,deletion_id,deleted_at) VALUES(?,?,?)').run(fingerprint('owner-a'),deletionId,when);
  assert.throws(()=>service.assertRestoreAllowed(copyId),code('MANAGED_COPY_RESTORE_BLOCKED'));
  assert.throws(()=>service.assertRestoreAllowed('unknown-copy'),code('MANAGED_COPY_NOT_FOUND'));
  assert.equal(existsSync(join(f.managed,'a.backup')),true);
});

test('R2 cleanup rechecks ancestor links and never follows a replaced directory to a protected sibling',t=>{
  const f=fixture(t);const service=f.service();f.file('owner-a/a.txt','original');
  const {copyId}=service.register({ownerUserId:'owner-a',kind:'file',rootPath:f.managed,relativePath:'owner-a/a.txt'});
  f.deleteOnline('owner-a');
  const outside=join(f.root,'protected');mkdirSync(outside);const canary=join(outside,'a.txt');writeFileSync(canary,'original');
  const original=join(f.managed,'owner-a');rmSync(original,{recursive:true});symlinkSync(outside,original,process.platform==='win32'?'junction':'dir');
  const result=service.cleanup('owner-a');
  assert.equal(result.status,'pending');assert.deepEqual(result.failures,[{copyId,kind:'file',reason:'MANAGED_COPY_UNSAFE_PATH'}]);
  assert.equal(readFileSync(canary,'utf8'),'original');assert.equal(result.files.remaining,1);
});
