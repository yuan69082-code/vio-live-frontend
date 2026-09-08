import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createCompletedTurn, createStandaloneChatFixture } from '../test-support/standalone-chat-r1-fixtures.js';
import { startMcpR6Server } from '../test-support/mcp-r6-fixture.js';
import { digest, randomToken } from '../src/modules/personal/personal-crypto.js';

async function approvedWrite(fixture, path, body, key, method = 'POST') {
  let response = await fixture.call(path, method, body, { 'idempotency-key': key });
  assert.equal(response.status, 200, JSON.stringify(response));
  if (response.data.operationStatus === 'confirmation_required') {
    const confirmationId = response.data.security.confirmationId;
    assert.equal(typeof confirmationId, 'string', JSON.stringify(response));
    const decision = await fixture.call(`/confirmations/${confirmationId}/decision`, 'POST', { decision: 'approve' });
    assert.equal(decision.status, 200, JSON.stringify(decision));
    response = await fixture.call(path, method, { ...body, confirmationId }, { 'idempotency-key': key });
  }
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(response.data.operationStatus, 'completed', JSON.stringify(response));
  return response.data;
}

async function executeAndApprove(fixture, body, key) {
  let response = await fixture.call('/capability-executions', 'POST', body, { 'idempotency-key': key });
  if (response.data?.status === 'waiting_confirmation') {
    const confirmationId = response.data.confirmation.confirmationId;
    assert.equal((await fixture.call(`/confirmations/${confirmationId}/decision`, 'POST', { decision: 'approve' })).status, 200);
    response = await fixture.call(`/capability-executions/${response.data.executionId}/recovery`, 'POST', {
      action: 'resume', confirmationId,
    }, { 'idempotency-key': `${key}-resume` });
  }
  return response;
}

test('R6 installs and executes immutable local tool, skill, and plugin facts through personal HTTP', async t => {
  const f = await createStandaloneChatFixture(t, { configure: false });
  const local = await approvedWrite(f, '/capabilities/local-tools', {
    definitionId: 'builtin.text.inspect/v1',
  }, 'r6-local-install-0001');
  assert.equal(local.capability.category, 'local_tool');
  assert.deepEqual(local.capability.operations, ['execute']);

  const input = { text: 'Vio 本地工具。' };
  const first = await executeAndApprove(f, {
    category: 'local_tool', capabilityId: local.capability.capabilityId, operationName: 'execute', input,
  }, 'r6-local-execute-0001');
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.data.status, 'succeeded');
  assert.equal(first.data.externalCall, 'not_performed');
  assert.equal(first.data.result.output.utf8Bytes, Buffer.byteLength(input.text, 'utf8'));
  const replay = await f.call('/capability-executions', 'POST', {
    category: 'local_tool', capabilityId: local.capability.capabilityId, operationName: 'execute', input,
  }, { 'idempotency-key': 'r6-local-execute-0001' });
  assert.deepEqual(replay.data, first.data);

  const skill = await approvedWrite(f, '/capabilities/skills', {
    schemaVersion: 'vio-skill/v1', name: 'Local inspect skill', version: '1.0.0',
    description: 'One immutable local step.',
    steps: [{ stepId: 'inspect', category: 'local_tool', capabilityId: local.capability.capabilityId, operationName: 'execute' }],
  }, 'r6-skill-install-0001');
  const plugin = await approvedWrite(f, '/capabilities/plugins', {
    schemaVersion: 'vio-plugin/v1', name: 'Local inspect plugin', version: '1.0.0',
    description: 'Maps one action to the immutable skill.',
    actions: [{ actionId: 'inspect-text', skillId: skill.capability.capabilityId }],
  }, 'r6-plugin-install-0001');
  assert.equal(plugin.capability.category, 'plugin_action');
  assert.deepEqual(plugin.capability.operations, ['inspect-text']);

  const pluginExecution = await executeAndApprove(f, {
    category: 'plugin_action', capabilityId: plugin.capability.capabilityId,
    operationName: 'inspect-text', input: { text: 'plugin path' },
  }, 'r6-plugin-execute-0001');
  assert.equal(pluginExecution.status, 200, JSON.stringify(pluginExecution));
  assert.equal(pluginExecution.data.status, 'succeeded');
  assert.equal(pluginExecution.data.result.output.steps.length, 1);

  const disabled = await approvedWrite(f, `/capabilities/plugins/${plugin.capability.capabilityId}/lifecycle`, {
    action: 'disable',
  }, 'r6-plugin-disable-0001');
  assert.equal(disabled.capability.status, 'disabled');
  const disabledExecution = await f.call('/capability-executions', 'POST', {
    category: 'plugin_action', capabilityId: plugin.capability.capabilityId,
    operationName: 'inspect-text', input: { text: 'must not execute while disabled' },
  }, { 'idempotency-key': 'r6-plugin-disabled-execution' });
  assert.equal(disabledExecution.status, 409);
  assert.equal(disabledExecution.error.code, 'CAPABILITY_DISABLED');

  const enabled = await approvedWrite(f, `/capabilities/plugins/${plugin.capability.capabilityId}/lifecycle`, {
    action: 'enable',
  }, 'r6-plugin-enable-0001');
  assert.equal(enabled.capability.status, 'enabled');
  const afterEnable = await executeAndApprove(f, {
    category: 'plugin_action', capabilityId: plugin.capability.capabilityId,
    operationName: 'inspect-text', input: { text: 'enabled again' },
  }, 'r6-plugin-after-enable');
  assert.equal(afterEnable.data.status, 'succeeded');

  const uninstalled = await approvedWrite(f, `/capabilities/plugins/${plugin.capability.capabilityId}/lifecycle`, {
    action: 'uninstall',
  }, 'r6-plugin-uninstall-0001');
  assert.equal(uninstalled.capability.lifecycleStatus, 'uninstalled');
  const afterUninstall = await f.call('/capability-executions', 'POST', {
    category: 'plugin_action', capabilityId: plugin.capability.capabilityId,
    operationName: 'inspect-text', input: { text: 'must not execute after uninstall' },
  }, { 'idempotency-key': 'r6-plugin-uninstalled-execution' });
  assert.equal(afterUninstall.status, 409);
  assert.equal(afterUninstall.error.code, 'CAPABILITY_UNINSTALLED');

  const db = f.app.database.connection;
  assert.equal(db.prepare('SELECT count(*) n FROM r6_execution_results').get().n, 3);
  assert.equal(db.prepare('SELECT count(*) n FROM r6_execution_usage_facts').get().n, 3);
  assert.equal(db.prepare('SELECT count(*) n FROM tool_usage_records').get().n, 0);
  assert.throws(() => db.prepare('DELETE FROM r6_execution_results').run(), /cannot be deleted/);
});

test('R6 scopes definitions, discovery, dependencies, lifecycle, execution, and replay to owner plus assistant', async t => {
  const mcp = await startMcpR6Server(t);
  const f = await createStandaloneChatFixture(t, {
    configure: false,
    applicationOptions: { mcpClient: mcp.client },
  });
  const mcpBody = {
    name: 'Scoped MCP', serviceUrl: mcp.serviceUrl,
    description: 'Assistant-scoped MCP fixture.',
    trustMode: 'explicit_https', acknowledgeTrustedEndpoint: true,
  };

  async function installStack(label) {
    const local = await approvedWrite(f, '/capabilities/local-tools', {
      definitionId: 'builtin.text.inspect/v1',
    }, 'r6-scope-install-local');
    const server = await approvedWrite(f, '/capabilities/mcp-servers', mcpBody, 'r6-scope-install-mcp');
    let discovery = await f.call(
      `/capabilities/mcp-servers/${server.capability.capabilityId}/discovery`,
      'POST', {}, { 'idempotency-key': 'r6-scope-discovery' },
    );
    const discoveryConfirmation = discovery.data.security.confirmationId;
    assert.equal((await f.call(`/confirmations/${discoveryConfirmation}/decision`, 'POST', { decision: 'approve' })).status, 200);
    discovery = await f.call(
      `/capabilities/mcp-servers/${server.capability.capabilityId}/discovery`,
      'POST', { confirmationId: discoveryConfirmation }, { 'idempotency-key': 'r6-scope-discovery' },
    );
    assert.equal(discovery.data.operationStatus, 'completed', JSON.stringify(discovery));
    const skill = await approvedWrite(f, '/capabilities/skills', {
      schemaVersion: 'vio-skill/v1', name: 'Scoped skill', version: '1.0.0',
      description: `${label} isolated dependencies.`,
      steps: [
        { stepId: 'inspect', category: 'local_tool', capabilityId: local.capability.capabilityId, operationName: 'execute' },
        { stepId: 'echo', category: 'mcp_tool', capabilityId: server.capability.capabilityId, operationName: 'echo' },
      ],
    }, `r6-scope-install-skill-${label}`);
    const plugin = await approvedWrite(f, '/capabilities/plugins', {
      schemaVersion: 'vio-plugin/v1', name: 'Scoped plugin', version: '1.0.0',
      description: `${label} isolated lifecycle.`,
      actions: [{ actionId: 'inspect-and-echo', skillId: skill.capability.capabilityId }],
    }, `r6-scope-install-plugin-${label}`);
    return { local, server, skill, plugin, discovery };
  }

  const first = await installStack('first');
  const firstExecution = await executeAndApprove(f, {
    category: 'plugin_action', capabilityId: first.plugin.capability.capabilityId,
    operationName: 'inspect-and-echo', input: { text: 'assistant one' },
  }, 'r6-scope-execute-shared');
  assert.equal(firstExecution.data.status, 'succeeded');
  assert.equal((await f.call('/capabilities')).data.items.filter(item => item.category !== 'model_api').length, 4);

  await f.selectAssistant(f.secondAssistantId);
  const secondEmpty = await f.call('/capabilities');
  assert.equal(secondEmpty.data.items.some(item => [
    first.local.capability.capabilityId, first.server.capability.capabilityId,
    first.skill.capability.capabilityId, first.plugin.capability.capabilityId,
  ].includes(item.capabilityId)), false);
  assert.equal((await f.call(`/capability-executions/${firstExecution.data.executionId}`)).status, 404);
  assert.deepEqual((await f.call('/capability-executions/by-idempotency-key/r6-scope-execute-shared')).data, { status: 'not_found', execution: null });
  assert.equal((await f.call(`/capabilities/mcp-servers/${first.server.capability.capabilityId}/discovery/by-idempotency-key/r6-scope-discovery`)).status, 404);
  assert.equal((await f.call(`/capabilities/plugins/${first.plugin.capability.capabilityId}/lifecycle`, 'POST', {
    action: 'disable',
  }, { 'idempotency-key': 'r6-cross-assistant-lifecycle' })).status, 404);
  assert.equal((await f.call('/capabilities/skills', 'POST', {
    schemaVersion: 'vio-skill/v1', name: 'Cross-assistant dependency', version: '1.0.0',
    description: 'Must fail closed.',
    steps: [{ stepId: 'blocked', category: 'local_tool', capabilityId: first.local.capability.capabilityId, operationName: 'execute' }],
  }, { 'idempotency-key': 'r6-cross-assistant-dependency' })).status, 404);

  const second = await installStack('second');
  assert.notEqual(second.local.capability.capabilityId, first.local.capability.capabilityId);
  assert.notEqual(second.server.capability.capabilityId, first.server.capability.capabilityId);
  assert.notEqual(second.skill.capability.capabilityId, first.skill.capability.capabilityId);
  assert.notEqual(second.plugin.capability.capabilityId, first.plugin.capability.capabilityId);
  assert.notEqual(second.discovery.data.discovery.snapshotId, first.discovery.data.discovery.snapshotId);
  const secondExecution = await executeAndApprove(f, {
    category: 'plugin_action', capabilityId: second.plugin.capability.capabilityId,
    operationName: 'inspect-and-echo', input: { text: 'assistant one' },
  }, 'r6-scope-execute-shared');
  assert.equal(secondExecution.data.status, 'succeeded');
  assert.notEqual(secondExecution.data.executionId, firstExecution.data.executionId);
  const disabledSecond = await approvedWrite(f, `/capabilities/plugins/${second.plugin.capability.capabilityId}/lifecycle`, {
    action: 'disable',
  }, 'r6-scope-disable-second');
  assert.equal(disabledSecond.capability.status, 'disabled');

  await f.selectAssistant(f.firstAssistantId);
  assert.equal((await f.call(`/capability-executions/${firstExecution.data.executionId}`)).status, 200);
  assert.equal((await f.call('/capability-executions/by-idempotency-key/r6-scope-execute-shared')).data.execution.executionId, firstExecution.data.executionId);
  const firstCatalog = await f.call('/capabilities');
  assert.equal(firstCatalog.data.items.find(item => item.capabilityId === first.plugin.capability.capabilityId).status, 'enabled');
  assert.equal(firstCatalog.data.items.some(item => item.capabilityId === second.plugin.capability.capabilityId), false);

  await f.restart();
  const restartedFirst = await f.call('/capabilities');
  assert.equal(restartedFirst.data.items.some(item => item.capabilityId === first.plugin.capability.capabilityId), true);
  assert.equal(restartedFirst.data.items.some(item => item.capabilityId === second.plugin.capability.capabilityId), false);
  await f.selectAssistant(f.secondAssistantId);
  const restartedSecond = await f.call('/capabilities');
  assert.equal(restartedSecond.data.items.find(item => item.capabilityId === second.plugin.capability.capabilityId).status, 'disabled');
  assert.equal(restartedSecond.data.items.some(item => item.capabilityId === first.plugin.capability.capabilityId), false);

  const db = f.app.database.connection;
  assert.equal(db.prepare('SELECT count(*) n FROM r6_capability_definitions WHERE owner_user_id=? AND assistant_id=?').get(f.ownerId, f.firstAssistantId).n, 4);
  assert.equal(db.prepare('SELECT count(*) n FROM r6_capability_definitions WHERE owner_user_id=? AND assistant_id=?').get(f.ownerId, f.secondAssistantId).n, 4);
  assert.equal(db.prepare('SELECT count(*) n FROM r6_mcp_discovery_snapshots').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM r6_unified_executions').get().n, 2);
});

test('R6 personal HTTP keeps another owner outside catalog, discovery, dependencies, lifecycle, execution, and replay', async t => {
  const mcp = await startMcpR6Server(t);
  const f = await createStandaloneChatFixture(t, {
    configure: false,
    applicationOptions: { mcpClient: mcp.client },
  });
  const firstState = { cookie: f.state.cookie, csrf: f.state.csrf };
  const local = await approvedWrite(f, '/capabilities/local-tools', {
    definitionId: 'builtin.text.inspect/v1',
  }, 'r6-owner-scope-local');
  const server = await approvedWrite(f, '/capabilities/mcp-servers', {
    name: 'Owner scoped MCP', serviceUrl: mcp.serviceUrl,
    description: 'Owner scope fixture.', trustMode: 'explicit_https', acknowledgeTrustedEndpoint: true,
  }, 'r6-owner-scope-mcp');
  let discovery = await f.call(`/capabilities/mcp-servers/${server.capability.capabilityId}/discovery`, 'POST', {}, {
    'idempotency-key': 'r6-owner-scope-discovery',
  });
  const discoveryConfirmation = discovery.data.security.confirmationId;
  assert.equal((await f.call(`/confirmations/${discoveryConfirmation}/decision`, 'POST', { decision: 'approve' })).status, 200);
  discovery = await f.call(`/capabilities/mcp-servers/${server.capability.capabilityId}/discovery`, 'POST', {
    confirmationId: discoveryConfirmation,
  }, { 'idempotency-key': 'r6-owner-scope-discovery' });
  assert.equal(discovery.data.operationStatus, 'completed');
  const skill = await approvedWrite(f, '/capabilities/skills', {
    schemaVersion: 'vio-skill/v1', name: 'Owner scoped skill', version: '1.0.0',
    description: 'Owner scope fixture.',
    steps: [{ stepId: 'inspect', category: 'local_tool', capabilityId: local.capability.capabilityId, operationName: 'execute' }],
  }, 'r6-owner-scope-skill');
  const plugin = await approvedWrite(f, '/capabilities/plugins', {
    schemaVersion: 'vio-plugin/v1', name: 'Owner scoped plugin', version: '1.0.0',
    description: 'Owner scope fixture.',
    actions: [{ actionId: 'inspect', skillId: skill.capability.capabilityId }],
  }, 'r6-owner-scope-plugin');
  const execution = await executeAndApprove(f, {
    category: 'local_tool', capabilityId: local.capability.capabilityId,
    operationName: 'execute', input: { text: 'owner one' },
  }, 'r6-owner-scope-execution');
  assert.equal(execution.data.status, 'succeeded');

  const db = f.app.database.connection;
  const secondOwnerId = 'r6-isolated-owner-two';
  const secondAssistantId = 'r6-isolated-owner-two-assistant';
  const sessionId = 'r6-isolated-owner-two-session';
  const sessionToken = randomToken();
  const when = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO users(user_id,primary_email,display_name,status,created_at,updated_at) VALUES(?,NULL,?,'active',?,?)")
    .run(secondOwnerId, 'Second isolated owner', when, when);
  db.prepare("INSERT INTO subjects(subject_id,owner_user_id,name,avatar_ref,basic_settings_json,status,created_at,updated_at) VALUES(?,?,?,NULL,'{}','active',?,?)")
    .run(secondAssistantId, secondOwnerId, 'Second owner assistant', when, when);
  db.prepare("INSERT INTO user_spaces(space_id,user_id,identity_mode,status,current_assistant_id,created_at,updated_at) VALUES(?,?,'personal_owner','active',?,?,?)")
    .run('r6-isolated-owner-two-space', secondOwnerId, secondAssistantId, when, when);
  db.prepare("INSERT INTO personal_identities(user_id,password_salt,password_verifier,wrapped_vault_key,onboarding_completed,created_at) VALUES(?,?,?, ?,1,?)")
    .run(secondOwnerId, 'test-salt', 'test-verifier', 'test-wrapped-key', when);
  db.prepare('INSERT INTO personal_assistant_versions(user_id,assistant_id,version,avatar) VALUES(?,?,1,NULL)')
    .run(secondOwnerId, secondAssistantId);
  db.prepare(`INSERT INTO personal_sessions(session_id,user_id,token_hash,device_name,created_at,last_seen_at,expires_at,revoked_at)
    VALUES(?,?,?,'Controlled second owner',?,?,?,NULL)`)
    .run(sessionId, secondOwnerId, digest(sessionToken), when, when, expires);
  for (const action of ['manage', 'delete']) {
    f.app.permissionService.createPermission(secondOwnerId, {
      subjectId: null, resourceType: 'identity', resourceId: secondOwnerId,
      action, permissionLevel: 'always_allow',
    });
  }
  f.state.cookie = `vio_personal_session=${sessionToken}`;
  f.state.csrf = createHmac('sha256', sessionToken).update('vio-personal-csrf/v1').digest('base64url');

  const otherCatalog = await f.call('/capabilities');
  assert.equal(otherCatalog.status, 200, JSON.stringify(otherCatalog));
  assert.equal(otherCatalog.data.items.some(item => [local.capability.capabilityId, server.capability.capabilityId,
    skill.capability.capabilityId, plugin.capability.capabilityId].includes(item.capabilityId)), false);
  assert.equal((await f.call(`/capability-executions/${execution.data.executionId}`)).status, 404);
  assert.deepEqual((await f.call('/capability-executions/by-idempotency-key/r6-owner-scope-execution')).data, {
    status: 'not_found', execution: null,
  });
  assert.equal((await f.call(`/capabilities/mcp-servers/${server.capability.capabilityId}/discovery/by-idempotency-key/r6-owner-scope-discovery`)).status, 404);
  assert.equal((await f.call(`/capabilities/plugins/${plugin.capability.capabilityId}/lifecycle`, 'POST', {
    action: 'disable',
  }, { 'idempotency-key': 'r6-other-owner-lifecycle' })).status, 404);
  assert.equal((await f.call('/capabilities/skills', 'POST', {
    schemaVersion: 'vio-skill/v1', name: 'Forbidden cross owner dependency', version: '1.0.0',
    description: 'Must fail closed.',
    steps: [{ stepId: 'blocked', category: 'local_tool', capabilityId: local.capability.capabilityId, operationName: 'execute' }],
  }, { 'idempotency-key': 'r6-other-owner-dependency' })).status, 404);

  const otherLocal = await approvedWrite(f, '/capabilities/local-tools', {
    definitionId: 'builtin.text.inspect/v1',
  }, 'r6-owner-scope-local');
  assert.notEqual(otherLocal.capability.capabilityId, local.capability.capabilityId);
  const otherExecution = await executeAndApprove(f, {
    category: 'local_tool', capabilityId: otherLocal.capability.capabilityId,
    operationName: 'execute', input: { text: 'owner one' },
  }, 'r6-owner-scope-execution');
  assert.equal(otherExecution.data.status, 'succeeded');
  assert.notEqual(otherExecution.data.executionId, execution.data.executionId);
  await f.restart();
  assert.equal((await f.call('/capabilities')).data.items.some(item => item.capabilityId === otherLocal.capability.capabilityId), true);
  assert.equal((await f.call('/capabilities')).data.items.some(item => item.capabilityId === local.capability.capabilityId), false);

  f.state.cookie = firstState.cookie;
  f.state.csrf = firstState.csrf;
  const originalAfterRestart = await f.call('/capabilities');
  assert.equal(originalAfterRestart.data.items.some(item => item.capabilityId === local.capability.capabilityId), true);
  assert.equal(originalAfterRestart.data.items.some(item => item.capabilityId === otherLocal.capability.capabilityId), false);
});

test('R6 projects existing R1 model execution facts without a second Provider call', async t => {
  const f = await createStandaloneChatFixture(t, { providerResponses: [{ type: 'success', content: 'Projected model result.' }] });
  const turn = await createCompletedTurn(f, 'Project this existing model execution.', 'r6-model-projection-turn');
  assert.equal(f.loopback.requests.length, 1);
  const list = await f.call('/capability-executions?category=model_api');
  assert.equal(list.status, 200, JSON.stringify(list));
  assert.equal(list.data.items.length, 1);
  const projected = list.data.items[0];
  assert.equal(projected.category, 'model_api');
  assert.equal(projected.status, 'succeeded');
  assert.equal(projected.result.output.responseCandidate, 'Projected model result.');
  assert.equal(projected.result.usage.status, 'provider_reported');
  await f.restart();
  const afterRestart = await f.call(`/capability-executions/${projected.executionId}`);
  assert.deepEqual(afterRestart.data, projected);
  assert.equal(f.loopback.requests.length, 1);
  assert.equal(turn.turn.status, 'completed');
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM r6_standalone_execution_projections').get().n, 1);
});
