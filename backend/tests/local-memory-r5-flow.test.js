import assert from 'node:assert/strict';
import test from 'node:test';

import { createStandaloneChatFixture, approveAndResumeTurn } from '../test-support/standalone-chat-r1-fixtures.js';

const memoryInput = (body, overrides = {}) => ({
  kind: 'preference',
  body,
  summary: null,
  occurredAt: null,
  includeInContext: true,
  sensitivity: 'normal',
  source: { sourceType: 'manual', sourceRef: null },
  ...overrides,
});

const PUBLIC_SELECTION_KEYS = [
  'strategy',
  'status',
  'querySource',
  'crossWindowCandidateCount',
  'crossWindowSelectedCount',
];

async function approve(fixture, response) {
  const confirmationId = response.data.confirmation?.confirmationId;
  assert.equal(typeof confirmationId, 'string', JSON.stringify(response));
  const decision = await fixture.call(`/confirmations/${confirmationId}/decision`, 'POST', {
    decision: 'approve',
  });
  assert.equal(decision.status, 200, JSON.stringify(decision));
  return confirmationId;
}

async function memoryWrite(fixture, path, body, key, method = 'POST', expected = 200) {
  let response = await fixture.call(path, method, body, { 'idempotency-key': key });
  if (response.data?.operationStatus === 'confirmation_required') {
    const confirmationId = await approve(fixture, response);
    response = await fixture.call(path, method, { ...body, confirmationId }, {
      'idempotency-key': key,
    });
  }
  assert.equal(response.status, expected, JSON.stringify(response));
  assert.equal(response.data.operationStatus, 'completed', JSON.stringify(response));
  return response.data;
}

async function memoryRead(fixture, path) {
  let response = await fixture.call(path);
  if (response.data?.operationStatus === 'confirmation_required') {
    const confirmationId = await approve(fixture, response);
    response = await fixture.call(path, 'GET', undefined, {
      'x-vio-confirmation-id': confirmationId,
    });
  }
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.data;
}

test('R5 CRUD uses the verified owner/current assistant and preserves immutable versions', async (t) => {
  const fixture = await createStandaloneChatFixture(t, { configure: false });
  const input = memoryInput('Prefers a quiet workspace.');
  const created = await memoryWrite(fixture, '/memories', input,
    'r5-memory-create-0001', 'POST', 201);
  assert.equal(created.memory.version, 1);
  assert.equal(created.memory.body, input.body);
  assert.equal(created.memory.assistantId, fixture.firstAssistantId);
  assert.equal(created.memory.source.sourceType, 'manual');
  assert.match(created.memory.source.sourceContentHash, /^sha256:[0-9a-f]{64}$/u);

  const replay = await fixture.call('/memories', 'POST', input, {
    'idempotency-key': 'r5-memory-create-0001',
  });
  assert.equal(replay.status, 201, JSON.stringify(replay));
  assert.deepEqual(replay.data, created);
  assert.equal(fixture.app.database.connection.prepare(
    'SELECT count(*) AS n FROM personal_local_memories',
  ).get().n, 1);

  const editedInput = memoryInput('Prefers a quiet workspace after 18:00.', {
    expectedVersion: 1,
  });
  const edited = await memoryWrite(fixture, `/memories/${created.memory.memoryId}`,
    editedInput, 'r5-memory-edit-0001', 'PATCH');
  assert.equal(edited.memory.version, 2);
  assert.equal(edited.memory.body, editedInput.body);
  const versions = await memoryRead(fixture,
    `/memories/${created.memory.memoryId}/versions`);
  assert.deepEqual(versions.items.map(item => item.body), [input.body, editedInput.body]);
  assert.deepEqual(versions.items.map(item => item.version), [1, 2]);

  const listed = await memoryRead(fixture, '/memories?query=quiet&limit=10');
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].memoryId, created.memory.memoryId);
  assert.equal(listed.selection.strategy, 'lexical-overlap-recency/v1');

  await fixture.selectAssistant(fixture.secondAssistantId);
  const isolated = await fixture.call(`/memories/${created.memory.memoryId}`);
  assert.equal(isolated.status, 404, JSON.stringify(isolated));
  assert.equal((await memoryRead(fixture, '/memories')).items.length, 0);
  await fixture.selectAssistant(fixture.firstAssistantId);
  assert.equal((await memoryRead(fixture, `/memories/${created.memory.memoryId}`)).body,
    editedInput.body);
});

test('R5 attached message sources fail closed after the source leaves the selected branch', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'success', content: 'Assistant source reply.' }],
  });
  const conversation = (await fixture.call('/chat/conversations', 'POST', {
    title: 'R5 source conversation',
  }, { 'idempotency-key': 'r5-source-conversation-0001' })).data.conversation;
  let turn = await fixture.call(`/chat/conversations/${conversation.conversationId}/turns`,
    'POST', { branchId: conversation.currentBranchId,
      content: 'The source message for memory.', attachmentIds: [] },
    { 'idempotency-key': 'r5-source-turn-0001' });
  turn = (await approveAndResumeTurn(fixture, turn, 'r5-source-turn-0001')).turn;
  assert.equal(turn.status, 'completed');
  const source = turn.userMessage;
  const created = await memoryWrite(fixture, '/memories', memoryInput('Remember this source.', {
    source: { sourceType: 'message_version',
      sourceRef: `message-version:${source.messageVersionId}` },
  }), 'r5-message-source-memory-0001', 'POST', 201);
  const reference = await memoryWrite(fixture,
    `/memories/${created.memory.memoryId}/references`, {
      sourceType: 'message_version', conversationId: conversation.conversationId,
      messageId: source.messageId, messageVersionId: source.messageVersionId,
      eventId: null, expectedVersion: 1,
    }, 'r5-reference-create-0001');
  assert.equal(reference.reference.status, 'active');
  assert.equal((await memoryRead(fixture,
    `/memories/${created.memory.memoryId}/references`)).items.length, 1);

  const branches = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/branches`,
  );
  const branch = branches.data.branches.find(item =>
    item.branchId === conversation.currentBranchId);
  const hidden = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/messages/${source.messageId}/deletion`,
    'POST', { branchId: conversation.currentBranchId,
      expectedBranchVersion: branch.version },
    { 'idempotency-key': 'r5-source-hide-0001' },
  );
  assert.equal(hidden.status, 200, JSON.stringify(hidden));
  const unavailable = await fixture.call(`/memories/${created.memory.memoryId}`);
  assert.equal(unavailable.status, 404, JSON.stringify(unavailable));
  assert.equal(unavailable.error.code, 'MEMORY_SOURCE_NOT_FOUND');
});

test('R5 deterministic memories enter one R4 locked snapshot and later edits cannot rewrite it', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'success', content: 'Memory-aware response.' }],
  });
  fixture.app.securityPolicyService.createPolicy(fixture.ownerId, {
    resourceType: 'memory', actionType: 'read', riskLevel: 'medium', rule: 'always_allow',
  });
  const created = await memoryWrite(fixture, '/memories',
    memoryInput('The launch codename is amber lighthouse.'),
    'r5-context-memory-create-0001', 'POST', 201);
  const conversation = (await fixture.call('/chat/conversations', 'POST', {
    title: 'R5 context conversation',
  }, { 'idempotency-key': 'r5-context-conversation-0001' })).data.conversation;
  let response = await fixture.call(`/chat/conversations/${conversation.conversationId}/turns`,
    'POST', { branchId: conversation.currentBranchId,
      content: 'What is the amber launch codename?', attachmentIds: [] },
    { 'idempotency-key': 'r5-context-turn-0001' });
  response = (await approveAndResumeTurn(fixture, response, 'r5-context-turn-0001')).response;
  assert.equal(response.status, 200, JSON.stringify(response));
  const turn = response.data;
  assert.equal(turn.context.memory.status, 'included');
  assert.equal(turn.context.memory.selectedCount, 1);
  assert.deepEqual(Object.keys(turn.context.selection), PUBLIC_SELECTION_KEYS);
  assert.equal('memoryEligibleCount' in turn.context.selection, false);
  assert.equal('memoryUnavailableCount' in turn.context.selection, false);
  const memorySource = turn.context.sources.find(item => item.sourceType === 'memory_slot');
  assert.equal(memorySource.evidence.memoryId, created.memory.memoryId);
  assert.equal(memorySource.evidence.memoryVersionId, created.memory.currentVersionId);
  assert.equal(fixture.loopback.requests.at(-1).body.messages.some(item =>
    item.content === created.memory.body), true);
  const locked = structuredClone(turn.context);

  await memoryWrite(fixture, `/memories/${created.memory.memoryId}`,
    memoryInput('The launch codename is cobalt bridge.', { expectedVersion: 1 }),
    'r5-context-memory-edit-0001', 'PATCH');
  const queried = await fixture.call(`/chat/turns/${turn.turnId}/context`);
  assert.equal(queried.status, 200, JSON.stringify(queried));
  assert.deepEqual(queried.data, locked);
  assert.deepEqual(Object.keys(queried.data.selection), PUBLIC_SELECTION_KEYS);
  const evidence = await fixture.call(`/chat/context-sources/${encodeURIComponent(
    memorySource.sourceRef,
  )}`);
  assert.equal(evidence.status, 200, JSON.stringify(evidence));
  assert.equal(evidence.data.body, created.memory.body);
  assert.equal(evidence.data.memoryVersionId, created.memory.currentVersionId);
  assert.equal(fixture.app.database.connection.prepare(`SELECT count(*) AS n
    FROM personal_context_memory_source_links WHERE memory_id=?`).get(
    created.memory.memoryId,
  ).n, 1);
});

test('R5 import/export are deterministic, idempotent and contain no external execution', async (t) => {
  const fixture = await createStandaloneChatFixture(t, { configure: false });
  const document = {
    contractVersion: 'vio-local-memory-import/v1', mode: 'best_effort', items: [
      { clientItemId: 'r5-import-item-0001', kind: 'decision',
        body: 'Use the verified local ledger.', summary: 'Ledger decision', occurredAt: null,
        includeInContext: false, sensitivity: 'normal' },
      { clientItemId: 'r5-import-item-0002', kind: 'unsupported',
        body: 'Rejected item.', summary: null, occurredAt: null,
        includeInContext: false, sensitivity: 'normal' },
    ],
  };
  const imported = await memoryWrite(fixture, '/memories/imports', document,
    'r5-import-operation-0001');
  assert.equal(imported.import.createdCount, 1);
  assert.equal(imported.import.invalidCount, 1);
  assert.equal(imported.externalCall, 'not_performed');
  const memoryId = imported.import.items.find(item => item.status === 'created').memoryId;
  const exported = await memoryWrite(fixture, '/memories/exports', {
    contractVersion: 'vio-local-memory-export/v1', memoryIds: [memoryId],
    includeArchived: false,
  }, 'r5-export-operation-0001');
  assert.equal(exported.export.itemCount, 1);
  assert.equal(exported.export.items[0].body, 'Use the verified local ledger.');
  assert.match(exported.export.contentHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(exported.externalCall, 'not_performed');
});

test('R5 deletion requires two controlled confirmations and preserves a minimal receipt', async (t) => {
  const fixture = await createStandaloneChatFixture(t, { configure: false });
  const created = await memoryWrite(fixture, '/memories', memoryInput('Delete this exact body.'),
    'r5-delete-memory-create-0001', 'POST', 201);
  const requested = await memoryWrite(fixture,
    `/memories/${created.memory.memoryId}/deletion`, { expectedVersion: 1 },
    'r5-delete-request-0001');
  assert.equal(requested.memory.status, 'deletion_pending');
  assert.equal(requested.deletion.bodyRetained, true);
  const deletionId = requested.deletion.deletionId;

  const finalized = await memoryWrite(fixture,
    `/memories/${created.memory.memoryId}/deletion-finalization`, { deletionId },
    'r5-delete-finalize-0001');
  assert.equal(finalized.memory, null);
  assert.equal(finalized.deletion.result, 'deleted');
  assert.equal(finalized.deletion.bodyRetained, false);
  const receipt = await fixture.call(`/memories/deletions/${deletionId}`);
  assert.equal(receipt.status, 200, JSON.stringify(receipt));
  assert.equal(JSON.stringify(receipt).includes('Delete this exact body.'), false);
  assert.equal(fixture.app.database.connection.prepare(
    'SELECT count(*) AS n FROM personal_local_memory_versions',
  ).get().n, 0);
  const replay = await fixture.call('/memories', 'POST', memoryInput('Delete this exact body.'), {
    'idempotency-key': 'r5-delete-memory-create-0001',
  });
  assert.equal(replay.status, 410, JSON.stringify(replay));
  assert.equal(replay.error.code, 'MEMORY_BODY_UNAVAILABLE');
});
