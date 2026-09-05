import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveAndResumeTurn,
  createCompletedTurn,
  createDeferred,
  createStandaloneChatFixture,
  r1LedgerCounts,
  responseTurn,
} from '../test-support/standalone-chat-r1-fixtures.js';
import { startPersonalTestApplication } from '../test-support/personal-test-application.js';
import {
  SUBJECT_RUNTIME_PORT_VERSION,
  createSubjectRuntimeConnectionSnapshot,
  negotiateSubjectRuntimeVersion,
} from '../src/modules/subject-runtime/subject-runtime-port-v1.js';

function externalRuntimeAdapter() {
  const manifest = Object.freeze({
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId: 'r1-third-party-test',
    adapterKind: 'third_party',
    adapterVersion: 'r1-test-adapter/v1',
    runtimeMode: 'external',
    runtimeName: 'R1 Test Runtime',
    runtimeVersion: 'r1-test-runtime/v1',
    supportedPortVersions: [SUBJECT_RUNTIME_PORT_VERSION],
    capabilities: ['observation_input', 'expression_result'],
    specializedContracts: [],
  });
  return Object.freeze({
    getManifest: () => structuredClone(manifest),
    getConnectionStatus: () => createSubjectRuntimeConnectionSnapshot({
      manifest,
      state: 'ready',
      reason: null,
    }),
    negotiateVersion: (vioSupportedVersions) => negotiateSubjectRuntimeVersion({
      vioSupportedVersions,
      adapterManifest: manifest,
    }),
    submitObservation() { throw new Error('R1 must not call an external runtime.'); },
    cancel() { throw new Error('R1 must not call an external runtime.'); },
    recover() { throw new Error('R1 must not call an external runtime.'); },
  });
}

async function waitUntil(predicate) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out while waiting for the controlled test boundary.');
}

function assertNoSecret(value, fixture) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(fixture.testCredential), false);
  assert.equal(/authorization/i.test(serialized), false);
}

test('R1 personal chat derives owner and assistant from the verified session and reads without execution', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const initial = await f.call('/chat/default');
  assert.equal(initial.status, 200, JSON.stringify(initial));
  assert.equal(initial.data.assistant.assistantId, f.firstAssistantId);
  assert.equal(initial.data.conversation, null);
  assert.deepEqual(initial.data.messages, []);
  assert.equal(initial.data.activeTurn, null);
  assert.equal(initial.data.externalCall, 'not_performed');
  assert.equal(f.loopback.requests.length, 0);

  for (const field of ['userId', 'assistantId', 'subjectId', 'conversationId']) {
    const rejected = await f.call('/chat/turns', 'POST', {
      content: 'Identity must be server derived.',
      [field]: 'caller-controlled-scope',
    }, { 'idempotency-key': `forged-${field}-0001` });
    assert.equal(rejected.status, 400, field);
  }
  assert.equal(f.loopback.requests.length, 0);

  const cookie = f.state.cookie;
  const csrf = f.state.csrf;
  f.state.cookie = '';
  f.state.csrf = '';
  const headerOnly = await f.call('/chat/default', 'GET', undefined, {
    'x-vio-user-id': f.ownerId,
  });
  assert.equal(headerOnly.status, 401);
  f.state.cookie = cookie;
  f.state.csrf = csrf;
});

test('R1 personal chat HTTP boundary rejects null bodies and malformed path encoding without side effects', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const emptyLedger = {
    defaultConversations: 0,
    turns: 0,
    executions: 0,
    budgetApprovals: 0,
    attempts: 0,
    usage: 0,
    results: 0,
    recoveryActions: 0,
  };
  assert.deepEqual(r1LedgerCounts(f.app.database.connection), emptyLedger);

  async function postLiteralNull(path, idempotencyKey) {
    const response = await fetch(`${f.baseUrl}/api/v1/personal${path}`, {
      method: 'POST',
      headers: {
        cookie: f.state.cookie,
        'x-vio-csrf': f.state.csrf,
        'idempotency-key': idempotencyKey,
        'content-type': 'application/json',
      },
      body: 'null',
    });
    return { status: response.status, ...await response.json() };
  }

  for (const response of [
    await postLiteralNull('/chat/turns', 'null-chat-turn-0001'),
    await postLiteralNull('/chat/turns/turn-does-not-exist/recovery', 'null-chat-recovery-0001'),
  ]) {
    assert.equal(response.status, 400, JSON.stringify(response));
    assert.equal(response.error.code, 'validation_error');
  }

  for (const [path, method, body, headers] of [
    ['/chat/turns/%', 'GET'],
    ['/chat/turns/by-idempotency-key/%', 'GET'],
    ['/chat/turns/%/recovery', 'POST', { action: 'resume' }, { 'idempotency-key': 'malformed-path-recovery-0001' }],
  ]) {
    const response = await f.call(path, method, body, headers);
    assert.equal(response.status, 400, `${path}: ${JSON.stringify(response)}`);
    assert.equal(response.error.code, 'validation_error');
  }

  assert.deepEqual(r1LedgerCounts(f.app.database.connection), emptyLedger);
  assert.equal(f.loopback.requests.length, 0);
});

test('R1 standalone endpoints fail closed instead of bypassing a selected external runtime', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: { subjectRuntimeAdapter: externalRuntimeAdapter() },
  });
  const read = await f.call('/chat/default');
  assert.equal(read.status, 409, JSON.stringify(read));
  assert.equal(read.error.code, 'STANDALONE_MODE_REQUIRED');
  const write = await f.call('/chat/turns', 'POST', { content: 'Must not bypass external mode.' }, {
    'idempotency-key': 'external-mode-refused-0001',
  });
  assert.equal(write.status, 409, JSON.stringify(write));
  assert.equal(write.error.code, 'STANDALONE_MODE_REQUIRED');
  assert.equal(f.loopback.requests.length, 0);
  assert.deepEqual(r1LedgerCounts(f.app.database.connection), {
    defaultConversations: 0,
    turns: 0,
    executions: 0,
    budgetApprovals: 0,
    attempts: 0,
    usage: 0,
    results: 0,
    recoveryActions: 0,
  });
});

test('R1 loopback OpenAI-compatible execution publishes pinned messages and bounded multi-turn history', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [
      { type: 'success', content: 'First controlled answer.', inputTokens: 20, outputTokens: 5 },
      { type: 'success', content: 'Second controlled answer.', inputTokens: 31, outputTokens: 6 },
    ],
  });
  const first = await createCompletedTurn(f, 'First user question.', 'chat-turn-first-0001');
  assert.equal(first.turn.userMessage.content, 'First user question.');
  assert.equal(first.turn.assistantMessage.content, 'First controlled answer.');
  assert.equal(first.turn.userMessage.senderType, 'user');
  assert.equal(first.turn.assistantMessage.senderType, 'subject');
  assert.equal(f.loopback.requests.length, 1);
  assert.equal(f.loopback.requests[0].path, '/chat/completions');
  assert.equal(f.loopback.requests[0].authorization, `Bearer ${f.testCredential}`);
  assert.equal(f.loopback.requests[0].body.max_tokens, 4_096);
  assert.deepEqual(f.loopback.requests[0].body.messages.map(({ role }) => role), ['system', 'user']);
  assert.match(f.loopback.requests[0].body.messages[0].content, /First controlled assistant/);
  assert.doesNotMatch(JSON.stringify(f.loopback.requests[0].body), /Second controlled assistant/);

  const second = await createCompletedTurn(f, 'Second user question.', 'chat-turn-second-0001');
  assert.equal(second.turn.assistantMessage.content, 'Second controlled answer.');
  assert.equal(f.loopback.requests.length, 2);
  assert.deepEqual(f.loopback.requests[1].body.messages.map(({ role }) => role), [
    'system', 'user', 'assistant', 'user',
  ]);
  assert.deepEqual(f.loopback.requests[1].body.messages.slice(1).map(({ content }) => content), [
    'First user question.', 'First controlled answer.', 'Second user question.',
  ]);

  const visible = await f.call('/chat/default');
  assert.equal(visible.data.messages.length, 4);
  assert.deepEqual(visible.data.messages.map(({ content }) => content), [
    'First user question.', 'First controlled answer.', 'Second user question.', 'Second controlled answer.',
  ]);
  assert.equal(f.app.database.connection.prepare(
    'SELECT sum(total_tokens) AS total FROM standalone_chat_usage_facts',
  ).get().total, 62);
  assert.equal(f.app.database.connection.prepare(`
    SELECT min(estimated_tokens) AS estimatedTokens
    FROM standalone_chat_model_executions
  `).get().estimatedTokens >= 4_096, true, 'budget estimate must cover the output-token cap');
  assert.deepEqual(f.app.database.connection.prepare(`
    SELECT DISTINCT max_output_tokens AS maxOutputTokens
    FROM standalone_chat_model_executions
  `).all().map(({ maxOutputTokens }) => maxOutputTokens), [4_096]);
  assertNoSecret(first.response, f);
  assertNoSecret(second.response, f);
});

test('R1 budget and security confirmation gates complete monotonically before one Provider call', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const budget = f.app.proactiveInteractionService.upsertTokenBudget(
    f.ownerId,
    f.firstAssistantId,
    {
    dailyTokenLimit: 1,
    sessionTokenLimit: 1,
    overagePolicy: 'require_confirmation',
    status: 'enabled',
    },
  );
  f.app.permissionService.createPermission(f.ownerId, {
    subjectId: f.firstAssistantId,
    resourceType: 'proactive_interaction',
    resourceId: budget.tokenBudgetId,
    action: 'execute',
    permissionLevel: 'always_allow',
    status: 'active',
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Both independent confirmation gates must be completed.',
  }, { 'idempotency-key': 'dual-confirmation-turn-0001' });
  const budgetWaiting = responseTurn(created);
  assert.equal(budgetWaiting.status, 'waiting_budget', JSON.stringify(created));
  const budgetConfirmationId = budgetWaiting.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${budgetConfirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const afterBudget = await f.call(`/chat/turns/${budgetWaiting.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: budgetConfirmationId,
  }, { 'idempotency-key': 'dual-confirmation-budget-resume-0001' });
  const securityWaiting = responseTurn(afterBudget);
  assert.equal(securityWaiting.status, 'waiting_confirmation', JSON.stringify(afterBudget));
  assert.notEqual(securityWaiting.confirmation.confirmationId, budgetConfirmationId);
  assert.equal(f.loopback.requests.length, 0);

  const securityConfirmationId = securityWaiting.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${securityConfirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const completed = await f.call(`/chat/turns/${securityWaiting.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: securityConfirmationId,
  }, { 'idempotency-key': 'dual-confirmation-security-resume-0001' });
  assert.equal(completed.status, 200, JSON.stringify(completed));
  assert.equal(responseTurn(completed).status, 'completed');
  assert.equal(f.loopback.requests.length, 1);
  assert.equal(r1LedgerCounts(f.app.database.connection).attempts, 1);
});

test('R1 keeps one default conversation per assistant and restores isolated history after switching and restart', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [
      { type: 'success', content: 'Answer owned by assistant one.' },
      { type: 'success', content: 'Answer owned by assistant two.' },
    ],
  });
  const firstCompleted = await createCompletedTurn(
    f,
    'Question for assistant one.',
    'assistant-one-turn-0001',
  );
  const firstView = (await f.call('/chat/default')).data;
  await f.selectAssistant(f.secondAssistantId);
  const emptySecond = (await f.call('/chat/default')).data;
  assert.equal(emptySecond.conversation, null);
  assert.deepEqual(emptySecond.messages, []);
  assert.equal((await f.call(`/chat/turns/${firstCompleted.turn.turnId}`)).status, 404);
  assert.equal((await f.call('/chat/turns/by-idempotency-key/assistant-one-turn-0001')).status, 404);
  await createCompletedTurn(f, 'Question for assistant two.', 'assistant-two-turn-0001');
  const secondView = (await f.call('/chat/default')).data;
  assert.notEqual(secondView.conversation.conversationId, firstView.conversation.conversationId);
  assert.deepEqual(secondView.messages.map(({ content }) => content), [
    'Question for assistant two.', 'Answer owned by assistant two.',
  ]);

  await f.selectAssistant(f.firstAssistantId);
  assert.deepEqual((await f.call('/chat/default')).data.messages.map(({ content }) => content), [
    'Question for assistant one.', 'Answer owned by assistant one.',
  ]);
  await f.restart();
  const restarted = await f.call('/chat/default');
  assert.deepEqual(restarted.data.messages.map(({ content }) => content), [
    'Question for assistant one.', 'Answer owned by assistant one.',
  ]);
  assert.equal(f.loopback.requests.length, 2);
  assert.deepEqual(r1LedgerCounts(f.app.database.connection), {
    defaultConversations: 2,
    turns: 2,
    executions: 2,
    budgetApprovals: 0,
    attempts: 2,
    usage: 2,
    results: 2,
    recoveryActions: 2,
  });
});

test('R1 idempotent replay and pure recovery queries never duplicate messages or Provider calls', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const completed = await createCompletedTurn(f, 'Exactly once question.', 'exactly-once-turn-0001');
  const turnId = completed.turn.turnId;
  const before = r1LedgerCounts(f.app.database.connection);
  const calls = f.loopback.requests.length;
  const replay = await f.call('/chat/turns', 'POST', {
    content: 'Exactly once question.',
  }, { 'idempotency-key': 'exactly-once-turn-0001' });
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.equal(responseTurn(replay).turnId, turnId);
  const changed = await f.call('/chat/turns', 'POST', {
    content: 'Changed content must conflict.',
  }, { 'idempotency-key': 'exactly-once-turn-0001' });
  assert.equal(changed.status, 409);
  const byId = await f.call(`/chat/turns/${turnId}`);
  const byKey = await f.call('/chat/turns/by-idempotency-key/exactly-once-turn-0001');
  assert.equal(responseTurn(byId).turnId, turnId);
  assert.equal(responseTurn(byKey).turnId, turnId);
  assert.deepEqual(r1LedgerCounts(f.app.database.connection), before);
  assert.equal(f.loopback.requests.length, calls);
});

test('R1 binds a creation Idempotency-Key to the owner across assistant switches', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const first = await createCompletedTurn(
    f,
    'The owner-wide operation key belongs to assistant one.',
    'owner-wide-turn-key-0001',
  );
  assert.equal(first.turn.status, 'completed');
  assert.equal(f.loopback.requests.length, 1);

  await f.selectAssistant(f.secondAssistantId);
  const conflict = await f.call('/chat/turns', 'POST', {
    content: 'The owner-wide operation key belongs to assistant one.',
  }, { 'idempotency-key': 'owner-wide-turn-key-0001' });
  assert.equal(conflict.status, 409, JSON.stringify(conflict));
  assert.match(conflict.error.message, /different assistant/i);
  assert.equal(f.loopback.requests.length, 1);
  assert.equal(r1LedgerCounts(f.app.database.connection).turns, 1);
});

test('R1 active-turn constraint rejects concurrent business requests before a second model call', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const first = await f.call('/chat/turns', 'POST', {
    content: 'First pending question.',
  }, { 'idempotency-key': 'active-turn-first-0001' });
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(responseTurn(first).status, 'waiting_confirmation');
  const second = await f.call('/chat/turns', 'POST', {
    content: 'Concurrent second question.',
  }, { 'idempotency-key': 'active-turn-second-0001' });
  assert.equal(second.status, 409, JSON.stringify(second));
  assert.equal(f.loopback.requests.length, 0);
  assert.equal(r1LedgerCounts(f.app.database.connection).turns, 1);
});

test('R1 fails closed for missing, disabled, denied, locked and budget-blocked execution facts', async (t) => {
  await t.test('no current assistant', async (t) => {
    const f = await startPersonalTestApplication(t);
    await f.initialize();
    const read = await f.call('/chat/default');
    assert.equal(read.status, 409);
    assert.equal(read.error.code, 'ASSISTANT_NOT_SELECTED');
  });
  await t.test('missing default model', async (t) => {
    const f = await createStandaloneChatFixture(t, { configure: false });
    const result = await f.call('/chat/turns', 'POST', { content: 'No configured model.' }, {
      'idempotency-key': 'missing-model-turn-0001',
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(responseTurn(result).error.code, 'DEFAULT_CHAT_MODEL_NOT_CONFIGURED');
    assert.equal(f.loopback.requests.length, 0);
  });
  await t.test('disabled default model', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const model = (await f.call('/models')).data.items.find(({ modelId }) => modelId === f.modelId);
    await f.secured(`/models/${f.modelId}`, 'PATCH', {
      modelName: model.modelName,
      modelType: model.modelType,
      capabilities: model.capabilities,
      status: 'disabled',
      defaultForChat: true,
      expectedVersion: model.version,
    }, 'disable-r1-model-0001');
    const result = await f.call('/chat/turns', 'POST', { content: 'Disabled model.' }, {
      'idempotency-key': 'disabled-model-turn-0001',
    });
    assert.equal(responseTurn(result).error.code, 'MODEL_DISABLED');
    assert.equal(f.loopback.requests.length, 0);
  });
  await t.test('disabled Provider', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const provider = (await f.call('/providers')).data.items.find(
      ({ providerId }) => providerId === f.providerId,
    );
    await f.secured(`/providers/${f.providerId}`, 'PATCH', {
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      interfaceFormat: provider.interfaceFormat,
      status: 'disabled',
      expectedVersion: provider.version,
    }, 'disable-r1-provider-0001');
    const result = await f.call('/chat/turns', 'POST', { content: 'Disabled Provider.' }, {
      'idempotency-key': 'disabled-provider-turn-0001',
    });
    assert.equal(responseTurn(result).error.code, 'PROVIDER_DISABLED');
    assert.equal(f.loopback.requests.length, 0);
  });
  await t.test('revoked credential', async (t) => {
    const f = await createStandaloneChatFixture(t);
    await f.secured(
      `/providers/${f.providerId}/credential`,
      'DELETE',
      {},
      'revoke-r1-credential-0001',
    );
    const result = await f.call('/chat/turns', 'POST', { content: 'Credential revoked.' }, {
      'idempotency-key': 'missing-credential-turn-0001',
    });
    const resumed = await approveAndResumeTurn(f, result, 'missing-credential-turn-0001');
    assert.equal(resumed.turn.error.code, 'CREDENTIAL_UNAVAILABLE');
    assert.equal(f.loopback.requests.length, 0);
  });
  await t.test('execute permission denied', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const executePermission = f.app.permissionService.listPermissions(f.ownerId, {
      resourceType: 'api',
      resourceId: f.providerId,
      action: 'execute',
      status: 'active',
    }).find(({ subjectId }) => subjectId === null);
    assert.ok(executePermission);
    f.app.permissionService.updatePermission(f.ownerId, executePermission.permissionId, {
      permissionLevel: 'denied',
    });
    const result = await f.call('/chat/turns', 'POST', { content: 'Permission denied.' }, {
      'idempotency-key': 'permission-denied-turn-0001',
    });
    assert.equal(responseTurn(result).error.code, 'PERMISSION_DENIED');
    assert.equal(f.loopback.requests.length, 0);
  });
  await t.test('vault locked after restart', async (t) => {
    const f = await createStandaloneChatFixture(t);
    await f.restart();
    const result = await f.call('/chat/turns', 'POST', { content: 'Vault is locked.' }, {
      'idempotency-key': 'locked-vault-turn-0001',
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    const resumed = await approveAndResumeTurn(f, result, 'locked-vault-turn-0001');
    assert.equal(resumed.turn.error.code, 'VAULT_LOCKED');
    assert.equal(f.loopback.requests.length, 0);
  });
  await t.test('token budget blocks before Provider', async (t) => {
    const f = await createStandaloneChatFixture(t, {
      dailyTokenLimit: 1,
      sessionTokenLimit: 1,
    });
    const result = await f.call('/chat/turns', 'POST', {
      content: 'This deterministic conservative estimate exceeds one token.',
    }, { 'idempotency-key': 'budget-blocked-turn-0001' });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(responseTurn(result).error.code, 'TOKEN_BUDGET_BLOCKED');
    assert.equal(f.loopback.requests.length, 0);
  });
  await t.test('security confirmation resume rechecks a disabled token budget', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const created = await f.call('/chat/turns', 'POST', {
      content: 'The budget must still be enabled after security confirmation.',
    }, { 'idempotency-key': 'budget-disabled-after-security-0001' });
    const waiting = responseTurn(created);
    assert.equal(waiting.status, 'waiting_confirmation', JSON.stringify(created));
    const confirmationId = waiting.confirmation.confirmationId;
    assert.equal((await f.call(`/confirmations/${confirmationId}/decision`, 'POST', {
      decision: 'approve',
    })).status, 200);
    f.app.proactiveInteractionService.upsertTokenBudget(f.ownerId, f.firstAssistantId, {
      dailyTokenLimit: 100_000,
      sessionTokenLimit: 50_000,
      overagePolicy: 'block',
      status: 'disabled',
    });
    const resumed = await f.call(`/chat/turns/${waiting.turnId}/recovery`, 'POST', {
      action: 'resume', confirmationId,
    }, { 'idempotency-key': 'budget-disabled-after-security-resume-0001' });
    assert.equal(resumed.status, 200, JSON.stringify(resumed));
    assert.equal(responseTurn(resumed).status, 'retryable');
    assert.equal(responseTurn(resumed).error.code, 'TOKEN_BUDGET_DISABLED');
    assert.equal(f.loopback.requests.length, 0);
    assert.equal(r1LedgerCounts(f.app.database.connection).attempts, 0);
  });
  await t.test('security confirmation resume rechecks an exhausted token budget', async (t) => {
    const f = await createStandaloneChatFixture(t);
    const created = await f.call('/chat/turns', 'POST', {
      content: 'The budget may become exhausted while confirmation is pending.',
    }, { 'idempotency-key': 'budget-exhausted-after-security-0001' });
    const waiting = responseTurn(created);
    assert.equal(waiting.status, 'waiting_confirmation', JSON.stringify(created));
    const confirmationId = waiting.confirmation.confirmationId;
    assert.equal((await f.call(`/confirmations/${confirmationId}/decision`, 'POST', {
      decision: 'approve',
    })).status, 200);
    f.app.proactiveInteractionService.upsertTokenBudget(f.ownerId, f.firstAssistantId, {
      dailyTokenLimit: 1,
      sessionTokenLimit: 1,
      overagePolicy: 'block',
      status: 'enabled',
    });
    const resumed = await f.call(`/chat/turns/${waiting.turnId}/recovery`, 'POST', {
      action: 'resume', confirmationId,
    }, { 'idempotency-key': 'budget-exhausted-after-security-resume-0001' });
    assert.equal(resumed.status, 200, JSON.stringify(resumed));
    assert.equal(responseTurn(resumed).status, 'failed');
    assert.equal(responseTurn(resumed).error.code, 'TOKEN_BUDGET_BLOCKED');
    assert.equal(f.loopback.requests.length, 0);
    assert.equal(r1LedgerCounts(f.app.database.connection).attempts, 0);
  });
});

test('R1 in-flight reply stays bound to its original assistant after current selection changes', async (t) => {
  const gate = createDeferred();
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'deferred', waitFor: gate.promise, content: 'Late scoped answer.' }],
  });
  const created = await f.call('/chat/turns', 'POST', { content: 'Late scoped question.' }, {
    'idempotency-key': 'late-scoped-turn-0001',
  });
  const turn = responseTurn(created);
  assert.equal(turn.status, 'waiting_confirmation');
  const confirmationId = turn.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${confirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const pending = f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'late-scoped-resume-0001' });
  await waitUntil(() => f.loopback.requests.length === 1);
  await f.selectAssistant(f.secondAssistantId);
  gate.resolve();
  const completed = await pending;
  assert.equal(responseTurn(completed).status, 'completed', JSON.stringify(completed));
  assert.deepEqual((await f.call('/chat/default')).data.messages, []);
  await f.selectAssistant(f.firstAssistantId);
  assert.deepEqual((await f.call('/chat/default')).data.messages.map(({ content }) => content), [
    'Late scoped question.', 'Late scoped answer.',
  ]);
  assert.equal(f.loopback.requests.length, 1);
});

test('R1 production personal access closes legacy chat/state writes and revoked sessions cannot call chat', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const legacyBase = `/api/v1/users/${f.ownerId}/subjects/${f.firstAssistantId}`;
  const conversationWrite = await f.call(`${legacyBase}/conversations`, 'POST', {
    title: 'Bypass attempt',
  });
  assert.equal(conversationWrite.status, 403);
  assert.equal(conversationWrite.error.code, 'PERSONAL_CHAT_ROUTE_REQUIRED');
  const stateWrite = await f.call(`${legacyBase}/state-updates`, 'POST', {
    reason: 'Bypass attempt', expectedVersion: 0, state: {},
  });
  assert.equal(stateWrite.status, 403);
  assert.equal(stateWrite.error.code, 'PERSONAL_CHAT_ROUTE_REQUIRED');
  assert.equal(f.loopback.requests.length, 0);
  const oldCookie = f.state.cookie;
  assert.equal((await f.call('/session', 'DELETE')).status, 200);
  assert.equal((await f.call('/chat/default', 'GET', undefined, { cookie: oldCookie })).status, 401);
  assert.equal(f.loopback.requests.length, 0);
});
