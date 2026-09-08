import assert from 'node:assert/strict';
import test from 'node:test';

import { createStandaloneChatFixture } from '../test-support/standalone-chat-r1-fixtures.js';
import { MCP_ECHO_TOOL } from '../test-support/mcp-r6-fixture.js';

function controlledMcpClient() {
  let mode = 'retryable';
  let calls = 0;
  let discoveries = 0;
  let discoveryMode = 'success';
  const tool = { ...MCP_ECHO_TOOL, inputHeaders: [], outputSchema: MCP_ECHO_TOOL.outputSchema };
  return {
    validateTarget: value => value,
    listTools: async ({ onRequestStart }) => {
      discoveries += 1;
      if (discoveryMode === 'unknown') { onRequestStart(); return { status: 'UNKNOWN', errorCode: 'MCP_RESPONSE_INTERRUPTED', requestMayHaveBeenSent: true }; }
      return { status: 'SUCCEEDED', tools: [tool], ttlMs: 1000, cacheScope: 'private', requestMayHaveBeenSent: true };
    },
    callTool: async ({ input, onRequestStart }) => {
      calls += 1;
      if (mode === 'unknown') { onRequestStart(); return { status: 'UNKNOWN', errorCode: 'MCP_RESPONSE_INTERRUPTED', requestMayHaveBeenSent: true }; }
      if (mode === 'retryable') { onRequestStart(); return { status: 'FAILED_RETRYABLE', errorCode: 'MCP_RATE_LIMITED', requestMayHaveBeenSent: true }; }
      onRequestStart();
      return { status: 'SUCCEEDED', output: { content: [{ type: 'text', text: input.text }], structuredContent: { echoed: input.text }, isError: false }, requestMayHaveBeenSent: true };
    },
    setMode(value) { mode = value; },
    setDiscoveryMode(value) { discoveryMode = value; },
    get calls() { return calls; },
    get discoveries() { return discoveries; },
  };
}

async function approve(f, response) {
  const confirmationId = response.data.security?.confirmationId ?? response.data.confirmation?.confirmationId;
  assert.equal(typeof confirmationId, 'string', JSON.stringify(response));
  assert.equal((await f.call(`/confirmations/${confirmationId}/decision`, 'POST', { decision: 'approve' })).status, 200);
  return confirmationId;
}

async function configuredMcp(t, client) {
  const f = await createStandaloneChatFixture(t, { configure: false, applicationOptions: { mcpClient: client } });
  const body = { name: 'Recovery MCP', serviceUrl: 'https://controlled.invalid/mcp', description: 'Controlled recovery fixture.', trustMode: 'explicit_https', acknowledgeTrustedEndpoint: true };
  let install = await f.call('/capabilities/mcp-servers', 'POST', body, { 'idempotency-key': 'r6-recovery-mcp-install' });
  const installConfirmation = await approve(f, install);
  install = await f.call('/capabilities/mcp-servers', 'POST', { ...body, confirmationId: installConfirmation }, { 'idempotency-key': 'r6-recovery-mcp-install' });
  const capabilityId = install.data.capability.capabilityId;
  let discovery = await f.call(`/capabilities/mcp-servers/${capabilityId}/discovery`, 'POST', {}, { 'idempotency-key': 'r6-recovery-mcp-discover' });
  const discoveryConfirmation = await approve(f, discovery);
  discovery = await f.call(`/capabilities/mcp-servers/${capabilityId}/discovery`, 'POST', { confirmationId: discoveryConfirmation }, { 'idempotency-key': 'r6-recovery-mcp-discover' });
  assert.equal(discovery.data.operationStatus, 'completed', JSON.stringify(discovery));
  return { f, capabilityId };
}

async function executeAfterConfirmation(f, capabilityId, key) {
  let result = await f.call('/capability-executions', 'POST', {
    category: 'mcp_tool', capabilityId, operationName: 'echo', input: { text: key },
  }, { 'idempotency-key': key });
  assert.equal(result.data.status, 'waiting_confirmation', JSON.stringify(result));
  const confirmationId = await approve(f, result);
  result = await f.call(`/capability-executions/${result.data.executionId}/recovery`, 'POST', { action: 'resume', confirmationId }, { 'idempotency-key': `${key}-resume` });
  return result;
}

test('R6 retry requires an explicit new action and rechecks confirmation before a second call', async t => {
  const client = controlledMcpClient();
  const { f, capabilityId } = await configuredMcp(t, client);
  let result = await executeAfterConfirmation(f, capabilityId, 'r6-retry-execution');
  assert.equal(result.data.status, 'retryable');
  assert.deepEqual(result.data.error, { code: 'MCP_RATE_LIMITED' });
  assert.equal(result.data.externalCall, 'performed');
  assert.equal(client.calls, 1);
  assert.equal((await f.call(`/capability-executions/${result.data.executionId}`)).data.status, 'retryable');
  assert.equal(client.calls, 1);

  client.setMode('success');
  result = await f.call(`/capability-executions/${result.data.executionId}/recovery`, 'POST', { action: 'retry' }, { 'idempotency-key': 'r6-retry-explicit-0001' });
  assert.equal(result.data.status, 'waiting_confirmation');
  assert.equal(client.calls, 1);
  const confirmationId = await approve(f, result);
  result = await f.call(`/capability-executions/${result.data.executionId}/recovery`, 'POST', { action: 'resume', confirmationId }, { 'idempotency-key': 'r6-retry-explicit-resume-0001' });
  assert.equal(result.data.status, 'succeeded', JSON.stringify(result));
  assert.equal(client.calls, 2);
  assert.equal(result.data.attemptCount, 2);
  const db = f.app.database.connection;
  assert.equal(db.prepare('SELECT count(*) n FROM r6_execution_attempts').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM r6_execution_results').get().n, 1);
});

test('R6 ambiguous MCP result remains fail-closed across restart and query-first recovery', async t => {
  const client = controlledMcpClient();
  client.setMode('unknown');
  const { f, capabilityId } = await configuredMcp(t, client);
  const result = await executeAfterConfirmation(f, capabilityId, 'r6-unknown-execution');
  assert.equal(result.data.status, 'outcome_unknown', JSON.stringify(result));
  assert.equal(result.data.externalCall, 'possibly_performed');
  assert.equal(client.calls, 1);
  const before = await f.call('/capability-executions/by-idempotency-key/r6-unknown-execution');
  assert.equal(before.data.status, 'found');
  await f.restart();
  const after = await f.call(`/capability-executions/${result.data.executionId}`);
  assert.equal(after.data.status, 'outcome_unknown');
  const retry = await f.call(`/capability-executions/${result.data.executionId}/recovery`, 'POST', { action: 'retry' }, { 'idempotency-key': 'r6-unknown-retry-0001' });
  assert.equal(retry.status, 409);
  assert.equal(retry.error.code, 'CAPABILITY_RETRY_NOT_ALLOWED');
  assert.equal(client.calls, 1);
});

test('R6 startup maps interrupted sent and unsent attempts without executing capabilities', async t => {
  const client = controlledMcpClient();
  const { f, capabilityId } = await configuredMcp(t, client);
  const db = f.app.database.connection;
  const now = new Date().toISOString();
  for (const [suffix, sent] of [['unsent', 0], ['sent', 1]]) {
    const executionId = `r6-interrupted-${suffix}`;
    db.prepare(`INSERT INTO r6_unified_executions(execution_id,owner_user_id,assistant_id,category,capability_id,capability_version,operation_name,idempotency_key,input_json,input_hash,source_type,source_id,status,confirmation_id,request_may_have_been_sent,error_code,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,'2026-07-28','echo',?,'{}',?,'personal_api',NULL,'in_flight',NULL,?,NULL,?,?,NULL)`).run(executionId, f.ownerId, f.firstAssistantId, 'mcp_tool', capabilityId, `r6-interrupted-${suffix}-key`, `sha256:${suffix === 'sent' ? 'a' : 'b'}${'0'.repeat(63)}`.slice(0, 71), sent, now, now);
    db.prepare(`INSERT INTO r6_execution_attempts(attempt_id,execution_id,owner_user_id,assistant_id,attempt_number,status,request_may_have_been_sent,started_at) VALUES(?,?,?,?,1,'in_flight',?,?)`).run(`${executionId}-attempt`, executionId, f.ownerId, f.firstAssistantId, sent, now);
  }
  await f.restart();
  assert.equal((await f.call('/capability-executions/r6-interrupted-unsent')).data.status, 'retryable');
  assert.equal((await f.call('/capability-executions/r6-interrupted-sent')).data.status, 'outcome_unknown');
  assert.equal(client.calls, 0);
});

test('R6 ambiguous discovery is durably queryable and same-key replay never crosses MCP twice', async t => {
  const client = controlledMcpClient();
  client.setDiscoveryMode('unknown');
  const f = await createStandaloneChatFixture(t, { configure: false, applicationOptions: { mcpClient: client } });
  const body = { name: 'Unknown discovery MCP', serviceUrl: 'https://controlled.invalid/mcp', description: 'Ambiguous discovery fixture.', trustMode: 'explicit_https', acknowledgeTrustedEndpoint: true };
  let install = await f.call('/capabilities/mcp-servers', 'POST', body, { 'idempotency-key': 'r6-unknown-discovery-install' });
  const installConfirmation = await approve(f, install);
  install = await f.call('/capabilities/mcp-servers', 'POST', { ...body, confirmationId: installConfirmation }, { 'idempotency-key': 'r6-unknown-discovery-install' });
  const capabilityId = install.data.capability.capabilityId;
  const key = 'r6-unknown-discovery-key';
  let result = await f.call(`/capabilities/mcp-servers/${capabilityId}/discovery`, 'POST', {}, { 'idempotency-key': key });
  const confirmationId = await approve(f, result);
  result = await f.call(`/capabilities/mcp-servers/${capabilityId}/discovery`, 'POST', { confirmationId }, { 'idempotency-key': key });
  assert.equal(result.data.operationStatus, 'outcome_unknown');
  assert.equal(result.data.externalCall, 'possibly_performed');
  assert.deepEqual(result.data.error, { code: 'MCP_RESPONSE_INTERRUPTED' });
  assert.equal(client.discoveries, 1);
  const replay = await f.call(`/capabilities/mcp-servers/${capabilityId}/discovery`, 'POST', { confirmationId }, { 'idempotency-key': key });
  assert.deepEqual(replay.data, result.data);
  assert.equal(client.discoveries, 1);
  await f.restart();
  const queried = await f.call(`/capabilities/mcp-servers/${capabilityId}/discovery/by-idempotency-key/${key}`);
  assert.deepEqual(queried.data, { status: 'found', operation: result.data });
  assert.equal(client.discoveries, 1);
});
