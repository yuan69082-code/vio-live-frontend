import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { runMigrations } from '../src/integrations/database/migrations.js';

import {
  createTestDatabasePath,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

async function createUserAndSubject(baseUrl, email) {
  const userResult = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(userResult.response.status, 201);
  const userId = userResult.body.data.userId;
  const subjectResult = await postJson(
    baseUrl,
    `/api/v1/users/${userId}/subjects`,
    { name: 'Policy Subject', basicSettings: {} },
  );
  assert.equal(subjectResult.response.status, 201);
  return { userId, subjectId: subjectResult.body.data.subjectId };
}

async function createPermission(baseUrl, userId, input) {
  return postJson(baseUrl, `/api/v1/users/${userId}/permissions`, input);
}

async function createPolicy(baseUrl, userId, input) {
  return postJson(baseUrl, `/api/v1/users/${userId}/security-policies`, input);
}

async function checkSecurity(baseUrl, userId, input) {
  return postJson(baseUrl, `/api/v1/users/${userId}/security-checks`, input);
}

function securityInput(subjectId, overrides = {}) {
  return {
    subjectId,
    resourceType: 'tool',
    resourceId: 'policy-tool',
    action: 'read',
    operationType: 'general_access',
    ...overrides,
  };
}

const PRE_POLICY_MIGRATIONS = Object.freeze([
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
]);

test('migration 012 preserves Event and AuditLog references while adding policy storage', async () => {
  const testDatabase = createTestDatabasePath();
  const legacyMigrationsPath = join(testDatabase.directory, 'pre-policy-migrations');
  mkdirSync(legacyMigrationsPath);
  for (const filename of PRE_POLICY_MIGRATIONS) {
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
    INSERT INTO users (
      user_id, primary_email, display_name, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'policy-legacy-user',
    'policy-legacy@example.com',
    '',
    'active',
    timestamp,
    timestamp,
  );
  legacy.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, '{}', ?, ?, ?)
  `).run(
    'policy-legacy-subject',
    'policy-legacy-user',
    'Legacy policy subject',
    'active',
    timestamp,
    timestamp,
  );
  legacy.prepare(`
    INSERT INTO events (
      event_id, user_id, subject_id, event_type, source_type, source_ref,
      occurred_at, recorded_at, event_data_json, summary, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
  `).run(
    'policy-legacy-event',
    'policy-legacy-user',
    'policy-legacy-subject',
    'device_changed',
    'legacy-test',
    'policy-legacy-device',
    timestamp,
    timestamp,
    'Legacy device event.',
    'pending',
  );
  legacy.prepare(`
    INSERT INTO audit_logs (
      audit_log_id, user_id, subject_id, operation_type, resource_type,
      resource_id, action, risk_level, permission_decision,
      confirmation_mode, result, reason_code, confirmation_id, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    'policy-legacy-audit',
    'policy-legacy-user',
    'policy-legacy-subject',
    'device_control',
    'device',
    'policy-legacy-device',
    'control',
    'critical',
    'deny',
    'every_time',
    'denied',
    'permission_denied',
    timestamp,
  );
  legacy.prepare(`
    INSERT INTO device_registry (
      device_id, owner_user_id, device_type, brand, name, status,
      adapter_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'policy-legacy-device',
    'policy-legacy-user',
    'camera',
    'generic_camera',
    'Legacy camera',
    'enabled',
    'generic',
    timestamp,
    timestamp,
  );
  legacy.prepare(`
    INSERT INTO device_capabilities (owner_user_id, device_id, capability)
    VALUES (?, ?, ?)
  `).run('policy-legacy-user', 'policy-legacy-device', 'view_status');
  legacy.prepare(`
    INSERT INTO device_operation_logs (
      device_operation_log_id, user_id, subject_id, device_id, capability,
      action, permission_decision, security_decision, risk_level,
      preparation_status, execution_status, result_summary,
      audit_log_id, event_id, requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'policy-legacy-device-log',
    'policy-legacy-user',
    'policy-legacy-subject',
    'policy-legacy-device',
    'view_status',
    'read',
    'deny',
    'deny',
    'critical',
    'denied',
    'not_executed',
    'Legacy request was not executed.',
    'policy-legacy-audit',
    'policy-legacy-event',
    timestamp,
  );
  legacy.close();

  const context = await startTestApplication(testDatabase.databasePath);
  try {
    assert.deepEqual(
      context.application.database.connection.prepare('PRAGMA foreign_key_check;').all(),
      [],
    );
    const event = await getJson(
      context.baseUrl,
      '/api/v1/users/policy-legacy-user/events/policy-legacy-event',
    );
    assert.equal(event.response.status, 200);
    const audit = await getJson(
      context.baseUrl,
      '/api/v1/users/policy-legacy-user/audit-logs/policy-legacy-audit',
    );
    assert.equal(audit.response.status, 200);
    const operationLog = await getJson(
      context.baseUrl,
      '/api/v1/users/policy-legacy-user/subjects/policy-legacy-subject/device-operation-logs/policy-legacy-device-log',
    );
    assert.equal(operationLog.response.status, 200);
    assert.equal(operationLog.body.data.eventId, 'policy-legacy-event');
    assert.equal(operationLog.body.data.auditLogId, 'policy-legacy-audit');
    const policy = await createPolicy(context.baseUrl, 'policy-legacy-user', {
      resourceType: 'device',
      actionType: 'read',
      riskLevel: 'high',
      rule: 'always_confirm',
    });
    assert.equal(policy.response.status, 201);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('security policies and user preferences support CRUD, isolation and persistence', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const first = await createUserAndSubject(context.baseUrl, 'policy-crud@example.com');
    const second = await createUserAndSubject(context.baseUrl, 'policy-other@example.com');
    const defaults = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-preferences`,
    );
    assert.equal(defaults.response.status, 200);
    assert.equal(defaults.body.data.defaultSecurityLevel, 'low');
    assert.equal(defaults.body.data.highRiskOperationPolicy, 'always_confirm');
    assert.deepEqual(defaults.body.data.autoConfirmationScopes, []);
    assert.deepEqual(defaults.body.data.forbiddenScopes, []);

    const preferences = await patchJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-preferences`,
      {
        defaultSecurityLevel: 'medium',
        highRiskOperationPolicy: 'deny',
        autoConfirmationScopes: [{
          resourceType: 'tool',
          actionType: 'read',
          maximumRiskLevel: 'medium',
        }],
        forbiddenScopes: [{ resourceType: 'device', actionType: 'control' }],
      },
    );
    assert.equal(preferences.response.status, 200);
    assert.equal(preferences.body.data.defaultSecurityLevel, 'medium');
    assert.equal(preferences.body.data.highRiskOperationPolicy, 'deny');

    const cases = [
      ['tool', 'read', 'low', 'always_allow'],
      ['tool', 'execute', 'medium', 'session_allow'],
      ['memory', 'write', 'medium', 'always_confirm'],
      ['device', 'control', 'critical', 'deny'],
      ['private_domain', 'read', 'high', 'deny_without_confirm'],
    ];
    const policies = [];
    for (const [resourceType, actionType, riskLevel, rule] of cases) {
      const response = await createPolicy(context.baseUrl, first.userId, {
        resourceType,
        actionType,
        riskLevel,
        rule,
      });
      assert.equal(response.response.status, 201);
      assert.equal(response.body.data.rule, rule);
      policies.push(response.body.data);
    }

    const list = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-policies`,
    );
    assert.equal(list.body.meta.count, 5);
    const read = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-policies/${policies[0].policyId}`,
    );
    assert.equal(read.response.status, 200);
    assert.equal(read.body.data.resourceType, 'tool');

    const updated = await patchJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-policies/${policies[0].policyId}`,
      { rule: 'always_confirm' },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.rule, 'always_confirm');
    const deleted = await deleteJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-policies/${policies[0].policyId}`,
    );
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.data.status, 'deleted');
    const deletedList = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-policies?status=deleted`,
    );
    assert.equal(deletedList.body.meta.count, 1);

    const crossUser = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/security-policies/${policies[1].policyId}`,
    );
    assert.equal(crossUser.response.status, 404);
    const duplicate = await createPolicy(context.baseUrl, first.userId, {
      resourceType: 'tool',
      actionType: 'execute',
      riskLevel: 'medium',
      rule: 'always_allow',
    });
    assert.equal(duplicate.response.status, 409);
    const unsafeAutoScope = await patchJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-preferences`,
      {
        autoConfirmationScopes: [{
          resourceType: 'device',
          actionType: 'control',
          maximumRiskLevel: 'critical',
        }],
      },
    );
    assert.equal(unsafeAutoScope.response.status, 400);

    const audit = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/audit-logs?operationType=security_policy_change&resourceType=security_policy&limit=20`,
    );
    assert.equal(audit.response.status, 200);
    assert.equal(audit.body.meta.count, 8);
    assert.deepEqual(
      new Set(audit.body.data.map((item) => item.reasonCode)),
      new Set([
        'security_policy_created',
        'security_policy_updated',
        'security_policy_deleted',
        'security_preference_updated',
      ]),
    );

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persisted = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-preferences`,
    );
    assert.equal(persisted.body.data.defaultSecurityLevel, 'medium');
    assert.equal(persisted.body.data.highRiskOperationPolicy, 'deny');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('Permission, policy, confirmation, Event and AuditLog form one safe preparation chain', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'policy-chain@example.com',
    );
    const permission = await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'tool',
      resourceId: 'policy-tool',
      action: 'read',
      permissionLevel: 'always_allow',
    });
    assert.equal(permission.response.status, 201);
    const policy = await createPolicy(context.baseUrl, userId, {
      resourceType: 'tool',
      actionType: 'read',
      riskLevel: 'low',
      rule: 'always_confirm',
    });
    assert.equal(policy.response.status, 201);

    const firstCheck = await checkSecurity(
      context.baseUrl,
      userId,
      securityInput(subjectId),
    );
    assert.equal(firstCheck.response.status, 200);
    assert.equal(firstCheck.body.data.permission.decision, 'allow');
    assert.equal(firstCheck.body.data.securityPolicy.reason, 'policy_always_confirm');
    assert.equal(firstCheck.body.data.decision, 'confirm');
    assert.equal(firstCheck.body.data.executionStatus, 'not_executed');
    const confirmationId = firstCheck.body.data.confirmation.confirmationId;
    const confirmation = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${confirmationId}`,
    );
    assert.equal(confirmation.body.data.securityPolicyId, policy.body.data.policyId);
    assert.equal(confirmation.body.data.userChoice, null);
    assert.match(confirmation.body.data.confirmationReason, /requires confirmation/i);
    assert.match(confirmation.body.data.riskDescription, /Risk level low/);

    const approval = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(approval.body.data.userChoice, 'approve');
    const allowed = await checkSecurity(context.baseUrl, userId, {
      ...securityInput(subjectId),
      confirmationId,
    });
    assert.equal(allowed.body.data.decision, 'allow');
    assert.equal(allowed.body.data.executionAllowed, false);

    const deniedPolicy = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/security-policies/${policy.body.data.policyId}`,
      { rule: 'deny_without_confirm' },
    );
    assert.equal(deniedPolicy.response.status, 200);
    const denied = await checkSecurity(
      context.baseUrl,
      userId,
      securityInput(subjectId),
    );
    assert.equal(denied.body.data.decision, 'deny');
    assert.equal(denied.body.data.securityPolicy.canAsk, false);
    assert.equal(denied.body.data.confirmation.status, 'blocked_by_security_policy');
    const deniedAudit = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/audit-logs/${denied.body.data.auditLogId}`,
    );
    assert.equal(deniedAudit.body.data.result, 'denied');
    assert.equal(deniedAudit.body.data.reasonCode, 'security_policy_denied');

    const automaticPermission = await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'memory',
      resourceId: 'automatic-memory',
      action: 'write',
      permissionLevel: 'always_allow',
    });
    assert.equal(automaticPermission.response.status, 201);
    const automaticPreferences = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/security-preferences`,
      {
        autoConfirmationScopes: [{
          resourceType: 'memory',
          actionType: 'write',
          maximumRiskLevel: 'medium',
        }],
      },
    );
    assert.equal(automaticPreferences.response.status, 200);
    const automatic = await checkSecurity(context.baseUrl, userId, securityInput(subjectId, {
      resourceType: 'memory',
      resourceId: 'automatic-memory',
      action: 'write',
    }));
    assert.equal(automatic.body.data.risk.level, 'medium');
    assert.equal(automatic.body.data.decision, 'allow');
    assert.equal(automatic.body.data.securityPolicy.reason, 'auto_confirmation_scope');

    const defaultLevelPermission = await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'skill',
      resourceId: 'default-level-skill',
      action: 'read',
      permissionLevel: 'always_allow',
    });
    assert.equal(defaultLevelPermission.response.status, 201);
    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/security-preferences`,
      { defaultSecurityLevel: 'medium' },
    );
    const raisedDefault = await checkSecurity(context.baseUrl, userId, securityInput(subjectId, {
      resourceType: 'skill',
      resourceId: 'default-level-skill',
    }));
    assert.equal(raisedDefault.body.data.risk.level, 'medium');
    assert.equal(raisedDefault.body.data.decision, 'confirm');
    assert.equal(raisedDefault.body.data.confirmation.mode, 'user_defined');

    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/security-preferences`,
      { forbiddenScopes: [{ resourceType: 'tool', actionType: 'read' }] },
    );
    const forbidden = await checkSecurity(
      context.baseUrl,
      userId,
      securityInput(subjectId),
    );
    assert.equal(forbidden.body.data.decision, 'deny');
    assert.equal(forbidden.body.data.securityPolicy.reason, 'forbidden_scope');
    assert.equal(forbidden.body.data.securityPolicy.canAsk, false);

    const highPermission = await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'private_domain',
      resourceId: 'private-policy',
      action: 'read',
      permissionLevel: 'always_allow',
    });
    assert.equal(highPermission.response.status, 201);
    const highPolicy = await createPolicy(context.baseUrl, userId, {
      resourceType: 'private_domain',
      actionType: 'read',
      riskLevel: 'high',
      rule: 'always_allow',
    });
    assert.equal(highPolicy.response.status, 201);
    const highRisk = await checkSecurity(context.baseUrl, userId, securityInput(subjectId, {
      resourceType: 'private_domain',
      resourceId: 'private-policy',
      operationType: 'privacy_access_request',
    }));
    assert.equal(highRisk.body.data.risk.level, 'high');
    assert.equal(highRisk.body.data.decision, 'confirm');
    assert.equal(highRisk.body.data.confirmation.mode, 'every_time');
    assert.equal(
      highRisk.body.data.securityPolicy.reason,
      'platform_high_risk_floor',
    );
    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/security-preferences`,
      { highRiskOperationPolicy: 'deny' },
    );
    const highRiskDenied = await checkSecurity(context.baseUrl, userId, securityInput(
      subjectId,
      {
        resourceType: 'private_domain',
        resourceId: 'private-policy',
        operationType: 'privacy_access_request',
      },
    ));
    assert.equal(highRiskDenied.body.data.decision, 'deny');
    assert.equal(highRiskDenied.body.data.securityPolicy.reason, 'high_risk_deny');

    const confirmationEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=confirmation_required`,
    );
    assert.equal(confirmationEvents.body.meta.count, 3);
    assert.ok(confirmationEvents.body.data.every((event) => (
      event.data.executionStatus === 'not_executed'
      && event.source.type === 'security-service'
    )));

    const updatedPermission = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permission.body.data.permissionId}`,
      { permissionLevel: 'ask_every_time' },
    );
    assert.equal(updatedPermission.response.status, 200);
    const revokedPermission = await deleteJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permission.body.data.permissionId}`,
    );
    assert.equal(revokedPermission.response.status, 200);
    for (const eventType of [
      'permission_created',
      'permission_changed',
      'permission_revoked',
    ]) {
      const events = await getJson(
        context.baseUrl,
        `/api/v1/users/${userId}/events?eventType=${eventType}`,
      );
      assert.ok(events.body.meta.count >= 1, eventType);
    }
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('session_allow is precisely scoped and never weakens the high-risk platform floor', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'policy-session@example.com',
    );
    const permission = await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'tool',
      resourceId: 'session-tool',
      action: 'execute',
      permissionLevel: 'always_allow',
    });
    assert.equal(permission.response.status, 201);
    const policy = await createPolicy(context.baseUrl, userId, {
      resourceType: 'tool',
      actionType: 'execute',
      riskLevel: 'medium',
      rule: 'session_allow',
    });
    assert.equal(policy.response.status, 201);
    const sessionScope = securityInput(subjectId, {
      resourceId: 'session-tool',
      action: 'execute',
      securitySessionId: 'security-session-a',
    });

    const first = await checkSecurity(context.baseUrl, userId, sessionScope);
    assert.equal(first.body.data.decision, 'confirm');
    assert.equal(first.body.data.securityPolicy.reason, 'session_confirmation_required');
    const confirmationId = first.body.data.confirmation.confirmationId;
    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    const granted = await checkSecurity(context.baseUrl, userId, {
      ...sessionScope,
      confirmationId,
    });
    assert.equal(granted.body.data.decision, 'allow');
    assert.equal(granted.body.data.securityPolicy.reason, 'session_grant_created');
    assert.ok(granted.body.data.securityPolicy.sessionGrant.sessionGrantId);
    assert.equal(granted.body.data.executionStatus, 'not_executed');

    const reused = await checkSecurity(context.baseUrl, userId, sessionScope);
    assert.equal(reused.body.data.decision, 'allow');
    assert.equal(reused.body.data.confirmation.mode, 'not_required');
    assert.equal(reused.body.data.securityPolicy.reason, 'active_session_grant');
    const otherSession = await checkSecurity(context.baseUrl, userId, {
      ...sessionScope,
      securitySessionId: 'security-session-b',
    });
    assert.equal(otherSession.body.data.decision, 'confirm');

    context.application.database.connection.prepare(`
      UPDATE security_policy_session_grants
      SET expires_at = ?
      WHERE session_grant_id = ?
    `).run(
      '2000-01-01T00:00:00.000Z',
      granted.body.data.securityPolicy.sessionGrant.sessionGrantId,
    );
    const expired = await checkSecurity(context.baseUrl, userId, sessionScope);
    assert.equal(expired.body.data.decision, 'confirm');

    const devicePermission = await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'device',
      resourceId: 'critical-session-device',
      action: 'control',
      permissionLevel: 'always_allow',
    });
    assert.equal(devicePermission.response.status, 201);
    const criticalPolicy = await createPolicy(context.baseUrl, userId, {
      resourceType: 'device',
      actionType: 'control',
      riskLevel: 'critical',
      rule: 'session_allow',
    });
    assert.equal(criticalPolicy.response.status, 201);
    const criticalScope = securityInput(subjectId, {
      resourceType: 'device',
      resourceId: 'critical-session-device',
      action: 'control',
      operationType: 'device_control',
      securitySessionId: 'critical-session',
    });
    const critical = await checkSecurity(context.baseUrl, userId, criticalScope);
    assert.equal(critical.body.data.decision, 'confirm');
    assert.equal(critical.body.data.confirmation.mode, 'every_time');
    const criticalConfirmationId = critical.body.data.confirmation.confirmationId;
    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${criticalConfirmationId}`,
      { decision: 'approve' },
    );
    const criticalAllowed = await checkSecurity(context.baseUrl, userId, {
      ...criticalScope,
      confirmationId: criticalConfirmationId,
    });
    assert.equal(criticalAllowed.body.data.decision, 'allow');
    assert.equal(criticalAllowed.body.data.securityPolicy.sessionGrant, null);
    const criticalAgain = await checkSecurity(context.baseUrl, userId, criticalScope);
    assert.equal(criticalAgain.body.data.decision, 'confirm');
    assert.notEqual(
      criticalAgain.body.data.confirmation.confirmationId,
      criticalConfirmationId,
    );

    const invalidSession = await checkSecurity(context.baseUrl, userId, {
      ...sessionScope,
      securitySessionId: 'invalid session id',
    });
    assert.equal(invalidSession.response.status, 400);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
