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
  '016_create_proactive_interaction_and_token_controls.sql',
]);

async function createScope(baseUrl, email, name = 'Export assistant') {
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

test('migration 017 preserves security history and adds the data_export scope', async () => {
  const testDatabase = createTestDatabasePath();
  const legacyMigrationsPath = join(testDatabase.directory, 'pre-stage-14-migrations');
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
  `).run('export-legacy-user', 'export-legacy@example.com', timestamp, timestamp);
  connection.prepare(`
    INSERT INTO subjects (
      subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, '{}', 'active', ?, ?)
  `).run(
    'export-legacy-subject',
    'export-legacy-user',
    'Legacy export subject',
    timestamp,
    timestamp,
  );
  connection.prepare(`
    INSERT INTO permissions (
      permission_id, user_id, subject_id, resource_type, resource_id, action,
      permission_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'memory', ?, 'read', 'always_allow', 'active', ?, ?)
  `).run(
    'export-legacy-permission',
    'export-legacy-user',
    'export-legacy-subject',
    'legacy-memory',
    timestamp,
    timestamp,
  );
  connection.prepare(`
    INSERT INTO security_policies (
      policy_id, user_id, resource_type, action_type, risk_level, rule,
      status, created_at, updated_at
    ) VALUES (?, ?, 'memory', 'read', 'low', 'always_allow', 'active', ?, ?)
  `).run('export-legacy-policy', 'export-legacy-user', timestamp, timestamp);
  connection.prepare(`
    INSERT INTO security_confirmations (
      confirmation_id, user_id, subject_id, operation_type, resource_type,
      resource_id, action, permission_id, permission_level,
      permission_updated_at, policy_fingerprint, confirmation_mode,
      risk_level, status, requested_at, expires_at
    ) VALUES (?, ?, ?, 'general_access', 'memory', ?, 'read', ?,
      'always_allow', ?, ?, 'every_time', 'high', 'pending', ?, ?)
  `).run(
    'export-legacy-confirmation',
    'export-legacy-user',
    'export-legacy-subject',
    'legacy-memory',
    'export-legacy-permission',
    timestamp,
    'legacy-export-policy-fingerprint',
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
    'export-legacy-audit',
    'export-legacy-user',
    'export-legacy-subject',
    'legacy-memory',
    'export-legacy-confirmation',
    timestamp,
  );
  connection.close();

  const context = await startTestApplication(testDatabase.databasePath);
  try {
    assert.deepEqual(
      context.application.database.connection.prepare('PRAGMA foreign_key_check;').all(),
      [],
    );
    for (const [table, idField, value] of [
      ['permissions', 'permission_id', 'export-legacy-permission'],
      ['security_policies', 'policy_id', 'export-legacy-policy'],
      ['security_confirmations', 'confirmation_id', 'export-legacy-confirmation'],
      ['audit_logs', 'audit_log_id', 'export-legacy-audit'],
    ]) {
      assert.equal(
        context.application.database.connection.prepare(`
          SELECT COUNT(*) AS count FROM ${table} WHERE ${idField} = ?
        `).get(value).count,
        1,
      );
    }
    assert.equal(
      context.application.database.connection.prepare(`
        SELECT COUNT(*) AS count FROM export_schema_scopes
      `).get().count,
      12,
    );
    const permission = await postJson(
      context.baseUrl,
      '/api/v1/users/export-legacy-user/permissions',
      {
        subjectId: 'export-legacy-subject',
        resourceType: 'data_export',
        resourceId: 'future-export-record',
        action: 'export',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(permission.response.status, 201);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('export schema and integrity preflight cover all twelve scopes without producing data', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);
  try {
    const scope = await createScope(context.baseUrl, 'export-schema@example.com');
    const schemas = await getJson(context.baseUrl, '/api/v1/data-export/schemas');
    assert.equal(schemas.response.status, 200);
    assert.equal(schemas.body.meta.count, 3);
    assert.ok(schemas.body.data.every((schema) => (
      schema.schemaVersion === 'vio-live-export-v1'
      && schema.scopes.length === 12
      && schema.createdTime
    )));

    const full = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports`,
      { exportType: 'full' },
    );
    assert.equal(full.response.status, 201);
    assert.equal(full.body.data.record.requestedScopes.length, 12);
    assert.equal(full.body.data.record.integrity.status, 'passed');
    assert.equal(full.body.data.record.integrity.permissionStatus, 'not_checked');
    assert.equal(full.body.data.record.result, 'preflight_passed');
    assert.equal(full.body.data.record.requestedBy.userId, scope.userId);
    assert.equal(
      full.body.data.record.requestedBy.authenticationStatus,
      'development_unverified',
    );
    assert.equal(full.body.data.dataIncluded, false);
    assert.equal(full.body.data.execution.payload, 'not_generated');
    assert.equal(full.body.data.execution.externalStorage, 'not_connected');

    context.application.database.connection.prepare(`
      UPDATE assistant_global_settings
      SET expression_style_json = 'not-json'
      WHERE owner_user_id = ? AND subject_id = ?
    `).run(scope.userId, scope.subjectId);
    const invalid = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports`,
      { exportType: 'selected', scopes: ['assistant_global_settings'] },
    );
    assert.equal(invalid.response.status, 201);
    assert.equal(invalid.body.data.record.integrity.status, 'failed');
    assert.equal(invalid.body.data.record.integrity.fieldStatus, 'failed');
    assert.equal(
      invalid.body.data.record.integrity.report.fields.missingRequiredFieldCount,
      1,
    );
    const blocked = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports/${invalid.body.data.record.exportId}/preparations`,
      {},
    );
    assert.equal(blocked.response.status, 409);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('sensitive export and migration preparation require confirmation and never transfer data', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);
  try {
    const scope = await createScope(context.baseUrl, 'export-secure@example.com');
    const other = await createScope(context.baseUrl, 'export-other@example.com');
    const created = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports`,
      {
        exportType: 'migration',
        scopes: [
          'user_data',
          'subject_state',
          'assistant_global_settings',
          'assistant_private_space',
        ],
      },
    );
    assert.equal(created.response.status, 201);
    const exportId = created.body.data.record.exportId;
    const permission = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/permissions`,
      {
        subjectId: scope.subjectId,
        resourceType: 'data_export',
        resourceId: exportId,
        action: 'export',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(permission.response.status, 201);

    const first = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports/${exportId}/preparations`,
      {},
    );
    assert.equal(first.response.status, 200);
    assert.equal(first.body.data.operationStatus, 'confirmation_required');
    assert.equal(first.body.data.security.risk.level, 'high');
    assert.equal(first.body.data.security.executionStatus, 'not_executed');
    assert.equal(first.body.data.dataIncluded, false);
    const confirmationId = first.body.data.security.confirmation.confirmationId;

    const approved = await patchJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(approved.response.status, 200);
    const ready = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports/${exportId}/preparations`,
      { confirmationId },
    );
    assert.equal(ready.response.status, 200);
    assert.equal(ready.body.data.operationStatus, 'ready');
    assert.equal(ready.body.data.record.result, 'ready');
    assert.equal(ready.body.data.execution.file, 'not_created');
    assert.equal(ready.body.data.execution.externalTransfer, 'not_performed');

    const contracts = await getJson(
      context.baseUrl,
      '/api/v1/data-export/migration-target-contracts',
    );
    assert.equal(contracts.response.status, 200);
    assert.equal(contracts.body.meta.count, 2);
    assert.ok(contracts.body.data.every(
      (contract) => contract.connectionStatus === 'not_connected',
    ));
    const migration = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports/${exportId}/migration-preparations`,
      { targetType: 'robot' },
    );
    assert.equal(migration.response.status, 200);
    assert.equal(migration.body.data.target.preparationStatus, 'reserved_only');
    assert.equal(migration.body.data.target.connectionStatus, 'not_connected');
    assert.equal(migration.body.data.target.migrationStatus, 'not_executed');
    assert.equal(migration.body.data.dataIncluded, false);
    assert.equal(migration.body.data.execution.robotConnection, 'not_connected');

    const rejectedTargetPayload = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports/${exportId}/migration-preparations`,
      { targetType: 'robot', serviceUrl: 'https://not-connected.invalid' },
    );
    assert.equal(rejectedTargetPayload.response.status, 400);

    const deniedExport = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports`,
      { exportType: 'selected', scopes: ['tool'] },
    );
    assert.equal(deniedExport.response.status, 201);
    const deniedExportId = deniedExport.body.data.record.exportId;
    const deniedPermission = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/permissions`,
      {
        subjectId: scope.subjectId,
        resourceType: 'data_export',
        resourceId: deniedExportId,
        action: 'export',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(deniedPermission.response.status, 201);
    const denyPolicy = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/security-policies`,
      {
        resourceType: 'data_export',
        actionType: 'export',
        riskLevel: 'high',
        rule: 'deny',
      },
    );
    assert.equal(denyPolicy.response.status, 201);
    const policyDenied = await postJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports/${deniedExportId}/preparations`,
      {},
    );
    assert.equal(policyDenied.response.status, 200);
    assert.equal(policyDenied.body.data.operationStatus, 'denied');
    assert.equal(policyDenied.body.data.security.securityPolicy.decision, 'deny');

    const crossUserRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${other.userId}/subjects/${scope.subjectId}/data-exports/${exportId}`,
    );
    assert.equal(crossUserRead.response.status, 404);

    const persisted = await getJson(
      context.baseUrl,
      `/api/v1/users/${scope.userId}/subjects/${scope.subjectId}/data-exports/${exportId}`,
    );
    assert.equal(persisted.response.status, 200);
    assert.equal(persisted.body.data.result, 'ready');
    assert.equal(persisted.body.data.execution.payload, 'not_generated');
    assert.ok(persisted.body.data.securityAuditLogId);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
