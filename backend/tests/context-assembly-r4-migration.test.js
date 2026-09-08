import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';

const MIGRATION = '027_create_context_assembly_ledger.sql';
const TABLES = [
  'personal_context_conversation_settings',
  'personal_context_operations',
  'personal_context_summaries',
  'personal_context_turn_controls',
  'personal_context_summary_sources',
  'personal_context_summary_attempts',
  'personal_context_assemblies',
  'personal_context_assembly_sources',
  'personal_context_recovery_actions',
];
const NOW = '2026-09-06T00:00:00.000Z';
const launcherRoot = process.env.VIO_TEST_PATHS_ROOT ?? null;

function temporaryRoot(prefix) {
  return mkdtempSync(join(launcherRoot ?? tmpdir(), prefix));
}

function removeRoot(root) {
  if (!launcherRoot) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function migrationsThrough026(root) {
  const path = join(root, 'migrations-026');
  cpSync(resolve('migrations'), path, { recursive: true });
  rmSync(join(path, MIGRATION));
  return path;
}

function seedR3Conversation(connection) {
  connection.exec('BEGIN');
  try {
    connection.prepare(`INSERT INTO users
      (user_id,primary_email,display_name,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?)`).run('r4-upgrade-owner', null, 'R4 owner', 'active', NOW, NOW);
    connection.prepare(`INSERT INTO subjects
      (subject_id,owner_user_id,name,avatar_ref,basic_settings_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run('r4-upgrade-assistant', 'r4-upgrade-owner',
      'R4 assistant', null, '{}', 'active', NOW, NOW);
    connection.prepare(`INSERT INTO personal_identities
      (user_id,password_salt,password_verifier,wrapped_vault_key,avatar,preferences_json,
       onboarding_completed,profile_version,selection_version,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('r4-upgrade-owner', 'salt', 'verifier', 'wrapped',
      null, '{"storagePreference":"local","contextMode":"balanced"}', 1, 1, 1, NOW);
    connection.prepare(`INSERT INTO conversations
      (conversation_id,user_id,subject_id,title,status,created_at,updated_at,last_activity_at)
      VALUES(?,?,?,?,?,?,?,?)`).run('r4-preserved-conversation', 'r4-upgrade-owner',
      'r4-upgrade-assistant', 'Preserved R3 conversation', 'active', NOW, NOW, NOW);
    connection.prepare(`INSERT INTO standalone_chat_default_conversations
      (user_id,assistant_id,conversation_id,is_r1_default,created_at)
      VALUES(?,?,?,?,?)`).run('r4-upgrade-owner', 'r4-upgrade-assistant',
      'r4-preserved-conversation', 0, NOW);
    connection.prepare(`INSERT INTO personal_chat_conversations
      (conversation_id,user_id,assistant_id,status,version,current_branch_id,created_at,updated_at)
      VALUES(?,?,?,'active',1,?,?,?)`).run('r4-preserved-conversation', 'r4-upgrade-owner',
      'r4-upgrade-assistant', 'r4-preserved-branch', NOW, NOW);
    connection.prepare(`INSERT INTO personal_chat_branches
      (branch_id,user_id,assistant_id,conversation_id,parent_branch_id,fork_message_id,title,
       version,clear_through_sequence,created_at,updated_at)
      VALUES(?,?,?,?,NULL,NULL,'Main',1,0,?,?)`).run('r4-preserved-branch',
      'r4-upgrade-owner', 'r4-upgrade-assistant', 'r4-preserved-conversation', NOW, NOW);
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

test('027 installs the complete fresh R4 ledger, execution snapshot binding and protections', () => {
  const root = temporaryRoot('vio-r4-fresh-');
  try {
    const database = createSqliteDatabase({
      databasePath: join(root, 'fresh.sqlite'),
      migrationsPath: resolve('migrations'),
    });
    try {
      assert.equal(database.connection.prepare(`
        SELECT count(*) AS n FROM schema_migrations WHERE version=?
      `).get(MIGRATION).n, 1);
      for (const table of TABLES) {
        assert.equal(database.connection.prepare(`
          SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?
        `).get(table).n, 1, table);
      }
      assert.equal(database.connection.prepare(`
        SELECT count(*) AS n FROM pragma_table_info('standalone_chat_model_executions')
        WHERE name='context_snapshot_hash'
      `).get().n, 1);
      assert.deepEqual(database.connection.prepare(`
        SELECT name FROM pragma_table_info('personal_context_assemblies')
        WHERE name IN ('unavailable_excluded_source_refs_json','raw_estimated_input_tokens',
          'selection_json','provider_messages_hash') ORDER BY name
      `).all().map((row) => row.name), [
        'provider_messages_hash',
        'raw_estimated_input_tokens',
        'selection_json',
        'unavailable_excluded_source_refs_json',
      ]);
      assert.equal(database.connection.prepare(`
        SELECT count(*) AS n FROM pragma_table_info('personal_context_assembly_sources')
        WHERE name='source_phase'
      `).get().n, 1);
      assert.equal(database.connection.prepare(`
        SELECT count(*) AS n FROM sqlite_master
        WHERE type='trigger' AND name LIKE '%personal_context%'
      `).get().n >= 19, true);
      assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      database.close();
    }
  } finally {
    removeRoot(root);
  }
});

test('001-026 upgrades to 027 without changing existing R3 ownership facts', () => {
  const root = temporaryRoot('vio-r4-upgrade-');
  const databasePath = join(root, 'upgrade.sqlite');
  try {
    const old = createSqliteDatabase({
      databasePath,
      migrationsPath: migrationsThrough026(root),
    });
    seedR3Conversation(old.connection);
    old.close();
    const upgraded = createSqliteDatabase({ databasePath, migrationsPath: resolve('migrations') });
    try {
      assert.deepEqual({ ...upgraded.connection.prepare(`
        SELECT conversation_id,user_id,assistant_id,current_branch_id,status
        FROM personal_chat_conversations
      `).get() }, {
        conversation_id: 'r4-preserved-conversation',
        user_id: 'r4-upgrade-owner',
        assistant_id: 'r4-upgrade-assistant',
        current_branch_id: 'r4-preserved-branch',
        status: 'active',
      });
      assert.equal(upgraded.connection.prepare(`
        SELECT count(*) AS n FROM schema_migrations WHERE version=?
      `).get(MIGRATION).n, 1);
      assert.equal(upgraded.connection.prepare(`
        SELECT count(*) AS n FROM personal_context_assemblies
      `).get().n, 0);
      assert.deepEqual(upgraded.connection.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    removeRoot(root);
  }
});

test('a failing 027 rolls back every R4 table and execution-column change', () => {
  const root = temporaryRoot('vio-r4-rollback-');
  const databasePath = join(root, 'rollback.sqlite');
  try {
    const old = createSqliteDatabase({
      databasePath,
      migrationsPath: migrationsThrough026(root),
    });
    seedR3Conversation(old.connection);
    old.close();
    const broken = join(root, 'migrations-broken');
    cpSync(resolve('migrations'), broken, { recursive: true });
    const migration = join(broken, MIGRATION);
    writeFileSync(migration, `${readFileSync(migration, 'utf8')}\nINVALID R4 SQL;\n`, 'utf8');
    assert.throws(
      () => createSqliteDatabase({ databasePath, migrationsPath: broken }),
      /027_create_context_assembly_ledger/u,
    );
    const inspected = new DatabaseSync(databasePath);
    try {
      assert.equal(inspected.prepare(`
        SELECT count(*) AS n FROM schema_migrations WHERE version=?
      `).get(MIGRATION).n, 0);
      for (const table of TABLES) {
        assert.equal(inspected.prepare(`
          SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?
        `).get(table).n, 0, table);
      }
      assert.equal(inspected.prepare(`
        SELECT count(*) AS n FROM pragma_table_info('standalone_chat_model_executions')
        WHERE name='context_snapshot_hash'
      `).get().n, 0);
      assert.equal(inspected.prepare(`
        SELECT title FROM conversations WHERE conversation_id='r4-preserved-conversation'
      `).get().title, 'Preserved R3 conversation');
      assert.deepEqual(inspected.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      inspected.close();
    }
  } finally {
    removeRoot(root);
  }
});
