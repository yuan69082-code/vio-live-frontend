import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { ContinuityTransportError } from '../src/integrations/continuity-engine/http-continuity-integration-transport.js';
import { createOpenAiCompatibleModelExecutor } from '../src/integrations/model-providers/openai-compatible-model-executor.js';
import {
  approveLatestExecutionConfirmation,
  capabilityRequiredEnvelope,
  completedEnvelope,
  configureV4Execution,
  createEngineTransportDouble,
  createV4Application,
  prepareV1Request,
  seedV4Platform,
} from '../test-support/continuity-capability-v4-fixtures.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

function successfulExecutor(counter) {
  return Object.freeze({
    async execute() {
      counter.calls += 1;
      return {
        status: 'SUCCEEDED',
        output: { responseCandidate: 'candidate', finishReason: 'stop' },
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        errorCode: null,
        requestMayHaveBeenSent: true,
        startedAt: '2026-08-10T00:00:03Z',
        completedAt: '2026-08-10T00:00:04Z',
        cost: { status: 'not_reported', amountMicros: null, currency: null },
      };
    },
  });
}

async function startRetryThenSuccessProvider() {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(Buffer.concat(chunks));
      if (requests.length === 1) {
        const body = Buffer.from('{"error":"rate_limited"}', 'utf8');
        response.writeHead(429, {
          'content-type': 'application/json',
          'content-length': body.length,
        });
        response.end(body);
        return;
      }
      const body = Buffer.from(JSON.stringify({
        choices: [{ message: { content: 'controlled retry candidate' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }), 'utf8');
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': body.length,
      });
      response.end(body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function sequencedExecutor(counter, statuses) {
  let index = 0;
  return Object.freeze({
    async execute() {
      counter.calls += 1;
      const status = statuses[index] ?? statuses.at(-1);
      index += 1;
      if (status === 'SUCCEEDED') {
        return {
          status,
          output: { responseCandidate: 'candidate', finishReason: 'stop' },
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          errorCode: null,
          requestMayHaveBeenSent: true,
          startedAt: '2026-08-10T00:00:03Z',
          completedAt: '2026-08-10T00:00:04Z',
          cost: { status: 'not_reported', amountMicros: null, currency: null },
        };
      }
      return {
        status,
        output: null,
        usage: null,
        errorCode: status === 'FAILED_RETRYABLE'
          ? 'PROVIDER_RATE_LIMITED'
          : 'PROVIDER_RESPONSE_UNKNOWN',
        requestMayHaveBeenSent: status === 'UNKNOWN',
        startedAt: '2026-08-10T00:00:03Z',
        completedAt: '2026-08-10T00:00:04Z',
        cost: {
          status: status === 'UNKNOWN' ? 'not_reported' : 'not_incurred',
          amountMicros: null,
          currency: null,
        },
      };
    },
  });
}

async function approveRetryAndResume(application, extra = {}) {
  const waiting = await application.continuityDeliveryService.resumeCapability(
    'capability-request-001',
    { retryApproved: true, ...extra },
  );
  const confirmationId = approveLatestExecutionConfirmation(application);
  return application.continuityDeliveryService.resumeCapability(
    'capability-request-001',
    { securityConfirmationId: confirmationId, ...extra },
  ).then((outcome) => ({ waiting, outcome, confirmationId }));
}

async function prepareWaiting(application) {
  const request = prepareV1Request(application);
  await application.continuityDeliveryService.submitStoredRequest(request.requestId);
  return { request, confirmationId: approveLatestExecutionConfirmation(application) };
}

test('lost CapabilityResult POST response recovers by GET without a second model call', async () => {
  const testDatabase = createTestDatabasePath();
  const base = createEngineTransportDouble();
  const counter = { calls: 0 };
  let responseLost = true;
  const transport = {
    ...base,
    async submitCapabilityResult(body) {
      base.state.resultPosts += 1;
      base.state.capabilityResult = JSON.parse(body.toString('utf8'));
      if (responseLost) {
        responseLost = false;
        throw new ContinuityTransportError('lost', {
          transportCode: 'response_timeout', outcomeUnknown: true,
        });
      }
      return { statusCode: 200, payload: completedEnvelope(base.state.request) };
    },
  };
  const { application } = createV4Application(testDatabase.databasePath, {
    transport, modelExecutor: successfulExecutor(counter),
  });
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const { request, confirmationId } = await prepareWaiting(application);
    const unknown = await application.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId });
    assert.equal(unknown.delivery.status, 'outcome_unknown');
    assert.equal(counter.calls, 1);
    const recovered = await application.continuityDeliveryService.submitStoredRequest(request.requestId);
    assert.equal(recovered.delivery.status, 'completed');
    assert.equal(counter.calls, 1);
    const connection = application.database.connection;
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_capability_results').get().count, 1);
    assert.equal(connection.prepare("SELECT status FROM continuity_capability_result_outbox").get().status, 'completed');
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_capability_usage_facts').get().count, 1);
  } finally { await application.stop(); testDatabase.remove(); }
});

test('capability_required recovery reposts the exact persisted Result without a second model call', async () => {
  const testDatabase = createTestDatabasePath();
  const base = createEngineTransportDouble();
  const counter = { calls: 0 };
  const postedBodies = [];
  let firstPost = true;
  const transport = {
    ...base,
    async submitCapabilityResult(body) {
      postedBodies.push(body.toString('utf8'));
      base.state.capabilityResult = JSON.parse(body.toString('utf8'));
      if (firstPost) {
        firstPost = false;
        throw new ContinuityTransportError('lost', {
          transportCode: 'response_timeout', outcomeUnknown: true,
        });
      }
      return { statusCode: 200, payload: completedEnvelope(base.state.request) };
    },
    async queryRequest() {
      return { statusCode: 200, kind: 'query', payload: base.state.capabilityEnvelope };
    },
  };
  const application = createV4Application(testDatabase.databasePath, {
    transport, modelExecutor: successfulExecutor(counter),
  }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const { request, confirmationId } = await prepareWaiting(application);
    await application.continuityDeliveryService.resumeCapability(
      'capability-request-001', { securityConfirmationId: confirmationId },
    );
    const recovered = await application.continuityDeliveryService.submitStoredRequest(request.requestId);
    assert.equal(recovered.delivery.status, 'completed');
    assert.equal(counter.calls, 1);
    assert.equal(postedBodies.length, 2);
    assert.equal(postedBodies[1], postedBodies[0]);
    assert.equal(
      JSON.parse(postedBodies[1]).capabilityResultId,
      JSON.parse(postedBodies[0]).capabilityResultId,
    );
  } finally { await application.stop(); testDatabase.remove(); }
});

test('FAILED_RETRYABLE is accepted once and requires an explicit controlled retry before success', async () => {
  const provider = await startRetryThenSuccessProvider();
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const executor = createOpenAiCompatibleModelExecutor({
    allowLoopbackHttp: true,
    connectTimeoutMs: 200,
    responseTimeoutMs: 500,
  });
  const application = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: executor,
  }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application, { baseUrl: provider.baseUrl });
    const { confirmationId } = await prepareWaiting(application);
    const retryable = await application.continuityDeliveryService.resumeCapability(
      'capability-request-001',
      { securityConfirmationId: confirmationId },
    );
    assert.equal(retryable.delivery.status, 'outcome_unknown');
    assert.equal(provider.requests.length, 1);
    assert.equal(transport.state.resultPosts, 1);
    const connection = application.database.connection;
    assert.equal(connection.prepare('SELECT status FROM continuity_capability_requests').get().status, 'waiting_retry');
    assert.equal(connection.prepare('SELECT status FROM continuity_capability_result_outbox').get().status, 'accepted');

    await application.continuityDeliveryService.resumeCapability('capability-request-001');
    await application.continuityDeliveryService.resumeCapability('capability-request-001');
    assert.equal(provider.requests.length, 1);
    assert.equal(transport.state.resultPosts, 1);

    const { waiting, outcome } = await approveRetryAndResume(application);
    assert.equal(waiting.delivery.status, 'outcome_unknown');
    assert.equal(provider.requests.length, 2);
    assert.equal(outcome.delivery.status, 'completed');
    const results = connection.prepare(`
      SELECT capability_result_id, execution_id, status FROM continuity_capability_results
      ORDER BY created_at, capability_result_id
    `).all();
    assert.equal(results.length, 2);
    assert.equal(new Set(results.map(({ capability_result_id: id }) => id)).size, 2);
    assert.equal(new Set(results.map(({ execution_id: id }) => id)).size, 2);
    assert.deepEqual(new Set(results.map(({ status }) => status)), new Set(['FAILED_RETRYABLE', 'SUCCEEDED']));
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_capability_model_executions').get().count, 2);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_capability_usage_facts').get().count, 2);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_first_round_results').get().count, 1);
    assert.equal(connection.prepare('SELECT COUNT(*) count FROM continuity_engine_state_projection_receipts').get().count, 1);
    assert.equal(connection.prepare("SELECT COUNT(*) count FROM continuity_capability_results WHERE status='SUCCEEDED'").get().count, 1);
  } finally {
    await application.stop();
    await provider.close();
    testDatabase.remove();
  }
});

test('two FAILED_RETRYABLE attempts remain immutable before one controlled success', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const counter = { calls: 0 };
  const application = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: sequencedExecutor(counter, [
      'FAILED_RETRYABLE',
      'FAILED_RETRYABLE',
      'SUCCEEDED',
    ]),
  }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const { confirmationId } = await prepareWaiting(application);
    await application.continuityDeliveryService.resumeCapability(
      'capability-request-001',
      { securityConfirmationId: confirmationId },
    );
    const second = await approveRetryAndResume(application);
    assert.equal(second.outcome.delivery.status, 'outcome_unknown');
    assert.equal(counter.calls, 2);
    assert.equal(application.database.connection.prepare('SELECT status FROM continuity_capability_requests').get().status, 'waiting_retry');
    const third = await approveRetryAndResume(application);
    assert.equal(third.outcome.delivery.status, 'completed');
    assert.equal(counter.calls, 3);
    const statuses = application.database.connection.prepare(`
      SELECT result.status status FROM continuity_capability_results result
      JOIN continuity_capability_model_executions execution USING (execution_id)
      ORDER BY execution.execution_number
    `).all().map(({ status }) => status);
    assert.deepEqual(statuses, ['FAILED_RETRYABLE', 'FAILED_RETRYABLE', 'SUCCEEDED']);
    assert.equal(new Set(transport.state.capabilityResults.map(({ capabilityResultId }) => capabilityResultId)).size, 3);
  } finally { await application.stop(); testDatabase.remove(); }
});

test('FAILED_RETRYABLE survives restart in waiting_retry and never retries without approval', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const firstCounter = { calls: 0 };
  const first = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: sequencedExecutor(firstCounter, ['FAILED_RETRYABLE']),
  }).application;
  seedV4Platform(first.database.connection);
  configureV4Execution(first);
  const { confirmationId } = await prepareWaiting(first);
  await first.continuityDeliveryService.resumeCapability(
    'capability-request-001',
    { securityConfirmationId: confirmationId },
  );
  assert.equal(firstCounter.calls, 1);
  await first.stop();

  const secondCounter = { calls: 0 };
  const second = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: successfulExecutor(secondCounter),
  }).application;
  try {
    await second.continuityCapabilityService.initialize();
    const resumed = await second.continuityDeliveryService.resumeCapability('capability-request-001');
    assert.equal(resumed.delivery.status, 'outcome_unknown');
    assert.equal(secondCounter.calls, 0);
    assert.equal(second.database.connection.prepare('SELECT status FROM continuity_capability_requests').get().status, 'waiting_retry');
    assert.equal(second.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_results').get().count, 1);
  } finally { await second.stop(); testDatabase.remove(); }
});

test('completed success and terminal failure reject every later Provider retry', async () => {
  for (const providerStatus of ['SUCCEEDED', 'FAILED_TERMINAL']) {
    const testDatabase = createTestDatabasePath();
    const transport = createEngineTransportDouble();
    const counter = { calls: 0 };
    const application = createV4Application(testDatabase.databasePath, {
      transport,
      modelExecutor: sequencedExecutor(counter, [providerStatus, 'SUCCEEDED']),
    }).application;
    try {
      seedV4Platform(application.database.connection);
      configureV4Execution(application);
      const { confirmationId } = await prepareWaiting(application);
      await application.continuityDeliveryService.resumeCapability(
        'capability-request-001',
        { securityConfirmationId: confirmationId },
      );
      await assert.rejects(
        () => application.continuityDeliveryService.resumeCapability(
          'capability-request-001',
          { retryApproved: true },
        ),
        /not waiting for an internal resume/,
      );
      assert.equal(counter.calls, 1);
      assert.equal(application.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_model_executions').get().count, 1);
      assert.equal(application.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_results').get().count, 1);
    } finally { await application.stop(); testDatabase.remove(); }
  }
});

test('UNKNOWN accepted by Engine is fail-closed across resume and restart', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const firstCounter = { calls: 0 };
  const first = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: sequencedExecutor(firstCounter, ['UNKNOWN']),
  }).application;
  seedV4Platform(first.database.connection);
  configureV4Execution(first);
  const { request, confirmationId } = await prepareWaiting(first);
  await first.continuityDeliveryService.resumeCapability(
    'capability-request-001',
    { securityConfirmationId: confirmationId },
  );
  assert.equal(firstCounter.calls, 1);
  assert.equal(transport.state.resultPosts, 1);
  assert.equal(first.database.connection.prepare('SELECT status FROM continuity_capability_requests').get().status, 'provider_outcome_unknown');
  assert.equal(first.database.connection.prepare('SELECT status FROM continuity_capability_result_outbox').get().status, 'accepted');
  assert.deepEqual({ ...first.database.connection.prepare(`
    SELECT usage_status, cost_status, total_tokens, cost_amount_micros
    FROM continuity_capability_usage_facts
  `).get() }, {
    usage_status: 'unknown',
    cost_status: 'not_reported',
    total_tokens: 0,
    cost_amount_micros: null,
  });
  await assert.rejects(
    () => first.continuityDeliveryService.resumeCapability('capability-request-001', { retryApproved: true }),
    /not waiting for an internal resume/,
  );
  assert.equal(firstCounter.calls, 1);
  await first.stop();

  const secondCounter = { calls: 0 };
  const second = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: successfulExecutor(secondCounter),
  }).application;
  try {
    await second.continuityCapabilityService.initialize();
    await second.continuityDeliveryService.submitStoredRequest(request.requestId);
    assert.equal(secondCounter.calls, 0);
    assert.equal(transport.state.resultPosts, 1);
    assert.equal(second.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_model_executions').get().count, 1);
    assert.equal(second.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_results').get().count, 1);
  } finally { await second.stop(); testDatabase.remove(); }
});

test('lost UNKNOWN Result response queries then replays the exact Result once before fail-closed acceptance', async () => {
  const testDatabase = createTestDatabasePath();
  const base = createEngineTransportDouble();
  const counter = { calls: 0 };
  const posted = [];
  let loseFirst = true;
  const transport = {
    ...base,
    async submitCapabilityResult(body) {
      posted.push(body.toString('utf8'));
      if (loseFirst) {
        loseFirst = false;
        base.state.capabilityResult = JSON.parse(body.toString('utf8'));
        throw new ContinuityTransportError('lost', {
          transportCode: 'response_timeout', outcomeUnknown: true,
        });
      }
      return base.submitCapabilityResult(body);
    },
    async queryRequest() {
      return { statusCode: 200, kind: 'query', payload: base.state.capabilityEnvelope };
    },
  };
  const application = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: sequencedExecutor(counter, ['UNKNOWN']),
  }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const { request, confirmationId } = await prepareWaiting(application);
    await application.continuityDeliveryService.resumeCapability(
      'capability-request-001',
      { securityConfirmationId: confirmationId },
    );
    assert.equal(application.database.connection.prepare('SELECT status FROM continuity_capability_result_outbox').get().status, 'outcome_unknown');
    await application.continuityDeliveryService.submitStoredRequest(request.requestId);
    assert.equal(counter.calls, 1);
    assert.equal(posted.length, 2);
    assert.equal(posted[1], posted[0]);
    assert.equal(application.database.connection.prepare('SELECT status FROM continuity_capability_result_outbox').get().status, 'accepted');
    assert.equal(application.database.connection.prepare('SELECT status FROM continuity_capability_requests').get().status, 'provider_outcome_unknown');
  } finally { await application.stop(); testDatabase.remove(); }
});

test('restart converts an in-flight Provider call with no result into UNKNOWN without recalling Provider', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  let firstCalls = 0;
  const first = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: { async execute() { firstCalls += 1; throw new Error('simulated-process-exit'); } },
  }).application;
  seedV4Platform(first.database.connection);
  configureV4Execution(first);
  const { confirmationId } = await prepareWaiting(first);
  await assert.rejects(() => first.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId }), /simulated-process-exit/);
  assert.equal(firstCalls, 1);
  assert.equal(first.database.connection.prepare('SELECT status FROM continuity_capability_model_executions').get().status, 'in_flight');
  await first.stop();

  const secondCounter = { calls: 0 };
  const second = createV4Application(testDatabase.databasePath, {
    transport, modelExecutor: successfulExecutor(secondCounter),
  }).application;
  try {
    const initialized = await second.continuityCapabilityService.initialize();
    assert.equal(initialized.normalized, 1);
    assert.equal(secondCounter.calls, 0);
    const stored = second.database.connection.prepare('SELECT status, result_json FROM continuity_capability_results').get();
    assert.equal(stored.status, 'UNKNOWN');
    assert.equal(JSON.parse(stored.result_json).retryClass, 'query');
    assert.equal(second.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_usage_facts').get().count, 1);
  } finally { await second.stop(); testDatabase.remove(); }
});

test('a persisted CapabilityResult is exact replay material and is not rebuilt on restart', async () => {
  const testDatabase = createTestDatabasePath();
  const base = createEngineTransportDouble();
  const counter = { calls: 0 };
  const transport = {
    ...base,
    async submitCapabilityResult(body) {
      base.state.resultPosts += 1;
      base.state.capabilityResult = JSON.parse(body.toString('utf8'));
      throw new ContinuityTransportError('lost', { transportCode: 'response_timeout', outcomeUnknown: true });
    },
  };
  const first = createV4Application(testDatabase.databasePath, { transport, modelExecutor: successfulExecutor(counter) }).application;
  seedV4Platform(first.database.connection);
  configureV4Execution(first);
  const { confirmationId } = await prepareWaiting(first);
  await first.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId });
  const before = first.database.connection.prepare('SELECT capability_result_id, result_hash, result_json FROM continuity_capability_results').get();
  await first.stop();
  const second = createV4Application(testDatabase.databasePath, { transport, modelExecutor: successfulExecutor(counter) }).application;
  try {
    await second.continuityCapabilityService.initialize();
    const after = second.database.connection.prepare('SELECT capability_result_id, result_hash, result_json FROM continuity_capability_results').get();
    assert.deepEqual(after, before);
    assert.equal(counter.calls, 1);
  } finally { await second.stop(); testDatabase.remove(); }
});

test('terminal callback HTTP errors quarantine the result and never recall the model', async () => {
  for (const httpStatus of [400, 401, 404, 409, 413, 415]) {
    const testDatabase = createTestDatabasePath();
    const base = createEngineTransportDouble();
    const counter = { calls: 0 };
    const transport = {
      ...base,
      async submitCapabilityResult(body) {
        base.state.capabilityResult = JSON.parse(body.toString('utf8'));
        throw new ContinuityTransportError('terminal', {
          transportCode: httpStatus === 401 ? 'unauthorized' : 'http_error', httpStatus,
        });
      },
    };
    const application = createV4Application(testDatabase.databasePath, { transport, modelExecutor: successfulExecutor(counter) }).application;
    try {
      seedV4Platform(application.database.connection);
      configureV4Execution(application);
      const { confirmationId } = await prepareWaiting(application);
      const outcome = await application.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId });
      assert.equal(outcome.delivery.status, 'quarantined');
      assert.equal(counter.calls, 1);
      assert.equal(application.database.connection.prepare('SELECT status FROM continuity_capability_result_outbox').get().status, 'quarantined');
    } finally { await application.stop(); testDatabase.remove(); }
  }
});

test('Engine 500 and 503 callback failures remain outcome_unknown without recalling the model', async () => {
  for (const httpStatus of [500, 503]) {
    const testDatabase = createTestDatabasePath();
    const base = createEngineTransportDouble();
    const counter = { calls: 0 };
    const transport = {
      ...base,
      async submitCapabilityResult(body) {
        base.state.capabilityResult = JSON.parse(body.toString('utf8'));
        throw new ContinuityTransportError('unavailable', {
          transportCode: 'engine_unavailable', httpStatus, outcomeUnknown: true,
        });
      },
    };
    const application = createV4Application(testDatabase.databasePath, {
      transport, modelExecutor: successfulExecutor(counter),
    }).application;
    try {
      seedV4Platform(application.database.connection);
      configureV4Execution(application);
      const { confirmationId } = await prepareWaiting(application);
      const outcome = await application.continuityDeliveryService.resumeCapability(
        'capability-request-001', { securityConfirmationId: confirmationId },
      );
      assert.equal(outcome.delivery.status, 'outcome_unknown');
      assert.equal(counter.calls, 1);
      assert.equal(
        application.database.connection.prepare('SELECT status FROM continuity_capability_result_outbox').get().status,
        'outcome_unknown',
      );
    } finally { await application.stop(); testDatabase.remove(); }
  }
});

test('budget block creates a terminal audited failure without calling Provider', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const counter = { calls: 0 };
  const application = createV4Application(testDatabase.databasePath, { transport, modelExecutor: successfulExecutor(counter) }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application, { dailyTokenLimit: 10, sessionTokenLimit: 10, overagePolicy: 'block' });
    const { confirmationId } = await prepareWaiting(application);
    const outcome = await application.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId });
    assert.equal(outcome.delivery.status, 'completed');
    assert.equal(counter.calls, 0);
    assert.equal(transport.state.capabilityResult.errorCode, 'VIO_TOKEN_BUDGET_BLOCKED');
    assert.equal(application.database.connection.prepare('SELECT usage_status FROM continuity_capability_usage_facts').get().usage_status, 'not_incurred');
  } finally { await application.stop(); testDatabase.remove(); }
});

test('budget defer persists waiting state and does not fabricate a CapabilityResult', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const counter = { calls: 0 };
  const application = createV4Application(testDatabase.databasePath, { transport, modelExecutor: successfulExecutor(counter) }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application, { dailyTokenLimit: 10, sessionTokenLimit: 10, overagePolicy: 'defer' });
    const { confirmationId } = await prepareWaiting(application);
    await application.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId });
    assert.equal(application.database.connection.prepare('SELECT status FROM continuity_capability_requests').get().status, 'waiting_budget');
    assert.equal(application.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_results').get().count, 0);
    assert.equal(counter.calls, 0);
  } finally { await application.stop(); testDatabase.remove(); }
});

test('budget confirmation waits without a Provider call and resumes through the internal service path', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const counter = { calls: 0 };
  const application = createV4Application(testDatabase.databasePath, {
    transport, modelExecutor: successfulExecutor(counter),
  }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application, {
      dailyTokenLimit: 10, sessionTokenLimit: 10, overagePolicy: 'require_confirmation',
    });
    const budget = application.proactiveInteractionService.getTokenBudget('user-001', 'assistant-001');
    application.permissionService.createPermission('user-001', {
      subjectId: 'assistant-001', resourceType: 'proactive_interaction',
      resourceId: budget.tokenBudgetId, action: 'execute',
      permissionLevel: 'always_allow', status: 'active',
    });
    const { confirmationId: firstSecurityConfirmationId } = await prepareWaiting(application);
    const waitingBudget = await application.continuityDeliveryService.resumeCapability(
      'capability-request-001', { securityConfirmationId: firstSecurityConfirmationId },
    );
    assert.equal(waitingBudget.delivery.status, 'outcome_unknown');
    assert.equal(counter.calls, 0);
    const budgetConfirmation = application.database.connection.prepare(`
      SELECT confirmation_id FROM security_confirmations
      WHERE resource_type='proactive_interaction' AND status='pending'
      ORDER BY requested_at DESC LIMIT 1
    `).get();
    application.confirmationService.decideConfirmation(
      'user-001', budgetConfirmation.confirmation_id, { decision: 'approve' },
    );
    await application.continuityDeliveryService.resumeCapability(
      'capability-request-001', { budgetConfirmationId: budgetConfirmation.confirmation_id },
    );
    assert.equal(counter.calls, 0);
    const secondSecurityConfirmationId = approveLatestExecutionConfirmation(application);
    const completed = await application.continuityDeliveryService.resumeCapability(
      'capability-request-001', {
        securityConfirmationId: secondSecurityConfirmationId,
        budgetConfirmationId: budgetConfirmation.confirmation_id,
      },
    );
    assert.equal(completed.delivery.status, 'completed');
    assert.equal(counter.calls, 1);
  } finally { await application.stop(); testDatabase.remove(); }
});

test('an unresolved credential fails closed before execution becomes in-flight', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const counter = { calls: 0 };
  const credentialStore = Object.freeze({
    describeApiKey: () => Object.freeze({ status: 'configured', storage: 'test', writeSupported: true }),
    resolveApiKey() { throw new Error('credential unavailable'); },
  });
  const application = createV4Application(testDatabase.databasePath, {
    transport, credentialStore, modelExecutor: successfulExecutor(counter),
  }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const { confirmationId } = await prepareWaiting(application);
    const outcome = await application.continuityDeliveryService.resumeCapability(
      'capability-request-001', { securityConfirmationId: confirmationId },
    );
    assert.equal(outcome.delivery.status, 'completed');
    assert.equal(counter.calls, 0);
    assert.equal(transport.state.capabilityResult.status, 'FAILED_TERMINAL');
    assert.equal(transport.state.capabilityResult.errorCode, 'PROVIDER_CREDENTIAL_UNAVAILABLE');
    assert.equal(application.database.connection.prepare('SELECT status FROM continuity_capability_model_executions').get().status, 'failed_terminal');
  } finally { await application.stop(); testDatabase.remove(); }
});

test('immutable result, usage and request facts reject update and delete', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const counter = { calls: 0 };
  const application = createV4Application(testDatabase.databasePath, { transport, modelExecutor: successfulExecutor(counter) }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const { confirmationId } = await prepareWaiting(application);
    await application.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId });
    const connection = application.database.connection;
    assert.throws(() => connection.exec("UPDATE continuity_capability_results SET status='UNKNOWN'"), /immutable/);
    assert.throws(() => connection.exec('DELETE FROM continuity_capability_usage_facts'), /governed retention/);
    assert.throws(() => connection.exec("UPDATE continuity_capability_requests SET request_hash='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"), /immutable/);
    assert.throws(() => connection.exec("UPDATE continuity_capability_requests SET binding_id='other-binding'"), /immutable/);
    assert.throws(() => connection.exec("UPDATE continuity_capability_requests SET input_hash='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"), /immutable/);
  } finally { await application.stop(); testDatabase.remove(); }
});

test('same capabilityResultId with different content cannot overwrite the first result', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const counter = { calls: 0 };
  const application = createV4Application(testDatabase.databasePath, { transport, modelExecutor: successfulExecutor(counter) }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const { confirmationId } = await prepareWaiting(application);
    await application.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId });
    const row = application.database.connection.prepare('SELECT * FROM continuity_capability_results').get();
    assert.throws(() => application.database.connection.prepare(`INSERT INTO continuity_capability_results (
      capability_result_id,capability_request_id,execution_id,request_id,request_hash,operation_id,status,
      content_hash,result_hash,result_json,usage_ledger_entry_id,created_at
    ) VALUES (?,?,?,?,?,?,'UNKNOWN',?,?,?,?,?)`).run(
      row.capability_result_id, row.capability_request_id, row.execution_id, row.request_id, row.request_hash,
      row.operation_id, row.content_hash, `sha256:${'f'.repeat(64)}`, row.result_json,
      row.usage_ledger_entry_id, row.created_at,
    ), /UNIQUE|terminal capability/);
    assert.equal(application.database.connection.prepare('SELECT COUNT(*) count FROM continuity_capability_results').get().count, 1);
  } finally { await application.stop(); testDatabase.remove(); }
});

test('real usage is included in future budget summaries while legacy usage retains old labels', async () => {
  const testDatabase = createTestDatabasePath();
  const transport = createEngineTransportDouble();
  const counter = { calls: 0 };
  const application = createV4Application(testDatabase.databasePath, { transport, modelExecutor: successfulExecutor(counter) }).application;
  try {
    seedV4Platform(application.database.connection);
    configureV4Execution(application);
    const { confirmationId } = await prepareWaiting(application);
    await application.continuityDeliveryService.resumeCapability('capability-request-001', { securityConfirmationId: confirmationId });
    const budget = application.proactiveInteractionService.checkTokenBudget('user-001', 'assistant-001', {
      estimatedTokens: 1, budgetSessionId: 'thinking-session-001',
    });
    assert.equal(budget.projection.sessionUsed, 7);
    const legacy = application.database.connection.prepare('SELECT COUNT(*) count FROM token_usage_records WHERE model_call_status<>\'not_performed_by_platform\' OR billing_status<>\'not_billed\'').get();
    assert.equal(legacy.count, 0);
  } finally { await application.stop(); testDatabase.remove(); }
});
