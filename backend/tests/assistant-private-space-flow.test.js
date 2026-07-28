import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

async function createUserAndAssistant(baseUrl, email) {
  const user = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(user.response.status, 201);
  const userId = user.body.data.userId;
  const assistant = await postJson(baseUrl, `/api/v1/users/${userId}/subjects`, {
    name: 'Private Space Assistant',
    basicSettings: {},
  });
  assert.equal(assistant.response.status, 201);
  return { userId, assistantId: assistant.body.data.subjectId };
}

async function createPrivateSpace(baseUrl, userId, assistantId) {
  return postJson(
    baseUrl,
    `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces`,
    {},
  );
}

async function grantPrivateActions(baseUrl, userId, assistantId, spaceId, actions) {
  for (const action of actions) {
    const permission = await postJson(baseUrl, `/api/v1/users/${userId}/permissions`, {
      subjectId: assistantId,
      resourceType: 'private_domain',
      resourceId: spaceId,
      action,
      permissionLevel: 'always_allow',
    });
    assert.equal(permission.response.status, 201);
  }
}

async function confirmedRequest(baseUrl, userId, request, payload = {}) {
  const first = await request(payload);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.operationStatus, 'confirmation_required');
  assert.equal(first.body.data.result, null);
  assert.equal(first.body.data.access.decision, 'confirm');
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
  assert.ok([200, 201].includes(completed.response.status));
  assert.equal(completed.body.data.operationStatus, 'completed');
  assert.equal(completed.body.data.access.decision, 'allow');
  assert.equal(completed.body.data.access.executionStatus, 'not_executed');
  return completed;
}

test('AI private space stores five versioned content types behind Permission and Security', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, assistantId } = await createUserAndAssistant(
      context.baseUrl,
      'private-space-flow@example.com',
    );
    const createdSpace = await createPrivateSpace(context.baseUrl, userId, assistantId);
    assert.equal(createdSpace.response.status, 201);
    const space = createdSpace.body.data;
    assert.equal(space.assistantId, assistantId);
    assert.equal(space.status, 'active');
    assert.equal(space.storageScope, 'assistant_private_space');
    assert.equal(space.userSpaceIncluded, false);

    await grantPrivateActions(
      context.baseUrl,
      userId,
      assistantId,
      space.spaceId,
      ['read', 'write', 'manage', 'export'],
    );

    const currentSpace = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/current/read`,
        body,
      ),
    );
    assert.equal(currentSpace.body.data.result.spaceId, space.spaceId);

    const contentInputs = [
      ['ai_state_record', { mood: 'focused', intensity: 0.7 }],
      ['ai_cognition_record', { observation: 'Prefer explicit boundaries.' }],
      ['ai_long_term_preference', { preference: 'Use concise summaries.' }],
      ['ai_work_record', { task: 'Prepared a private outline.' }],
      ['ai_private_note', { note: 'Private note for context tests.' }],
    ];
    const createdContent = [];
    for (const [contentType, content] of contentInputs) {
      const result = await confirmedRequest(
        context.baseUrl,
        userId,
        (body) => postJson(
          context.baseUrl,
          `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${space.spaceId}/contents`,
          body,
        ),
        { contentType, content },
      );
      assert.equal(result.response.status, 201);
      assert.equal(result.body.data.result.contentType, contentType);
      assert.equal(result.body.data.result.versionNumber, 1);
      assert.equal(result.body.data.result.sourceType, 'explicit_api_input');
      createdContent.push(result.body.data.result);
    }

    const state = createdContent[0];
    const directRead = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${space.spaceId}/contents/${state.contentId}/read`,
        body,
      ),
    );
    assert.equal(directRead.body.data.result.content.mood, 'focused');
    const updated = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => patchJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${space.spaceId}/contents/${state.contentId}`,
        body,
      ),
      {
        baseVersionId: state.contentVersionId,
        content: { mood: 'calm', intensity: 0.5 },
      },
    );
    assert.equal(updated.body.data.result.versionNumber, 2);
    assert.equal(updated.body.data.result.parentVersionId, state.contentVersionId);

    const versions = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${space.spaceId}/contents/${state.contentId}/versions/query`,
        body,
      ),
    );
    assert.deepEqual(
      versions.body.data.result.map((version) => version.versionNumber),
      [2, 1],
    );
    assert.equal(versions.body.data.result[1].content.mood, 'focused');

    const queried = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${space.spaceId}/contents/query`,
        body,
      ),
      { limit: 10 },
    );
    assert.equal(queried.body.data.result.length, 5);
    assert.equal(
      queried.body.data.result.find((item) => item.contentId === state.contentId).versionNumber,
      2,
    );

    const projection = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${space.spaceId}/context-projections`,
        body,
      ),
      { contentTypes: ['ai_state_record', 'ai_private_note'], limit: 10 },
    );
    assert.equal(projection.body.data.result.schemaVersion, 'assistant-private-context-v1');
    assert.equal(projection.body.data.result.userSpaceIncluded, false);
    assert.equal(projection.body.data.result.records.length, 2);
    assert.deepEqual(projection.body.data.result.execution, {
      modelCall: 'not_performed',
      externalApiCall: 'not_performed',
      continuityEngine: 'not_invoked',
    });

    const manifest = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${space.spaceId}/export-manifests`,
        body,
      ),
    );
    assert.equal(manifest.body.data.result.exportStatus, 'not_generated');
    assert.equal(manifest.body.data.result.contentIncluded, false);
    assert.equal(manifest.body.data.result.counts.contentCount, 5);
    assert.equal(manifest.body.data.result.counts.versionCount, 6);
    assert.equal(manifest.body.data.result.versions.length, 6);
    assert.ok(manifest.body.data.result.versions.every((version) => !('content' in version)));

    const spaceEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=private_space_created&subjectId=${assistantId}`,
    );
    assert.equal(spaceEvents.body.meta.count, 1);
    const stateEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=private_state_changed&subjectId=${assistantId}`,
    );
    assert.equal(stateEvents.body.meta.count, 2);
    const memoryEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=private_memory_updated&subjectId=${assistantId}`,
    );
    assert.equal(memoryEvents.body.meta.count, 4);
    const privateEventsText = JSON.stringify([
      ...spaceEvents.body.data,
      ...stateEvents.body.data,
      ...memoryEvents.body.data,
    ]);
    assert.equal(privateEventsText.includes('Private note for context tests.'), false);

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persisted = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${space.spaceId}/contents/query`,
        body,
      ),
      { contentType: 'ai_state_record' },
    );
    assert.equal(persisted.body.data.result.length, 1);
    assert.equal(persisted.body.data.result[0].content.mood, 'calm');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('AI private space isolation, input boundaries and policy denial prevent data disclosure', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const first = await createUserAndAssistant(
      context.baseUrl,
      'private-boundary@example.com',
    );
    const second = await createUserAndAssistant(
      context.baseUrl,
      'private-boundary-other@example.com',
    );
    const createdSpace = await createPrivateSpace(
      context.baseUrl,
      first.userId,
      first.assistantId,
    );
    const spaceId = createdSpace.body.data.spaceId;
    await grantPrivateActions(
      context.baseUrl,
      first.userId,
      first.assistantId,
      spaceId,
      ['read', 'write'],
    );

    const crossUser = await postJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/subjects/${second.assistantId}/private-spaces/${spaceId}/contents/query`,
      {},
    );
    assert.equal(crossUser.response.status, 404);

    const secretRejected = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.assistantId}/private-spaces/${spaceId}/contents`,
      {
        contentType: 'ai_private_note',
        content: { credentials: { apiKey: 'not-a-real-key' } },
      },
    );
    assert.equal(secretRejected.response.status, 400);
    assert.equal(secretRejected.body.error.code, 'validation_error');

    const emptyRejected = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.assistantId}/private-spaces/${spaceId}/contents`,
      { contentType: 'ai_private_note', content: {} },
    );
    assert.equal(emptyRejected.response.status, 400);

    const policy = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/security-policies`,
      {
        resourceType: 'private_domain',
        actionType: 'read',
        riskLevel: 'high',
        rule: 'deny',
      },
    );
    assert.equal(policy.response.status, 201);
    const denied = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.assistantId}/private-spaces/${spaceId}/contents/query`,
      {},
    );
    assert.equal(denied.response.status, 200);
    assert.equal(denied.body.data.operationStatus, 'denied');
    assert.equal(denied.body.data.result, null);
    assert.equal(denied.body.data.access.securityPolicy.reason, 'deny');

    const tables = context.application.database.connection.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('users', 'assistant_private_spaces', 'assistant_private_content_versions')
      ORDER BY name
    `).all().map((row) => row.name);
    assert.deepEqual(tables, [
      'assistant_private_content_versions',
      'assistant_private_spaces',
      'users',
    ]);
    assert.deepEqual(
      context.application.database.connection.prepare('PRAGMA foreign_key_check;').all(),
      [],
    );
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('AI private space status changes are gated and immutable history rejects direct mutation', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, assistantId } = await createUserAndAssistant(
      context.baseUrl,
      'private-status@example.com',
    );
    const createdSpace = await createPrivateSpace(context.baseUrl, userId, assistantId);
    const spaceId = createdSpace.body.data.spaceId;
    await grantPrivateActions(
      context.baseUrl,
      userId,
      assistantId,
      spaceId,
      ['read', 'write', 'manage'],
    );
    const created = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${spaceId}/contents`,
        body,
      ),
      { contentType: 'ai_private_note', content: { note: 'Immutable.' } },
    );
    const versionId = created.body.data.result.contentVersionId;

    assert.throws(() => context.application.database.connection.prepare(`
      UPDATE assistant_private_content_versions
      SET content_json = '{}'
      WHERE content_version_id = ?
    `).run(versionId), /immutable/);

    const deactivated = await confirmedRequest(
      context.baseUrl,
      userId,
      (body) => patchJson(
        context.baseUrl,
        `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${spaceId}/status`,
        body,
      ),
      { status: 'inactive' },
    );
    assert.equal(deactivated.body.data.result.status, 'inactive');

    const writeAttempt = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${spaceId}/contents`,
      { contentType: 'ai_private_note', content: { note: 'Blocked while inactive.' } },
    );
    assert.equal(writeAttempt.body.data.operationStatus, 'confirmation_required');
    const confirmationId = writeAttempt.body.data.access.confirmation.confirmationId;
    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    const blocked = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${spaceId}/contents`,
      {
        contentType: 'ai_private_note',
        content: { note: 'Blocked while inactive.' },
        confirmationId,
      },
    );
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.body.error.code, 'conflict');

    const readAttempt = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${spaceId}/contents/query`,
      {},
    );
    assert.equal(readAttempt.body.data.operationStatus, 'confirmation_required');
    const readConfirmationId = readAttempt.body.data.access.confirmation.confirmationId;
    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${readConfirmationId}`,
      { decision: 'approve' },
    );
    const blockedRead = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${assistantId}/private-spaces/${spaceId}/contents/query`,
      { confirmationId: readConfirmationId },
    );
    assert.equal(blockedRead.response.status, 409);
    assert.equal(blockedRead.body.error.code, 'conflict');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
