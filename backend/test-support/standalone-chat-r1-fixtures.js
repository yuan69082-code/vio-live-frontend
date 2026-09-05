import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createOpenAiCompatibleModelExecutor } from '../src/integrations/model-providers/openai-compatible-model-executor.js';
import { createProviderConnectionChecker } from '../src/integrations/model-providers/provider-connection-check.js';
import { sealTestCredential, startPersonalTestApplication } from './personal-test-application.js';

const TEST_PASSPHRASE = 'controlled-personal-test-passphrase';
const TEST_CREDENTIAL = 'controlled-loopback-provider-credential';

export async function startLoopbackChatProvider(t, {
  responses = [],
  defaultContent = 'Controlled assistant response.',
} = {}) {
  const requests = [];
  const queue = [...responses];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    requests.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
      body,
    });
    const next = queue.shift() ?? { type: 'success', content: defaultContent };
    if (next.type === 'disconnect') {
      request.socket.destroy();
      return;
    }
    if (next.type === 'timeout') return;
    if (next.type === 'deferred') await next.waitFor;
    const status = next.status ?? (next.type === 'rate_limit' ? 429 : 200);
    const payload = next.payload ?? (status === 200 ? {
      choices: [{ message: { content: next.content ?? defaultContent }, finish_reason: 'stop' }],
      usage: { prompt_tokens: next.inputTokens ?? 12, completion_tokens: next.outputTokens ?? 4, total_tokens: (next.inputTokens ?? 12) + (next.outputTokens ?? 4) },
    } : { error: { type: 'controlled_test_failure' } });
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    enqueue(...items) { queue.push(...items); },
    closeConnections() { server.closeAllConnections(); },
  };
}

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function loopbackChatExecutor(overrides = {}) {
  return createOpenAiCompatibleModelExecutor({
    allowLoopbackHttp: true,
    connectTimeoutMs: 100,
    responseTimeoutMs: 200,
    maxRequestBytes: 256 * 1024,
    maxResponseBytes: 256 * 1024,
    ...overrides,
  });
}

export async function createStandaloneChatFixture(t, {
  providerResponses,
  provider,
  applicationOptions = {},
  dailyTokenLimit = 100_000,
  sessionTokenLimit = 50_000,
  configure = true,
} = {}) {
  const loopback = provider ?? await startLoopbackChatProvider(t, { responses: providerResponses });
  const fixture = await startPersonalTestApplication(t, {
    modelExecutor: loopbackChatExecutor(),
    providerConnectionChecker: createProviderConnectionChecker({
      allowedLoopbackOrigins: [loopback.origin],
    }),
    ...applicationOptions,
  });
  const initialized = await fixture.initialize();
  const onboarding = await fixture.call('/onboarding', 'POST', {
    displayName: 'Controlled owner',
    avatar: null,
    assistant: {
      name: 'First controlled assistant',
      avatar: null,
      settings: {
        positioning: 'personal assistant',
        personality: 'careful',
        persona: 'concise',
        requirements: 'Use only the current conversation.',
        contextMode: 'balanced',
      },
    },
    preferences: { storagePreference: 'local', contextMode: 'balanced' },
  }, { 'idempotency-key': 'r1-onboarding-0001' });
  assert.equal(onboarding.status, 200, JSON.stringify(onboarding));
  const firstAssistantId = onboarding.data.currentAssistantId;
  const second = await fixture.call('/assistants', 'POST', {
    name: 'Second controlled assistant',
    avatar: null,
    settings: {
      positioning: 'separate assistant',
      personality: 'steady',
      persona: 'direct',
      requirements: 'Keep this assistant isolated.',
      contextMode: 'balanced',
    },
  }, { 'idempotency-key': 'r1-second-assistant-0001' });
  assert.equal(second.status, 201, JSON.stringify(second));
  const secondAssistantId = second.data.assistantId;

  let providerId = null;
  let modelId = null;
  if (configure) {
    const createdProvider = await fixture.secured('/providers', 'POST', {
      displayName: 'Controlled loopback OpenAI-compatible Provider',
      providerType: 'openai',
      baseUrl: loopback.origin,
      interfaceFormat: 'openai_compatible',
      status: 'enabled',
    }, 'r1-provider-0001');
    providerId = createdProvider.provider.providerId;
    const transport = (await fixture.call('/vault')).data.transport;
    await fixture.secured(
      `/providers/${providerId}/credential`,
      'PUT',
      sealTestCredential(transport, TEST_CREDENTIAL),
      'r1-credential-0001',
    );
    const createdModel = await fixture.secured('/models', 'POST', {
      providerId,
      modelName: 'controlled-chat-model',
      modelType: 'chat',
      capabilities: ['chat'],
      defaultForChat: true,
    }, 'r1-model-0001');
    modelId = createdModel.model.modelId;
    for (const assistantId of [firstAssistantId, secondAssistantId]) {
      fixture.app.proactiveInteractionService.upsertTokenBudget(
        initialized.data.user.userId,
        assistantId,
        {
          dailyTokenLimit,
          sessionTokenLimit,
          overagePolicy: 'block',
          status: 'enabled',
        },
      );
    }
  }

  async function selectAssistant(assistantId) {
    const assistants = (await fixture.call('/assistants')).data;
    const result = await fixture.call('/current-assistant', 'PUT', {
      assistantId,
      expectedSelectionVersion: assistants.selectionVersion,
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.data;
  }

  return Object.assign(fixture, {
    loopback,
    ownerId: initialized.data.user.userId,
    firstAssistantId,
    secondAssistantId,
    providerId,
    modelId,
    testCredential: TEST_CREDENTIAL,
    passphrase: TEST_PASSPHRASE,
    selectAssistant,
  });
}

export function r1LedgerCounts(connection) {
  const count = (table) => connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  return {
    defaultConversations: count('standalone_chat_default_conversations'),
    turns: count('standalone_chat_turns'),
    executions: count('standalone_chat_model_executions'),
    budgetApprovals: count('standalone_chat_budget_approvals'),
    attempts: count('standalone_chat_provider_attempts'),
    usage: count('standalone_chat_usage_facts'),
    results: count('standalone_chat_provider_results'),
    recoveryActions: count('standalone_chat_recovery_actions'),
  };
}

export function responseTurn(response) {
  return response?.data?.turn ?? response?.data ?? null;
}

export async function approveAndResumeTurn(fixture, response, key) {
  let current = response;
  let turn = responseTurn(current);
  if (turn?.status === 'waiting_confirmation' || turn?.status === 'waiting_budget') {
    const confirmationId = turn.confirmation?.confirmationId ?? turn.confirmationId;
    assert.equal(typeof confirmationId, 'string', JSON.stringify(current));
    const decision = await fixture.call(
      `/confirmations/${confirmationId}/decision`,
      'POST',
      { decision: 'approve' },
    );
    assert.equal(decision.status, 200, JSON.stringify(decision));
    current = await fixture.call(
      `/chat/turns/${turn.turnId}/recovery`,
      'POST',
      { action: 'resume', confirmationId },
      { 'idempotency-key': `${key}-resume` },
    );
    turn = responseTurn(current);
  }
  return { response: current, turn };
}

export async function createCompletedTurn(fixture, content, key) {
  const created = await fixture.call(
    '/chat/turns',
    'POST',
    { content },
    { 'idempotency-key': key },
  );
  assert.equal(created.status, 200, JSON.stringify(created));
  const completed = await approveAndResumeTurn(fixture, created, key);
  assert.equal(completed.response.status, 200, JSON.stringify(completed.response));
  assert.equal(completed.turn.status, 'completed', JSON.stringify(completed.response));
  return completed;
}
