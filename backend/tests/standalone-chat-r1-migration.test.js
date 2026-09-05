import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from '../src/config.js';
import { createSqliteDatabase } from '../src/integrations/database/sqlite-database.js';
import { createSqliteStandaloneChatRepository } from '../src/integrations/database/sqlite-standalone-chat-repository.js';
import {
  approveAndResumeTurn,
  createCompletedTurn,
  createStandaloneChatFixture,
  responseTurn,
} from '../test-support/standalone-chat-r1-fixtures.js';

const MIGRATION = '025_create_standalone_chat_ledger.sql';
const TABLES = Object.freeze([
  'standalone_chat_default_conversations',
  'standalone_chat_turns',
  'standalone_chat_model_executions',
  'standalone_chat_budget_approvals',
  'standalone_chat_provider_attempts',
  'standalone_chat_usage_facts',
  'standalone_chat_provider_results',
  'standalone_chat_recovery_actions',
]);

function activePersonalSession(connection, userId) {
  const session = connection.prepare(`
    SELECT session_id,expires_at
    FROM personal_sessions
    WHERE user_id=? AND revoked_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);
  assert.ok(session);
  return session;
}

async function seedReadyTurnWithApprovedFacts(f, key) {
  const created = await f.call('/chat/turns', 'POST', {
    content: `Direct migration guard fixture ${key}.`,
  }, { 'idempotency-key': key });
  const turn = responseTurn(created);
  assert.equal(turn.status, 'waiting_confirmation', JSON.stringify(created));
  const confirmationId = turn.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${confirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const db = f.app.database.connection;
  const session = activePersonalSession(db, f.ownerId);
  const security = f.app.securityService.checkSecurity(f.ownerId, {
    subjectId: null,
    resourceType: 'api',
    resourceId: f.providerId,
    action: 'execute',
    operationType: 'privacy_access_request',
    sensitiveDataCategories: ['private_record'],
    confirmationId,
    securitySessionId: session.session_id,
  }, { minimumRiskLevel: 'high' });
  assert.equal(security.decision, 'allow');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE standalone_chat_turns
    SET status='ready',confirmation_id=NULL,confirmation_kind=NULL,
        public_failure_code=NULL,recovery_reason=NULL,updated_at=?
    WHERE turn_id=? AND status='waiting_confirmation'
  `).run(now, turn.turnId);
  const model = db.prepare(`
    SELECT m.model_id,m.model_name,p.api_provider_id,p.provider_type,p.interface_format
    FROM models m JOIN api_providers p
      ON p.owner_user_id=m.owner_user_id AND p.api_provider_id=m.provider_id
    WHERE m.owner_user_id=? AND m.model_id=?
  `).get(f.ownerId, f.modelId);
  const binding = db.prepare(`
    SELECT credential_binding_id FROM api_provider_credential_bindings
    WHERE owner_user_id=? AND provider_id=? AND status='active'
  `).get(f.ownerId, f.providerId);
  const budget = db.prepare(`
    SELECT token_budget_id FROM token_budgets
    WHERE user_id=? AND subject_id=? AND status='enabled'
  `).get(f.ownerId, f.firstAssistantId);
  assert.ok(model);
  assert.ok(binding);
  assert.ok(budget);
  return {
    turn,
    session,
    now,
    model,
    binding,
    budget,
    security,
    requestHash: `sha256:${'a'.repeat(64)}`,
    securityFactsHash: `sha256:${'b'.repeat(64)}`,
    budgetFactsHash: `sha256:${'c'.repeat(64)}`,
  };
}

function insertExecutionDirect(connection, f, facts, {
  executionId = randomUUID(),
  status = 'prepared',
  providerCallMayHaveStarted = 0,
} = {}) {
  connection.prepare(`
    INSERT INTO standalone_chat_model_executions (
      execution_id,turn_id,user_id,assistant_id,conversation_id,
      provider_id,model_id,credential_binding_id,token_budget_id,budget_session_id,
      provider_type,provider_interface_format,model_name,
      permission_decision,security_decision,budget_decision,estimated_tokens,
      security_audit_log_id,permission_id,permission_updated_at,
      security_facts_hash,budget_facts_hash,budget_approval_id,max_output_tokens,
      request_hash,status,provider_call_may_have_started,started_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'allow','allow','allow',4096,?,?,?,?,?,NULL,4096,?,?,?,?,?)
  `).run(
    executionId,
    facts.turn.turnId,
    f.ownerId,
    f.firstAssistantId,
    facts.turn.conversationId,
    f.providerId,
    f.modelId,
    facts.binding.credential_binding_id,
    facts.budget.token_budget_id,
    facts.turn.conversationId,
    facts.model.provider_type,
    facts.model.interface_format,
    facts.model.model_name,
    facts.security.auditLogId,
    facts.security.permission.permissionId,
    facts.security.permission.permissionUpdatedAt,
    facts.securityFactsHash,
    facts.budgetFactsHash,
    facts.requestHash,
    status,
    providerCallMayHaveStarted,
    facts.now,
    facts.now,
  );
  return executionId;
}

function insertAttemptDirect(connection, f, facts, executionId, {
  status,
  providerCallMayHaveStarted,
}) {
  connection.prepare(`
    INSERT INTO standalone_chat_provider_attempts (
      attempt_id,execution_id,turn_id,user_id,assistant_id,conversation_id,
      attempt_number,security_audit_log_id,permission_id,permission_updated_at,
      security_facts_hash,budget_facts_hash,budget_approval_id,request_hash,
      status,provider_call_may_have_started,started_at,completed_at
    ) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,NULL,?,?,?,?,?)
  `).run(
    randomUUID(),
    executionId,
    facts.turn.turnId,
    f.ownerId,
    f.firstAssistantId,
    facts.turn.conversationId,
    facts.security.auditLogId,
    facts.security.permission.permissionId,
    facts.security.permission.permissionUpdatedAt,
    facts.securityFactsHash,
    facts.budgetFactsHash,
    facts.requestHash,
    status,
    providerCallMayHaveStarted,
    facts.now,
    status === 'in_flight' ? null : facts.now,
  );
}

test('R1 migration 025 installs fresh with complete ledger constraints and no foreign-key errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'vio-r1-fresh-migration-'));
  const databasePath = join(root, 'fresh.sqlite');
  const database = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: databasePath }));
  try {
    assert.equal(database.connection.prepare(
      'SELECT count(*) AS n FROM schema_migrations WHERE version=?',
    ).get(MIGRATION).n, 1);
    for (const table of TABLES) {
      assert.equal(database.connection.prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?",
      ).get(table).n, 1, table);
    }
    assert.equal(database.connection.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_standalone_chat_one_active_turn'",
    ).get().n, 1);
    assert.equal(database.connection.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE '%standalone%'",
    ).get().n >= 20, true);
    const recoveryColumns = database.connection.prepare(
      "PRAGMA table_info('standalone_chat_recovery_actions')",
    ).all().map(({ name }) => name);
    for (const column of ['input_json', 'turn_status_before', 'attempt_count_before']) {
      assert.equal(recoveryColumns.includes(column), true, column);
    }
    const executionColumns = database.connection.prepare(
      "PRAGMA table_info('standalone_chat_model_executions')",
    ).all().map(({ name }) => name);
    for (const column of [
      'permission_id',
      'permission_updated_at',
      'security_facts_hash',
      'budget_facts_hash',
      'budget_approval_id',
      'max_output_tokens',
    ]) assert.equal(executionColumns.includes(column), true, column);
    const attemptColumns = database.connection.prepare(
      "PRAGMA table_info('standalone_chat_provider_attempts')",
    ).all().map(({ name }) => name);
    for (const column of [
      'permission_id',
      'permission_updated_at',
      'security_facts_hash',
      'budget_facts_hash',
      'budget_approval_id',
    ]) assert.equal(attemptColumns.includes(column), true, column);
    const ownerUniqueIndex = database.connection.prepare(
      "PRAGMA index_list('standalone_chat_turns')",
    ).all().filter(({ unique }) => unique === 1).some(({ name }) => {
      const columns = database.connection.prepare(`PRAGMA index_info('${name}')`)
        .all().map(({ name: column }) => column);
      return columns.length === 2
        && columns[0] === 'user_id'
        && columns[1] === 'idempotency_key';
    });
    assert.equal(ownerUniqueIndex, true, 'owner-wide Idempotency-Key must be unique');
    assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('R1 migration upgrades an exact 001-024 database without claiming or changing old facts', () => {
  const root = mkdtempSync(join(tmpdir(), 'vio-r1-upgrade-migration-'));
  const migrations024 = join(root, 'migrations-024');
  const databasePath = join(root, 'upgrade.sqlite');
  cpSync(resolve('migrations'), migrations024, { recursive: true });
  rmSync(join(migrations024, MIGRATION));
  try {
    const before = createSqliteDatabase({ databasePath, migrationsPath: migrations024 });
    before.connection.prepare(`
      INSERT INTO users (
        user_id, primary_email, display_name, status, created_at, updated_at
      ) VALUES ('retained-r1-owner', NULL, 'Retained before R1', 'active', ?, ?)
    `).run('2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z');
    const previousMigrationCount = before.connection.prepare(
      'SELECT count(*) AS n FROM schema_migrations',
    ).get().n;
    assert.equal(previousMigrationCount, 24);
    before.close();

    const upgraded = createSqliteDatabase(loadConfig({ VIO_BACKEND_DB_PATH: databasePath }));
    assert.deepEqual({ ...upgraded.connection.prepare(
      "SELECT user_id,display_name,status FROM users WHERE user_id='retained-r1-owner'",
    ).get() }, {
      user_id: 'retained-r1-owner',
      display_name: 'Retained before R1',
      status: 'active',
    });
    assert.equal(upgraded.connection.prepare(
      'SELECT count(*) AS n FROM schema_migrations',
    ).get().n, previousMigrationCount + 1);
    for (const table of TABLES) {
      assert.equal(upgraded.connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    }
    assert.deepEqual(upgraded.connection.prepare('PRAGMA foreign_key_check').all(), []);
    upgraded.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('R1 migration 025 failure rolls back the whole migration and preserves 001-024', () => {
  const root = mkdtempSync(join(tmpdir(), 'vio-r1-rollback-migration-'));
  const migrations024 = join(root, 'migrations-024');
  const broken = join(root, 'migrations-broken');
  const databasePath = join(root, 'rollback.sqlite');
  cpSync(resolve('migrations'), migrations024, { recursive: true });
  rmSync(join(migrations024, MIGRATION));
  try {
    const before = createSqliteDatabase({ databasePath, migrationsPath: migrations024 });
    before.close();
    cpSync(resolve('migrations'), broken, { recursive: true });
    const migrationPath = join(broken, MIGRATION);
    writeFileSync(
      migrationPath,
      `${readFileSync(migrationPath, 'utf8')}\nINVALID R1 MIGRATION SQL;\n`,
      'utf8',
    );
    assert.throws(
      () => createSqliteDatabase({ databasePath, migrationsPath: broken }),
      /025_create_standalone_chat_ledger/,
    );
    const inspected = new DatabaseSync(databasePath);
    assert.equal(inspected.prepare(
      'SELECT count(*) AS n FROM schema_migrations',
    ).get().n, 24);
    assert.equal(inspected.prepare(
      'SELECT count(*) AS n FROM schema_migrations WHERE version=?',
    ).get(MIGRATION).n, 0);
    for (const table of TABLES) {
      assert.equal(inspected.prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?",
      ).get(table).n, 0, table);
    }
    assert.deepEqual(inspected.prepare('PRAGMA foreign_key_check').all(), []);
    inspected.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('R1 raw ledger inserts reject non-initial turn, execution, attempt and recovery states', async (t) => {
  await t.test('turn must begin processing without terminal fields', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const db = f.app.database.connection;
    const created = await f.call('/chat/turns', 'POST', {
      content: 'Raw turn must begin from processing.',
    }, { 'idempotency-key': 'raw-turn-state-source-0001' });
    assert.equal(responseTurn(created).status, 'waiting_confirmation');
    const source = db.prepare(`
      SELECT * FROM standalone_chat_turns WHERE turn_id=?
    `).get(responseTurn(created).turnId);
    const insert = db.prepare(`
      INSERT INTO standalone_chat_turns(
        turn_id,user_id,assistant_id,conversation_id,created_by_session_id,
        idempotency_key,input_content_hash,user_message_id,user_message_version_id,
        source_event_id,status,created_at,updated_at,completed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const args = (status, completedAt = null) => [
      randomUUID(),
      source.user_id,
      source.assistant_id,
      source.conversation_id,
      source.created_by_session_id,
      `raw-turn-${randomUUID()}`,
      source.input_content_hash,
      source.user_message_id,
      source.user_message_version_id,
      source.source_event_id,
      status,
      source.created_at,
      source.created_at,
      completedAt,
    ];
    assert.throws(
      () => insert.run(...args('ready')),
      /initial|processing/i,
    );
    assert.throws(
      () => insert.run(...args('processing', new Date().toISOString())),
      /begin|initial|terminal|CHECK constraint/i,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM standalone_chat_turns').get().n, 1);
  });

  await t.test('execution must begin prepared', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const facts = await seedReadyTurnWithApprovedFacts(f, 'raw-execution-state-0001');
    assert.throws(
      () => insertExecutionDirect(
        f.app.database.connection,
        f,
        facts,
        { status: 'retryable', providerCallMayHaveStarted: 0 },
      ),
      /approved current configuration|initial|prepared/i,
    );
    assert.equal(f.app.database.connection.prepare(
      'SELECT count(*) n FROM standalone_chat_model_executions',
    ).get().n, 0);
  });

  await t.test('Provider attempt must begin prepared', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const facts = await seedReadyTurnWithApprovedFacts(f, 'raw-attempt-state-0001');
    const executionId = insertExecutionDirect(f.app.database.connection, f, facts);
    assert.throws(
      () => insertAttemptDirect(
        f.app.database.connection,
        f,
        facts,
        executionId,
        { status: 'retryable', providerCallMayHaveStarted: 0 },
      ),
      /initial|prepared|safely retryable/i,
    );
    assert.equal(f.app.database.connection.prepare(
      'SELECT count(*) n FROM standalone_chat_provider_attempts',
    ).get().n, 0);
  });

  await t.test('recovery action must begin pending', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const created = await f.call('/chat/turns', 'POST', {
      content: 'Raw recovery action must begin pending.',
    }, { 'idempotency-key': 'raw-recovery-state-turn-0001' });
    const turn = responseTurn(created);
    assert.equal(turn.status, 'waiting_confirmation');
    const now = new Date().toISOString();
    assert.throws(() => f.app.database.connection.prepare(`
      INSERT INTO standalone_chat_recovery_actions(
        recovery_action_id,user_id,assistant_id,conversation_id,turn_id,
        idempotency_key,action_type,content_hash,input_json,turn_status_before,
        attempt_count_before,status,created_at,completed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,? ,0,'completed',?,?)
    `).run(
      randomUUID(),
      f.ownerId,
      f.firstAssistantId,
      turn.conversationId,
      turn.turnId,
      'raw-completed-recovery-0001',
      'resume',
      `sha256:${'e'.repeat(64)}`,
      '{"action":"resume"}',
      'waiting_confirmation',
      now,
      now,
    ), /initial|pending/i);
    assert.equal(f.app.database.connection.prepare(
      'SELECT count(*) n FROM standalone_chat_recovery_actions',
    ).get().n, 0);
  });
});

test('R1 expired personal session cannot form a budget approval fact', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const budget = f.app.proactiveInteractionService.upsertTokenBudget(
    f.ownerId,
    f.firstAssistantId,
    {
      dailyTokenLimit: 1,
      sessionTokenLimit: 1,
      overagePolicy: 'require_confirmation',
      status: 'enabled',
    },
  );
  f.app.permissionService.createPermission(f.ownerId, {
    subjectId: f.firstAssistantId,
    resourceType: 'proactive_interaction',
    resourceId: budget.tokenBudgetId,
    action: 'execute',
    permissionLevel: 'always_allow',
    status: 'active',
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'An expired session cannot approve budget use.',
  }, { 'idempotency-key': 'expired-session-budget-turn-0001' });
  const turn = responseTurn(created);
  assert.equal(turn.status, 'waiting_budget', JSON.stringify(created));
  const confirmationId = turn.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${confirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const db = f.app.database.connection;
  const session = activePersonalSession(db, f.ownerId);
  const estimatedTokens = 5_000;
  const checked = f.app.proactiveInteractionService.checkTokenBudget(
    f.ownerId,
    f.firstAssistantId,
    {
      estimatedTokens,
      budgetSessionId: turn.conversationId,
      confirmationId,
      securitySessionId: session.session_id,
    },
  );
  assert.equal(checked.decision, 'allow');
  db.prepare('UPDATE personal_sessions SET expires_at=? WHERE session_id=?')
    .run('2000-01-01T00:00:00.000Z', session.session_id);
  assert.throws(() => db.prepare(`
    INSERT INTO standalone_chat_budget_approvals(
      budget_approval_id,turn_id,user_id,assistant_id,conversation_id,
      target_attempt_number,token_budget_id,budget_session_id,estimated_tokens,
      daily_token_limit,session_token_limit,overage_policy,budget_updated_at,
      daily_projected,session_projected,request_hash,budget_facts_hash,
      confirmation_id,security_audit_log_id,approved_by_session_id,approved_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    randomUUID(),
    turn.turnId,
    f.ownerId,
    f.firstAssistantId,
    turn.conversationId,
    1,
    checked.budget.tokenBudgetId,
    turn.conversationId,
    estimatedTokens,
    checked.budget.dailyTokenLimit,
    checked.budget.sessionTokenLimit,
    checked.budget.overagePolicy,
    checked.budget.updatedAt,
    checked.projection.dailyProjected,
    checked.projection.sessionProjected,
    `sha256:${'f'.repeat(64)}`,
    `sha256:${'0'.repeat(64)}`,
    confirmationId,
    checked.security.auditLogId,
    session.session_id,
    new Date().toISOString(),
  ), /expired|matching consumed facts/i);
  assert.equal(db.prepare(
    'SELECT count(*) n FROM standalone_chat_budget_approvals',
  ).get().n, 0);
});

test('R1 completed ledger facts are immutable and cannot be deleted outside governed owner deletion', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const budget = f.app.proactiveInteractionService.upsertTokenBudget(
    f.ownerId,
    f.firstAssistantId,
    {
      dailyTokenLimit: 1,
      sessionTokenLimit: 1,
      overagePolicy: 'require_confirmation',
      status: 'enabled',
    },
  );
  f.app.permissionService.createPermission(f.ownerId, {
    subjectId: f.firstAssistantId,
    resourceType: 'proactive_interaction',
    resourceId: budget.tokenBudgetId,
    action: 'execute',
    permissionLevel: 'always_allow',
    status: 'active',
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Immutable standalone history.',
  }, { 'idempotency-key': 'immutable-r1-turn-0001' });
  const budgetTurn = responseTurn(created);
  assert.equal(budgetTurn.status, 'waiting_budget', JSON.stringify(created));
  const budgetConfirmationId = budgetTurn.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${budgetConfirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const waitingSecurity = await f.call(`/chat/turns/${budgetTurn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: budgetConfirmationId,
  }, { 'idempotency-key': 'immutable-r1-budget-resume-0001' });
  const securityTurn = responseTurn(waitingSecurity);
  assert.equal(securityTurn.status, 'waiting_confirmation', JSON.stringify(waitingSecurity));
  const securityConfirmationId = securityTurn.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${securityConfirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const completedResponse = await f.call(`/chat/turns/${securityTurn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: securityConfirmationId,
  }, { 'idempotency-key': 'immutable-r1-security-resume-0001' });
  const completed = { turn: responseTurn(completedResponse) };
  assert.equal(completed.turn.status, 'completed', JSON.stringify(completedResponse));
  const db = f.app.database.connection;
  const turnId = completed.turn.turnId;
  assert.throws(
    () => db.prepare('UPDATE standalone_chat_turns SET input_content_hash=? WHERE turn_id=?')
      .run(`sha256:${'1'.repeat(64)}`, turnId),
    /immutable/,
  );
  assert.throws(
    () => db.prepare('UPDATE standalone_chat_usage_facts SET total_tokens=0 WHERE turn_id=?')
      .run(turnId),
    /immutable/,
  );
  assert.throws(
    () => db.prepare('UPDATE standalone_chat_provider_results SET finish_reason=? WHERE turn_id=?')
      .run('changed', turnId),
    /immutable/,
  );
  assert.throws(
    () => db.prepare(`
      UPDATE standalone_chat_budget_approvals SET budget_facts_hash=? WHERE turn_id=?
    `).run(`sha256:${'3'.repeat(64)}`, turnId),
    /immutable/,
  );
  assert.throws(
    () => db.prepare('UPDATE standalone_chat_turns SET idempotency_key=? WHERE turn_id=?')
      .run('changed-owner-key-0001', turnId),
    /immutable/,
  );
  const recovery = db.prepare(`
    SELECT recovery_action_id FROM standalone_chat_recovery_actions WHERE turn_id=? LIMIT 1
  `).get(turnId);
  assert.ok(recovery);
  for (const [column, value] of [
    ['input_json', '{"action":"cancel"}'],
    ['turn_status_before', 'retryable'],
    ['attempt_count_before', 99],
  ]) {
    assert.throws(
      () => db.prepare(`
        UPDATE standalone_chat_recovery_actions SET ${column}=? WHERE recovery_action_id=?
      `).run(value, recovery.recovery_action_id),
      /immutable/,
      column,
    );
  }
  for (const table of TABLES) {
    assert.throws(
      () => db.prepare(`DELETE FROM ${table}`).run(),
      /governed retention/,
      table,
    );
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('R1 database state machine permits not-sent retry but forbids retry after outcome_unknown', async (t) => {
  let calls = 0;
  const responses = [
    {
      status: 'FAILED_RETRYABLE', output: null, usage: null,
      errorCode: 'PROVIDER_CONNECTION_FAILED', requestMayHaveBeenSent: false,
      startedAt: '2026-09-05T00:00:01.000Z', completedAt: '2026-09-05T00:00:02.000Z',
      cost: { status: 'not_incurred', amountMicros: null, currency: null },
    },
    {
      status: 'SUCCEEDED',
      output: { responseCandidate: 'Second attempt is safe.', finishReason: 'stop' },
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      errorCode: null,
      requestMayHaveBeenSent: true,
      startedAt: '2026-09-05T00:00:03.000Z', completedAt: '2026-09-05T00:00:04.000Z',
      cost: { status: 'not_reported', amountMicros: null, currency: null },
    },
  ];
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      modelExecutor: { async executeChat() { calls += 1; return responses.shift(); } },
    },
  });
  const created = await f.call('/chat/turns', 'POST', { content: 'Not sent transition.' }, {
    'idempotency-key': 'migration-not-sent-0001',
  });
  const confirmationId = responseTurn(created).confirmation.confirmationId;
  await f.call(`/confirmations/${confirmationId}/decision`, 'POST', { decision: 'approve' });
  const first = await f.call(`/chat/turns/${responseTurn(created).turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'migration-not-sent-resume-0001' });
  assert.equal(responseTurn(first).status, 'retryable');
  const execution = f.app.database.connection.prepare(
    'SELECT * FROM standalone_chat_model_executions',
  ).get();
  const attempt = f.app.database.connection.prepare(
    'SELECT * FROM standalone_chat_provider_attempts',
  ).get();
  assert.equal(attempt.status, 'not_sent');
  assert.equal(execution.status, 'retryable');
  assert.equal(calls, 1);
  assert.throws(() => f.app.database.connection.prepare(`
    UPDATE standalone_chat_provider_attempts
    SET provider_call_may_have_started=1
    WHERE attempt_id=? AND status='not_sent'
  `).run(attempt.attempt_id), /CHECK constraint|not.sent|immutable/i);
  assert.deepEqual({ ...f.app.database.connection.prepare(`
    SELECT status,provider_call_may_have_started AS mayHaveStarted
    FROM standalone_chat_provider_attempts WHERE attempt_id=?
  `).get(attempt.attempt_id) }, { status: 'not_sent', mayHaveStarted: 0 });
  const retry = await f.call(`/chat/turns/${responseTurn(first).turnId}/recovery`, 'POST', {
    action: 'retry',
  }, { 'idempotency-key': 'migration-safe-retry-0001' });
  const retryConfirmation = responseTurn(retry).confirmation.confirmationId;
  await f.call(`/confirmations/${retryConfirmation}/decision`, 'POST', { decision: 'approve' });
  const completed = await f.call(`/chat/turns/${responseTurn(first).turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: retryConfirmation,
  }, { 'idempotency-key': 'migration-safe-retry-resume-0001' });
  assert.equal(responseTurn(completed).status, 'completed');
  assert.equal(calls, 2);
  assert.equal(f.app.database.connection.prepare(
    'SELECT count(*) AS n FROM standalone_chat_provider_attempts',
  ).get().n, 2);

  const unknownFixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'disconnect' }],
  });
  const unknownCreated = await unknownFixture.call('/chat/turns', 'POST', {
    content: 'Unknown attempt cannot be retried.',
  }, { 'idempotency-key': 'migration-unknown-turn-0001' });
  const unknown = await approveAndResumeTurn(
    unknownFixture,
    unknownCreated,
    'migration-unknown-turn-0001',
  );
  assert.equal(unknown.turn.status, 'outcome_unknown');
  const unknownDb = unknownFixture.app.database.connection;
  const unknownExecution = unknownDb.prepare(
    'SELECT * FROM standalone_chat_model_executions WHERE turn_id=?',
  ).get(unknown.turn.turnId);
  const unknownAttempt = unknownDb.prepare(
    'SELECT * FROM standalone_chat_provider_attempts WHERE turn_id=?',
  ).get(unknown.turn.turnId);
  assert.throws(() => unknownDb.prepare(`
      INSERT INTO standalone_chat_provider_attempts (
        attempt_id,execution_id,turn_id,user_id,assistant_id,conversation_id,
        attempt_number,security_audit_log_id,permission_id,permission_updated_at,
        security_facts_hash,budget_facts_hash,budget_approval_id,request_hash,status,
        provider_call_may_have_started,started_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,'prepared',0,?)
  `).run(
    'forbidden-unknown-attempt',
    unknownExecution.execution_id,
    unknownExecution.turn_id,
    unknownExecution.user_id,
    unknownExecution.assistant_id,
    unknownExecution.conversation_id,
    2,
    unknownAttempt.security_audit_log_id,
    unknownAttempt.permission_id,
    unknownAttempt.permission_updated_at,
    unknownAttempt.security_facts_hash,
    unknownAttempt.budget_facts_hash,
    unknownAttempt.request_hash,
    '2026-09-05T00:00:05.000Z',
  ), /safely retryable/);
  assert.throws(() => unknownDb.prepare(`
    UPDATE standalone_chat_provider_attempts
    SET status='response_received'
    WHERE attempt_id=?
  `).run(unknownAttempt.attempt_id), /immutable|not allowed/i);
  assert.throws(() => unknownDb.prepare(`
    UPDATE standalone_chat_model_executions
    SET status='succeeded'
    WHERE execution_id=?
  `).run(unknownExecution.execution_id), /immutable|not allowed/i);
  assert.throws(() => unknownDb.prepare(`
    UPDATE standalone_chat_turns
    SET status='result_ready'
    WHERE turn_id=?
  `).run(unknown.turn.turnId), /not allowed|durably recorded/i);
  assert.equal(unknownDb.prepare(
    'SELECT status FROM standalone_chat_provider_attempts WHERE attempt_id=?',
  ).get(unknownAttempt.attempt_id).status, 'outcome_unknown');
  assert.equal(unknownDb.prepare(
    'SELECT status FROM standalone_chat_model_executions WHERE execution_id=?',
  ).get(unknownExecution.execution_id).status, 'outcome_unknown');
  assert.equal(unknownDb.prepare(
    'SELECT status FROM standalone_chat_turns WHERE turn_id=?',
  ).get(unknown.turn.turnId).status, 'outcome_unknown');
  assert.deepEqual(unknownDb.prepare('PRAGMA foreign_key_check').all(), []);
});

test('R1 repository rejects any changed fact for an existing providerResultId', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const completed = await createCompletedTurn(
    f,
    'Every locked Provider result column is part of exact replay.',
    'provider-result-exact-replay-turn-0001',
  );
  const db = f.app.database.connection;
  const row = db.prepare(`
    SELECT * FROM standalone_chat_provider_results WHERE turn_id=?
  `).get(completed.turn.turnId);
  const repository = createSqliteStandaloneChatRepository(db);
  const record = {
    providerResultId: row.provider_result_id,
    executionId: row.execution_id,
    attemptId: row.attempt_id,
    usageLedgerEntryId: row.usage_ledger_entry_id,
    resultHash: row.result_hash,
    responseContentHash: row.response_content_hash,
    resultJson: row.result_json,
    finishReason: row.finish_reason,
    receivedAt: row.received_at,
  };
  assert.equal(repository.insertProviderResult(record).providerResultId, row.provider_result_id);
  for (const [field, changed] of [
    ['executionId', randomUUID()],
    ['attemptId', randomUUID()],
    ['usageLedgerEntryId', randomUUID()],
    ['resultHash', `sha256:${'1'.repeat(64)}`],
    ['responseContentHash', `sha256:${'2'.repeat(64)}`],
    ['resultJson', '{"finishReason":"changed","responseCandidate":"changed"}'],
    ['finishReason', 'changed'],
    ['receivedAt', '2026-09-06T00:00:00.000Z'],
  ]) {
    assert.throws(
      () => repository.insertProviderResult({ ...record, [field]: changed }),
      /different|conflict/i,
      field,
    );
  }
});

test('R1 repository rejects a retry attempt whose request hash differs from the execution snapshot', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      modelExecutor: {
        async executeChat() {
          return {
            status: 'FAILED_RETRYABLE', output: null, usage: null,
            errorCode: 'PROVIDER_DNS_FAILED', requestMayHaveBeenSent: false,
            startedAt: '2026-09-05T00:00:01.000Z', completedAt: '2026-09-05T00:00:02.000Z',
            cost: { status: 'not_incurred', amountMicros: null, currency: null },
          };
        },
      },
    },
  });
  const created = await f.call('/chat/turns', 'POST', { content: 'Lock the execution request hash.' }, {
    'idempotency-key': 'attempt-request-hash-turn-0001',
  });
  const failed = await approveAndResumeTurn(f, created, 'attempt-request-hash-turn-0001');
  assert.equal(failed.turn.status, 'retryable');
  const db = f.app.database.connection;
  const repository = createSqliteStandaloneChatRepository(db);
  const execution = repository.findExecutionByTurn(failed.turn.turnId);
  repository.transitionExecution(execution.executionId, 'retryable', 'prepared', {
    updatedAt: '2026-09-05T00:00:03.000Z',
  });
  const audit = db.prepare(`
    SELECT security_audit_log_id AS auditId
    FROM standalone_chat_provider_attempts WHERE execution_id=? LIMIT 1
  `).get(execution.executionId);
  assert.throws(() => repository.startAttempt({
    attemptId: randomUUID(),
    executionId: execution.executionId,
    securityAuditLogId: audit.auditId,
    permissionId: execution.permissionId,
    permissionUpdatedAt: execution.permissionUpdatedAt,
    securityFactsHash: execution.securityFactsHash,
    budgetFactsHash: execution.budgetFactsHash,
    budgetApprovalId: execution.budgetApprovalId,
    requestHash: `sha256:${'f'.repeat(64)}`,
    startedAt: '2026-09-05T00:00:03.000Z',
  }), /request hash|snapshot|retryable/i);
});
