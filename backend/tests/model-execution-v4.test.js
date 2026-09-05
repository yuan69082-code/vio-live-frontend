import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { createOpenAiCompatibleModelExecutor } from '../src/integrations/model-providers/openai-compatible-model-executor.js';

const capabilityRequest = Object.freeze({
  deadlineAt: '2099-01-01T00:00:00Z',
  input: Object.freeze({
    instruction: 'Reply to the user.',
    messageContent: 'hello',
    perceptionSummary: 'A greeting was observed.',
    currentFocus: 'Answer the greeting.',
    maximumOutputCharacters: 100,
  }),
});
const model = Object.freeze({ modelId: 'model-1', modelName: 'local-model' });

async function serverWith(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function execute(executor, baseUrl, overrides = {}) {
  return executor.execute({
    provider: { providerId: 'provider-1', baseUrl, interfaceFormat: 'openai_compatible', ...overrides.provider },
    model,
    apiKey: 'controlled-test-key',
    capabilityRequest: overrides.capabilityRequest ?? capabilityRequest,
    cancelled: overrides.cancelled ?? false,
  });
}

function successfulHttpsRequestDouble(observed) {
  return (options) => {
    observed.options = options;
    const request = new EventEmitter();
    request.destroy = () => {};
    request.write = (body) => { observed.body = Buffer.from(body); };
    request.end = () => {
      options.lookup(options.hostname, { all: false }, (error, address, family) => {
        observed.lookup = { error, address, family };
      });
      request.emit('finish');
      const response = new EventEmitter();
      response.statusCode = 200;
      response.destroy = () => {};
      request.emit('response', response);
      response.emit('data', Buffer.from(JSON.stringify({
        choices: [{ message: { content: 'pinned response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      })));
      response.emit('end');
    };
    return request;
  };
}

function standaloneChatInput(overrides = {}) {
  return {
    provider: {
      providerId: 'provider-1',
      baseUrl: 'https://provider.test',
      interfaceFormat: 'openai_compatible',
    },
    model,
    apiKey: 'controlled-test-key',
    messages: [{ role: 'user', content: 'hello' }],
    deadlineAt: capabilityRequest.deadlineAt,
    maxOutputCharacters: 100,
    ...overrides,
  };
}

test('openai_compatible adapter performs a real loopback HTTP call and parses trusted usage', async () => {
  let observed;
  const server = await serverWith((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      observed = { path: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { content: 'hello back' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }));
    });
  });
  try {
    const outcome = await execute(createOpenAiCompatibleModelExecutor({ allowLoopbackHttp: true }), server.baseUrl);
    assert.equal(outcome.status, 'SUCCEEDED');
    assert.deepEqual(outcome.usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
    assert.equal(observed.path, '/chat/completions');
    assert.equal(observed.authorization, 'Bearer controlled-test-key');
    assert.equal(observed.body.stream, false);
    assert.equal(Object.hasOwn(observed.body, 'tools'), false);
  } finally { await server.close(); }
});

test('legacy Capability execution preserves the full valid E5-A aggregate input boundary', async () => {
  let observed;
  const server = await serverWith((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      observed = JSON.parse(Buffer.concat(chunks));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { content: 'accepted' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  const maximumCapabilityRequest = {
    ...capabilityRequest,
    input: {
      instruction: 'i'.repeat(4_096),
      messageContent: 'm'.repeat(32_768),
      perceptionSummary: 'p'.repeat(4_096),
      currentFocus: 'f'.repeat(2_048),
      maximumOutputCharacters: 100,
    },
  };
  try {
    const outcome = await execute(
      createOpenAiCompatibleModelExecutor({ allowLoopbackHttp: true }),
      server.baseUrl,
      { capabilityRequest: maximumCapabilityRequest },
    );
    assert.equal(outcome.status, 'SUCCEEDED');
    assert.equal(observed.messages.length, 1);
    assert.equal(observed.messages[0].content.length, 43_014);
  } finally { await server.close(); }
});

test('HTTPS execution validates every DNS answer and pins the selected safe IPv4 address', async () => {
  const observed = {};
  let resolutions = 0;
  let requestStarts = 0;
  const executor = createOpenAiCompatibleModelExecutor({
    resolveAddresses: async (hostname, options) => {
      resolutions += 1;
      assert.equal(hostname, 'provider.test');
      assert.deepEqual(options, { all: true, verbatim: true });
      return [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ];
    },
    requestHttps: successfulHttpsRequestDouble(observed),
  });
  const outcome = await executor.executeChat(standaloneChatInput({
    onRequestStart() { requestStarts += 1; },
  }));
  assert.equal(outcome.status, 'SUCCEEDED');
  assert.equal(resolutions, 1);
  assert.equal(requestStarts, 1);
  assert.equal(observed.options.hostname, 'provider.test');
  assert.deepEqual(observed.lookup, {
    error: null,
    address: '93.184.216.34',
    family: 4,
  });
  assert.equal(JSON.parse(observed.body).model, model.modelName);
});

test('HTTPS execution rejects mixed public and private DNS answers before request start', async () => {
  let requestCreated = false;
  let requestStarts = 0;
  const executor = createOpenAiCompatibleModelExecutor({
    resolveAddresses: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
    requestHttps() { requestCreated = true; throw new Error('must not create request'); },
  });
  const outcome = await executor.executeChat(standaloneChatInput({
    onRequestStart() { requestStarts += 1; },
  }));
  assert.equal(outcome.status, 'FAILED_TERMINAL');
  assert.equal(outcome.errorCode, 'PROVIDER_TARGET_UNSAFE');
  assert.equal(outcome.requestMayHaveBeenSent, false);
  assert.equal(requestCreated, false);
  assert.equal(requestStarts, 0);
});

test('HTTPS execution fails closed with a stable status for an IPv6-only Provider', async () => {
  const executor = createOpenAiCompatibleModelExecutor({
    resolveAddresses: async () => [
      { address: '2606:4700:4700::1111', family: 6 },
    ],
    requestHttps() { throw new Error('must not create request'); },
  });
  const outcome = await executor.executeChat(standaloneChatInput());
  assert.equal(outcome.status, 'FAILED_TERMINAL');
  assert.equal(outcome.errorCode, 'PROVIDER_ADDRESS_FAMILY_UNSUPPORTED');
  assert.equal(outcome.requestMayHaveBeenSent, false);
});

test('DNS failure is retryable only as a request proven not sent', async () => {
  let requestStarts = 0;
  const executor = createOpenAiCompatibleModelExecutor({
    resolveAddresses: async () => { throw new Error('controlled DNS failure'); },
    requestHttps() { throw new Error('must not create request'); },
  });
  const outcome = await executor.executeChat(standaloneChatInput({
    onRequestStart() { requestStarts += 1; },
  }));
  assert.equal(outcome.status, 'FAILED_RETRYABLE');
  assert.equal(outcome.errorCode, 'PROVIDER_DNS_UNAVAILABLE');
  assert.equal(outcome.requestMayHaveBeenSent, false);
  assert.equal(requestStarts, 0);
});

test('a synchronous request failure after the durable request boundary is UNKNOWN', async () => {
  let requestStarts = 0;
  const executor = createOpenAiCompatibleModelExecutor({
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    requestHttps() {
      const request = new EventEmitter();
      request.destroy = () => {};
      request.write = () => { throw new Error('controlled synchronous write failure'); };
      request.end = () => {};
      return request;
    },
  });
  const outcome = await executor.executeChat(standaloneChatInput({
    onRequestStart() { requestStarts += 1; },
  }));
  assert.equal(requestStarts, 1);
  assert.equal(outcome.status, 'UNKNOWN');
  assert.equal(outcome.errorCode, 'PROVIDER_REQUEST_INTERRUPTED');
  assert.equal(outcome.requestMayHaveBeenSent, true);
});

test('a request error after the durable request boundary cannot revert to proven not sent', async () => {
  let requestStarts = 0;
  const executor = createOpenAiCompatibleModelExecutor({
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    requestHttps() {
      const request = new EventEmitter();
      request.destroy = () => {};
      request.write = () => true;
      request.end = () => {
        queueMicrotask(() => request.emit('error', new Error('controlled request error')));
      };
      return request;
    },
  });
  const outcome = await executor.executeChat(standaloneChatInput({
    onRequestStart() { requestStarts += 1; },
  }));
  assert.equal(requestStarts, 1);
  assert.equal(outcome.status, 'UNKNOWN');
  assert.equal(outcome.errorCode, 'PROVIDER_CONNECTION_FAILED');
  assert.equal(outcome.requestMayHaveBeenSent, true);
});

test('failure to persist the request boundary remains proven not sent', async () => {
  const executor = createOpenAiCompatibleModelExecutor({
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    requestHttps() {
      const request = new EventEmitter();
      request.destroy = () => {};
      request.write = () => { throw new Error('must not write after boundary failure'); };
      request.end = () => {};
      return request;
    },
  });
  const outcome = await executor.executeChat(standaloneChatInput({
    onRequestStart() { throw new Error('controlled persistence failure'); },
  }));
  assert.equal(outcome.status, 'FAILED_RETRYABLE');
  assert.equal(outcome.errorCode, 'PROVIDER_REQUEST_NOT_SENT');
  assert.equal(outcome.requestMayHaveBeenSent, false);
});

for (const [statusCode, expectedStatus, errorCode] of [
  [429, 'FAILED_RETRYABLE', 'PROVIDER_RATE_LIMITED'],
  [503, 'FAILED_RETRYABLE', 'PROVIDER_RETRYABLE_RESPONSE'],
  [400, 'FAILED_TERMINAL', 'PROVIDER_REJECTED_REQUEST'],
]) {
  test(`Provider HTTP ${statusCode} maps to ${expectedStatus}`, async () => {
    const server = await serverWith((_request, response) => {
      response.writeHead(statusCode, { 'content-type': 'application/json' });
      response.end('{}');
    });
    try {
      const outcome = await execute(createOpenAiCompatibleModelExecutor({ allowLoopbackHttp: true }), server.baseUrl);
      assert.equal(outcome.status, expectedStatus);
      assert.equal(outcome.errorCode, errorCode);
      assert.equal(outcome.output, null);
    } finally { await server.close(); }
  });
}

test('response timeout after request send maps to UNKNOWN and does not invent usage', async () => {
  const server = await serverWith((_request, _response) => {});
  try {
    const outcome = await execute(createOpenAiCompatibleModelExecutor({
      allowLoopbackHttp: true, connectTimeoutMs: 100, responseTimeoutMs: 30,
    }), server.baseUrl);
    assert.equal(outcome.status, 'UNKNOWN');
    assert.equal(outcome.errorCode, 'PROVIDER_RESPONSE_TIMEOUT');
    assert.equal(outcome.usage, null);
    assert.equal(outcome.requestMayHaveBeenSent, true);
  } finally { await server.close(); }
});

test('connection failure that cannot be proven unsent is never automatically retried by the adapter', async () => {
  const probe = await serverWith((_request, response) => response.end());
  const baseUrl = probe.baseUrl;
  await probe.close();
  const outcome = await execute(createOpenAiCompatibleModelExecutor({
    allowLoopbackHttp: true, connectTimeoutMs: 100, responseTimeoutMs: 100,
  }), baseUrl);
  assert.ok(['FAILED_RETRYABLE', 'UNKNOWN'].includes(outcome.status));
  assert.equal(outcome.output, null);
});

test('successful text without trustworthy usage maps to UNKNOWN', async () => {
  const server = await serverWith((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'text' }, finish_reason: 'stop' }] }));
  });
  try {
    const outcome = await execute(createOpenAiCompatibleModelExecutor({ allowLoopbackHttp: true }), server.baseUrl);
    assert.equal(outcome.status, 'UNKNOWN');
    assert.equal(outcome.errorCode, 'PROVIDER_RESULT_NOT_RECOVERABLE');
    assert.equal(outcome.usage, null);
  } finally { await server.close(); }
});

test('mismatched Provider total usage maps to UNKNOWN', async () => {
  const server = await serverWith((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { content: 'text' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 99 },
    }));
  });
  try {
    const outcome = await execute(createOpenAiCompatibleModelExecutor({ allowLoopbackHttp: true }), server.baseUrl);
    assert.equal(outcome.status, 'UNKNOWN');
  } finally { await server.close(); }
});

test('output longer than Engine maximum maps to FAILED_TERMINAL', async () => {
  const server = await serverWith((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { content: 'too long' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
  try {
    const outcome = await execute(createOpenAiCompatibleModelExecutor({ allowLoopbackHttp: true }), server.baseUrl, {
      capabilityRequest: { ...capabilityRequest, input: { ...capabilityRequest.input, maximumOutputCharacters: 3 } },
    });
    assert.equal(outcome.status, 'FAILED_TERMINAL');
    assert.equal(outcome.errorCode, 'PROVIDER_OUTPUT_TOO_LONG');
  } finally { await server.close(); }
});

test('unsupported provider interface fails closed before network execution', async () => {
  const executor = createOpenAiCompatibleModelExecutor();
  const outcome = await execute(executor, 'https://provider.invalid', {
    provider: { interfaceFormat: 'anthropic_messages' },
  });
  assert.equal(outcome.status, 'FAILED_TERMINAL');
  assert.equal(outcome.errorCode, 'PROVIDER_INTERFACE_UNSUPPORTED');
});

test('non-loopback plaintext Provider maps to a terminal configuration failure', async () => {
  const executor = createOpenAiCompatibleModelExecutor();
  const outcome = await execute(executor, 'http://example.com');
  assert.equal(outcome.status, 'FAILED_TERMINAL');
  assert.equal(outcome.errorCode, 'PROVIDER_CONFIGURATION_INVALID');
});

test('credential values unsafe for an Authorization header fail before network execution', async () => {
  const executor = createOpenAiCompatibleModelExecutor();
  const outcome = await executor.execute({
    provider: { providerId: 'provider-1', baseUrl: 'https://provider.invalid', interfaceFormat: 'openai_compatible' },
    model,
    apiKey: 'unsafe\ncredential',
    capabilityRequest,
  });
  assert.equal(outcome.status, 'FAILED_TERMINAL');
  assert.equal(outcome.errorCode, 'PROVIDER_CREDENTIAL_UNAVAILABLE');
});

test('expired and cancelled calls never reach a Provider', async () => {
  const executor = createOpenAiCompatibleModelExecutor();
  const expired = await execute(executor, 'https://provider.invalid', {
    capabilityRequest: { ...capabilityRequest, deadlineAt: '2000-01-01T00:00:00Z' },
  });
  const cancelled = await execute(executor, 'https://provider.invalid', { cancelled: true });
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(cancelled.status, 'CANCELLED');
});

test('openai_compatible adapter never follows redirects', async () => {
  let redirected = false;
  const destination = await serverWith((_request, response) => { redirected = true; response.end(); });
  const source = await serverWith((_request, response) => {
    response.writeHead(302, { location: `${destination.baseUrl}/capture`, 'content-type': 'application/json' });
    response.end('{}');
  });
  try {
    const outcome = await execute(createOpenAiCompatibleModelExecutor({ allowLoopbackHttp: true }), source.baseUrl);
    assert.equal(outcome.status, 'FAILED_TERMINAL');
    assert.equal(redirected, false);
  } finally { await source.close(); await destination.close(); }
});
