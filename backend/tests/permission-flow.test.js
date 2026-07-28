import assert from 'node:assert/strict';
import test from 'node:test';

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
  const subjectResult = await postJson(baseUrl, `/api/v1/users/${userId}/subjects`, {
    name: 'Permission Subject',
    basicSettings: {},
  });
  assert.equal(subjectResult.response.status, 201);

  return {
    userId,
    subjectId: subjectResult.body.data.subjectId,
  };
}

function permissionInput(subjectId, overrides = {}) {
  return {
    subjectId,
    resourceType: 'memory',
    resourceId: 'memory-alpha',
    action: 'read',
    permissionLevel: 'always_allow',
    ...overrides,
  };
}

async function checkPermission(baseUrl, userId, input) {
  return postJson(baseUrl, `/api/v1/users/${userId}/permission-checks`, input);
}

test('permission rules support CRUD, three-state checks and event linkage', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'permission-crud@example.com',
    );
    const scope = {
      subjectId,
      resourceType: 'memory',
      resourceId: 'memory-alpha',
      action: 'read',
    };
    const created = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions`,
      permissionInput(subjectId),
    );
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.permissionLevel, 'always_allow');
    assert.equal(created.body.data.status, 'active');
    const permissionId = created.body.data.permissionId;

    const permissionRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permissionId}`,
    );
    assert.equal(permissionRead.response.status, 200);
    assert.equal(permissionRead.body.data.resourceId, 'memory-alpha');

    const permissionList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions?subjectId=${encodeURIComponent(subjectId)}&resourceType=memory&action=read`,
    );
    assert.equal(permissionList.response.status, 200);
    assert.equal(permissionList.body.meta.count, 1);

    const allowed = await checkPermission(context.baseUrl, userId, scope);
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.data.decision, 'allow');
    assert.equal(allowed.body.data.reason, 'always_allow');

    const askRule = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permissionId}`,
      { permissionLevel: 'ask_every_time' },
    );
    assert.equal(askRule.response.status, 200);
    const ask = await checkPermission(context.baseUrl, userId, scope);
    assert.equal(ask.body.data.decision, 'ask');

    const deniedRule = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permissionId}`,
      { permissionLevel: 'denied' },
    );
    assert.equal(deniedRule.response.status, 200);
    const denied = await checkPermission(context.baseUrl, userId, scope);
    assert.equal(denied.body.data.decision, 'deny');
    assert.equal(denied.body.data.canAsk, true);

    const forbiddenRule = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permissionId}`,
      { permissionLevel: 'forbidden_ask' },
    );
    assert.equal(forbiddenRule.response.status, 200);
    const forbidden = await checkPermission(context.baseUrl, userId, scope);
    assert.equal(forbidden.body.data.decision, 'deny');
    assert.equal(forbidden.body.data.canAsk, false);

    const deleted = await deleteJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permissionId}`,
    );
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.data.status, 'deleted');

    const afterDelete = await checkPermission(context.baseUrl, userId, scope);
    assert.equal(afterDelete.body.data.decision, 'deny');
    assert.equal(afterDelete.body.data.reason, 'no_active_rule');

    const currentPermissions = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions`,
    );
    assert.equal(currentPermissions.body.meta.count, 0);

    const deletedPermissions = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions?status=deleted`,
    );
    assert.equal(deletedPermissions.body.meta.count, 1);

    const changedEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=permission_changed`,
    );
    assert.equal(changedEvents.response.status, 200);
    assert.equal(changedEvents.body.meta.count, 3);
    const createdEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=permission_created`,
    );
    const revokedEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=permission_revoked`,
    );
    assert.equal(createdEvents.body.meta.count, 1);
    assert.equal(revokedEvents.body.meta.count, 1);
    const permissionEvents = [
      ...createdEvents.body.data,
      ...changedEvents.body.data,
      ...revokedEvents.body.data,
    ];
    assert.deepEqual(
      new Set(permissionEvents.map((event) => event.data.changeType)),
      new Set(['created', 'updated', 'deleted']),
    );
    assert.ok(permissionEvents.every((event) => (
      event.subjectId === subjectId
      && event.source.type === 'permission-service'
      && event.source.reference === permissionId
    )));

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);

    const persistedDeleted = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions?status=deleted`,
    );
    assert.equal(persistedDeleted.body.meta.count, 1);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('allow-once, resource types and user-subject isolation are enforced', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const first = await createUserAndSubject(context.baseUrl, 'first-permission@example.com');
    const second = await createUserAndSubject(context.baseUrl, 'second-permission@example.com');
    const oneTimeScope = {
      subjectId: first.subjectId,
      resourceType: 'tool',
      resourceId: 'tool-once',
      action: 'execute',
    };
    const oneTimeRule = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/permissions`,
      {
        ...oneTimeScope,
        permissionLevel: 'allow_once',
      },
    );
    assert.equal(oneTimeRule.response.status, 201);
    const oneTimePermissionId = oneTimeRule.body.data.permissionId;

    const firstCheck = await checkPermission(context.baseUrl, first.userId, oneTimeScope);
    assert.equal(firstCheck.response.status, 200);
    assert.equal(firstCheck.body.data.decision, 'allow');
    assert.equal(firstCheck.body.data.permissionStatus, 'consumed');

    const secondCheck = await checkPermission(context.baseUrl, first.userId, oneTimeScope);
    assert.equal(secondCheck.body.data.decision, 'deny');
    assert.equal(secondCheck.body.data.reason, 'no_active_rule');

    const consumedRule = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/permissions/${oneTimePermissionId}`,
    );
    assert.equal(consumedRule.body.data.status, 'consumed');

    const resourceTypes = [
      'memory',
      'mcp',
      'skill',
      'device',
      'api',
      'private_domain',
    ];

    for (const resourceType of resourceTypes) {
      const result = await postJson(
        context.baseUrl,
        `/api/v1/users/${first.userId}/permissions`,
        permissionInput(first.subjectId, {
          resourceType,
          resourceId: `${resourceType}-resource`,
          status: 'inactive',
        }),
      );
      assert.equal(result.response.status, 201);
    }

    const crossUserRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/permissions/${oneTimePermissionId}`,
    );
    assert.equal(crossUserRead.response.status, 404);

    const crossUserSubject = await postJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/permissions`,
      permissionInput(first.subjectId),
    );
    assert.equal(crossUserSubject.response.status, 404);

    const crossUserCheck = await checkPermission(context.baseUrl, second.userId, oneTimeScope);
    assert.equal(crossUserCheck.response.status, 404);

    const invalidResource = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/permissions`,
      permissionInput(first.subjectId, {
        resourceType: 'phone',
        resourceId: 'phone-resource',
      }),
    );
    assert.equal(invalidResource.response.status, 400);

    const invalidLevel = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/permissions`,
      permissionInput(first.subjectId, {
        resourceId: 'invalid-level',
        permissionLevel: 'session_allow',
      }),
    );
    assert.equal(invalidLevel.response.status, 400);

    const consumedEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/events?eventType=permission_changed`,
    );
    assert.ok(consumedEvents.body.data.some((event) => (
      event.data.permissionId === oneTimePermissionId
      && event.data.changeType === 'consumed'
    )));
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
