import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteDatabase} from '../src/integrations/database/sqlite-database.js';

const migration='024_create_governed_personal_deletion.sql';
test('024 fresh and 001-023 upgrade retain old identities and ordinary immutable guards',()=>{
  const root=mkdtempSync(join(tmpdir(),'vio-r2-delete-migration-'));
  try {
  const oldPath=join(root,'old');cpSync(resolve('migrations'),oldPath,{recursive:true});rmSync(join(oldPath,migration));rmSync(join(oldPath,'025_create_standalone_chat_ledger.sql'));rmSync(join(oldPath,'026_create_personal_multi_conversation.sql'));
  const file=join(root,'db.sqlite');const old=createSqliteDatabase({databasePath:file,migrationsPath:oldPath});
  old.connection.prepare("INSERT INTO users VALUES('retained','retained@example.test','Retained','active','2026-01-01','2026-01-01')").run();
  const guards=old.connection.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND sql LIKE '%BEFORE UPDATE%'").all();old.close();
  const upgraded=createSqliteDatabase({databasePath:file,migrationsPath:resolve('migrations')});
  try {
   assert.equal(upgraded.connection.prepare("SELECT display_name FROM users WHERE user_id='retained'").get().display_name,'Retained');
   for(const g of guards)assert.equal(upgraded.connection.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(g.name).sql,g.sql);
   assert.equal(upgraded.connection.prepare("SELECT vio_owner_deletion_authorized('message_versions',1) allowed").get().allowed,0);
   assert.equal(upgraded.connection.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND sql LIKE '%WHEN vio_owner_deletion_authorized%'").get().n,43);
   assert.equal(upgraded.connection.prepare('SELECT count(*) n FROM personal_deletion_tasks').get().n,0);
   assert.deepEqual(upgraded.connection.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { upgraded.close(); }
  const fresh=createSqliteDatabase({databasePath:join(root,'fresh.sqlite'),migrationsPath:resolve('migrations')});
  assert.equal(fresh.connection.prepare('SELECT count(*) n FROM schema_migrations WHERE version=?').get(migration).n,1);fresh.close();
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('024 failure rolls back tables and trigger replacement without changing 001-023',()=>{
 const root=mkdtempSync(join(tmpdir(),'vio-r2-delete-rollback-'));const path=join(root,'migrations');const file=join(root,'db.sqlite');
 try {
  cpSync(resolve('migrations'),path,{recursive:true});const sql=readFileSync(join(path,migration),'utf8');writeFileSync(join(path,migration),`${sql}\nINVALID DELETION SQL;`);
  assert.throws(()=>createSqliteDatabase({databasePath:file,migrationsPath:path}),/024_create_governed_personal_deletion/);
  const db=new DatabaseSync(file);
  assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n,23);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='personal_deletion_tasks'").get().n,0);
  assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_master WHERE name='prevent_message_version_delete'").get().sql,/vio_owner_deletion_authorized/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
 }finally{rmSync(root,{recursive:true,force:true});}
});
