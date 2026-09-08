import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';

const MIGRATION = '028_create_local_long_term_memory.sql';
const TABLES = [
  'personal_local_memories', 'personal_local_memory_versions',
  'personal_local_memory_references', 'personal_local_memory_operations',
  'personal_local_memory_imports', 'personal_local_memory_import_items',
  'personal_local_memory_exports', 'personal_local_memory_export_items',
  'personal_local_memory_deletions', 'personal_context_memory_source_links',
];
const NOW = '2026-09-08T00:00:00.000Z';
const launcherRoot = process.env.VIO_TEST_PATHS_ROOT ?? null;
const temporaryRoot = prefix => mkdtempSync(join(launcherRoot ?? tmpdir(), prefix));
const cleanup = root => { if (!launcherRoot) rmSync(root, { recursive: true, force: true }); };

function through027(root) {
  const target = join(root, 'migrations-027');
  cpSync(resolve('migrations'), target, { recursive: true });
  rmSync(join(target, MIGRATION));
  return target;
}

function seedPersonalAssistant(connection) {
  connection.exec('BEGIN');
  try {
    connection.prepare(`INSERT INTO users
      (user_id,primary_email,display_name,status,created_at,updated_at)
      VALUES('r5-upgrade-owner',NULL,'R5 owner','active',?,?)`).run(NOW, NOW);
    connection.prepare(`INSERT INTO user_spaces
      (space_id,user_id,identity_mode,status,current_assistant_id,created_at,updated_at)
      VALUES('r5-upgrade-space','r5-upgrade-owner','personal_owner','active',NULL,?,?)`)
      .run(NOW, NOW);
    connection.prepare(`INSERT INTO subjects
      (subject_id,owner_user_id,name,avatar_ref,basic_settings_json,status,created_at,updated_at)
      VALUES('r5-upgrade-assistant','r5-upgrade-owner','R5 assistant',NULL,'{}','active',?,?)`)
      .run(NOW, NOW);
    connection.prepare(`UPDATE user_spaces SET current_assistant_id='r5-upgrade-assistant'
      WHERE user_id='r5-upgrade-owner'`).run();
    connection.prepare(`INSERT INTO personal_identities
      (user_id,password_salt,password_verifier,wrapped_vault_key,avatar,preferences_json,
       onboarding_completed,profile_version,selection_version,created_at)
      VALUES('r5-upgrade-owner','salt','verifier','wrapped',NULL,
       '{"storagePreference":"local","contextMode":"balanced"}',1,1,1,?)`).run(NOW);
    connection.prepare(`INSERT INTO personal_assistant_versions(user_id,assistant_id,version,avatar)
      VALUES('r5-upgrade-owner','r5-upgrade-assistant',1,NULL)`).run();
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

function seedProtectedMemoryFacts(connection) {
  connection.exec('BEGIN');
  try {
    connection.prepare(`INSERT INTO personal_local_memories
      (memory_id,user_id,assistant_id,current_version_id,current_version,status,deletion_id,
       created_at,updated_at)
      VALUES('r5-protected-memory','r5-upgrade-owner','r5-upgrade-assistant',NULL,1,
       'active',NULL,?,?)`).run(NOW, NOW);
    for (const [id, version, previous] of [
      ['r5-protected-version-1', 1, null],
      ['r5-protected-version-2', 2, 'r5-protected-version-1'],
    ]) {
      connection.prepare(`INSERT INTO personal_local_memory_versions
        (memory_version_id,memory_id,user_id,assistant_id,version_number,kind,body,summary,
         primary_source_type,primary_source_ref,primary_source_content_hash,
         source_conversation_id,source_message_id,source_message_version_id,source_event_id,
         occurred_at,recorded_at,include_in_context,visibility_scope,sensitivity,content_hash,
         previous_version_id)
        VALUES(?,'r5-protected-memory','r5-upgrade-owner','r5-upgrade-assistant',?,
         'other',?,NULL,'manual',?,
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         NULL,NULL,NULL,NULL,NULL,?,0,'current_assistant','normal',
         'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',?)`)
        .run(id, version, `body-${version}`, `manual:protected-${version}`, NOW, previous);
    }
    connection.prepare(`UPDATE personal_local_memories SET current_version_id=?
      WHERE memory_id='r5-protected-memory'`).run('r5-protected-version-1');
    connection.prepare(`INSERT INTO personal_local_memory_operations
      (operation_id,user_id,assistant_id,idempotency_key,operation_type,request_hash,status,
       resource_type,resource_id,resource_version_id,confirmation_id,error_code,
       created_at,completed_at)
      VALUES('r5-protected-operation','r5-upgrade-owner','r5-upgrade-assistant',
       'r5-protected-key','memory.create',
       'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
       'completed','memory','r5-protected-memory','r5-protected-version-1',NULL,NULL,?,?)`)
      .run(NOW, NOW);
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

test('028 creates the complete R5 ledger with strict foreign keys and protections', () => {
  const root = temporaryRoot('vio-r5-fresh-');
  try {
    const database = createSqliteDatabase({ databasePath: join(root, 'fresh.sqlite'),
      migrationsPath: resolve('migrations') });
    try {
      assert.equal(database.connection.prepare(
        'SELECT count(*) AS n FROM schema_migrations WHERE version=?',
      ).get(MIGRATION).n, 1);
      for (const table of TABLES) {
        assert.equal(database.connection.prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?",
        ).get(table).n, 1, table);
      }
      assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
      const triggerCount = database.connection.prepare(`SELECT count(*) AS n FROM sqlite_master
        WHERE type='trigger' AND name LIKE '%personal_local_memory%'`).get().n;
      assert.equal(triggerCount >= 10, true);
      seedPersonalAssistant(database.connection);
      seedProtectedMemoryFacts(database.connection);
      assert.throws(() => database.connection.prepare(`UPDATE personal_local_memories
        SET current_version_id='r5-protected-version-2'
        WHERE memory_id='r5-protected-memory'`).run(), /identity\/version is immutable/u);
      assert.throws(() => database.connection.prepare(`UPDATE personal_local_memory_operations
        SET error_code='changed' WHERE operation_id='r5-protected-operation'`).run(),
      /terminal local memory operations are immutable/u);
      assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { database.close(); }
  } finally { cleanup(root); }
});

test('001-027 upgrades to 028 without claiming old memory tables and seeds scoped permissions', () => {
  const root = temporaryRoot('vio-r5-upgrade-');
  const file = join(root, 'upgrade.sqlite');
  try {
    const old = createSqliteDatabase({ databasePath: file, migrationsPath: through027(root) });
    seedPersonalAssistant(old.connection);
    old.close();
    const upgraded = createSqliteDatabase({ databasePath: file, migrationsPath: resolve('migrations') });
    try {
      assert.equal(upgraded.connection.prepare(
        'SELECT count(*) AS n FROM schema_migrations WHERE version=?',
      ).get(MIGRATION).n, 1);
      assert.equal(upgraded.connection.prepare(`SELECT count(*) AS n FROM permissions
        WHERE user_id='r5-upgrade-owner' AND subject_id='r5-upgrade-assistant'
          AND resource_type='memory' AND resource_id='local-memory' AND status='active'`).get().n, 5);
      assert.equal(upgraded.connection.prepare('SELECT count(*) AS n FROM local_memories').get().n, 0);
      assert.deepEqual(upgraded.connection.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { upgraded.close(); }
  } finally { cleanup(root); }
});

test('a failing 028 rolls back its complete schema and preserves the exact 001-027 database', () => {
  const root = temporaryRoot('vio-r5-rollback-');
  const file = join(root, 'rollback.sqlite');
  try {
    const old = createSqliteDatabase({ databasePath: file, migrationsPath: through027(root) });
    seedPersonalAssistant(old.connection);
    old.close();
    const broken = join(root, 'migrations-broken');
    cpSync(resolve('migrations'), broken, { recursive: true });
    const migration = join(broken, MIGRATION);
    writeFileSync(migration, `${readFileSync(migration, 'utf8')}\nINVALID R5 SQL;\n`, 'utf8');
    assert.throws(() => createSqliteDatabase({ databasePath: file, migrationsPath: broken }),
      /028_create_local_long_term_memory/u);
    const inspected = new DatabaseSync(file);
    try {
      assert.equal(inspected.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 27);
      assert.equal(inspected.prepare(
        'SELECT count(*) AS n FROM schema_migrations WHERE version=?',
      ).get(MIGRATION).n, 0);
      for (const table of TABLES) {
        assert.equal(inspected.prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?",
        ).get(table).n, 0, table);
      }
      assert.equal(inspected.prepare(`SELECT count(*) AS n FROM subjects
        WHERE subject_id='r5-upgrade-assistant'`).get().n, 1);
      assert.deepEqual(inspected.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { inspected.close(); }
  } finally { cleanup(root); }
});
