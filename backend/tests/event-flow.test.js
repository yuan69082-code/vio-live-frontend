import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

async function createUserAndSubject(baseUrl, email) {
  const userResult = await postJson(baseUrl, '/api/v1/users', { email });
  const userId = userResult.body.data.userId;
  const subjectResult = await postJson(baseUrl, `/api/v1/users/${userId}/subjects`, {
    name: 'Vio Event Subject',
    basicSettings: {},
  });

  return {
    userId,
    subjectId: subjectResult.body.data.subjectId,
  };
}

test('events can be created, persisted and filtered by user, subject and time', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);
  let firstEventId;

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'events@example.com',
    );
    const eventInputs = [
      {
        eventType: 'appearance_changed',
        occurredAt: '2026-07-25T01:00:00.000Z',
        summary: 'User changed the application theme.',
        data: { field: 'theme', value: 'violet' },
      },
      {
        subjectId,
        eventType: 'subject_updated',
        occurredAt: '2026-07-25T02:00:00.000Z',
        summary: 'Subject name was updated.',
        data: { field: 'name', value: 'Vio' },
      },
      {
        subjectId,
        eventType: 'permission_changed',
        occurredAt: '2026-07-25T03:00:00.000Z',
        summary: 'A permission setting changed.',
        data: { permission: 'camera', state: 'ask_each_time' },
      },
      {
        subjectId,
        eventType: 'life_record_created',
        occurredAt: '2026-07-25T04:00:00.000Z',
        summary: 'A life record was created.',
        data: { category: 'calendar' },
      },
      {
        eventType: 'device_changed',
        occurredAt: '2026-07-25T05:00:00.000Z',
        summary: 'A device connection state changed.',
        data: { state: 'offline' },
      },
    ];

    for (const input of eventInputs) {
      const result = await postJson(context.baseUrl, `/api/v1/users/${userId}/events`, {
        ...input,
        source: {
          type: 'backend-test',
          reference: 'event-flow',
        },
      });
      assert.equal(result.response.status, 201);
      assert.equal(result.body.data.userId, userId);
      assert.equal(result.body.data.status, 'pending');
      firstEventId ??= result.body.data.eventId;
    }

    const allEvents = await getJson(context.baseUrl, `/api/v1/users/${userId}/events`);
    assert.equal(allEvents.response.status, 200);
    assert.equal(allEvents.body.meta.count, 5);
    assert.deepEqual(
      allEvents.body.data.map((event) => event.eventType),
      [
        'device_changed',
        'life_record_created',
        'permission_changed',
        'subject_updated',
        'appearance_changed',
      ],
    );

    const subjectEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?subjectId=${encodeURIComponent(subjectId)}`,
    );
    assert.equal(subjectEvents.response.status, 200);
    assert.equal(subjectEvents.body.meta.count, 3);
    assert.ok(subjectEvents.body.data.every((event) => event.subjectId === subjectId));

    const timeEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?from=${encodeURIComponent('2026-07-25T02:00:00.000Z')}&to=${encodeURIComponent('2026-07-25T04:00:00.000Z')}`,
    );
    assert.equal(timeEvents.response.status, 200);
    assert.deepEqual(
      timeEvents.body.data.map((event) => event.eventType),
      ['life_record_created', 'permission_changed', 'subject_updated'],
    );

    const typeEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=appearance_changed`,
    );
    assert.equal(typeEvents.body.meta.count, 1);

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);

    const persistedEvent = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events/${firstEventId}`,
    );
    assert.equal(persistedEvent.response.status, 200);
    assert.equal(persistedEvent.body.data.eventType, 'appearance_changed');
    assert.deepEqual(persistedEvent.body.data.source, {
      type: 'backend-test',
      reference: 'event-flow',
    });
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('event types and user-subject ownership are enforced', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const first = await createUserAndSubject(context.baseUrl, 'first-events@example.com');
    const second = await createUserAndSubject(context.baseUrl, 'second-events@example.com');
    const invalidType = await postJson(context.baseUrl, `/api/v1/users/${first.userId}/events`, {
      eventType: 'model_called',
      source: { type: 'backend-test' },
      summary: 'This type is outside the current stage.',
      data: {},
    });
    assert.equal(invalidType.response.status, 400);
    assert.equal(invalidType.body.error.code, 'validation_error');

    const secretData = await postJson(context.baseUrl, `/api/v1/users/${first.userId}/events`, {
      eventType: 'appearance_changed',
      source: { type: 'backend-test' },
      summary: 'Secret fields must not be stored in event data.',
      data: { apiKey: 'not-a-real-key' },
    });
    assert.equal(secretData.response.status, 400);
    assert.equal(secretData.body.error.code, 'validation_error');

    const crossUserSubject = await postJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/events`,
      {
        subjectId: first.subjectId,
        eventType: 'subject_updated',
        source: { type: 'backend-test' },
        summary: 'Cross-user subject events must fail.',
        data: {},
      },
    );
    assert.equal(crossUserSubject.response.status, 404);
    assert.equal(crossUserSubject.body.error.code, 'not_found');

    const firstUserEvent = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/events`,
      {
        subjectId: first.subjectId,
        eventType: 'subject_updated',
        source: { type: 'backend-test' },
        summary: 'This event belongs only to the first user.',
        data: { field: 'name' },
      },
    );
    assert.equal(firstUserEvent.response.status, 201);

    const crossUserRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/events/${firstUserEvent.body.data.eventId}`,
    );
    assert.equal(crossUserRead.response.status, 404);
    assert.equal(crossUserRead.body.error.code, 'not_found');

    const secondUserEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/events`,
    );
    assert.equal(secondUserEvents.response.status, 200);
    assert.equal(secondUserEvents.body.meta.count, 0);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
