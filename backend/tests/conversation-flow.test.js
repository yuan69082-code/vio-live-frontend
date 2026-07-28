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

function scopedPath(userId, subjectId) {
  return `/api/v1/users/${encodeURIComponent(userId)}/subjects/${encodeURIComponent(subjectId)}`;
}

function conversationPath(userId, subjectId, conversationId) {
  return `${scopedPath(userId, subjectId)}/conversations/${encodeURIComponent(conversationId)}`;
}

function messagePath(userId, subjectId, conversationId, messageId) {
  return `${conversationPath(userId, subjectId, conversationId)}/messages/${encodeURIComponent(messageId)}`;
}

async function createUser(baseUrl, email) {
  const result = await postJson(baseUrl, '/api/v1/users', {
    email,
    displayName: 'Conversation Test Owner',
  });
  assert.equal(result.response.status, 201);
  assertEnvelope(result.body, true);
  return result.body.data;
}

async function createSubject(baseUrl, userId, name) {
  const subjectResult = await postJson(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(userId)}/subjects`,
    { name, basicSettings: {} },
  );
  assert.equal(subjectResult.response.status, 201);
  assertEnvelope(subjectResult.body, true);
  return subjectResult.body.data;
}

async function createConversation(baseUrl, userId, subjectId, title) {
  const result = await postJson(
    baseUrl,
    `${scopedPath(userId, subjectId)}/conversations`,
    { title },
  );
  assert.equal(result.response.status, 201);
  assertEnvelope(result.body, true);
  return result.body.data;
}

async function createMessage(
  baseUrl,
  userId,
  subjectId,
  conversationId,
  senderType,
  content,
) {
  const result = await postJson(
    baseUrl,
    `${conversationPath(userId, subjectId, conversationId)}/messages`,
    { senderType, content },
  );
  assert.equal(result.response.status, 201);
  assertEnvelope(result.body, true);
  return result.body.data;
}

async function listEvents(baseUrl, userId, subjectId, eventType) {
  const query = new URLSearchParams({ subjectId, eventType });
  const result = await getJson(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(userId)}/events?${query}`,
  );
  assert.equal(result.response.status, 200);
  assertEnvelope(result.body, true);
  return result.body;
}

test('conversations, messages and immutable versions complete a persisted event-linked flow', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'conversation-flow@example.com');
    const subject = await createSubject(context.baseUrl, user.userId, 'Vio Dialogue');
    const conversation = await createConversation(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'First persisted conversation',
    );
    const conversationCollection = `${scopedPath(user.userId, subject.subjectId)}/conversations`;
    const conversationItem = conversationPath(
      user.userId,
      subject.subjectId,
      conversation.conversationId,
    );
    const messagesCollection = `${conversationItem}/messages`;

    assert.match(conversation.conversationId, /^[0-9a-f-]{36}$/);
    assert.equal(conversation.userId, user.userId);
    assert.equal(conversation.subjectId, subject.subjectId);
    assert.equal(conversation.status, 'active');

    const conversations = await getJson(context.baseUrl, conversationCollection);
    assert.equal(conversations.response.status, 200);
    assertEnvelope(conversations.body, true);
    assert.equal(conversations.body.meta.count, 1);
    assert.equal(conversations.body.data[0].conversationId, conversation.conversationId);

    const detail = await getJson(context.baseUrl, conversationItem);
    assert.equal(detail.response.status, 200);
    assertEnvelope(detail.body, true);
    assert.equal(detail.body.data.title, 'First persisted conversation');

    const originalUserContent = 'USER-CONTENT-MARKER-71 original';
    const editedUserContent = 'USER-CONTENT-MARKER-72 edited';
    const originalSubjectContent = 'SUBJECT-CONTENT-MARKER-71 original';
    const regeneratedSubjectContent = 'SUBJECT-CONTENT-MARKER-72 regenerated';
    const systemContent = 'SYSTEM-CONTENT-MARKER-71 notice';
    const userMessage = await createMessage(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'user',
      originalUserContent,
    );
    const subjectMessage = await createMessage(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'subject',
      originalSubjectContent,
    );
    const systemMessage = await createMessage(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'system',
      systemContent,
    );

    assert.equal(userMessage.currentVersionNumber, 1);
    assert.equal(subjectMessage.currentVersionNumber, 1);
    assert.equal(systemMessage.currentVersionNumber, 1);

    const initialMessages = await getJson(context.baseUrl, messagesCollection);
    assert.equal(initialMessages.response.status, 200);
    assertEnvelope(initialMessages.body, true);
    assert.equal(initialMessages.body.meta.count, 3);
    assert.deepEqual(
      initialMessages.body.data.map((message) => message.senderType),
      ['user', 'subject', 'system'],
    );
    assert.deepEqual(
      initialMessages.body.data.map((message) => message.sequenceNumber),
      [1, 2, 3],
    );

    const userEdit = await patchJson(
      context.baseUrl,
      messagePath(
        user.userId,
        subject.subjectId,
        conversation.conversationId,
        userMessage.messageId,
      ),
      {
        baseVersionId: userMessage.currentVersionId,
        content: editedUserContent,
      },
    );
    assert.equal(userEdit.response.status, 200);
    assertEnvelope(userEdit.body, true);
    assert.equal(userEdit.body.data.versionNumber, 2);
    assert.equal(userEdit.body.data.changeReason, 'edited');
    assert.equal(userEdit.body.data.parentVersionId, userMessage.currentVersionId);
    assert.equal(userEdit.body.data.isCurrent, true);

    const subjectRegeneration = await postJson(
      context.baseUrl,
      `${messagePath(
        user.userId,
        subject.subjectId,
        conversation.conversationId,
        subjectMessage.messageId,
      )}/regenerations`,
      {
        baseVersionId: subjectMessage.currentVersionId,
        content: regeneratedSubjectContent,
      },
    );
    assert.equal(subjectRegeneration.response.status, 201);
    assertEnvelope(subjectRegeneration.body, true);
    assert.equal(subjectRegeneration.body.data.versionNumber, 2);
    assert.equal(subjectRegeneration.body.data.changeReason, 'regenerated');
    assert.equal(
      subjectRegeneration.body.data.parentVersionId,
      subjectMessage.currentVersionId,
    );
    assert.equal(subjectRegeneration.body.data.isCurrent, true);

    const userVersionsPath = `${messagePath(
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      userMessage.messageId,
    )}/versions`;
    const userVersions = await getJson(context.baseUrl, userVersionsPath);
    assert.equal(userVersions.response.status, 200);
    assertEnvelope(userVersions.body, true);
    assert.equal(userVersions.body.meta.count, 2);
    assert.deepEqual(
      userVersions.body.data.map((version) => ({
        versionNumber: version.versionNumber,
        parentVersionId: version.parentVersionId,
        changeReason: version.changeReason,
        isCurrent: version.isCurrent,
      })),
      [
        {
          versionNumber: 1,
          parentVersionId: null,
          changeReason: 'original',
          isCurrent: false,
        },
        {
          versionNumber: 2,
          parentVersionId: userMessage.currentVersionId,
          changeReason: 'edited',
          isCurrent: true,
        },
      ],
    );

    const originalVersion = await getJson(
      context.baseUrl,
      `${userVersionsPath}/${encodeURIComponent(userMessage.currentVersionId)}`,
    );
    assert.equal(originalVersion.response.status, 200);
    assertEnvelope(originalVersion.body, true);
    assert.equal(originalVersion.body.data.content, originalUserContent);
    assert.equal(originalVersion.body.data.isCurrent, false);

    const currentVersion = await getJson(
      context.baseUrl,
      `${userVersionsPath}/${encodeURIComponent(userEdit.body.data.messageVersionId)}`,
    );
    assert.equal(currentVersion.response.status, 200);
    assert.equal(currentVersion.body.data.content, editedUserContent);
    assert.equal(currentVersion.body.data.parentVersionId, userMessage.currentVersionId);
    assert.equal(currentVersion.body.data.isCurrent, true);

    const currentMessages = await getJson(context.baseUrl, messagesCollection);
    assert.deepEqual(
      currentMessages.body.data.map((message) => message.content),
      [editedUserContent, regeneratedSubjectContent, systemContent],
    );
    assert.deepEqual(
      currentMessages.body.data.map((message) => message.currentVersionNumber),
      [2, 2, 1],
    );

    const expectedEventCounts = {
      conversation_created: 1,
      message_created: 3,
      message_updated: 1,
      message_regenerated: 1,
    };
    const forbiddenContent = [
      'First persisted conversation',
      originalUserContent,
      editedUserContent,
      originalSubjectContent,
      regeneratedSubjectContent,
      systemContent,
    ];

    for (const [eventType, expectedCount] of Object.entries(expectedEventCounts)) {
      const events = await listEvents(
        context.baseUrl,
        user.userId,
        subject.subjectId,
        eventType,
      );
      assert.equal(events.meta.count, expectedCount);

      for (const event of events.data) {
        const eventView = JSON.stringify({ data: event.data, summary: event.summary });
        assert.equal(Object.hasOwn(event.data, 'content'), false);
        for (const content of forbiddenContent) {
          assert.equal(eventView.includes(content), false);
        }
      }
    }

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);

    const persistedConversation = await getJson(context.baseUrl, conversationItem);
    assert.equal(persistedConversation.response.status, 200);
    assert.equal(persistedConversation.body.data.conversationId, conversation.conversationId);
    const persistedMessages = await getJson(context.baseUrl, messagesCollection);
    assert.equal(persistedMessages.response.status, 200);
    assert.deepEqual(
      persistedMessages.body.data.map((message) => message.content),
      [editedUserContent, regeneratedSubjectContent, systemContent],
    );
    const persistedVersions = await getJson(context.baseUrl, userVersionsPath);
    assert.equal(persistedVersions.body.meta.count, 2);
    assert.equal(persistedVersions.body.data[0].content, originalUserContent);
    assert.equal(persistedVersions.body.data[1].content, editedUserContent);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('conversation ownership, sender operations, request fields and base versions are enforced', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const firstUser = await createUser(context.baseUrl, 'conversation-owner@example.com');
    const secondUser = await createUser(context.baseUrl, 'conversation-other@example.com');
    const firstSubject = await createSubject(context.baseUrl, firstUser.userId, 'First');
    const siblingSubject = await createSubject(context.baseUrl, firstUser.userId, 'Sibling');
    const secondSubject = await createSubject(context.baseUrl, secondUser.userId, 'Second');
    const firstConversation = await createConversation(
      context.baseUrl,
      firstUser.userId,
      firstSubject.subjectId,
      'Owner conversation',
    );
    const otherConversation = await createConversation(
      context.baseUrl,
      firstUser.userId,
      firstSubject.subjectId,
      'Other conversation',
    );
    const userMessage = await createMessage(
      context.baseUrl,
      firstUser.userId,
      firstSubject.subjectId,
      firstConversation.conversationId,
      'user',
      'Original user message',
    );
    const subjectMessage = await createMessage(
      context.baseUrl,
      firstUser.userId,
      firstSubject.subjectId,
      firstConversation.conversationId,
      'subject',
      'Original subject message',
    );
    const systemMessage = await createMessage(
      context.baseUrl,
      firstUser.userId,
      firstSubject.subjectId,
      firstConversation.conversationId,
      'system',
      'Original system message',
    );

    const crossUserConversation = await getJson(
      context.baseUrl,
      conversationPath(
        secondUser.userId,
        secondSubject.subjectId,
        firstConversation.conversationId,
      ),
    );
    assert.equal(crossUserConversation.response.status, 404);
    assertEnvelope(crossUserConversation.body, false);

    const crossSubjectConversation = await getJson(
      context.baseUrl,
      conversationPath(
        firstUser.userId,
        siblingSubject.subjectId,
        firstConversation.conversationId,
      ),
    );
    assert.equal(crossSubjectConversation.response.status, 404);

    const crossConversationMessage = await getJson(
      context.baseUrl,
      messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        otherConversation.conversationId,
        userMessage.messageId,
      ),
    );
    assert.equal(crossConversationMessage.response.status, 404);

    const invalidSender = await postJson(
      context.baseUrl,
      `${conversationPath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
      )}/messages`,
      { senderType: 'assistant', content: 'Unsupported sender.' },
    );
    assert.equal(invalidSender.response.status, 400);
    assertEnvelope(invalidSender.body, false);

    const unknownConversationField = await postJson(
      context.baseUrl,
      `${scopedPath(firstUser.userId, firstSubject.subjectId)}/conversations`,
      { title: 'Must not exist', status: 'active' },
    );
    assert.equal(unknownConversationField.response.status, 400);

    const unknownMessageField = await postJson(
      context.baseUrl,
      `${conversationPath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
      )}/messages`,
      { senderType: 'user', content: 'Must not exist', role: 'owner' },
    );
    assert.equal(unknownMessageField.response.status, 400);

    const editSubject = await patchJson(
      context.baseUrl,
      messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
        subjectMessage.messageId,
      ),
      { baseVersionId: subjectMessage.currentVersionId, content: 'Invalid edit.' },
    );
    assert.equal(editSubject.response.status, 409);
    assertEnvelope(editSubject.body, false);

    const editSystem = await patchJson(
      context.baseUrl,
      messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
        systemMessage.messageId,
      ),
      { baseVersionId: systemMessage.currentVersionId, content: 'Invalid system edit.' },
    );
    assert.equal(editSystem.response.status, 409);

    const regenerateUser = await postJson(
      context.baseUrl,
      `${messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
        userMessage.messageId,
      )}/regenerations`,
      { baseVersionId: userMessage.currentVersionId, content: 'Invalid regeneration.' },
    );
    assert.equal(regenerateUser.response.status, 409);

    const unknownVersionField = await patchJson(
      context.baseUrl,
      messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
        userMessage.messageId,
      ),
      {
        baseVersionId: userMessage.currentVersionId,
        content: 'Unknown field edit.',
        parentVersionId: userMessage.currentVersionId,
      },
    );
    assert.equal(unknownVersionField.response.status, 400);

    const validEdit = await patchJson(
      context.baseUrl,
      messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
        userMessage.messageId,
      ),
      { baseVersionId: userMessage.currentVersionId, content: 'Current user version.' },
    );
    assert.equal(validEdit.response.status, 200);

    const staleEdit = await patchJson(
      context.baseUrl,
      messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
        userMessage.messageId,
      ),
      { baseVersionId: userMessage.currentVersionId, content: 'Stale write.' },
    );
    assert.equal(staleEdit.response.status, 409);
    assertEnvelope(staleEdit.body, false);

    const currentUserMessage = await getJson(
      context.baseUrl,
      messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
        userMessage.messageId,
      ),
    );
    assert.equal(currentUserMessage.response.status, 200);
    assert.equal(currentUserMessage.body.data.content, 'Current user version.');
    assert.equal(
      currentUserMessage.body.data.currentVersionId,
      validEdit.body.data.messageVersionId,
    );

    const userVersions = await getJson(
      context.baseUrl,
      `${messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        firstConversation.conversationId,
        userMessage.messageId,
      )}/versions`,
    );
    assert.equal(userVersions.body.meta.count, 2);
    assert.equal(userVersions.body.data.filter((version) => version.isCurrent).length, 1);

    const crossConversationVersion = await getJson(
      context.baseUrl,
      `${messagePath(
        firstUser.userId,
        firstSubject.subjectId,
        otherConversation.conversationId,
        userMessage.messageId,
      )}/versions/${encodeURIComponent(userMessage.currentVersionId)}`,
    );
    assert.equal(crossConversationVersion.response.status, 404);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('message and version mutations roll back when linked Event insertion fails', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'conversation-rollback@example.com');
    const subject = await createSubject(context.baseUrl, user.userId, 'Rollback Subject');
    const conversation = await createConversation(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'Rollback conversation',
    );
    const conversationItem = conversationPath(
      user.userId,
      subject.subjectId,
      conversation.conversationId,
    );
    const messagesCollection = `${conversationItem}/messages`;
    const subjectMessage = await createMessage(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'subject',
      'Subject version before rollback',
    );
    const beforeCreateConversation = await getJson(context.baseUrl, conversationItem);
    const beforeCreateMessages = await getJson(context.baseUrl, messagesCollection);
    const beforeCreateEventCount = await listEvents(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'message_created',
    );
    const beforeMessageRows = context.application.database.connection
      .prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?')
      .get(conversation.conversationId).count;
    const beforeVersionRows = context.application.database.connection
      .prepare('SELECT COUNT(*) AS count FROM message_versions WHERE conversation_id = ?')
      .get(conversation.conversationId).count;

    context.application.database.connection.exec(`
      CREATE TRIGGER reject_message_created_event
      BEFORE INSERT ON events
      WHEN NEW.event_type = 'message_created'
      BEGIN
        SELECT RAISE(ABORT, 'forced message-created event failure');
      END;
    `);

    const failedCreate = await postJson(context.baseUrl, messagesCollection, {
      senderType: 'user',
      content: 'MESSAGE-CREATE-MUST-ROLL-BACK',
    });
    assert.equal(failedCreate.response.status, 500);
    assertEnvelope(failedCreate.body, false);
    assert.equal(failedCreate.body.error.code, 'internal_error');

    const afterCreateMessages = await getJson(context.baseUrl, messagesCollection);
    assert.equal(afterCreateMessages.body.meta.count, beforeCreateMessages.body.meta.count);
    assert.deepEqual(afterCreateMessages.body.data, beforeCreateMessages.body.data);
    const afterCreateConversation = await getJson(context.baseUrl, conversationItem);
    assert.equal(
      afterCreateConversation.body.data.updatedAt,
      beforeCreateConversation.body.data.updatedAt,
    );
    assert.equal(
      afterCreateConversation.body.data.lastActivityAt,
      beforeCreateConversation.body.data.lastActivityAt,
    );
    const afterCreateEventCount = await listEvents(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'message_created',
    );
    assert.equal(afterCreateEventCount.meta.count, beforeCreateEventCount.meta.count);
    assert.equal(
      context.application.database.connection
        .prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?')
        .get(conversation.conversationId).count,
      beforeMessageRows,
    );
    assert.equal(
      context.application.database.connection
        .prepare('SELECT COUNT(*) AS count FROM message_versions WHERE conversation_id = ?')
        .get(conversation.conversationId).count,
      beforeVersionRows,
    );
    assert.equal(
      context.application.database.connection
        .prepare('SELECT COUNT(*) AS count FROM message_versions WHERE content = ?')
        .get('MESSAGE-CREATE-MUST-ROLL-BACK').count,
      0,
    );

    context.application.database.connection.exec('DROP TRIGGER reject_message_created_event;');

    const subjectMessageItem = messagePath(
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      subjectMessage.messageId,
    );
    const subjectVersionsPath = `${subjectMessageItem}/versions`;
    const beforeRegenerationMessage = await getJson(context.baseUrl, subjectMessageItem);
    const beforeRegenerationVersions = await getJson(context.baseUrl, subjectVersionsPath);
    const beforeRegenerationConversation = await getJson(context.baseUrl, conversationItem);
    const beforeRegenerationEvents = await listEvents(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'message_regenerated',
    );

    context.application.database.connection.exec(`
      CREATE TRIGGER reject_message_regenerated_event
      BEFORE INSERT ON events
      WHEN NEW.event_type = 'message_regenerated'
      BEGIN
        SELECT RAISE(ABORT, 'forced message-regenerated event failure');
      END;
    `);

    const failedRegeneration = await postJson(
      context.baseUrl,
      `${subjectMessageItem}/regenerations`,
      {
        baseVersionId: subjectMessage.currentVersionId,
        content: 'MESSAGE-REGENERATION-MUST-ROLL-BACK',
      },
    );
    assert.equal(failedRegeneration.response.status, 500);
    assertEnvelope(failedRegeneration.body, false);
    assert.equal(failedRegeneration.body.error.code, 'internal_error');

    const afterRegenerationMessage = await getJson(context.baseUrl, subjectMessageItem);
    assert.deepEqual(afterRegenerationMessage.body.data, beforeRegenerationMessage.body.data);
    assert.equal(
      afterRegenerationMessage.body.data.currentVersionId,
      subjectMessage.currentVersionId,
    );
    assert.equal(
      afterRegenerationMessage.body.data.content,
      'Subject version before rollback',
    );
    const afterRegenerationVersions = await getJson(context.baseUrl, subjectVersionsPath);
    assert.deepEqual(afterRegenerationVersions.body.data, beforeRegenerationVersions.body.data);
    assert.equal(afterRegenerationVersions.body.meta.count, 1);
    assert.equal(afterRegenerationVersions.body.data[0].isCurrent, true);
    const afterRegenerationConversation = await getJson(context.baseUrl, conversationItem);
    assert.equal(
      afterRegenerationConversation.body.data.updatedAt,
      beforeRegenerationConversation.body.data.updatedAt,
    );
    assert.equal(
      afterRegenerationConversation.body.data.lastActivityAt,
      beforeRegenerationConversation.body.data.lastActivityAt,
    );
    const afterRegenerationEvents = await listEvents(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'message_regenerated',
    );
    assert.equal(afterRegenerationEvents.meta.count, beforeRegenerationEvents.meta.count);
    assert.equal(
      context.application.database.connection
        .prepare('SELECT COUNT(*) AS count FROM message_versions WHERE content = ?')
        .get('MESSAGE-REGENERATION-MUST-ROLL-BACK').count,
      0,
    );
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
