import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { runMigrations } from '../src/integrations/database/migrations.js';

import {
  createTestDatabasePath,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

async function createUserAndSubject(baseUrl, email) {
  const user = await postJson(baseUrl, '/api/v1/users', { email });
  const userId = user.body.data.userId;
  const subject = await postJson(baseUrl, `/api/v1/users/${userId}/subjects`, {
    name: 'Life Assistant',
    basicSettings: {},
  });
  return { userId, subjectId: subject.body.data.subjectId };
}

async function grant(baseUrl, userId, subjectId, resourceId, actions) {
  for (const action of actions) {
    const created = await postJson(baseUrl, `/api/v1/users/${userId}/permissions`, {
      subjectId,
      resourceType: 'life_data',
      resourceId,
      action,
      permissionLevel: 'always_allow',
    });
    assert.equal(created.response.status, 201);
  }
}

async function confirmed(baseUrl, userId, request, payload = {}, created = false) {
  const first = await request(payload);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.operationStatus, 'confirmation_required');
  assert.equal(first.body.data.result, null);
  assert.equal(first.body.data.access.risk.level, 'high');
  assert.equal(first.body.data.access.executionStatus, 'not_executed');
  const confirmationId = first.body.data.access.confirmation.confirmationId;
  const approval = await patchJson(
    baseUrl,
    `/api/v1/users/${userId}/confirmations/${confirmationId}`,
    { decision: 'approve' },
  );
  assert.equal(approval.response.status, 200);
  const completed = await request({ ...payload, confirmationId });
  assert.equal(completed.response.status, created ? 201 : 200);
  assert.equal(completed.body.data.operationStatus, 'completed');
  assert.equal(completed.body.data.access.decision, 'allow');
  assert.equal(completed.body.data.access.executionStatus, 'not_executed');
  return completed.body.data.result;
}

const PRE_LIFE_MIGRATIONS = Object.freeze([
  '001_create_users_and_subjects.sql',
  '002_create_events.sql',
  '003_create_api_providers_and_models.sql',
  '004_create_permissions.sql',
  '005_create_security_system.sql',
  '006_create_conversations_messages_and_events.sql',
  '007_create_context_summaries_and_subject_states.sql',
  '008_create_assistant_global_settings.sql',
  '009_expand_model_routing_configuration.sql',
  '010_create_capability_registries.sql',
  '011_create_device_adaptation_foundation.sql',
  '012_create_custom_security_policies.sql',
  '013_create_ai_private_spaces.sql',
]);

test('migration 014 preserves existing permission, policy, confirmation and audit relationships', async () => {
  const testDatabase = createTestDatabasePath();
  const legacyMigrationsPath = join(testDatabase.directory, 'pre-life-migrations');
  mkdirSync(legacyMigrationsPath);
  for (const filename of PRE_LIFE_MIGRATIONS) {
    copyFileSync(
      new URL(`../migrations/${filename}`, import.meta.url),
      join(legacyMigrationsPath, filename),
    );
  }
  const legacy = new DatabaseSync(testDatabase.databasePath);
  legacy.exec('PRAGMA foreign_keys = ON;');
  runMigrations(legacy, legacyMigrationsPath);
  const timestamp = '2026-07-28T00:00:00.000Z';
  legacy.prepare(`
    INSERT INTO users (user_id, primary_email, display_name, status, created_at, updated_at)
    VALUES (?, ?, '', 'active', ?, ?)
  `).run('life-legacy-user', 'life-legacy@example.com', timestamp, timestamp);
  legacy.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, '{}', 'active', ?, ?)
  `).run(
    'life-legacy-subject',
    'life-legacy-user',
    'Legacy life subject',
    timestamp,
    timestamp,
  );
  legacy.prepare(`
    INSERT INTO permissions (
      permission_id, user_id, subject_id, resource_type, resource_id,
      action, permission_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'private_domain', ?, 'read', 'always_allow', 'active', ?, ?)
  `).run(
    'life-legacy-permission',
    'life-legacy-user',
    'life-legacy-subject',
    'life-legacy-space',
    timestamp,
    timestamp,
  );
  legacy.prepare(`
    INSERT INTO security_policies (
      policy_id, user_id, resource_type, action_type, risk_level,
      rule, status, created_at, updated_at
    ) VALUES (?, ?, 'private_domain', 'read', 'high', 'always_confirm', 'active', ?, ?)
  `).run('life-legacy-policy', 'life-legacy-user', timestamp, timestamp);
  legacy.prepare(`
    INSERT INTO security_confirmations (
      confirmation_id, user_id, subject_id, operation_type, resource_type,
      resource_id, action, permission_id, permission_level, permission_updated_at,
      policy_fingerprint, confirmation_mode, risk_level, status, requested_at,
      expires_at, decided_at, consumed_at, security_policy_id,
      security_policy_updated_at, security_session_id, confirmation_reason,
      risk_description, user_choice
    ) VALUES (
      ?, ?, ?, 'privacy_access_request', 'private_domain', ?, 'read', ?,
      'always_allow', ?, ?, 'every_time', 'high', 'pending', ?, ?,
      NULL, NULL, ?, ?, NULL, ?, ?, NULL
    )
  `).run(
    'life-legacy-confirmation',
    'life-legacy-user',
    'life-legacy-subject',
    'life-legacy-space',
    'life-legacy-permission',
    timestamp,
    'legacy-fingerprint',
    timestamp,
    '2026-07-28T00:05:00.000Z',
    'life-legacy-policy',
    timestamp,
    'Legacy confirmation reason.',
    'Legacy risk description.',
  );
  legacy.prepare(`
    INSERT INTO audit_logs (
      audit_log_id, user_id, subject_id, operation_type, resource_type,
      resource_id, action, risk_level, permission_decision, confirmation_mode,
      result, reason_code, confirmation_id, occurred_at
    ) VALUES (
      ?, ?, ?, 'privacy_access_request', 'private_domain', ?, 'read', 'high',
      'allow', 'every_time', 'confirmation_required', 'confirmation_required', ?, ?
    )
  `).run(
    'life-legacy-audit',
    'life-legacy-user',
    'life-legacy-subject',
    'life-legacy-space',
    'life-legacy-confirmation',
    timestamp,
  );
  legacy.prepare(`
    INSERT INTO security_policy_session_grants (
      session_grant_id, user_id, subject_id, policy_id, policy_updated_at,
      security_session_id, resource_id, action_type, risk_level, granted_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'read', 'medium', ?, ?)
  `).run(
    'life-legacy-grant',
    'life-legacy-user',
    'life-legacy-subject',
    'life-legacy-policy',
    timestamp,
    'life-legacy-session',
    'life-legacy-space',
    timestamp,
    '2026-07-28T00:30:00.000Z',
  );
  legacy.close();

  const context = await startTestApplication(testDatabase.databasePath);
  try {
    const connection = context.application.database.connection;
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check;').all(), []);
    assert.equal(
      connection.prepare(`
        SELECT COUNT(*) AS count FROM security_policy_session_grants
        WHERE session_grant_id = 'life-legacy-grant'
      `).get().count,
      1,
    );
    for (const [path, expectedIdField, expectedId] of [
      ['/api/v1/users/life-legacy-user/permissions/life-legacy-permission', 'permissionId', 'life-legacy-permission'],
      ['/api/v1/users/life-legacy-user/security-policies/life-legacy-policy', 'policyId', 'life-legacy-policy'],
      ['/api/v1/users/life-legacy-user/confirmations/life-legacy-confirmation', 'confirmationId', 'life-legacy-confirmation'],
      ['/api/v1/users/life-legacy-user/audit-logs/life-legacy-audit', 'auditLogId', 'life-legacy-audit'],
    ]) {
      const result = await getJson(context.baseUrl, path);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.data[expectedIdField], expectedId);
    }
    const newPermission = await postJson(
      context.baseUrl,
      '/api/v1/users/life-legacy-user/permissions',
      {
        subjectId: 'life-legacy-subject',
        resourceType: 'life_data',
        resourceId: 'finance',
        action: 'read',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(newPermission.response.status, 201);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('finance records, budgets, category statistics and monthly summaries form a secured loop', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);
  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'life-finance@example.com',
    );
    await grant(context.baseUrl, userId, subjectId, 'finance', ['read', 'write', 'manage']);
    const basePath = `/api/v1/users/${userId}/subjects/${subjectId}/life/finance`;

    const income = await confirmed(
      context.baseUrl,
      userId,
      (body) => postJson(context.baseUrl, `${basePath}/records`, body),
      {
        entryType: 'income',
        category: 'salary',
        amount: '12000.50',
        currency: 'CNY',
        occurredAt: '2026-07-01T08:00:00.000Z',
        note: 'Sensitive salary note.',
      },
      true,
    );
    assert.equal(income.amount, '12000.50');
    const expense = await confirmed(
      context.baseUrl,
      userId,
      (body) => postJson(context.baseUrl, `${basePath}/records`, body),
      {
        entryType: 'expense',
        category: 'food',
        amount: 350.25,
        occurredAt: '2026-07-02T08:00:00.000Z',
      },
      true,
    );
    assert.equal(expense.amount, '350.25');

    const budget = await confirmed(
      context.baseUrl,
      userId,
      (body) => postJson(context.baseUrl, `${basePath}/budgets`, body),
      {
        month: '2026-07',
        category: 'food',
        amount: '1000.00',
        reminderRule: { enabled: true, thresholdPercent: 80 },
      },
      true,
    );
    assert.deepEqual(budget.reminderRule, { enabled: true, thresholdPercent: 80 });

    const records = await confirmed(
      context.baseUrl,
      userId,
      (body) => postJson(context.baseUrl, `${basePath}/records/query`, body),
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' },
    );
    assert.equal(records.length, 2);
    const statistics = await confirmed(
      context.baseUrl,
      userId,
      (body) => postJson(context.baseUrl, `${basePath}/statistics/categories`, body),
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' },
    );
    assert.equal(statistics.groups.length, 2);
    assert.equal(
      statistics.groups.find((group) => group.category === 'food').totalAmount,
      '350.25',
    );
    const monthly = await confirmed(
      context.baseUrl,
      userId,
      (body) => postJson(context.baseUrl, `${basePath}/summaries/monthly`, body),
      { month: '2026-07' },
    );
    assert.deepEqual(monthly.totals[0], {
      currency: 'CNY',
      recordCount: 2,
      incomeAmount: '12000.50',
      expenseAmount: '350.25',
      netAmount: '11650.25',
    });
    assert.equal(monthly.budgets.length, 1);
    assert.equal(monthly.bankSync, 'not_connected');
    assert.equal(monthly.paymentExecution, 'not_supported');

    const recordEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=life_event_created&subjectId=${subjectId}`,
    );
    const budgetEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=budget_changed&subjectId=${subjectId}`,
    );
    assert.equal(recordEvents.body.meta.count, 2);
    assert.equal(budgetEvents.body.meta.count, 1);
    const eventText = JSON.stringify([...recordEvents.body.data, ...budgetEvents.body.data]);
    assert.equal(eventText.includes('12000.50'), false);
    assert.equal(eventText.includes('Sensitive salary note.'), false);

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persisted = await confirmed(
      context.baseUrl,
      userId,
      (body) => postJson(context.baseUrl, `${basePath}/records/query`, body),
      {},
    );
    assert.equal(persisted.length, 2);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('calendar, body management and local memory remain isolated and explicitly context-controlled', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);
  try {
    const first = await createUserAndSubject(context.baseUrl, 'life-modules@example.com');
    const second = await createUserAndSubject(context.baseUrl, 'life-other@example.com');
    for (const [resourceId, actions] of [
      ['calendar', ['read', 'write']],
      ['body', ['read', 'write', 'manage']],
      ['local-memory', ['read', 'write', 'manage']],
    ]) {
      await grant(context.baseUrl, first.userId, first.subjectId, resourceId, actions);
      await grant(context.baseUrl, second.userId, second.subjectId, resourceId, ['read']);
    }
    const root = `/api/v1/users/${first.userId}/subjects/${first.subjectId}/life`;

    const calendarEntries = [];
    for (const [index, entryType] of [
      'anniversary', 'menstrual_period', 'intimate_record', 'ordinary_event',
    ].entries()) {
      calendarEntries.push(await confirmed(
        context.baseUrl,
        first.userId,
        (body) => postJson(context.baseUrl, `${root}/calendar/entries`, body),
        {
          entryType,
          title: `Private calendar entry ${index}`,
          startsAt: `2026-07-${String(index + 10).padStart(2, '0')}T08:00:00.000Z`,
          reminderRule: {
            enabled: true,
            remindAt: `2026-07-${String(index + 9).padStart(2, '0')}T08:00:00.000Z`,
          },
        },
        true,
      ));
    }
    const updatedCalendar = await confirmed(
      context.baseUrl,
      first.userId,
      (body) => patchJson(
        context.baseUrl,
        `${root}/calendar/entries/${calendarEntries[0].calendarEntryId}`,
        body,
      ),
      { title: 'Updated private anniversary' },
    );
    assert.equal(updatedCalendar.title, 'Updated private anniversary');
    const calendarQuery = await confirmed(
      context.baseUrl,
      first.userId,
      (body) => postJson(context.baseUrl, `${root}/calendar/entries/query`, body),
      {},
    );
    assert.equal(calendarQuery.length, 4);

    for (const [weightKg, measuredAt] of [
      [60.5, '2026-07-01T08:00:00.000Z'],
      [59.2, '2026-07-15T08:00:00.000Z'],
    ]) {
      const record = await confirmed(
        context.baseUrl,
        first.userId,
        (body) => postJson(context.baseUrl, `${root}/body/records`, body),
        {
          weightKg,
          waistCm: weightKg,
          measuredAt,
          aiSuggestion: 'Caller-provided note; not generated by a model.',
        },
        true,
      );
      assert.equal(record.modelCall, 'not_performed');
      assert.equal(record.wearableSync, 'not_connected');
    }
    const goal = await confirmed(
      context.baseUrl,
      first.userId,
      (body) => postJson(context.baseUrl, `${root}/body/goals`, body),
      { targetWeightKg: 58, targetDate: '2026-12-31' },
      true,
    );
    assert.equal(goal.medicalUse, 'not_for_diagnosis');
    const trend = await confirmed(
      context.baseUrl,
      first.userId,
      (body) => postJson(context.baseUrl, `${root}/body/trends`, body),
      {},
    );
    assert.equal(trend.changes.weightKg, -1.3);
    assert.equal(trend.medicalDiagnosis, 'not_performed');

    const memory = await confirmed(
      context.baseUrl,
      first.userId,
      (body) => postJson(context.baseUrl, `${root}/memories`, body),
      {
        title: 'Local private memory',
        content: 'Content selected by the user for later context.',
        participatesInContext: false,
        exportMarked: false,
      },
      true,
    );
    const updatedMemory = await confirmed(
      context.baseUrl,
      first.userId,
      (body) => patchJson(context.baseUrl, `${root}/memories/${memory.memoryId}`, body),
      { participatesInContext: true, exportMarked: true },
    );
    assert.equal(updatedMemory.participatesInContext, true);
    assert.equal(updatedMemory.exportMarked, true);
    const projection = await confirmed(
      context.baseUrl,
      first.userId,
      (body) => postJson(context.baseUrl, `${root}/memories/context-projections`, body),
      {},
    );
    assert.equal(projection.memories.length, 1);
    assert.equal(projection.execution.modelCall, 'not_performed');
    assert.equal(projection.execution.externalApiCall, 'not_performed');

    const otherRoot = `/api/v1/users/${second.userId}/subjects/${second.subjectId}/life`;
    const otherCalendar = await confirmed(
      context.baseUrl,
      second.userId,
      (body) => postJson(context.baseUrl, `${otherRoot}/calendar/entries/query`, body),
      {},
    );
    const otherBody = await confirmed(
      context.baseUrl,
      second.userId,
      (body) => postJson(context.baseUrl, `${otherRoot}/body/records/query`, body),
      {},
    );
    const otherMemories = await confirmed(
      context.baseUrl,
      second.userId,
      (body) => postJson(context.baseUrl, `${otherRoot}/memories/query`, body),
      {},
    );
    assert.deepEqual([otherCalendar.length, otherBody.length, otherMemories.length], [0, 0, 0]);

    const policy = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-policies`,
      {
        resourceType: 'life_data',
        actionType: 'read',
        riskLevel: 'high',
        rule: 'deny',
      },
    );
    assert.equal(policy.response.status, 201);
    const denied = await postJson(context.baseUrl, `${root}/memories/query`, {});
    assert.equal(denied.body.data.operationStatus, 'denied');
    assert.equal(denied.body.data.result, null);

    const healthEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/events?eventType=health_record_updated&subjectId=${first.subjectId}`,
    );
    assert.equal(healthEvents.body.meta.count, 3);
    const eventText = JSON.stringify(healthEvents.body.data);
    assert.equal(eventText.includes('60.5'), false);
    assert.equal(eventText.includes('Caller-provided note'), false);
    assert.deepEqual(
      context.application.database.connection.prepare('PRAGMA foreign_key_check;').all(),
      [],
    );
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
