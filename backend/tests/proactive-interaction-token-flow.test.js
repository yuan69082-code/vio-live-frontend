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

const PRE_STAGE_MIGRATIONS = Object.freeze([
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
  '014_create_life_management_foundation.sql',
  '015_create_user_spaces_and_data_isolation.sql',
]);

async function putJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

async function createScope(baseUrl, email, name = 'Proactive assistant') {
  const user = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(user.response.status, 201);
  const subject = await postJson(
    baseUrl,
    `/api/v1/users/${user.body.data.userId}/subjects`,
    { name, basicSettings: {} },
  );
  assert.equal(subject.response.status, 201);
  return {
    userId: user.body.data.userId,
    subjectId: subject.body.data.subjectId,
  };
}

async function createPermission(baseUrl, scope, resourceId) {
  const result = await postJson(
    baseUrl,
    `/api/v1/users/${scope.userId}/permissions`,
    {
      subjectId: scope.subjectId,
      resourceType: 'proactive_interaction',
      resourceId,
      action: 'execute',
      permissionLevel: 'always_allow',
    },
  );
  assert.equal(result.response.status, 201);
  return result.body.data;
}

async function configureBackground(baseUrl, scope, overrides = {}) {
  return putJson(
    baseUrl,
    `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/background-policy`,
    {
      runState: 'active',
      backgroundEnabled: true,
      maxWakeupsPerHour: 4,
      maxPromptsPerHour: 6,
      allowedWakeTypes: ['voice', 'desktop', 'schedule', 'event'],
      quietHours: { start: '23:00', end: '07:00' },
      ...overrides,
    },
  );
}

test('migration 016 preserves security facts and adds proactive interaction scope', async () => {
  const testDatabase = createTestDatabasePath();
  const legacyMigrationsPath = join(testDatabase.directory, 'pre-stage-13-migrations');
  mkdirSync(legacyMigrationsPath);
  for (const filename of PRE_STAGE_MIGRATIONS) {
    copyFileSync(
      new URL(`../migrations/${filename}`, import.meta.url),
      join(legacyMigrationsPath, filename),
    );
  }

  const connection = new DatabaseSync(testDatabase.databasePath);
  connection.exec('PRAGMA foreign_keys = ON;');
  runMigrations(connection, legacyMigrationsPath);
  const timestamp = '2026-07-28T00:00:00.000Z';
  connection.prepare(`
    INSERT INTO users (
      user_id, primary_email, display_name, status, created_at, updated_at
    ) VALUES (?, ?, '', 'active', ?, ?)
  `).run('proactive-legacy-user', 'proactive-legacy@example.com', timestamp, timestamp);
  connection.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, '{}', 'active', ?, ?)
  `).run(
    'proactive-legacy-subject',
    'proactive-legacy-user',
    'Legacy proactive subject',
    timestamp,
    timestamp,
  );
  connection.prepare(`
    INSERT INTO permissions (
      permission_id, user_id, subject_id, resource_type, resource_id, action,
      permission_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'memory', ?, 'read', 'always_allow', 'active', ?, ?)
  `).run(
    'proactive-legacy-permission',
    'proactive-legacy-user',
    'proactive-legacy-subject',
    'legacy-memory',
    timestamp,
    timestamp,
  );
  connection.prepare(`
    INSERT INTO security_policies (
      policy_id, user_id, resource_type, action_type, risk_level, rule,
      status, created_at, updated_at
    ) VALUES (?, ?, 'memory', 'read', 'low', 'always_allow', 'active', ?, ?)
  `).run(
    'proactive-legacy-policy',
    'proactive-legacy-user',
    timestamp,
    timestamp,
  );
  connection.prepare(`
    INSERT INTO security_confirmations (
      confirmation_id, user_id, subject_id, operation_type, resource_type,
      resource_id, action, permission_id, permission_level,
      permission_updated_at, policy_fingerprint, confirmation_mode,
      risk_level, status, requested_at, expires_at
    ) VALUES (?, ?, ?, 'general_access', 'memory', ?, 'read', ?,
      'always_allow', ?, ?, 'every_time', 'high', 'pending', ?, ?)
  `).run(
    'proactive-legacy-confirmation',
    'proactive-legacy-user',
    'proactive-legacy-subject',
    'legacy-memory',
    'proactive-legacy-permission',
    timestamp,
    'legacy-policy-fingerprint',
    timestamp,
    '2026-07-28T00:05:00.000Z',
  );
  connection.prepare(`
    INSERT INTO audit_logs (
      audit_log_id, user_id, subject_id, operation_type, resource_type,
      resource_id, action, risk_level, permission_decision, confirmation_mode,
      result, reason_code, confirmation_id, occurred_at
    ) VALUES (?, ?, ?, 'general_access', 'memory', ?, 'read', 'high',
      'ask', 'every_time', 'confirmation_required', 'confirmation_required', ?, ?)
  `).run(
    'proactive-legacy-audit',
    'proactive-legacy-user',
    'proactive-legacy-subject',
    'legacy-memory',
    'proactive-legacy-confirmation',
    timestamp,
  );
  connection.close();

  const context = await startTestApplication(testDatabase.databasePath);
  try {
    assert.deepEqual(
      context.application.database.connection.prepare('PRAGMA foreign_key_check;').all(),
      [],
    );
    assert.equal(
      context.application.database.connection.prepare(`
        SELECT COUNT(*) AS count FROM permissions WHERE permission_id = ?
      `).get('proactive-legacy-permission').count,
      1,
    );
    assert.equal(
      context.application.database.connection.prepare(`
        SELECT COUNT(*) AS count FROM security_policies WHERE policy_id = ?
      `).get('proactive-legacy-policy').count,
      1,
    );
    assert.equal(
      context.application.database.connection.prepare(`
        SELECT COUNT(*) AS count FROM security_confirmations WHERE confirmation_id = ?
      `).get('proactive-legacy-confirmation').count,
      1,
    );
    assert.equal(
      context.application.database.connection.prepare(`
        SELECT COUNT(*) AS count FROM audit_logs WHERE audit_log_id = ?
      `).get('proactive-legacy-audit').count,
      1,
    );
    const proactivePermission = await postJson(
      context.baseUrl,
      '/api/v1/users/proactive-legacy-user/permissions',
      {
        subjectId: 'proactive-legacy-subject',
        resourceType: 'proactive_interaction',
        resourceId: 'legacy-wake',
        action: 'execute',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(proactivePermission.response.status, 201);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('wake and proactive prompt preparation respect authorization, priority and Security', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);
  try {
    const scope = await createScope(context.baseUrl, 'wake-prompt@example.com');
    const background = await configureBackground(context.baseUrl, scope);
    assert.equal(background.response.status, 200);
    assert.equal(background.body.data.runState, 'active');
    assert.equal(background.body.data.runtime.scheduler, 'not_connected');

    const unauthorizedWake = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/wake-rules`,
      {
        wakeType: 'voice',
        triggerCondition: { phraseLabel: 'vio' },
        status: 'enabled',
      },
    );
    assert.equal(unauthorizedWake.response.status, 409);

    const wake = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/wake-rules`,
      {
        wakeType: 'voice',
        triggerCondition: { phraseLabel: 'vio' },
        userAuthorization: 'granted',
        status: 'enabled',
      },
    );
    assert.equal(wake.response.status, 201);
    assert.equal(wake.body.data.runtime.microphonePermission, 'not_connected');
    assert.equal(wake.body.data.runtime.systemWake, 'not_connected');
    await createPermission(context.baseUrl, scope, wake.body.data.wakeId);

    const mediumAllowPolicy = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/security-policies`,
      {
        resourceType: 'proactive_interaction',
        actionType: 'execute',
        riskLevel: 'medium',
        rule: 'always_allow',
      },
    );
    assert.equal(mediumAllowPolicy.response.status, 201);
    const wakePreparation = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/wake-rules/${wake.body.data.wakeId}/preparations`,
      {},
    );
    assert.equal(wakePreparation.response.status, 200);
    assert.equal(wakePreparation.body.data.operationStatus, 'ready');
    assert.equal(wakePreparation.body.data.security.executionStatus, 'not_executed');
    assert.equal(wakePreparation.body.data.execution.microphoneAccess, 'not_performed');

    const zeroWakeLimit = await configureBackground(context.baseUrl, scope, {
      maxWakeupsPerHour: 0,
    });
    assert.equal(zeroWakeLimit.response.status, 200);
    const suppressedWake = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/wake-rules/${wake.body.data.wakeId}/preparations`,
      {},
    );
    assert.equal(suppressedWake.response.status, 200);
    assert.equal(suppressedWake.body.data.operationStatus, 'suppressed');
    assert.equal(
      suppressedWake.body.data.reason,
      'wakeups_disabled_by_background_limit',
    );
    const restoredBackground = await configureBackground(context.baseUrl, scope);
    assert.equal(restoredBackground.response.status, 200);

    const trigger = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/events`,
      {
        subjectId: scope.subjectId,
        eventType: 'life_event_created',
        occurredAt: '2026-07-28T09:00:00.000Z',
        source: { type: 'test', reference: 'life-event' },
        summary: 'A test life event was created.',
        data: { module: 'calendar', changeType: 'created' },
      },
    );
    assert.equal(trigger.response.status, 201);

    const promptRule = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/proactive-prompt-rules`,
      {
        name: 'Important life reminder',
        priority: 'urgent',
        triggerEventType: 'life_event_created',
        condition: { module: 'calendar' },
        requiresConfirmation: true,
        status: 'enabled',
      },
    );
    assert.equal(promptRule.response.status, 201);
    await createPermission(context.baseUrl, scope, promptRule.body.data.promptRuleId);

    const firstPreparation = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/proactive-prompt-rules/${promptRule.body.data.promptRuleId}/preparations`,
      { triggerEventId: trigger.body.data.eventId },
    );
    assert.equal(firstPreparation.response.status, 200);
    assert.equal(firstPreparation.body.data.operationStatus, 'confirmation_required');
    assert.equal(firstPreparation.body.data.security.risk.level, 'high');
    assert.equal(firstPreparation.body.data.record.deliveryStatus, 'not_delivered');
    const confirmationId = firstPreparation.body.data.security.confirmation.confirmationId;

    const approval = await patchJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(approval.response.status, 200);
    const confirmedPreparation = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/proactive-prompt-rules/${promptRule.body.data.promptRuleId}/preparations`,
      { triggerEventId: trigger.body.data.eventId, confirmationId },
    );
    assert.equal(confirmedPreparation.response.status, 200);
    assert.equal(confirmedPreparation.body.data.operationStatus, 'ready');
    assert.equal(confirmedPreparation.body.data.execution.messageDelivery, 'not_performed');
    assert.equal(confirmedPreparation.body.data.execution.modelCall, 'not_performed');

    const silentRule = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/proactive-prompt-rules`,
      {
        name: 'Silent bookkeeping',
        priority: 'silent',
        triggerEventType: 'life_event_created',
        condition: {},
        requiresConfirmation: false,
        status: 'enabled',
      },
    );
    assert.equal(silentRule.response.status, 201);
    const suppressed = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/proactive-prompt-rules/${silentRule.body.data.promptRuleId}/preparations`,
      { triggerEventId: trigger.body.data.eventId },
    );
    assert.equal(suppressed.body.data.operationStatus, 'suppressed');
    assert.equal(suppressed.body.data.reason, 'silent_priority');

    const promptEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/events?eventType=proactive_prompt_prepared`,
    );
    assert.equal(promptEvents.response.status, 200);
    assert.equal(promptEvents.body.meta.count, 3);
    assert.ok(promptEvents.body.data.every(
      (event) => event.data.executionStatus === 'not_executed',
    ));
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('token budgets enforce daily and session limits without model calls or cross-scope reads', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);
  try {
    const first = await createScope(context.baseUrl, 'token-first@example.com');
    const second = await createScope(context.baseUrl, 'token-second@example.com');
    const budget = await putJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/token-budget`,
      {
        dailyTokenLimit: 100,
        sessionTokenLimit: 60,
        overagePolicy: 'require_confirmation',
        status: 'enabled',
      },
    );
    assert.equal(budget.response.status, 200);
    assert.equal(budget.body.data.dailyTokenLimit, 100);

    const usage = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/token-usage-records`,
      {
        budgetSessionId: 'session-alpha',
        inputTokens: 25,
        outputTokens: 15,
      },
    );
    assert.equal(usage.response.status, 201);
    assert.equal(usage.body.data.totalTokens, 40);
    assert.equal(usage.body.data.usageSource, 'explicit_api_input');
    assert.equal(usage.body.data.modelCallStatus, 'not_performed_by_platform');
    assert.equal(usage.body.data.billingStatus, 'not_billed');

    const withinBudget = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/token-budget/checks`,
      { estimatedTokens: 15, budgetSessionId: 'session-alpha' },
    );
    assert.equal(withinBudget.response.status, 200);
    assert.equal(withinBudget.body.data.operationStatus, 'within_budget');
    assert.equal(withinBudget.body.data.projection.sessionProjected, 55);
    assert.equal(withinBudget.body.data.execution.modelCall, 'not_performed');

    await createPermission(context.baseUrl, first, budget.body.data.tokenBudgetId);
    const overBudget = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/token-budget/checks`,
      { estimatedTokens: 25, budgetSessionId: 'session-alpha' },
    );
    assert.equal(overBudget.response.status, 200);
    assert.equal(overBudget.body.data.operationStatus, 'confirmation_required');
    assert.equal(overBudget.body.data.security.risk.level, 'high');
    assert.equal(overBudget.body.data.security.executionStatus, 'not_executed');

    const blockedBudget = await putJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/token-budget`,
      {
        dailyTokenLimit: 100,
        sessionTokenLimit: 60,
        overagePolicy: 'block',
        status: 'enabled',
      },
    );
    assert.equal(blockedBudget.response.status, 200);
    assert.equal(blockedBudget.body.data.tokenBudgetId, budget.body.data.tokenBudgetId);
    const blocked = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/token-budget/checks`,
      { estimatedTokens: 25, budgetSessionId: 'session-alpha' },
    );
    assert.equal(blocked.body.data.operationStatus, 'blocked_by_budget');
    assert.equal(blocked.body.data.decision, 'deny');

    const deferredBudget = await putJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/token-budget`,
      {
        dailyTokenLimit: 100,
        sessionTokenLimit: 60,
        overagePolicy: 'defer',
        status: 'enabled',
      },
    );
    assert.equal(deferredBudget.response.status, 200);
    const deferred = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/token-budget/checks`,
      { estimatedTokens: 25, budgetSessionId: 'session-alpha' },
    );
    assert.equal(deferred.response.status, 200);
    assert.equal(deferred.body.data.operationStatus, 'deferred_by_budget');
    assert.equal(deferred.body.data.decision, 'defer');

    const crossUserBudget = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/subjects/${first.subjectId}/token-budget`,
    );
    assert.equal(crossUserBudget.response.status, 404);
    const secretWake = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/wake-rules`,
      {
        wakeType: 'event',
        triggerCondition: { apiKey: 'must-not-persist' },
        userAuthorization: 'granted',
      },
    );
    assert.equal(secretWake.response.status, 400);
    const audioPayloadWake = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/wake-rules`,
      {
        wakeType: 'voice',
        triggerCondition: { audioData: 'not-accepted' },
        userAuthorization: 'granted',
      },
    );
    assert.equal(audioPayloadWake.response.status, 400);

    const usageEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/events?eventType=token_usage_recorded`,
    );
    assert.equal(usageEvents.response.status, 200);
    assert.equal(usageEvents.body.meta.count, 1);
    assert.equal(usageEvents.body.data[0].data.modelCallStatus, 'not_performed_by_platform');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
