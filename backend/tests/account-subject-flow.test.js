import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

test('user and subject complete a persisted create-read loop', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);
  let userId;
  let subjectId;

  try {
    const createUserResult = await postJson(context.baseUrl, '/api/v1/users', {
      email: 'Owner@Example.com',
      displayName: 'Vio Owner',
    });
    assert.equal(createUserResult.response.status, 201);
    assert.match(createUserResult.body.data.userId, /^[0-9a-f-]{36}$/);
    assert.equal(createUserResult.body.data.email, 'owner@example.com');
    assert.equal(createUserResult.body.data.status, 'active');
    userId = createUserResult.body.data.userId;

    const readUserResult = await getJson(context.baseUrl, `/api/v1/users/${userId}`);
    assert.equal(readUserResult.response.status, 200);
    assert.equal(readUserResult.body.data.userId, userId);
    assert.equal(readUserResult.body.data.displayName, 'Vio Owner');

    const createSubjectResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects`,
      {
        name: 'Vio',
        avatarRef: 'asset://avatars/vio-default',
        basicSettings: {
          positioning: 'life-companion',
          responseStyle: 'warm-and-clear',
        },
      },
    );
    assert.equal(createSubjectResult.response.status, 201);
    assert.match(createSubjectResult.body.data.subjectId, /^[0-9a-f-]{36}$/);
    assert.equal(createSubjectResult.body.data.ownerUserId, userId);
    assert.equal(createSubjectResult.body.data.status, 'active');
    subjectId = createSubjectResult.body.data.subjectId;

    const readSubjectResult = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}`,
    );
    assert.equal(readSubjectResult.response.status, 200);
    assert.equal(readSubjectResult.body.data.name, 'Vio');
    assert.deepEqual(readSubjectResult.body.data.basicSettings, {
      positioning: 'life-companion',
      responseStyle: 'warm-and-clear',
    });

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);

    const persistedUserResult = await getJson(context.baseUrl, `/api/v1/users/${userId}`);
    assert.equal(persistedUserResult.response.status, 200);
    assert.equal(persistedUserResult.body.data.email, 'owner@example.com');

    const persistedSubjectResult = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}`,
    );
    assert.equal(persistedSubjectResult.response.status, 200);
    assert.equal(persistedSubjectResult.body.data.subjectId, subjectId);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('duplicate users and cross-user subject reads are rejected', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const firstUser = await postJson(context.baseUrl, '/api/v1/users', {
      email: 'first@example.com',
    });
    const duplicateUser = await postJson(context.baseUrl, '/api/v1/users', {
      email: 'FIRST@example.com',
    });
    const secondUser = await postJson(context.baseUrl, '/api/v1/users', {
      email: 'second@example.com',
    });
    const subject = await postJson(
      context.baseUrl,
      `/api/v1/users/${firstUser.body.data.userId}/subjects`,
      { name: 'Private Subject', basicSettings: {} },
    );

    assert.equal(duplicateUser.response.status, 409);
    assert.equal(duplicateUser.body.error.code, 'conflict');

    const crossUserRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${secondUser.body.data.userId}/subjects/${subject.body.data.subjectId}`,
    );
    assert.equal(crossUserRead.response.status, 404);
    assert.equal(crossUserRead.body.error.code, 'not_found');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
