import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

function assertEnvelope(body, success) {
  assert.equal(body.success, success);
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));

  if (success) {
    assert.equal(body.error, null);
    assert.notEqual(body.data, null);
    return;
  }

  assert.equal(body.data, null);
  assert.equal(typeof body.error?.code, 'string');
  assert.equal(typeof body.error?.message, 'string');
  assert.equal(typeof body.error?.requestId, 'string');
}

function subjectPath(userId, subjectId) {
  return `/api/v1/users/${encodeURIComponent(userId)}/subjects/${encodeURIComponent(subjectId)}`;
}

async function createUser(baseUrl, email) {
  const result = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(result.response.status, 201);
  return result.body.data;
}

async function createSubject(baseUrl, userId, name = 'Vio Global') {
  const result = await postJson(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(userId)}/subjects`,
    {
      name,
      avatarRef: 'builtin-avatar:initial',
      basicSettings: { legacyPreference: 'preserved' },
    },
  );
  assert.equal(result.response.status, 201);
  return result.body.data;
}

function completeSettings() {
  return {
    name: 'Vio Long-Term',
    avatarRef: 'asset://vio-long-term',
    personalityDescription: 'Warm, observant, candid, and consistent across windows.',
    expressionStyle: {
      tone: 'warm_and_clear',
      verbosity: 'balanced',
      preferredLanguage: 'zh-CN',
    },
    relationshipDefinition: 'A trusted long-term AI companion owned by this user.',
    longTermRequirements: [
      'Keep decisions traceable.',
      'Distinguish known facts from assumptions.',
    ],
    prohibitions: [
      'Do not impersonate the user.',
      'Do not weaken platform safety rules.',
    ],
  };
}

test('assistant global settings update, persist and appear in context across windows', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'global-settings@example.com');
    const subject = await createSubject(context.baseUrl, user.userId);
    const path = `${subjectPath(user.userId, subject.subjectId)}/global-settings`;

    const initial = await getJson(context.baseUrl, path);
    assert.equal(initial.response.status, 200);
    assertEnvelope(initial.body, true);
    assert.deepEqual(
      {
        name: initial.body.data.name,
        avatarRef: initial.body.data.avatarRef,
        personalityDescription: initial.body.data.personalityDescription,
        expressionStyle: initial.body.data.expressionStyle,
        relationshipDefinition: initial.body.data.relationshipDefinition,
        longTermRequirements: initial.body.data.longTermRequirements,
        prohibitions: initial.body.data.prohibitions,
      },
      {
        name: 'Vio Global',
        avatarRef: 'builtin-avatar:initial',
        personalityDescription: '',
        expressionStyle: {},
        relationshipDefinition: '',
        longTermRequirements: [],
        prohibitions: [],
      },
    );

    const settingsInput = completeSettings();
    const updated = await patchJson(context.baseUrl, path, settingsInput);
    assert.equal(updated.response.status, 200);
    assertEnvelope(updated.body, true);
    assert.deepEqual(
      Object.fromEntries(Object.keys(settingsInput).map((key) => [key, updated.body.data[key]])),
      settingsInput,
    );

    const currentSubject = await getJson(
      context.baseUrl,
      subjectPath(user.userId, subject.subjectId),
    );
    assert.equal(currentSubject.body.data.name, settingsInput.name);
    assert.equal(currentSubject.body.data.avatarRef, settingsInput.avatarRef);
    assert.deepEqual(currentSubject.body.data.basicSettings, {
      legacyPreference: 'preserved',
    });

    const conversation = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/conversations`,
      { title: 'Global settings context' },
    );
    assert.equal(conversation.response.status, 201);
    const assembled = await getJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/conversations/${conversation.body.data.conversationId}/context`,
    );
    assert.equal(assembled.response.status, 200);
    assertEnvelope(assembled.body, true);
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(settingsInput).map((key) => [
          key,
          assembled.body.data.sections.subjectGlobalSettings[key],
        ]),
      ),
      settingsInput,
    );
    assert.equal(assembled.body.data.sections.currentSubjectState, null);
    assert.deepEqual(assembled.body.data.execution, {
      modelCall: 'not_performed',
      externalApiCall: 'not_performed',
      continuityEngineCall: 'not_performed',
    });

    const events = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/events?subjectId=${subject.subjectId}&eventType=subject_updated`,
    );
    assert.equal(events.body.meta.count, 1);
    assert.deepEqual(events.body.data[0].data.changedFields, Object.keys(settingsInput));
    assert.deepEqual(events.body.data[0].source, {
      type: 'assistant-global-settings-service',
      reference: subject.subjectId,
    });

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persisted = await getJson(context.baseUrl, path);
    assert.equal(persisted.response.status, 200);
    assert.deepEqual(
      Object.fromEntries(Object.keys(settingsInput).map((key) => [key, persisted.body.data[key]])),
      settingsInput,
    );
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('global settings enforce ownership, input shape, no-op behavior and state separation', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const owner = await createUser(context.baseUrl, 'global-owner@example.com');
    const other = await createUser(context.baseUrl, 'global-other@example.com');
    const subject = await createSubject(context.baseUrl, owner.userId, 'Vio Isolated');
    const path = `${subjectPath(owner.userId, subject.subjectId)}/global-settings`;

    const crossUserRead = await getJson(
      context.baseUrl,
      `${subjectPath(other.userId, subject.subjectId)}/global-settings`,
    );
    assert.equal(crossUserRead.response.status, 404);
    assertEnvelope(crossUserRead.body, false);

    const crossUserUpdate = await patchJson(
      context.baseUrl,
      `${subjectPath(other.userId, subject.subjectId)}/global-settings`,
      { personalityDescription: 'Must not cross users.' },
    );
    assert.equal(crossUserUpdate.response.status, 404);

    for (const invalidInput of [
      {},
      { currentState: { mood: 'calm' } },
      { expressionStyle: [] },
      { expressionStyle: { apiKey: 'not-a-real-key' } },
      { longTermRequirements: ['same', 'same'] },
      { prohibitions: 'not-an-array' },
    ]) {
      const invalid = await patchJson(context.baseUrl, path, invalidInput);
      assert.equal(invalid.response.status, 400);
      assertEnvelope(invalid.body, false);
    }

    const firstUpdate = await patchJson(context.baseUrl, path, {
      personalityDescription: 'Stable long-term identity.',
      longTermRequirements: ['Preserve user ownership boundaries.'],
    });
    assert.equal(firstUpdate.response.status, 200);
    const noChange = await patchJson(context.baseUrl, path, {
      personalityDescription: 'Stable long-term identity.',
      longTermRequirements: ['Preserve user ownership boundaries.'],
    });
    assert.equal(noChange.response.status, 200);
    assert.equal(noChange.body.data.updatedAt, firstUpdate.body.data.updatedAt);

    const events = await getJson(
      context.baseUrl,
      `/api/v1/users/${owner.userId}/events?subjectId=${subject.subjectId}&eventType=subject_updated`,
    );
    assert.equal(events.body.meta.count, 1);

    const currentState = await getJson(
      context.baseUrl,
      `${subjectPath(owner.userId, subject.subjectId)}/state`,
    );
    assert.equal(currentState.response.status, 200);
    assert.equal(currentState.body.data, null);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('global settings, subject identity and update event roll back together', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'global-rollback@example.com');
    const subject = await createSubject(context.baseUrl, user.userId, 'Before Rollback');
    const path = `${subjectPath(user.userId, subject.subjectId)}/global-settings`;
    context.application.database.connection.exec(`
      CREATE TRIGGER reject_global_settings_event
      BEFORE INSERT ON events
      WHEN NEW.event_type = 'subject_updated'
      BEGIN
        SELECT RAISE(ABORT, 'forced global settings event failure');
      END;
    `);

    const failed = await patchJson(context.baseUrl, path, {
      name: 'Must Roll Back',
      personalityDescription: 'This value must also roll back.',
    });
    assert.equal(failed.response.status, 500);
    assertEnvelope(failed.body, false);

    const persisted = await getJson(context.baseUrl, path);
    assert.equal(persisted.response.status, 200);
    assert.equal(persisted.body.data.name, 'Before Rollback');
    assert.equal(persisted.body.data.personalityDescription, '');

    const events = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/events?subjectId=${subject.subjectId}&eventType=subject_updated`,
    );
    assert.equal(events.body.meta.count, 0);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
