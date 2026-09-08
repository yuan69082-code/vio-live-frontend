import assert from 'node:assert/strict';
import test from 'node:test';

import { createMcpStreamableHttpClient } from '../src/integrations/mcp/mcp-streamable-http-client.js';
import { inspectJsonSchema2020 } from '../src/modules/capability-execution/json-schema-2020.js';
import { createStandaloneChatFixture } from '../test-support/standalone-chat-r1-fixtures.js';
import { assertMcpRequestShape, MCP_ECHO_TOOL, startMcpR6Server } from '../test-support/mcp-r6-fixture.js';

async function approve(f, response) {
  assert.equal(response.data.operationStatus, 'confirmation_required', JSON.stringify(response));
  const id = response.data.security.confirmationId;
  assert.equal((await f.call(`/confirmations/${id}/decision`, 'POST', { decision: 'approve' })).status, 200);
  return id;
}

async function installMcp(f, server, key = 'r6-mcp-install-0001') {
  const body = {
    name: 'Controlled MCP server', serviceUrl: server.serviceUrl,
    description: 'A loopback-only MCP fixture.', trustMode: 'explicit_https', acknowledgeTrustedEndpoint: true,
  };
  let result = await f.call('/capabilities/mcp-servers', 'POST', body, { 'idempotency-key': key });
  const id = await approve(f, result);
  result = await f.call('/capabilities/mcp-servers', 'POST', { ...body, confirmationId: id }, { 'idempotency-key': key });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.operationStatus, 'completed');
  return result.data.capability;
}

test('R6 MCP 2026-07-28 uses exact per-request JSON/SSE contract and x-mcp-header', async t => {
  const server = await startMcpR6Server(t);
  const listed = await server.client.listTools({ serviceUrl: server.serviceUrl });
  assert.equal(listed.status, 'SUCCEEDED');
  assert.equal(listed.tools.length, 1);
  assertMcpRequestShape(assert, server.requests[0], 'tools/list');
  assert.equal(server.requests[0].mcpName, undefined);

  server.setMode('sse');
  const called = await server.client.callTool({
    serviceUrl: server.serviceUrl, tool: listed.tools[0], input: { text: 'hello', trace: 'trace-value' },
  });
  assert.equal(called.status, 'SUCCEEDED');
  assert.deepEqual(called.output.structuredContent, { echoed: 'hello' });
  assertMcpRequestShape(assert, server.requests[1], 'tools/call', { name: 'echo' });
  assert.equal(server.requests[1].trace, 'trace-value');
  assert.equal(server.requests[1].body.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
  assert.equal(Object.hasOwn(server.requests[1].body.params, 'sessionId'), false);
});

test('R6 MCP schema and target handling fail closed without public network access', async t => {
  assert.throws(() => inspectJsonSchema2020({
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'array',
    items: { type: 'object', properties: { secret: { type: 'string', 'x-mcp-header': 'Secret' } }, additionalProperties: false },
  }), /x-mcp-header is invalid/);

  const unsorted = await startMcpR6Server(t, { tools: [{ ...MCP_ECHO_TOOL, name: 'zeta' }, { ...MCP_ECHO_TOOL, name: 'alpha' }] });
  assert.deepEqual(await unsorted.client.listTools({ serviceUrl: unsorted.serviceUrl }), {
    status: 'FAILED_TERMINAL', errorCode: 'MCP_SCHEMA_UNSUPPORTED', requestMayHaveBeenSent: true,
  });

  const noNetwork = createMcpStreamableHttpClient({
    resolveAddresses: async () => { throw new Error('must not resolve invalid targets'); },
  });
  for (const target of ['http://example.com/mcp', 'https://user:pass@example.com/mcp', 'https://127.0.0.1/mcp', 'https://example.com/mcp?q=1', 'https://example.com/mcp#fragment']) {
    assert.throws(() => noNetwork.validateTarget(target));
  }
  const rebound = createMcpStreamableHttpClient({ resolveAddresses: async () => [{ address: '127.0.0.1', family: 4 }] });
  const blocked = await rebound.listTools({ serviceUrl: 'https://example.invalid/mcp' });
  assert.equal(blocked.errorCode, 'MCP_TARGET_UNSAFE');
  assert.equal(blocked.requestMayHaveBeenSent, false);
});

test('R6 personal MCP discovery and execution persist one bounded result through explicit confirmation', async t => {
  const server = await startMcpR6Server(t);
  const f = await createStandaloneChatFixture(t, { configure: false, applicationOptions: { mcpClient: server.client } });
  const capability = await installMcp(f, server);
  assert.equal(capability.category, 'mcp_tool');
  assert.deepEqual(capability.operations, []);

  const discoveryKey = 'r6-mcp-discover-0001';
  let discovery = await f.call(`/capabilities/mcp-servers/${capability.capabilityId}/discovery`, 'POST', {}, { 'idempotency-key': discoveryKey });
  const discoveryConfirmation = await approve(f, discovery);
  discovery = await f.call(`/capabilities/mcp-servers/${capability.capabilityId}/discovery`, 'POST', { confirmationId: discoveryConfirmation }, { 'idempotency-key': discoveryKey });
  assert.equal(discovery.status, 200, JSON.stringify(discovery));
  assert.equal(discovery.data.operationStatus, 'completed');
  assert.equal(discovery.data.discovery.toolCount, 1);
  assert.match(discovery.data.discovery.tools[0].inputSchemaHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(discovery.data.discovery.tools[0].outputSchemaHash, /^sha256:[0-9a-f]{64}$/);
  const catalog = await f.call('/capabilities');
  const mcpItem = catalog.data.items.find(item => item.capabilityId === capability.capabilityId);
  assert.deepEqual(mcpItem.operations, ['echo']);

  const executionKey = 'r6-mcp-execute-0001';
  let execution = await f.call('/capability-executions', 'POST', {
    category: 'mcp_tool', capabilityId: capability.capabilityId,
    operationName: 'echo', input: { text: 'real loopback MCP', trace: 'audit-safe' },
  }, { 'idempotency-key': executionKey });
  assert.equal(execution.data.status, 'waiting_confirmation', JSON.stringify(execution));
  const executionConfirmation = execution.data.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${executionConfirmation}/decision`, 'POST', { decision: 'approve' })).status, 200);
  execution = await f.call(`/capability-executions/${execution.data.executionId}/recovery`, 'POST', {
    action: 'resume', confirmationId: executionConfirmation,
  }, { 'idempotency-key': 'r6-mcp-resume-0001' });
  assert.equal(execution.status, 200, JSON.stringify(execution));
  assert.equal(execution.data.status, 'succeeded');
  assert.equal(execution.data.externalCall, 'performed');
  assert.deepEqual(execution.data.result.output.structuredContent, { echoed: 'real loopback MCP' });
  assert.equal(server.requests.filter(item => item.body?.method === 'tools/call').length, 1);
  const db = f.app.database.connection;
  assert.equal(db.prepare('SELECT count(*) n FROM r6_execution_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM r6_execution_results').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM r6_execution_steps').get().n, 1);
});

test('R6 MCP explicit terminal response is not misclassified as ambiguous outcome', async t => {
  const server = await startMcpR6Server(t, { mode: 'redirect' });
  const result = await server.client.listTools({ serviceUrl: server.serviceUrl });
  assert.equal(result.status, 'FAILED_TERMINAL');
  assert.equal(result.errorCode, 'MCP_REDIRECT_REFUSED');
  assert.equal(result.requestMayHaveBeenSent, true);
});

test('R6 MCP maps explicit retryable responses separately from ambiguous transport loss', async t => {
  const server = await startMcpR6Server(t, { mode: 'rate_limit' });
  for (const [mode, status, errorCode] of [
    ['rate_limit', 'FAILED_RETRYABLE', 'MCP_RATE_LIMITED'],
    ['server_error', 'FAILED_RETRYABLE', 'MCP_SERVER_UNAVAILABLE'],
    ['disconnect', 'UNKNOWN', 'MCP_RESPONSE_INTERRUPTED'],
    ['timeout', 'UNKNOWN', 'MCP_RESPONSE_TIMEOUT'],
  ]) {
    server.setMode(mode);
    const result = await server.client.listTools({ serviceUrl: server.serviceUrl });
    assert.equal(result.status, status, `${mode}: ${JSON.stringify(result)}`);
    assert.equal(result.errorCode, errorCode, mode);
    assert.equal(result.requestMayHaveBeenSent, true, mode);
  }
});
