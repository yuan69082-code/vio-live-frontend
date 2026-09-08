import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from '../src/config.js';
import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import { deleteInventory, ownerDeletionInventory } from '../src/integrations/database/personal-deletion-scope.js';

const MIGRATION = '029_create_unified_capability_execution.sql';
const TABLES = [
  'r6_capability_definitions', 'r6_capability_operations', 'r6_mcp_discovery_snapshots',
  'r6_unified_executions', 'r6_execution_attempts', 'r6_execution_steps',
  'r6_execution_usage_facts', 'r6_execution_results', 'r6_standalone_execution_projections',
];
const migrations = resolve(import.meta.dirname, '..', 'migrations');
const HASH = `sha256:${'0'.repeat(64)}`;

function tempRoot(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function migrationCopy(root, through = 29) {
  const target = join(root, 'migrations');
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(migrations).filter(name => /^\d+_.+\.sql$/u.test(name) && Number(name.slice(0, 3)) <= through)) {
    cpSync(join(migrations, name), join(target, name), { recursive: true, force: true });
  }
  return target;
}

test('R6 migration 029 installs fresh with all immutable execution ledger tables', t => {
  const root = tempRoot(t, 'vio-r6-fresh-');
  const database = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: join(root, 'fresh.sqlite') }));
  try {
    const names = new Set(database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of TABLES) assert.equal(names.has(table), true, table);
    assert.equal(database.connection.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get().version, MIGRATION);
    assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
    assert.ok(database.connection.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='protect_terminal_r6_execution'").get());
  } finally { database.close(); }
});

test('R6 migration upgrades an exact 001-028 database and preserves pre-existing facts', t => {
  const root = tempRoot(t, 'vio-r6-upgrade-');
  const migrationPath = migrationCopy(root, 28);
  const databasePath = join(root, 'upgrade.sqlite');
  let database = createSqliteDatabase({ ...loadConfig({ VIO_BACKEND_DB_PATH: databasePath }), migrationsPath: migrationPath });
  database.connection.exec("CREATE TABLE preserved_r6_upgrade_marker(value TEXT PRIMARY KEY); INSERT INTO preserved_r6_upgrade_marker VALUES('before-029');");
  database.close();
  cpSync(join(migrations, MIGRATION), join(migrationPath, MIGRATION));
  database = createSqliteDatabase({ ...loadConfig({ VIO_BACKEND_DB_PATH: databasePath }), migrationsPath: migrationPath });
  try {
    assert.equal(database.connection.prepare('SELECT value FROM preserved_r6_upgrade_marker').get().value, 'before-029');
    assert.equal(database.connection.prepare('SELECT version FROM schema_migrations WHERE version=?').get(MIGRATION).version, MIGRATION);
    assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { database.close(); }
});

test('R6 migration scopes mutable capability facts to owner plus assistant and governed deletion preserves other owners', t => {
  const root = tempRoot(t, 'vio-r6-scope-');
  const database = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: join(root, 'scope.sqlite') }));
  const db = database.connection;
  const when = '2026-09-08T00:00:00.000Z';

  function seedOwner(ownerId, assistantIds) {
    db.prepare(`INSERT INTO users(user_id,primary_email,display_name,status,created_at,updated_at)
      VALUES(?,NULL,?,'active',?,?)`).run(ownerId, ownerId, when, when);
    for (const assistantId of assistantIds) {
      db.prepare(`INSERT INTO subjects(subject_id,owner_user_id,name,avatar_ref,basic_settings_json,status,created_at,updated_at)
        VALUES(?,?,?,NULL,'{}','active',?,?)`).run(assistantId, ownerId, assistantId, when, when);
      const suffix = `${ownerId}-${assistantId}`;
      const capabilityId = `cap-${suffix}`;
      const executionId = `exec-${suffix}`;
      const attemptId = `attempt-${suffix}`;
      db.prepare(`INSERT INTO r6_capability_definitions
        (capability_id,owner_user_id,assistant_id,category,registry_id,name,version,definition_json,definition_hash,status,lifecycle_status,created_at,updated_at)
        VALUES(?,?,?,'mcp_server',?,'Shared scoped name','2026-07-28','{}',?,'enabled','installed',?,?)`)
        .run(capabilityId, ownerId, assistantId, `registry-${ownerId}`, HASH, when, when);
      db.prepare(`INSERT INTO r6_capability_operations
        (operation_id,owner_user_id,assistant_id,operation_type,idempotency_key,input_hash,response_json,created_at)
        VALUES(?,?,?,'install','same-operation-key',?,'{}',?)`)
        .run(`operation-${suffix}`, ownerId, assistantId, HASH, when);
      db.prepare(`INSERT INTO r6_mcp_discovery_snapshots
        (snapshot_id,owner_user_id,assistant_id,capability_id,protocol_version,tools_json,tools_hash,ttl_ms,cache_scope,discovered_at)
        VALUES(?,?,?,?, '2026-07-28','[]',?,60000,'private',?)`)
        .run(`snapshot-${suffix}`, ownerId, assistantId, capabilityId, HASH, when);
      db.prepare(`INSERT INTO r6_unified_executions
        (execution_id,owner_user_id,assistant_id,category,capability_id,capability_version,operation_name,idempotency_key,input_json,input_hash,source_type,source_id,status,confirmation_id,request_may_have_been_sent,error_code,created_at,updated_at,completed_at)
        VALUES(?,?,?,'mcp_tool',?,'2026-07-28','echo','same-execution-key','{}',?,'personal_api',NULL,'succeeded',NULL,1,NULL,?,?,?)`)
        .run(executionId, ownerId, assistantId, capabilityId, HASH, when, when, when);
      db.prepare(`INSERT INTO r6_execution_attempts
        (attempt_id,execution_id,owner_user_id,assistant_id,attempt_number,status,request_may_have_been_sent,error_code,started_at,completed_at)
        VALUES(?,?,?,?,1,'response_received',1,NULL,?,?)`)
        .run(attemptId, executionId, ownerId, assistantId, when, when);
      db.prepare(`INSERT INTO r6_execution_steps
        (step_fact_id,execution_id,attempt_id,owner_user_id,assistant_id,step_number,step_id,category,capability_id,operation_name,status,input_hash,output_hash,error_code,started_at,completed_at)
        VALUES(?,?,?,?,?,1,'echo','mcp_tool',?,'echo','succeeded',?,?,NULL,?,?)`)
        .run(`step-${suffix}`, executionId, attemptId, ownerId, assistantId, capabilityId, HASH, HASH, when, when);
      db.prepare(`INSERT INTO r6_execution_usage_facts
        (usage_fact_id,execution_id,attempt_id,owner_user_id,assistant_id,usage_status,input_tokens,output_tokens,total_tokens,cost_status,cost_amount_micros,cost_currency,recorded_at)
        VALUES(?,?,?,?,?,'not_incurred',0,0,0,'not_incurred',NULL,NULL,?)`)
        .run(`usage-${suffix}`, executionId, attemptId, ownerId, assistantId, when);
      db.prepare(`INSERT INTO r6_execution_results
        (result_id,execution_id,attempt_id,owner_user_id,assistant_id,status,output_json,content_hash,created_at)
        VALUES(?,?,?,?,?,'succeeded','{}',?,?)`)
        .run(`result-${suffix}`, executionId, attemptId, ownerId, assistantId, HASH, when);
    }
  }

  try {
    seedOwner('owner-a', ['assistant-a1', 'assistant-a2']);
    seedOwner('owner-b', ['assistant-b1']);
    assert.equal(db.prepare("SELECT count(*) n FROM r6_capability_definitions WHERE owner_user_id='owner-a'").get().n, 2);
    assert.equal(db.prepare("SELECT count(*) n FROM r6_unified_executions WHERE owner_user_id='owner-a' AND idempotency_key='same-execution-key'").get().n, 2);
    assert.throws(() => db.prepare(`INSERT INTO r6_capability_definitions
      (capability_id,owner_user_id,assistant_id,category,registry_id,name,version,definition_json,definition_hash,status,lifecycle_status,created_at,updated_at)
      VALUES('cross-owner-capability','owner-a','assistant-b1','local_tool','cross-owner-registry','Cross owner','1','{}',?,'enabled','installed',?,?)`).run(HASH, when, when), /constraint/i);
    assert.throws(() => db.prepare(`INSERT INTO r6_mcp_discovery_snapshots
      (snapshot_id,owner_user_id,assistant_id,capability_id,protocol_version,tools_json,tools_hash,ttl_ms,cache_scope,discovered_at)
      VALUES('cross-assistant-snapshot','owner-a','assistant-a2','cap-owner-a-assistant-a1','2026-07-28','[]',?,0,'private',?)`).run(HASH, when), /constraint/i);

    db.prepare(`INSERT INTO personal_deletion_tasks
      (deletion_id,owner_user_id,owner_fingerprint,idempotency_key,requested_at,cancellable_until,status,scope_json,inventory_json)
      VALUES('delete-owner-a','owner-a','fingerprint-owner-a','delete-owner-a-key',?,?,'processing','{}',NULL)`)
      .run(when, when);
    db.prepare("UPDATE users SET status='deletion_pending' WHERE user_id='owner-a'").run();
    const inventory = ownerDeletionInventory(db, 'owner-a');
    assert.equal(inventory.rows.some(row => row.table === 'r6_capability_definitions'), true);
    assert.equal(inventory.rows.some(row => row.table === 'r6_execution_results'), true);
    assert.equal(inventory.rows.some(row => JSON.stringify(row.key).includes('owner-b')), false);
    database.runInTransaction(() => database.withOwnerDeletion(
      'delete-owner-a', 'owner-a', inventory.rows,
      () => deleteInventory(db, inventory.rows),
    ));
    assert.equal(db.prepare("SELECT count(*) n FROM r6_capability_definitions WHERE owner_user_id='owner-a'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM r6_unified_executions WHERE owner_user_id='owner-a'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM users WHERE user_id='owner-a'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM r6_capability_definitions WHERE owner_user_id='owner-b'").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM r6_unified_executions WHERE owner_user_id='owner-b'").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM users WHERE user_id='owner-b'").get().n, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});

test('R6 migration failure rolls back its entire partial schema and migration record', t => {
  const root = tempRoot(t, 'vio-r6-rollback-');
  const migrationPath = migrationCopy(root, 28);
  const broken = readFileSync(join(migrations, MIGRATION), 'utf8').replace(
    'CREATE TABLE r6_execution_results',
    'CREATE TABLE r6_partial_failure_probe(value TEXT);\nTHIS IS NOT SQL;\nCREATE TABLE r6_execution_results',
  );
  writeFileSync(join(migrationPath, MIGRATION), broken, 'utf8');
  const databasePath = join(root, 'rollback.sqlite');
  assert.throws(() => createSqliteDatabase({ ...loadConfig({ VIO_BACKEND_DB_PATH: databasePath }), migrationsPath: migrationPath }), /Database migration failed: 029/);
  const connection = new DatabaseSync(databasePath);
  try {
    assert.equal(connection.prepare("SELECT 1 FROM sqlite_master WHERE name='r6_partial_failure_probe'").get(), undefined);
    assert.equal(connection.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(MIGRATION), undefined);
    for (const table of TABLES) assert.equal(connection.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table), undefined, table);
  } finally { connection.close(); }
});
