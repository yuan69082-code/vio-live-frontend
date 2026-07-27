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
  } else {
    assert.equal(body.data, null);
    assert.equal(typeof body.error?.code, 'string');
    assert.equal(typeof body.error?.message, 'string');
    assert.equal(typeof body.error?.requestId, 'string');
  }
}

async function createUser(baseUrl, email) {
  const result = await postJson(baseUrl, '/api/v1/users', {
    email,
    displayName: 'API Owner',
  });
  assert.equal(result.response.status, 201);
  assertEnvelope(result.body, true);
  return result.body.data;
}

async function createSubject(baseUrl, userId, input) {
  const result = await postJson(baseUrl, `/api/v1/users/${userId}/subjects`, input);
  assert.equal(result.response.status, 201);
  assertEnvelope(result.body, true);
  return result.body.data;
}

test('User, Subject and Dashboard APIs share one envelope and persisted data flow', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'api-connection@example.com');
    const otherUser = await createUser(context.baseUrl, 'api-connection-other@example.com');

    const missingCurrentContext = await getJson(
      context.baseUrl,
      '/api/v1/users/current',
    );
    assert.equal(missingCurrentContext.response.status, 400);
    assertEnvelope(missingCurrentContext.body, false);
    assert.equal(missingCurrentContext.body.error.code, 'validation_error');

    const currentUser = await getJson(
      context.baseUrl,
      '/api/v1/users/current',
      { headers: { 'x-vio-user-id': user.userId } },
    );
    assert.equal(currentUser.response.status, 200);
    assertEnvelope(currentUser.body, true);
    assert.equal(currentUser.body.data.userId, user.userId);

    const subject = await createSubject(context.baseUrl, user.userId, {
      name: 'Vio API',
      avatarRef: 'builtin-avatar:spark',
      basicSettings: { positioning: 'companion', removeAfterUpdate: true },
    });
    const secondSubject = await createSubject(context.baseUrl, user.userId, {
      name: 'Vio Second',
      basicSettings: {},
    });

    const firstList = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects`,
    );
    const secondList = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects`,
    );
    assert.equal(firstList.response.status, 200);
    assertEnvelope(firstList.body, true);
    assert.equal(firstList.body.meta.count, 2);
    assert.deepEqual(firstList.body.data, secondList.body.data);
    assert.deepEqual(
      new Set(firstList.body.data.map((item) => item.subjectId)),
      new Set([subject.subjectId, secondSubject.subjectId]),
    );

    const updated = await patchJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}`,
      {
        name: 'Vio Connected',
        avatarRef: 'builtin-avatar:moon',
        basicSettings: { responseStyle: 'warm-and-clear' },
      },
    );
    assert.equal(updated.response.status, 200);
    assertEnvelope(updated.body, true);
    assert.equal(updated.body.data.name, 'Vio Connected');
    assert.equal(updated.body.data.avatarRef, 'builtin-avatar:moon');
    assert.deepEqual(updated.body.data.basicSettings, {
      responseStyle: 'warm-and-clear',
    });

    const updateEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/events?subjectId=${subject.subjectId}&eventType=subject_updated`,
    );
    assert.equal(updateEvents.response.status, 200);
    assert.equal(updateEvents.body.meta.count, 1);
    assert.deepEqual(updateEvents.body.data[0].data.changedFields, [
      'name',
      'avatarRef',
      'basicSettings',
    ]);
    assert.deepEqual(updateEvents.body.data[0].source, {
      type: 'subject-service',
      reference: subject.subjectId,
    });

    const noChange = await patchJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}`,
      {
        name: 'Vio Connected',
        avatarRef: 'builtin-avatar:moon',
        basicSettings: { responseStyle: 'warm-and-clear' },
      },
    );
    assert.equal(noChange.response.status, 200);
    assert.equal(noChange.body.data.updatedAt, updated.body.data.updatedAt);
    const eventsAfterNoChange = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/events?subjectId=${subject.subjectId}&eventType=subject_updated`,
    );
    assert.equal(eventsAfterNoChange.body.meta.count, 1);

    const clearedAvatar = await patchJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}`,
      { avatarRef: null },
    );
    assert.equal(clearedAvatar.response.status, 200);
    assert.equal(clearedAvatar.body.data.avatarRef, null);

    const dashboard = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}/dashboard`,
    );
    assert.equal(dashboard.response.status, 200);
    assertEnvelope(dashboard.body, true);
    assert.equal(dashboard.body.data.user.userId, user.userId);
    assert.equal(dashboard.body.data.subject.subjectId, subject.subjectId);
    assert.deepEqual(dashboard.body.data.basicStatus, {
      userStatus: 'active',
      subjectStatus: 'active',
      ready: true,
      continuityStatus: 'not_available',
    });

    const crossUserDashboard = await getJson(
      context.baseUrl,
      `/api/v1/users/${otherUser.userId}/subjects/${subject.subjectId}/dashboard`,
    );
    assert.equal(crossUserDashboard.response.status, 404);
    assertEnvelope(crossUserDashboard.body, false);

    const crossUserUpdate = await patchJson(
      context.baseUrl,
      `/api/v1/users/${otherUser.userId}/subjects/${subject.subjectId}`,
      { name: 'Must Stay Isolated' },
    );
    assert.equal(crossUserUpdate.response.status, 404);
    assertEnvelope(crossUserUpdate.body, false);

    const subjectAfterCrossUserUpdate = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}`,
    );
    assert.equal(subjectAfterCrossUserUpdate.response.status, 200);
    assert.equal(subjectAfterCrossUserUpdate.body.data.name, 'Vio Connected');

    const emptyPatch = await patchJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}`,
      {},
    );
    assert.equal(emptyPatch.response.status, 400);
    assertEnvelope(emptyPatch.body, false);

    const unsupportedPatch = await patchJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}`,
      { status: 'disabled' },
    );
    assert.equal(unsupportedPatch.response.status, 400);
    assertEnvelope(unsupportedPatch.body, false);

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persistedDashboard = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}/dashboard`,
    );
    assert.equal(persistedDashboard.response.status, 200);
    assert.equal(persistedDashboard.body.data.subject.name, 'Vio Connected');
    assert.equal(persistedDashboard.body.data.subject.avatarRef, null);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('Subject update and subject_updated Event roll back together', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'api-rollback@example.com');
    const subject = await createSubject(context.baseUrl, user.userId, {
      name: 'Before Rollback',
      basicSettings: {},
    });
    context.application.database.connection.exec(`
      CREATE TRIGGER reject_subject_updated_event
      BEFORE INSERT ON events
      WHEN NEW.event_type = 'subject_updated'
      BEGIN
        SELECT RAISE(ABORT, 'forced subject event failure');
      END;
    `);

    const failedUpdate = await patchJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}`,
      { name: 'Must Roll Back' },
    );
    assert.equal(failedUpdate.response.status, 500);
    assertEnvelope(failedUpdate.body, false);
    assert.equal(failedUpdate.body.error.code, 'internal_error');

    const persistedSubject = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/subjects/${subject.subjectId}`,
    );
    assert.equal(persistedSubject.response.status, 200);
    assert.equal(persistedSubject.body.data.name, 'Before Rollback');

    const events = await getJson(
      context.baseUrl,
      `/api/v1/users/${user.userId}/events?subjectId=${subject.subjectId}&eventType=subject_updated`,
    );
    assert.equal(events.response.status, 200);
    assert.equal(events.body.meta.count, 0);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
