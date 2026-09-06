import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import { loadConfig } from '../src/config.js';

test('R2 migration installs fresh and upgrades 001-022 without claiming old data',()=>{
  const root=mkdtempSync(join(tmpdir(),'vio-r2-migration-'));const db=join(root,'db.sqlite');const oldMigrations=join(root,'old');
  cpSync(resolve('migrations'),oldMigrations,{recursive:true});rmSync(join(oldMigrations,'023_create_personal_identity_and_access.sql'));rmSync(join(oldMigrations,'024_create_governed_personal_deletion.sql'));rmSync(join(oldMigrations,'025_create_standalone_chat_ledger.sql'));rmSync(join(oldMigrations,'026_create_personal_multi_conversation.sql'));
  try {
    const old=createSqliteDatabase({databasePath:db,migrationsPath:oldMigrations});
    old.connection.prepare("INSERT INTO users VALUES('legacy','legacy@example.test','Legacy','active',?,?)").run('2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');old.close();
    const upgraded=createSqliteDatabase(loadConfig({VIO_BACKEND_DB_PATH:db}));
    assert.equal(upgraded.connection.prepare("SELECT display_name FROM users WHERE user_id='legacy'").get().display_name,'Legacy');
    assert.equal(upgraded.connection.prepare('SELECT count(*) n FROM personal_installation').get().n,0);
    assert.equal(upgraded.connection.prepare('PRAGMA foreign_key_check').all().length,0);upgraded.close();
    const fresh=createSqliteDatabase(loadConfig({VIO_BACKEND_DB_PATH:join(root,'fresh.sqlite')}));
    assert.equal(fresh.connection.prepare("SELECT count(*) n FROM schema_migrations WHERE version='023_create_personal_identity_and_access.sql'").get().n,1);
    assert.equal(fresh.connection.prepare('PRAGMA foreign_key_check').all().length,0);fresh.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('R2 migration failure rolls back the whole migration',()=>{
  const root=mkdtempSync(join(tmpdir(),'vio-r2-rollback-'));const migrations=join(root,'migrations');const db=join(root,'db.sqlite');
  cpSync(resolve('migrations'),migrations,{recursive:true});const file=join(migrations,'023_create_personal_identity_and_access.sql');writeFileSync(file,readFileSync(file,'utf8')+'\nINVALID R2 SQL;');
  try {
    assert.throws(()=>createSqliteDatabase({databasePath:db,migrationsPath:migrations}),/023_create_personal/);
    const inspected=new DatabaseSync(db);assert.equal(inspected.prepare("SELECT count(*) n FROM schema_migrations WHERE version LIKE '023_%'").get().n,0);assert.equal(inspected.prepare("SELECT count(*) n FROM sqlite_master WHERE name='personal_identities'").get().n,0);inspected.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('formal initialization CLI requires explicit private paths and writes no invitation to output',()=>{
  const root=mkdtempSync(join(tmpdir(),'vio-r2-cli-'));const runtime=join(root,'private');mkdirSync(runtime);
  const db=join(runtime,'db.sqlite');const invitation=join(runtime,'invitation');
  const result=spawnSync(process.execPath,['scripts/initialize-personal.js','--database',db,'--invitation-file',invitation,'--acknowledge-owner-initialization'],{cwd:resolve('.'),encoding:'utf8',env:process.env});
  try {
    assert.equal(result.status,0,result.stderr);assert.equal(existsSync(invitation),true);
    const raw=readFileSync(invitation,'utf8');assert.match(raw,/^[A-Za-z0-9_-]{43}$/);assert.equal(result.stdout.includes(raw),false);
    const second=spawnSync(process.execPath,['scripts/initialize-personal.js','--database',db,'--invitation-file',join(runtime,'second'),'--acknowledge-owner-initialization'],{cwd:resolve('.'),encoding:'utf8',env:process.env});
    assert.equal(second.status,2);assert.equal(second.stderr.includes(raw),false);
    assert.equal(readdirSync(runtime).some(name=>name.endsWith('-wal')||name.endsWith('-shm')),false);
  } finally {rmSync(root,{recursive:true,force:true});}
});
