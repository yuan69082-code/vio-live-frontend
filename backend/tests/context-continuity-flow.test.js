import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

function assertEnvelope(body, success) {
  assert.equal(body.success, success);
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));

  if (success) {
    assert.equal(body.error, null);
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

function conversationPath(userId, subjectId, conversationId) {
  return `${subjectPath(userId, subjectId)}/conversations/${encodeURIComponent(conversationId)}`;
}

async function createUser(baseUrl, email) {
  const result = await postJson(baseUrl, '/api/v1/users', {
    email,
    displayName: 'Context Test Owner',
  });
  assert.equal(result.response.status, 201);
  assertEnvelope(result.body, true);
  return result.body.data;
}

async function createSubject(baseUrl, userId, name) {
  const result = await postJson(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(userId)}/subjects`,
    {
      name,
      avatarRef: `asset://${name.toLowerCase().replaceAll(' ', '-')}`,
      basicSettings: {
        persona: 'A persistent development subject.',
        expressionStyle: 'concise',
      },
    },
  );
  assert.equal(result.response.status, 201);
  assertEnvelope(result.body, true);
  return result.body.data;
}

async function createConversation(baseUrl, userId, subjectId, title) {
  const result = await postJson(
    baseUrl,
    `${subjectPath(userId, subjectId)}/conversations`,
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

async function createEvent(baseUrl, userId, subjectId, summary) {
  const result = await postJson(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(userId)}/events`,
    {
      subjectId,
      eventType: 'life_record_created',
      source: { type: 'context-test', reference: 'record-1' },
      data: { recordType: 'task' },
      summary,
    },
  );
  assert.equal(result.response.status, 201);
  assertEnvelope(result.body, true);
  return result.body.data;
}

async function createSummary(
  baseUrl,
  userId,
  subjectId,
  conversationId,
  content,
  sources,
) {
  return postJson(
    baseUrl,
    `${conversationPath(userId, subjectId, conversationId)}/summaries`,
    { content, sources },
  );
}

function stateUpdatePayload(source, unresolvedEventIds = []) {
  return {
    currentState: {
      focus: 'continue the open task',
      relationship: 'stable',
    },
    emotion: 'focused',
    intensity: 0.72,
    changeReason: 'A referenced conversation established an unfinished task.',
    unresolvedEventIds,
    continuityConstraints: [
      'Keep the unfinished task visible in the next window.',
      'Do not claim that a model produced this state.',
    ],
    source,
  };
}

test('summaries, state updates and context assembly persist across conversation windows', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'context-flow@example.com');
    const subject = await createSubject(context.baseUrl, user.userId, 'Vio Context');
    const earlierConversation = await createConversation(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'Earlier window',
    );
    const earlierMessage = await createMessage(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      earlierConversation.conversationId,
      'user',
      'Please keep this unfinished task across windows.',
    );
    const event = await createEvent(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'An unfinished task was recorded.',
    );
    const summaryResult = await createSummary(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      earlierConversation.conversationId,
      'The earlier window established an unfinished task that must remain visible.',
      [
        {
          type: 'message_version',
          messageId: earlierMessage.messageId,
          messageVersionId: earlierMessage.currentVersionId,
        },
        { type: 'event', eventId: event.eventId },
      ],
    );
    assert.equal(summaryResult.response.status, 201);
    assertEnvelope(summaryResult.body, true);
    const summary = summaryResult.body.data;
    assert.equal(summary.summaryVersion, 1);
    assert.equal(summary.sources.length, 2);
    assert.deepEqual(summary.sources.map((source) => source.type), [
      'message_version',
      'event',
    ]);
    assert.equal(
      summary.sources[0].reference.messageVersionId,
      earlierMessage.currentVersionId,
    );
    assert.equal(summary.sources[1].reference.eventId, event.eventId);

    const summaryDetail = await getJson(
      context.baseUrl,
      `${conversationPath(
        user.userId,
        subject.subjectId,
        earlierConversation.conversationId,
      )}/summaries/${encodeURIComponent(summary.summaryId)}`,
    );
    assert.equal(summaryDetail.response.status, 200);
    assertEnvelope(summaryDetail.body, true);
    assert.equal(summaryDetail.body.data.content, summary.content);

    const currentConversation = await createConversation(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'Current window',
    );
    const currentMessage = await createMessage(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      currentConversation.conversationId,
      'user',
      'Continue from the previous window.',
    );
    const crossWindow = await getJson(
      context.baseUrl,
      `${conversationPath(
        user.userId,
        subject.subjectId,
        currentConversation.conversationId,
      )}/cross-window-summaries`,
    );
    assert.equal(crossWindow.response.status, 200);
    assertEnvelope(crossWindow.body, true);
    assert.equal(crossWindow.body.meta.count, 1);
    assert.equal(crossWindow.body.data[0].summaryId, summary.summaryId);
    assert.notEqual(
      crossWindow.body.data[0].conversationId,
      currentConversation.conversationId,
    );

    const stateResult = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
      stateUpdatePayload(
        {
          type: 'conversation_summary',
          conversationId: earlierConversation.conversationId,
          summaryId: summary.summaryId,
        },
        [event.eventId],
      ),
    );
    assert.equal(stateResult.response.status, 201);
    assertEnvelope(stateResult.body, true);
    const state = stateResult.body.data;
    assert.equal(state.stateVersion, 1);
    assert.equal(state.isCurrent, true);
    assert.deepEqual(state.unresolvedEventIds, [event.eventId]);
    assert.equal(state.source.type, 'conversation_summary');
    assert.equal(state.source.reference.summaryId, summary.summaryId);

    const currentState = await getJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state`,
    );
    assert.equal(currentState.response.status, 200);
    assertEnvelope(currentState.body, true);
    assert.equal(currentState.body.data.subjectStateId, state.subjectStateId);

    const stateHistory = await getJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
    );
    assert.equal(stateHistory.response.status, 200);
    assertEnvelope(stateHistory.body, true);
    assert.equal(stateHistory.body.meta.count, 1);

    const contextResult = await getJson(
      context.baseUrl,
      `${conversationPath(
        user.userId,
        subject.subjectId,
        currentConversation.conversationId,
      )}/context?recentMessageLimit=10&crossWindowSummaryLimit=5`,
    );
    assert.equal(contextResult.response.status, 200);
    assertEnvelope(contextResult.body, true);
    const assembly = contextResult.body.data;
    assert.deepEqual(assembly.assemblyOrder, [
      'systemSafetyRules',
      'subjectGlobalSettings',
      'currentSubjectState',
      'unresolvedEvents',
      'recentMessages',
      'crossWindowSummaries',
      'longTermMemory',
      'currentUserMessage',
    ]);
    assert.equal(assembly.sections.systemSafetyRules.status, 'reserved');
    assert.equal(assembly.sections.currentSubjectState.subjectStateId, state.subjectStateId);
    assert.equal(assembly.sections.unresolvedEvents[0].eventId, event.eventId);
    assert.equal(assembly.sections.recentMessages.length, 0);
    assert.equal(
      assembly.sections.currentUserMessage.messageId,
      currentMessage.messageId,
    );
    assert.equal(
      assembly.sections.crossWindowSummaries[0].summaryId,
      summary.summaryId,
    );
    assert.deepEqual(assembly.sections.longTermMemory, {
      status: 'not_implemented',
      items: [],
    });
    assert.deepEqual(assembly.execution, {
      modelCall: 'not_performed',
      externalApiCall: 'not_performed',
      continuityEngineCall: 'not_performed',
    });

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persistedContext = await getJson(
      context.baseUrl,
      `${conversationPath(
        user.userId,
        subject.subjectId,
        currentConversation.conversationId,
      )}/context`,
    );
    assert.equal(persistedContext.response.status, 200);
    assertEnvelope(persistedContext.body, true);
    assert.equal(
      persistedContext.body.data.sections.currentSubjectState.subjectStateId,
      state.subjectStateId,
    );
    assert.equal(
      persistedContext.body.data.sections.crossWindowSummaries[0].summaryId,
      summary.summaryId,
    );
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('summary and state source ownership, input shape and current state version are enforced', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'context-isolation@example.com');
    const otherUser = await createUser(context.baseUrl, 'context-other@example.com');
    const subject = await createSubject(context.baseUrl, user.userId, 'Primary Subject');
    const sibling = await createSubject(context.baseUrl, user.userId, 'Sibling Subject');
    const otherSubject = await createSubject(
      context.baseUrl,
      otherUser.userId,
      'Other User Subject',
    );
    const conversation = await createConversation(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'Primary conversation',
    );
    const siblingConversation = await createConversation(
      context.baseUrl,
      user.userId,
      sibling.subjectId,
      'Sibling conversation',
    );
    const message = await createMessage(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'user',
      'Primary source message.',
    );
    const event = await createEvent(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'Primary subject event.',
    );
    const siblingEvent = await createEvent(
      context.baseUrl,
      user.userId,
      sibling.subjectId,
      'Sibling subject event.',
    );

    const missingSources = await createSummary(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'Missing sources must fail.',
      [],
    );
    assert.equal(missingSources.response.status, 400);
    assertEnvelope(missingSources.body, false);

    const duplicateSources = await createSummary(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'Duplicate sources must fail.',
      [
        { type: 'event', eventId: event.eventId },
        { type: 'event', eventId: event.eventId },
      ],
    );
    assert.equal(duplicateSources.response.status, 400);

    const wrongEvent = await createSummary(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'Cross-subject source must fail.',
      [{ type: 'event', eventId: siblingEvent.eventId }],
    );
    assert.equal(wrongEvent.response.status, 404);
    assertEnvelope(wrongEvent.body, false);

    const wrongConversation = await createSummary(
      context.baseUrl,
      user.userId,
      sibling.subjectId,
      siblingConversation.conversationId,
      'Cross-conversation message source must fail.',
      [{
        type: 'message_version',
        messageId: message.messageId,
        messageVersionId: message.currentVersionId,
      }],
    );
    assert.equal(wrongConversation.response.status, 404);

    const unknownField = await postJson(
      context.baseUrl,
      `${conversationPath(
        user.userId,
        subject.subjectId,
        conversation.conversationId,
      )}/summaries`,
      {
        content: 'Unknown fields must fail.',
        sources: [{ type: 'event', eventId: event.eventId }],
        generatedByModel: true,
      },
    );
    assert.equal(unknownField.response.status, 400);

    const validSummaryResult = await createSummary(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'Valid traceable summary.',
      [{
        type: 'message_version',
        messageId: message.messageId,
        messageVersionId: message.currentVersionId,
      }],
    );
    assert.equal(validSummaryResult.response.status, 201);
    const validSummary = validSummaryResult.body.data;

    const invalidIntensity = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
      {
        ...stateUpdatePayload({ type: 'event', eventId: event.eventId }),
        intensity: 2,
      },
    );
    assert.equal(invalidIntensity.response.status, 400);

    const wrongStateSource = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, sibling.subjectId)}/state-updates`,
      stateUpdatePayload({
        type: 'conversation_summary',
        conversationId: conversation.conversationId,
        summaryId: validSummary.summaryId,
      }),
    );
    assert.equal(wrongStateSource.response.status, 404);

    const wrongUnresolvedEvent = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
      stateUpdatePayload(
        {
          type: 'conversation_summary',
          conversationId: conversation.conversationId,
          summaryId: validSummary.summaryId,
        },
        [siblingEvent.eventId],
      ),
    );
    assert.equal(wrongUnresolvedEvent.response.status, 404);

    const firstStateResult = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
      stateUpdatePayload({
        type: 'message_version',
        conversationId: conversation.conversationId,
        messageId: message.messageId,
        messageVersionId: message.currentVersionId,
      }),
    );
    assert.equal(firstStateResult.response.status, 201);
    const firstState = firstStateResult.body.data;

    const secondStateResult = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
      {
        ...stateUpdatePayload({ type: 'event', eventId: event.eventId }),
        emotion: 'calm',
        intensity: 0.35,
      },
    );
    assert.equal(secondStateResult.response.status, 201);
    const secondState = secondStateResult.body.data;
    assert.equal(secondState.stateVersion, 2);
    assert.equal(secondState.isCurrent, true);

    const history = await getJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
    );
    assert.equal(history.response.status, 200);
    assert.deepEqual(
      history.body.data.map((state) => ({
        stateVersion: state.stateVersion,
        isCurrent: state.isCurrent,
      })),
      [
        { stateVersion: 2, isCurrent: true },
        { stateVersion: 1, isCurrent: false },
      ],
    );
    assert.equal(history.body.data[1].subjectStateId, firstState.subjectStateId);

    const ownWindow = await getJson(
      context.baseUrl,
      `${conversationPath(
        user.userId,
        subject.subjectId,
        conversation.conversationId,
      )}/cross-window-summaries`,
    );
    assert.equal(ownWindow.response.status, 200);
    assert.equal(ownWindow.body.meta.count, 0);

    const crossUser = await getJson(
      context.baseUrl,
      `${conversationPath(
        otherUser.userId,
        otherSubject.subjectId,
        conversation.conversationId,
      )}/summaries/${encodeURIComponent(validSummary.summaryId)}`,
    );
    assert.equal(crossUser.response.status, 404);
    assertEnvelope(crossUser.body, false);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('summary and subject state writes roll back and immutable records reject mutation', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const user = await createUser(context.baseUrl, 'context-rollback@example.com');
    const subject = await createSubject(context.baseUrl, user.userId, 'Rollback Subject');
    const conversation = await createConversation(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'Rollback conversation',
    );
    const message = await createMessage(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'user',
      'Rollback source message.',
    );
    const event = await createEvent(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      'Rollback event.',
    );
    const connection = context.application.database.connection;

    connection.exec(`
      CREATE TRIGGER fail_context_test_summary_source
      BEFORE INSERT ON conversation_summary_sources
      BEGIN
        SELECT RAISE(ABORT, 'context test summary source failure');
      END;
    `);
    const failedSummary = await createSummary(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'This summary must be rolled back.',
      [{
        type: 'message_version',
        messageId: message.messageId,
        messageVersionId: message.currentVersionId,
      }],
    );
    assert.equal(failedSummary.response.status, 500);
    assertEnvelope(failedSummary.body, false);
    assert.equal(
      connection.prepare('SELECT COUNT(*) AS count FROM conversation_summaries').get().count,
      0,
    );
    connection.exec('DROP TRIGGER fail_context_test_summary_source;');

    const summaryResult = await createSummary(
      context.baseUrl,
      user.userId,
      subject.subjectId,
      conversation.conversationId,
      'This summary persists.',
      [{ type: 'event', eventId: event.eventId }],
    );
    assert.equal(summaryResult.response.status, 201);
    const summary = summaryResult.body.data;
    assert.throws(
      () => connection.prepare(
        'UPDATE conversation_summaries SET summary_text = ? WHERE summary_id = ?',
      ).run('mutated', summary.summaryId),
      /conversation summaries are immutable/,
    );
    assert.throws(
      () => connection.prepare(
        'DELETE FROM conversation_summary_sources WHERE summary_id = ?',
      ).run(summary.summaryId),
      /conversation summary sources require a governed retention process/,
    );

    connection.exec(`
      CREATE TRIGGER fail_context_test_state_head
      BEFORE INSERT ON subject_state_heads
      BEGIN
        SELECT RAISE(ABORT, 'context test state head failure');
      END;
    `);
    const failedState = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
      stateUpdatePayload(
        {
          type: 'conversation_summary',
          conversationId: conversation.conversationId,
          summaryId: summary.summaryId,
        },
        [event.eventId],
      ),
    );
    assert.equal(failedState.response.status, 500);
    assertEnvelope(failedState.body, false);
    assert.equal(
      connection.prepare('SELECT COUNT(*) AS count FROM subject_states').get().count,
      0,
    );
    assert.equal(
      connection.prepare(
        'SELECT COUNT(*) AS count FROM subject_state_unresolved_events',
      ).get().count,
      0,
    );
    connection.exec('DROP TRIGGER fail_context_test_state_head;');

    const stateResult = await postJson(
      context.baseUrl,
      `${subjectPath(user.userId, subject.subjectId)}/state-updates`,
      stateUpdatePayload({ type: 'event', eventId: event.eventId }, [event.eventId]),
    );
    assert.equal(stateResult.response.status, 201);
    const state = stateResult.body.data;
    assert.throws(
      () => connection.prepare(
        'UPDATE subject_states SET emotion = ? WHERE subject_state_id = ?',
      ).run('mutated', state.subjectStateId),
      /subject states are immutable/,
    );
    assert.throws(
      () => connection.prepare(
        'DELETE FROM subject_states WHERE subject_state_id = ?',
      ).run(state.subjectStateId),
      /subject states require a governed retention process/,
    );
    assert.equal(connection.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
