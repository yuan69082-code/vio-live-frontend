import assert from 'node:assert/strict';
import test from 'node:test';

import { createStandaloneChatFixture } from '../test-support/standalone-chat-r1-fixtures.js';

const input = (body, overrides = {}) => ({
  kind: 'preference',
  body,
  summary: null,
  occurredAt: null,
  includeInContext: true,
  sensitivity: 'normal',
  source: { sourceType: 'manual', sourceRef: null },
  ...overrides,
});

async function approve(fixture, confirmationId) {
  const decision = await fixture.call(`/confirmations/${confirmationId}/decision`, 'POST', {
    decision: 'approve',
  });
  assert.equal(decision.status, 200, JSON.stringify(decision));
}

async function write(fixture, path, body, key, { method = 'POST', created = false } = {}) {
  let response = await fixture.call(path, method, body, { 'idempotency-key': key });
  if (response.data?.operationStatus === 'confirmation_required') {
    const confirmationId = response.data.confirmation.confirmationId;
    await approve(fixture, confirmationId);
    response = await fixture.call(path, method, { ...body, confirmationId }, {
      'idempotency-key': key,
    });
  }
  assert.equal(response.status, created ? 201 : 200, JSON.stringify(response));
  assert.equal(response.data.operationStatus, 'completed', JSON.stringify(response));
  return response.data;
}

async function read(fixture, path) {
  let response = await fixture.call(path);
  if (response.data?.operationStatus === 'confirmation_required') {
    const confirmationId = response.data.confirmation.confirmationId;
    await approve(fixture, confirmationId);
    response = await fixture.call(path, 'GET', undefined, {
      'x-vio-confirmation-id': confirmationId,
    });
  }
  assert.equal(response.status, 200, JSON.stringify(response));
  return response;
}

test('R5 restart preserves pending confirmation and fails an orphaned processing operation closed', async (t) => {
  const fixture = await createStandaloneChatFixture(t, { configure: false });
  const pendingInput = input('Persist the confirmation checkpoint.');
  const pending = await fixture.call('/memories', 'POST', pendingInput, {
    'idempotency-key': 'r5-restart-pending-0001',
  });
  assert.equal(pending.status, 200, JSON.stringify(pending));
  assert.equal(pending.data.operationStatus, 'confirmation_required');
  const confirmationId = pending.data.confirmation.confirmationId;

  await fixture.restart();
  const afterRestart = await fixture.call('/memories', 'POST', pendingInput, {
    'idempotency-key': 'r5-restart-pending-0001',
  });
  assert.equal(afterRestart.status, 200, JSON.stringify(afterRestart));
  assert.equal(afterRestart.data.confirmation.confirmationId, confirmationId);
  assert.equal(fixture.app.database.connection.prepare(
    'SELECT count(*) AS n FROM personal_local_memories',
  ).get().n, 0);

  await approve(fixture, confirmationId);
  const completed = await fixture.call('/memories', 'POST', {
    ...pendingInput, confirmationId,
  }, { 'idempotency-key': 'r5-restart-pending-0001' });
  assert.equal(completed.status, 201, JSON.stringify(completed));
  assert.equal(completed.data.operationStatus, 'completed');

  const orphanInput = input('This operation must never execute after a crash.');
  const orphan = await fixture.call('/memories', 'POST', orphanInput, {
    'idempotency-key': 'r5-restart-orphan-0001',
  });
  assert.equal(orphan.data.operationStatus, 'confirmation_required');
  fixture.app.database.connection.prepare(`UPDATE personal_local_memory_operations
    SET status='processing',confirmation_id=NULL
    WHERE user_id=? AND assistant_id=? AND idempotency_key=?`).run(
    fixture.ownerId, fixture.firstAssistantId, 'r5-restart-orphan-0001',
  );

  await fixture.restart();
  const recovered = await fixture.call(
    '/memories/operations/by-idempotency-key/r5-restart-orphan-0001',
  );
  assert.equal(recovered.status, 200, JSON.stringify(recovered));
  assert.equal(recovered.data.operationStatus, 'failed');
  assert.equal(recovered.data.operation.status, 'failed');
  assert.equal(recovered.data.operation.errorCode, 'MEMORY_OPERATION_INTERRUPTED');
  const replay = await fixture.call('/memories', 'POST', orphanInput, {
    'idempotency-key': 'r5-restart-orphan-0001',
  });
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.deepEqual(replay.data, recovered.data);
  assert.equal(fixture.app.database.connection.prepare(
    'SELECT count(*) AS n FROM personal_local_memories',
  ).get().n, 1);
});

test('R5 concurrent exact replay is single-write and changed content conflicts without a second fact', async (t) => {
  const fixture = await createStandaloneChatFixture(t, { configure: false });
  const exact = input('One exact concurrent fact.');
  const pending = await fixture.call('/memories', 'POST', exact, {
    'idempotency-key': 'r5-concurrent-0001',
  });
  assert.equal(pending.data.operationStatus, 'confirmation_required');
  const confirmationId = pending.data.confirmation.confirmationId;
  await approve(fixture, confirmationId);
  const [first, second] = await Promise.all([
    fixture.call('/memories', 'POST', { ...exact, confirmationId }, {
      'idempotency-key': 'r5-concurrent-0001',
    }),
    fixture.call('/memories', 'POST', { ...exact, confirmationId }, {
      'idempotency-key': 'r5-concurrent-0001',
    }),
  ]);
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.equal(second.status, 201, JSON.stringify(second));
  assert.deepEqual(second.data, first.data);
  const conflict = await fixture.call('/memories', 'POST', input('Changed concurrent fact.'), {
    'idempotency-key': 'r5-concurrent-0001',
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict));
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const connection = fixture.app.database.connection;
  assert.equal(connection.prepare('SELECT count(*) AS n FROM personal_local_memories').get().n, 1);
  assert.equal(connection.prepare(
    'SELECT count(*) AS n FROM personal_local_memory_versions',
  ).get().n, 1);
  assert.equal(connection.prepare(
    'SELECT count(*) AS n FROM personal_local_memory_operations',
  ).get().n, 1);
});

test('R5 relevant search cursor retains the complete snapshot and rejects tamper or assistant reuse', async (t) => {
  let clockValue = Date.parse('2026-09-08T00:00:00.000Z');
  const fixture = await createStandaloneChatFixture(t, { configure: false,
    applicationOptions: { personalClock: () => new Date(clockValue += 1_000) } });
  const relevant = await write(fixture, '/memories', input('Amber lighthouse launch code.'),
    'r5-cursor-relevant-0001', { created: true });
  await write(fixture, '/memories', input('A newer but unrelated record.'),
    'r5-cursor-unrelated-0001', { created: true });

  const first = await read(fixture, '/memories?query=amber&limit=1');
  assert.equal(first.data.items[0].memoryId, relevant.memory.memoryId);
  assert.equal(typeof first.data.nextCursor, 'string');
  const second = await read(fixture, `/memories?query=amber&limit=1&cursor=${encodeURIComponent(
    first.data.nextCursor,
  )}`);
  assert.equal(second.data.items.length, 1);
  assert.notEqual(second.data.items[0].memoryId, relevant.memory.memoryId);
  assert.equal(second.data.nextCursor, null);

  const tampered = `${first.data.nextCursor.slice(0, -1)}A`;
  const rejected = await fixture.call(
    `/memories?query=amber&limit=1&cursor=${encodeURIComponent(tampered)}`,
  );
  assert.equal(rejected.status, 400, JSON.stringify(rejected));
  assert.equal(rejected.error.code, 'MEMORY_CURSOR_INVALID');

  await fixture.selectAssistant(fixture.secondAssistantId);
  const crossAssistant = await fixture.call(
    `/memories?query=amber&limit=1&cursor=${encodeURIComponent(first.data.nextCursor)}`,
  );
  assert.equal(crossAssistant.status, 400, JSON.stringify(crossAssistant));
  assert.equal(crossAssistant.error.code, 'MEMORY_CURSOR_INVALID');
});

test('R5 sensitive reads challenge the whole response and deletion cancellation restores the same version', async (t) => {
  const fixture = await createStandaloneChatFixture(t, { configure: false });
  const created = await write(fixture, '/memories', input('Sensitive local-only fact.', {
    sensitivity: 'sensitive',
  }), 'r5-sensitive-create-0001', { created: true });
  const challenged = await fixture.call('/memories');
  assert.equal(challenged.status, 200, JSON.stringify(challenged));
  assert.equal(challenged.data.operationStatus, 'confirmation_required');
  assert.equal(JSON.stringify(challenged).includes('Sensitive local-only fact.'), false);
  const confirmationId = challenged.data.confirmation.confirmationId;
  await approve(fixture, confirmationId);
  const revealed = await fixture.call('/memories', 'GET', undefined, {
    'x-vio-confirmation-id': confirmationId,
  });
  assert.equal(revealed.status, 200, JSON.stringify(revealed));
  assert.equal(revealed.data.items[0].body, 'Sensitive local-only fact.');

  const requested = await write(fixture,
    `/memories/${created.memory.memoryId}/deletion`, { expectedVersion: 1 },
    'r5-cancel-request-0001');
  assert.equal(requested.memory.status, 'deletion_pending');
  const cancelled = await write(fixture,
    `/memories/${created.memory.memoryId}/deletion-cancellation`, {
      deletionId: requested.deletion.deletionId,
    }, 'r5-cancel-final-0001');
  assert.equal(cancelled.deletion.status, 'cancelled');
  assert.equal(cancelled.memory.status, 'active');
  assert.equal(cancelled.memory.currentVersionId, created.memory.currentVersionId);
  assert.equal(fixture.app.database.connection.prepare(
    'SELECT count(*) AS n FROM personal_local_memory_versions',
  ).get().n, 1);
});

test('R5 failed atomic import rolls back created memories and leaves a terminal hash-only operation', async (t) => {
  const fixture = await createStandaloneChatFixture(t, { configure: false });
  const base = {
    contractVersion: 'vio-local-memory-import/v1',
    mode: 'atomic',
    items: [{ clientItemId: 'r5-atomic-existing-0001', kind: 'decision',
      body: 'Original import fact.', summary: null, occurredAt: null,
      includeInContext: false, sensitivity: 'normal' }],
  };
  await write(fixture, '/memories/imports', base, 'r5-atomic-seed-0001');
  const conflictInput = { ...base, items: [
    { ...base.items[0], body: 'Conflicting import fact.' },
    { clientItemId: 'r5-atomic-new-0001', kind: 'project', body: 'Must roll back.',
      summary: null, occurredAt: null, includeInContext: false, sensitivity: 'normal' },
  ] };
  let response = await fixture.call('/memories/imports', 'POST', conflictInput, {
    'idempotency-key': 'r5-atomic-conflict-0001',
  });
  assert.equal(response.data.operationStatus, 'confirmation_required', JSON.stringify(response));
  const confirmationId = response.data.confirmation.confirmationId;
  await approve(fixture, confirmationId);
  response = await fixture.call('/memories/imports', 'POST', {
    ...conflictInput, confirmationId,
  }, { 'idempotency-key': 'r5-atomic-conflict-0001' });
  assert.equal(response.status, 409, JSON.stringify(response));
  assert.equal(response.error.code, 'MEMORY_IMPORT_INVALID');
  const connection = fixture.app.database.connection;
  assert.equal(connection.prepare('SELECT count(*) AS n FROM personal_local_memories').get().n, 1);
  const operation = connection.prepare(`SELECT status,error_code,request_hash
    FROM personal_local_memory_operations WHERE idempotency_key=?`).get(
    'r5-atomic-conflict-0001',
  );
  assert.deepEqual({ status: operation.status, errorCode: operation.error_code }, {
    status: 'failed', errorCode: 'MEMORY_IMPORT_INVALID',
  });
  assert.match(operation.request_hash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(operation).includes('Conflicting import fact.'), false);
  assert.equal(JSON.stringify(operation).includes('Must roll back.'), false);
});
