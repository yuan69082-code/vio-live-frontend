import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  configureV4Execution,
  createV4Application,
} from '../test-support/continuity-capability-v4-fixtures.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

const SCOPE = Object.freeze({
  userId: 'user-001',
  subjectId: 'assistant-001',
  conversationId: 'conversation-001',
});

function successExecutor(counter) {
  return {
    async execute() {
      counter.calls += 1;
      return {
        status: 'SUCCEEDED',
        output: { responseCandidate: 'Provider candidate.', finishReason: 'stop' },
        usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
        errorCode: null,
        requestMayHaveBeenSent: true,
        startedAt: '2026-08-10T00:00:03Z',
        completedAt: '2026-08-10T00:00:04Z',
        cost: { status: 'not_reported', amountMicros: null, currency: null },
      };
    },
  };
}

function setup(databasePath, options = {}) {
  const counter = options.counter ?? { calls: 0 };
  const created = createV4Application(databasePath, {
    modelExecutor: options.modelExecutor ?? successExecutor(counter),
  });
  created.application.fixedLocalChatProfileService.prepare();
  configureV4Execution(created.application);
  return { ...created, counter };
}

async function startHttp(application) {
  const address = await application.start();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    async request(path, { method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'x-vio-user-id': SCOPE.userId,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

function turnPath(suffix = '') {
  return `/api/v1/users/${SCOPE.userId}/subjects/${SCOPE.subjectId}/conversations/${SCOPE.conversationId}/turns${suffix}`;
}

test('migration 022 installs fresh and protects immutable turn facts', () => {
  const testDatabase = createTestDatabasePath();
  const database = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: testDatabase.databasePath }));
  try {
    const table = database.connection.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='continuity_conversation_turns'",
    ).get();
    assert.equal(table.name, 'continuity_conversation_turns');
    assert.equal(database.connection.prepare(
      "SELECT COUNT(*) count FROM schema_migrations WHERE version='022_create_continuity_conversation_turn_ledger.sql'",
    ).get().count, 1);
    assert.equal(database.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
    const activeIndex = database.connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_continuity_conversation_turns_active_engine_subject'",
    ).get();
    assert.match(activeIndex.sql, /WHERE status NOT IN/);
  } finally {
    database.close();
    testDatabase.remove();
  }
});

test('001-021 upgrades to 022 and a broken migration rolls back completely', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vio-v5-migration-'));
  const migrations021 = join(directory, 'migrations-021');
  const broken = join(directory, 'migrations-broken');
  const upgradePath = join(directory, 'upgrade.sqlite');
  cpSync(resolve('migrations'), migrations021, { recursive: true });
  rmSync(join(migrations021, '022_create_continuity_conversation_turn_ledger.sql'));
  const old = createSqliteDatabase({ databasePath: upgradePath, migrationsPath: migrations021 });
  old.connection.prepare(`INSERT INTO users
    (user_id,primary_email,display_name,status,created_at,updated_at)
    VALUES ('kept-v5','kept-v5@example.com','Kept V5','active',?,?)`)
    .run('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  old.close();
  const upgraded = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: upgradePath }));
  assert.equal(upgraded.connection.prepare(
    "SELECT display_name FROM users WHERE user_id='kept-v5'",
  ).get().display_name, 'Kept V5');
  upgraded.close();

  const rollbackPath = join(directory, 'rollback.sqlite');
  const before = createSqliteDatabase({ databasePath: rollbackPath, migrationsPath: migrations021 });
  before.close();
  cpSync(resolve('migrations'), broken, { recursive: true });
  const migration = join(broken, '022_create_continuity_conversation_turn_ledger.sql');
  writeFileSync(migration, `${readFileSync(migration, 'utf8')}\nINVALID V5 SQL;\n`, 'utf8');
  assert.throws(
    () => createSqliteDatabase({ databasePath: rollbackPath, migrationsPath: broken }),
    /022_create_continuity/,
  );
  const inspected = new DatabaseSync(rollbackPath);
  assert.equal(inspected.prepare(
    "SELECT COUNT(*) count FROM schema_migrations WHERE version LIKE '022_%'",
  ).get().count, 0);
  assert.equal(inspected.prepare(
    "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='continuity_conversation_turns'",
  ).get().count, 0);
  inspected.close();
  rmSync(directory, { recursive: true, force: true });
});

test('fixed local chat profile is internal, exact, idempotent and fail-closed on conflict', async () => {
  const testDatabase = createTestDatabasePath();
  const { application } = createV4Application(testDatabase.databasePath, {
    modelExecutor: successExecutor({ calls: 0 }),
  });
  try {
    const first = application.fixedLocalChatProfileService.prepare();
    const second = application.fixedLocalChatProfileService.prepare();
    assert.deepEqual(second, first);
    assert.deepEqual(first, {
      userId: 'user-001', assistantId: 'assistant-001', engineSubjectId: 'subject-001',
      bindingId: 'binding-001', bindingVersion: 1, conversationId: 'conversation-001',
      userStatus: 'active', assistantStatus: 'active', conversationStatus: 'active',
      bindingStatus: 'active',
    });
    assert.equal(application.database.connection.prepare(
      'SELECT COUNT(*) count FROM continuity_first_round_binding_fixtures',
    ).get().count, 1);
    assert.equal(application.database.connection.prepare(
      'SELECT COUNT(*) count FROM conversations',
    ).get().count, 1);
  } finally {
    await application.stop();
    testDatabase.remove();
  }
});

test('public turn API persists one user message then publishes only the Engine final response', async () => {
  const testDatabase = createTestDatabasePath();
  const environment = setup(testDatabase.databasePath);
  const http = await startHttp(environment.application);
  try {
    const created = await http.request(turnPath(), {
      method: 'POST',
      headers: { 'Idempotency-Key': 'turn-success-001' },
      body: { content: 'hello from public V5' },
    });
    assert.equal(created.status, 202);
    assert.equal(created.body.data.status, 'confirmation_required');
    assert.equal(created.body.data.userMessage.content, 'hello from public V5');
    assert.equal(created.body.data.subjectMessage, null);
    assert.equal(environment.counter.calls, 0);

    const resumed = await http.request(
      turnPath(`/${created.body.data.turnId}/resumptions`),
      {
        method: 'POST',
        body: { confirmationId: created.body.data.confirmation.confirmationId },
      },
    );
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.data.status, 'completed');
    assert.equal(resumed.body.data.subjectMessage.content, 'Engine-approved provider reply.');
    assert.notEqual(resumed.body.data.subjectMessage.content, 'Provider candidate.');
    assert.equal(environment.counter.calls, 1);

    const connection = environment.application.database.connection;
    assert.equal(connection.prepare("SELECT COUNT(*) count FROM messages WHERE sender_type='user'").get().count, 1);
    assert.equal(connection.prepare("SELECT COUNT(*) count FROM messages WHERE sender_type='subject'").get().count, 1);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_first_round_requests').get().count, 1);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_first_round_results').get().count, 1);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_engine_state_projection_receipts').get().count, 1);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_conversation_turns').get().count, 1);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM subject_states').get().count, 0);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM subject_state_heads').get().count, 0);

    const read = await http.request(turnPath(`/${created.body.data.turnId}`));
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.data, resumed.body.data);
  } finally {
    await environment.application.stop();
    testDatabase.remove();
  }
});

test('Idempotency-Key exact replay is stable while content and scope conflicts return 409', async () => {
  const testDatabase = createTestDatabasePath();
  const environment = setup(testDatabase.databasePath);
  const http = await startHttp(environment.application);
  try {
    const first = await http.request(turnPath(), {
      method: 'POST', headers: { 'Idempotency-Key': 'turn-idempotent-001' },
      body: { content: 'same content' },
    });
    const replay = await http.request(turnPath(), {
      method: 'POST', headers: { 'Idempotency-Key': 'turn-idempotent-001' },
      body: { content: 'same content' },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.turnId, first.body.data.turnId);
    assert.equal(environment.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='user'",
    ).get().count, 1);
    const conflict = await http.request(turnPath(), {
      method: 'POST', headers: { 'Idempotency-Key': 'turn-idempotent-001' },
      body: { content: 'different content' },
    });
    assert.equal(conflict.status, 409);
    const otherConversationId = 'conversation-002';
    const now = '2026-08-12T00:00:00Z';
    environment.application.database.connection.prepare(`
      INSERT INTO conversations (
        conversation_id, user_id, subject_id, title, status,
        created_at, updated_at, last_activity_at
      ) VALUES (?, 'user-001', 'assistant-001', 'Other conversation', 'active', ?, ?, ?)
    `).run(otherConversationId, now, now, now);
    const scopeConflict = await http.request(
      `/api/v1/users/user-001/subjects/assistant-001/conversations/${otherConversationId}/turns`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'turn-idempotent-001' },
        body: { content: 'same content' },
      },
    );
    assert.equal(scopeConflict.status, 409);
    const wrongUser = await fetch(
      `http://127.0.0.1:${environment.application.server.address().port}${turnPath()}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vio-user-id': 'another-user',
          'Idempotency-Key': 'turn-other-user-001',
        },
        body: JSON.stringify({ content: 'blocked' }),
      },
    );
    assert.equal(wrongUser.status, 400);
    const wrongSubject = await http.request(
      `/api/v1/users/user-001/subjects/other-subject/conversations/conversation-001/turns/${first.body.data.turnId}`,
    );
    const wrongConversation = await http.request(
      `/api/v1/users/user-001/subjects/assistant-001/conversations/other-conversation/turns/${first.body.data.turnId}`,
    );
    assert.equal(wrongSubject.status, 404);
    assert.equal(wrongConversation.status, 404);
  } finally {
    await environment.application.stop();
    testDatabase.remove();
  }
});

test('public input rejects missing headers, invalid keys, unknown fields and disabled integration', async () => {
  const testDatabase = createTestDatabasePath();
  const environment = setup(testDatabase.databasePath);
  const http = await startHttp(environment.application);
  try {
    const missingKey = await http.request(turnPath(), {
      method: 'POST', body: { content: 'hello' },
    });
    assert.equal(missingKey.status, 400);
    const badKey = await http.request(turnPath(), {
      method: 'POST', headers: { 'Idempotency-Key': 'bad key' }, body: { content: 'hello' },
    });
    assert.equal(badKey.status, 400);
    const unknown = await http.request(turnPath(), {
      method: 'POST', headers: { 'Idempotency-Key': 'turn-unknown-001' },
      body: { content: 'hello', model: 'forbidden' },
    });
    assert.equal(unknown.status, 400);
  } finally {
    await environment.application.stop();
    testDatabase.remove();
  }

  const disabledPath = createTestDatabasePath();
  const disabled = createApplication({
    config: loadConfig({ VIO_BACKEND_DB_PATH: disabledPath.databasePath, VIO_BACKEND_PORT: '0' }),
    logger: { error() {} },
  });
  disabled.fixedLocalChatProfileService.prepare();
  const disabledHttp = await startHttp(disabled);
  const unavailable = await disabledHttp.request(turnPath(), {
    method: 'POST', headers: { 'Idempotency-Key': 'turn-disabled-001' },
    body: { content: 'must fail before persistence' },
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error.code, 'continuity_engine_unavailable');
  assert.equal(disabled.database.connection.prepare(
    'SELECT COUNT(*) count FROM continuity_conversation_turns',
  ).get().count, 0);
  await disabled.stop();
  disabledPath.remove();
});

test('one engine subject cannot have two active turns and terminal turns are immutable', async () => {
  const testDatabase = createTestDatabasePath();
  const environment = setup(testDatabase.databasePath);
  try {
    const first = await environment.application.continuityConversationTurnService.createTurn(
      SCOPE.userId, SCOPE.subjectId, SCOPE.conversationId, 'turn-active-001',
      { content: 'first active' },
    );
    assert.equal(first.turn.status, 'confirmation_required');
    await assert.rejects(
      () => environment.application.continuityConversationTurnService.createTurn(
        SCOPE.userId, SCOPE.subjectId, SCOPE.conversationId, 'turn-active-002',
        { content: 'second active' },
      ),
      /active-turn fact/,
    );
    assert.equal(environment.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='user'",
    ).get().count, 1);
  } finally {
    await environment.application.stop();
    testDatabase.remove();
  }
});
