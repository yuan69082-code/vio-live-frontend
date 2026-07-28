import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const PRE_ISOLATION_MIGRATIONS = Object.freeze([
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
]);

async function createUser(baseUrl, email) {
  const result = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(result.response.status, 201);
  return result.body.data;
}

async function createAssistant(baseUrl, userId, name) {
  const result = await postJson(baseUrl, `/api/v1/users/${userId}/subjects`, {
    name,
    basicSettings: {},
  });
  assert.equal(result.response.status, 201);
  return result.body.data;
}

async function createEvent(baseUrl, userId, assistantId, summary) {
  const result = await postJson(baseUrl, `/api/v1/users/${userId}/events`, {
    subjectId: assistantId,
    eventType: 'subject_updated',
    source: { type: 'account-data-isolation-test', reference: assistantId },
    summary,
    data: { changeType: 'isolation_test' },
  });
  assert.equal(result.response.status, 201);
  return result.body.data;
}

async function createState(baseUrl, userId, assistantId, eventId, emotion) {
  const result = await postJson(
    baseUrl,
    `/api/v1/users/${userId}/subjects/${assistantId}/state-updates`,
    {
      currentState: { phase: emotion },
      emotion,
      intensity: 0.5,
      changeReason: 'Explicit isolation test state.',
      unresolvedEventIds: [],
      continuityConstraints: [],
      source: { type: 'event', eventId },
    },
  );
  assert.equal(result.response.status, 201);
  return result.body.data;
}

test('migration 015 backfills one User Space and a stable current assistant', () => {
  const testDatabase = createTestDatabasePath();
  const legacyMigrationsPath = join(testDatabase.directory, 'pre-isolation-migrations');
  mkdirSync(legacyMigrationsPath);
  for (const filename of PRE_ISOLATION_MIGRATIONS) {
    copyFileSync(
      new URL(`../migrations/${filename}`, import.meta.url),
      join(legacyMigrationsPath, filename),
    );
  }

  const connection = new DatabaseSync(testDatabase.databasePath);
  try {
    connection.exec('PRAGMA foreign_keys = ON;');
    runMigrations(connection, legacyMigrationsPath);
    const timestamp = '2026-07-28T00:00:00.000Z';
    connection.prepare(`
      INSERT INTO users (
        user_id, primary_email, display_name, status, created_at, updated_at
      ) VALUES (?, ?, NULL, 'active', ?, ?)
    `).run('legacy-user', 'legacy-space@example.com', timestamp, timestamp);
    connection.prepare(`
      INSERT INTO subjects (
        subject_id, owner_user_id, name, avatar_ref, basic_settings_json,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, '{}', 'active', ?, ?)
    `).run('legacy-assistant', 'legacy-user', 'Legacy assistant', timestamp, timestamp);

    runMigrations(connection, fileURLToPath(new URL('../migrations', import.meta.url)));
    const userSpace = connection.prepare(`
      SELECT user_id, identity_mode, current_assistant_id
      FROM user_spaces
      WHERE user_id = ?
    `).get('legacy-user');
    assert.deepEqual({ ...userSpace }, {
      user_id: 'legacy-user',
      identity_mode: 'development_unverified',
      current_assistant_id: 'legacy-assistant',
    });
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check;').all(), []);
  } finally {
    connection.close();
    testDatabase.remove();
  }
});

test('User Space persists current assistant while assistant settings and state stay isolated', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const owner = await createUser(context.baseUrl, 'space-owner@example.com');
    const other = await createUser(context.baseUrl, 'space-other@example.com');
    const first = await createAssistant(context.baseUrl, owner.userId, 'First assistant');
    const second = await createAssistant(context.baseUrl, owner.userId, 'Second assistant');
    const foreign = await createAssistant(context.baseUrl, other.userId, 'Foreign assistant');

    const initialSpace = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/user-space`,
    );
    assert.equal(initialSpace.response.status, 200);
    assert.equal(initialSpace.body.data.identity.mode, 'development_unverified');
    assert.equal(initialSpace.body.data.identity.verified, false);
    assert.equal(initialSpace.body.data.identity.authenticationStatus, 'not_connected');
    assert.equal(initialSpace.body.data.currentAssistantId, first.subjectId);

    const assistants = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/user-space/assistants`,
    );
    assert.equal(assistants.body.meta.count, 2);
    assert.deepEqual(
      assistants.body.data.map((assistant) => [assistant.assistantId, assistant.current]),
      [[first.subjectId, true], [second.subjectId, false]],
    );

    const firstSettings = await patchJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/subjects/${first.subjectId}/global-settings`,
      { personalityDescription: 'First assistant boundary.' },
    );
    const secondSettings = await patchJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/subjects/${second.subjectId}/global-settings`,
      { personalityDescription: 'Second assistant boundary.' },
    );
    assert.equal(firstSettings.response.status, 200);
    assert.equal(secondSettings.response.status, 200);

    const firstEvent = await createEvent(
      context.baseUrl,
      owner.userId,
      first.subjectId,
      'First assistant state source.',
    );
    const secondEvent = await createEvent(
      context.baseUrl,
      owner.userId,
      second.subjectId,
      'Second assistant state source.',
    );
    const firstState = await createState(
      context.baseUrl,
      owner.userId,
      first.subjectId,
      firstEvent.eventId,
      'focused',
    );
    const secondState = await createState(
      context.baseUrl,
      owner.userId,
      second.subjectId,
      secondEvent.eventId,
      'calm',
    );

    const switched = await patchJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/user-space/current-assistant`,
      { assistantId: second.subjectId },
    );
    assert.equal(switched.response.status, 200);
    assert.equal(switched.body.data.userSpace.currentAssistantId, second.subjectId);
    assert.equal(switched.body.data.assistant.current, true);

    const crossUserSwitch = await patchJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/user-space/current-assistant`,
      { assistantId: foreign.subjectId },
    );
    assert.equal(crossUserSwitch.response.status, 404);

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);

    const current = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/user-space/current-assistant`,
    );
    assert.equal(current.body.data.assistant.assistantId, second.subjectId);
    const persistedFirstSettings = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/subjects/${first.subjectId}/global-settings`,
    );
    const persistedSecondSettings = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/subjects/${second.subjectId}/global-settings`,
    );
    assert.equal(
      persistedFirstSettings.body.data.personalityDescription,
      'First assistant boundary.',
    );
    assert.equal(
      persistedSecondSettings.body.data.personalityDescription,
      'Second assistant boundary.',
    );
    const persistedFirstState = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/subjects/${first.subjectId}/state`,
    );
    const persistedSecondState = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/subjects/${second.subjectId}/state`,
    );
    assert.equal(persistedFirstState.body.data.subjectStateId, firstState.subjectStateId);
    assert.equal(persistedFirstState.body.data.emotion, 'focused');
    assert.equal(persistedSecondState.body.data.subjectStateId, secondState.subjectStateId);
    assert.equal(persistedSecondState.body.data.emotion, 'calm');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('data isolation verifies ownership before Permission and Security Policy', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const owner = await createUser(context.baseUrl, 'isolation-owner@example.com');
    const other = await createUser(context.baseUrl, 'isolation-other@example.com');
    const assistant = await createAssistant(context.baseUrl, owner.userId, 'Owner assistant');
    const foreignAssistant = await createAssistant(
      context.baseUrl,
      other.userId,
      'Other assistant',
    );
    const userSpace = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/user-space`,
    );

    const boundaries = await getJson(context.baseUrl, '/api/v1/data-access-boundaries');
    assert.equal(boundaries.response.status, 200);
    assert.equal(boundaries.body.meta.count, 13);
    assert.deepEqual(
      new Set(boundaries.body.data.map((boundary) => boundary.dataCategory)),
      new Set(['user_data', 'ai_data', 'device_data', 'life_data', 'event_data']),
    );

    const directUserSpace = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        resourceType: 'user_space',
        resourceId: userSpace.body.data.spaceId,
        action: 'read',
      },
    );
    assert.equal(directUserSpace.response.status, 200);
    assert.equal(directUserSpace.body.data.operationStatus, 'ready');
    assert.equal(directUserSpace.body.data.ownership.verified, true);
    assert.equal(directUserSpace.body.data.boundary.permissionRequired, false);
    assert.equal(directUserSpace.body.data.execution.status, 'not_executed');

    const ambiguousUserSpace = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        resourceType: 'user_space',
        resourceId: userSpace.body.data.spaceId,
        assistantId: assistant.subjectId,
        action: 'read',
      },
    );
    assert.equal(ambiguousUserSpace.response.status, 400);

    const directSettings = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        assistantId: assistant.subjectId,
        resourceType: 'assistant_global_settings',
        resourceId: assistant.subjectId,
        action: 'read',
      },
    );
    assert.equal(directSettings.response.status, 200);
    assert.deepEqual(directSettings.body.data.boundary.queryFilter, [
      'owner_user_id',
      'subject_id',
    ]);

    const event = await createEvent(
      context.baseUrl,
      owner.userId,
      assistant.subjectId,
      'Scoped event.',
    );
    const scopedEvent = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        assistantId: assistant.subjectId,
        resourceType: 'event',
        resourceId: event.eventId,
        action: 'read',
      },
    );
    assert.equal(scopedEvent.body.data.ownership.assistantId, assistant.subjectId);
    const wrongEventScope = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        assistantId: foreignAssistant.subjectId,
        resourceType: 'event',
        resourceId: event.eventId,
        action: 'read',
      },
    );
    assert.equal(wrongEventScope.response.status, 404);

    const privateSpace = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/subjects/${assistant.subjectId}/private-spaces`,
      {},
    );
    assert.equal(privateSpace.response.status, 201);
    const privateCheck = (body = {}) => postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        assistantId: assistant.subjectId,
        resourceType: 'assistant_private_space',
        resourceId: privateSpace.body.data.spaceId,
        action: 'read',
        ...body,
      },
    );
    const deniedPrivate = await privateCheck();
    assert.equal(deniedPrivate.body.data.operationStatus, 'denied');
    assert.equal(deniedPrivate.body.data.access.permission.decision, 'deny');

    const privatePermission = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/permissions`,
      {
        subjectId: assistant.subjectId,
        resourceType: 'private_domain',
        resourceId: privateSpace.body.data.spaceId,
        action: 'read',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(privatePermission.response.status, 201);
    const confirmationRequired = await privateCheck();
    assert.equal(confirmationRequired.body.data.operationStatus, 'confirmation_required');
    assert.equal(confirmationRequired.body.data.access.risk.level, 'high');
    assert.equal(confirmationRequired.body.data.access.securityPolicy.decision, 'confirm');

    const denyPolicy = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/security-policies`,
      {
        resourceType: 'private_domain',
        actionType: 'read',
        riskLevel: 'high',
        rule: 'deny',
      },
    );
    assert.equal(denyPolicy.response.status, 201);
    const policyDenied = await privateCheck();
    assert.equal(policyDenied.body.data.operationStatus, 'denied');
    assert.equal(policyDenied.body.data.access.permission.decision, 'allow');
    assert.equal(policyDenied.body.data.access.securityPolicy.decision, 'deny');

    const crossUserPrivate = await postJson(
      context.baseUrl,
      `/api/v1/users/${other.userId}/data-access-checks`,
      {
        assistantId: foreignAssistant.subjectId,
        resourceType: 'assistant_private_space',
        resourceId: privateSpace.body.data.spaceId,
        action: 'read',
      },
    );
    assert.equal(crossUserPrivate.response.status, 404);

    const device = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/devices`,
      {
        deviceType: 'phone',
        brand: 'apple',
        name: 'Isolation test phone',
        capabilities: ['view_status'],
      },
    );
    const deviceAccess = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        assistantId: assistant.subjectId,
        resourceType: 'device',
        resourceId: device.body.data.device.deviceId,
        action: 'read',
      },
    );
    assert.equal(deviceAccess.body.data.resource.dataCategory, 'device_data');
    assert.equal(deviceAccess.body.data.operationStatus, 'denied');

    const financialRecordId = 'isolation-financial-record';
    const timestamp = '2026-07-28T12:00:00.000Z';
    context.application.database.connection.prepare(`
      INSERT INTO life_financial_records (
        financial_record_id, user_id, subject_id, entry_type, category,
        amount_minor, currency, occurred_at, note, created_at
      ) VALUES (?, ?, ?, 'expense', 'testing', 100, 'CNY', ?, NULL, ?)
    `).run(financialRecordId, owner.userId, assistant.subjectId, timestamp, timestamp);
    const wrongLifeAssistant = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        assistantId: foreignAssistant.subjectId,
        resourceType: 'life_financial_record',
        resourceId: financialRecordId,
        action: 'read',
      },
    );
    assert.equal(wrongLifeAssistant.response.status, 404);

    const lifePermission = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/permissions`,
      {
        subjectId: assistant.subjectId,
        resourceType: 'life_data',
        resourceId: 'finance',
        action: 'read',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(lifePermission.response.status, 201);
    const lifeAccess = await postJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/data-access-checks`,
      {
        assistantId: assistant.subjectId,
        resourceType: 'life_financial_record',
        resourceId: financialRecordId,
        action: 'read',
      },
    );
    assert.equal(lifeAccess.body.data.resource.dataCategory, 'life_data');
    assert.equal(lifeAccess.body.data.boundary.permissionResourceId, 'finance');
    assert.equal(lifeAccess.body.data.operationStatus, 'confirmation_required');
    assert.equal(lifeAccess.body.data.execution.externalServiceCall, 'not_performed');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
