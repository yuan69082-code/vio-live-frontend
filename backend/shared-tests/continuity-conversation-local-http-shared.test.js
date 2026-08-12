import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIO_V5_PARENT,
  createV5SharedEnvironment,
  inspectEngine,
} from '../test-support/continuity-conversation-v5-shared.js';

const BASE_PATH = '/api/v1/users/user-001/subjects/assistant-001/conversations/conversation-001/turns';

async function request(environment, path, { method = 'GET', body, key } = {}) {
  const response = await fetch(`${environment.vioBaseUrl}${path}`, {
    method,
    headers: {
      'x-vio-user-id': 'user-001',
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, payload: await response.json() };
}

function count(connection, table, where = '') {
  return connection.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get().count;
}

test('V5 public Conversation turn closes through real V1-V4, Engine E5-A and loopback Provider', async (t) => {
  const environment = await createV5SharedEnvironment();
  try {
    await t.test('public POST waits for scoped confirmation without an early Provider call', async () => {
      const created = await request(environment, BASE_PATH, {
        method: 'POST',
        key: 'v5-shared-turn-001',
        body: { content: 'hello through the V5 public API' },
      });
      assert.equal(created.status, 202);
      assert.equal(created.payload.data.status, 'confirmation_required');
      assert.equal(created.payload.data.userMessage.senderType, 'user');
      assert.equal(created.payload.data.subjectMessage, null);
      assert.equal(environment.provider.calls.length, 0);
      t.mock?.restoreAll?.();
      t.diagnostic(`turnId=${created.payload.data.turnId}`);
      environment.turn = created.payload.data;
    });

    await t.test('public resumption performs real loopback model execution and publishes Engine response once', async () => {
      const resumed = await request(
        environment,
        `${BASE_PATH}/${environment.turn.turnId}/resumptions`,
        {
          method: 'POST',
          body: { confirmationId: environment.turn.confirmation.confirmationId },
        },
      );
      assert.equal(resumed.status, 200);
      assert.equal(resumed.payload.data.status, 'completed');
      assert.equal(environment.provider.calls.length, 1);
      assert.deepEqual(environment.provider.calls[0], {
        path: '/chat/completions',
        authorizationMatches: true,
        model: 'v4-model',
        stream: false,
      });
      const connection = environment.application.database.connection;
      const v2 = JSON.parse(connection.prepare(
        'SELECT response_json FROM continuity_first_round_results',
      ).get().response_json);
      assert.equal(resumed.payload.data.subjectMessage.content, v2.content);
      assert.equal(connection.prepare(
        'SELECT engine_response_id FROM continuity_conversation_turns',
      ).get().engine_response_id, v2.responseId);
      assert.equal(count(connection, 'messages', "WHERE sender_type='user'"), 1);
      assert.equal(count(connection, 'messages', "WHERE sender_type='subject'"), 1);
      assert.equal(count(connection, 'continuity_first_round_requests'), 1);
      assert.equal(count(connection, 'continuity_capability_requests'), 1);
      assert.equal(count(connection, 'continuity_capability_model_executions'), 1);
      assert.equal(count(connection, 'continuity_capability_results'), 1);
      assert.equal(count(connection, 'continuity_first_round_results'), 1);
      assert.equal(count(connection, 'continuity_engine_state_projection_receipts'), 1);
      assert.equal(count(connection, 'continuity_conversation_turns'), 1);
      assert.equal(count(connection, 'subject_states'), 0);
      assert.equal(count(connection, 'subject_state_heads'), 0);
      environment.completed = resumed.payload.data;
    });

    await t.test('same Idempotency-Key replays exactly and conflicting content is rejected', async () => {
      const replay = await request(environment, BASE_PATH, {
        method: 'POST',
        key: 'v5-shared-turn-001',
        body: { content: 'hello through the V5 public API' },
      });
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.payload.data, environment.completed);
      const conflict = await request(environment, BASE_PATH, {
        method: 'POST',
        key: 'v5-shared-turn-001',
        body: { content: 'different content must conflict' },
      });
      assert.equal(conflict.status, 409);
      assert.equal(environment.provider.calls.length, 1);
    });

    await t.test('Vio and Engine restart preserve the same public result without another model call', async () => {
      await environment.restartVio();
      await environment.restartEngine();
      const recovered = await request(
        environment,
        `${BASE_PATH}/${environment.completed.turnId}`,
      );
      assert.equal(recovered.status, 200);
      assert.deepEqual(recovered.payload.data, environment.completed);
      const terminalResume = await request(
        environment,
        `${BASE_PATH}/${environment.completed.turnId}/resumptions`,
        { method: 'POST', body: {} },
      );
      assert.equal(terminalResume.status, 200);
      assert.deepEqual(terminalResume.payload.data, environment.completed);
      assert.equal(environment.provider.calls.length, 1);
      const connection = environment.application.database.connection;
      assert.equal(count(connection, 'messages', "WHERE sender_type='subject'"), 1);
      assert.equal(count(connection, 'continuity_first_round_results'), 1);
      assert.equal(count(connection, 'continuity_conversation_turns'), 1);
      assert.deepEqual(inspectEngine(environment), {
        revision: 0,
        operations: 1,
        completed: 1,
        thinking: 1,
      });
    });

    await t.test('public boundaries reject wrong user and unknown request fields', async () => {
      const wrongUser = await fetch(`${environment.vioBaseUrl}${BASE_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vio-user-id': 'other-user',
          'Idempotency-Key': 'v5-shared-wrong-user-001',
        },
        body: JSON.stringify({ content: 'blocked' }),
      });
      assert.equal(wrongUser.status, 400);
      const unknown = await request(environment, BASE_PATH, {
        method: 'POST',
        key: 'v5-shared-unknown-field-001',
        body: { content: 'blocked', providerId: 'forbidden' },
      });
      assert.equal(unknown.status, 400);
      assert.equal(environment.provider.calls.length, 1);
    });

    assert.equal(VIO_V5_PARENT, '0b68e3209cd11c662d4cb973084a18825ed3d03e');
  } finally {
    await environment.cleanup();
  }
});
