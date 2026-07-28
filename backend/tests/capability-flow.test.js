import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

async function createUserAndSubject(baseUrl, email, name = 'Capability Subject') {
  const userResult = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(userResult.response.status, 201);
  const userId = userResult.body.data.userId;
  const subjectResult = await postJson(
    baseUrl,
    `/api/v1/users/${userId}/subjects`,
    { name, basicSettings: {} },
  );
  assert.equal(subjectResult.response.status, 201);

  return { userId, subjectId: subjectResult.body.data.subjectId };
}

async function createPermission(baseUrl, userId, input) {
  const result = await postJson(
    baseUrl,
    `/api/v1/users/${userId}/permissions`,
    input,
  );
  assert.equal(result.response.status, 201);
  return result.body.data;
}

async function enableRegistryEntry(baseUrl, path) {
  const result = await patchJson(baseUrl, path, { status: 'enabled' });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.status, 'enabled');
  return result.body.data;
}

function findCapability(capabilities, category) {
  return capabilities.find((item) => item.category === category);
}

test('registries, unified capabilities and tool usage persist without external execution', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'capability-registry@example.com',
    );
    const toolResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/tools`,
      {
        name: 'Local notes reader',
        description: 'Registry metadata for a future read-only notes capability.',
        toolType: 'read_only',
        inputDefinition: {
          type: 'object',
          properties: { noteId: { type: 'string' } },
          required: ['noteId'],
        },
        outputDefinition: {
          type: 'object',
          properties: { content: { type: 'string' } },
        },
        permissionAction: 'read',
      },
    );
    assert.equal(toolResult.response.status, 201);
    assert.equal(toolResult.body.data.status, 'disabled');
    assert.equal(toolResult.body.data.executionSupport, 'not_implemented');
    const tool = await enableRegistryEntry(
      context.baseUrl,
      `/api/v1/users/${userId}/tools/${toolResult.body.data.toolId}/status`,
    );

    const mcpResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/mcp-registrations`,
      {
        name: 'Example MCP registry',
        serviceUrl: 'https://mcp.example.test/v1',
        capabilityDescription: 'Connection metadata only; no MCP client is present.',
      },
    );
    assert.equal(mcpResult.response.status, 201);
    assert.equal(mcpResult.body.data.connectionStatus, 'not_connected');
    const mcp = await enableRegistryEntry(
      context.baseUrl,
      `/api/v1/users/${userId}/mcp-registrations/${mcpResult.body.data.mcpId}/status`,
    );

    const skillResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/skills`,
      {
        name: 'Meeting outline skill',
        description: 'Describes a future reusable meeting-outline workflow.',
        applicableScenarios: ['meeting preparation', 'agenda drafting'],
        version: '0.1.0',
      },
    );
    assert.equal(skillResult.response.status, 201);
    const skill = await enableRegistryEntry(
      context.baseUrl,
      `/api/v1/users/${userId}/skills/${skillResult.body.data.skillId}/status`,
    );

    const pluginResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/plugins`,
      {
        name: 'Calendar bridge metadata',
        description: 'A future plugin manifest entry that is never installed here.',
        version: '0.1.0',
        dependencies: ['calendar-contract@1'],
      },
    );
    assert.equal(pluginResult.response.status, 201);
    assert.equal(pluginResult.body.data.installationStatus, 'not_installed');
    const plugin = await enableRegistryEntry(
      context.baseUrl,
      `/api/v1/users/${userId}/plugins/${pluginResult.body.data.pluginId}/status`,
    );

    const blockedCapabilities = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/capabilities?status=enabled`,
    );
    assert.equal(blockedCapabilities.response.status, 200);
    assert.equal(blockedCapabilities.body.meta.count, 4);
    assert.equal(
      findCapability(blockedCapabilities.body.data, 'tool').availability.state,
      'blocked_by_permission',
    );
    assert.equal(
      findCapability(blockedCapabilities.body.data, 'plugin').availability.state,
      'registry_only',
    );

    await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'tool',
      resourceId: tool.toolId,
      action: 'read',
      permissionLevel: 'always_allow',
    });
    await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'mcp',
      resourceId: mcp.mcpId,
      action: 'connect',
      permissionLevel: 'always_allow',
    });
    await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'skill',
      resourceId: skill.skillId,
      action: 'execute',
      permissionLevel: 'always_allow',
    });

    const capabilitiesResult = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/capabilities`,
    );
    assert.equal(capabilitiesResult.response.status, 200);
    assert.deepEqual(
      capabilitiesResult.body.data.map((item) => item.category),
      ['tool', 'mcp', 'skill', 'plugin'],
    );
    for (const category of ['tool', 'mcp', 'skill']) {
      const capability = findCapability(capabilitiesResult.body.data, category);
      assert.equal(capability.permission.decision, 'allow');
      assert.equal(capability.availability.availableForSelection, true);
      assert.equal(capability.availability.executionAvailable, false);
      assert.equal(capability.recentUsage, null);
    }
    const pluginCapability = findCapability(capabilitiesResult.body.data, 'plugin');
    assert.equal(pluginCapability.capabilityId, plugin.pluginId);
    assert.equal(pluginCapability.permission.decision, 'not_applicable');
    assert.equal(pluginCapability.availability.executionAvailable, false);

    const categoryResult = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/capabilities?category=tool`,
    );
    assert.equal(categoryResult.response.status, 200);
    assert.equal(categoryResult.body.meta.count, 1);

    const preparationResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/tools/${tool.toolId}/execution-preparations`,
      {},
    );
    assert.equal(preparationResult.response.status, 201);
    assert.equal(preparationResult.body.data.preparationStatus, 'ready');
    assert.equal(preparationResult.body.data.security.decision, 'allow');
    assert.equal(preparationResult.body.data.execution.supported, false);
    assert.equal(preparationResult.body.data.execution.status, 'not_executed');
    assert.equal(preparationResult.body.data.execution.externalCalls, 'not_performed');
    assert.deepEqual(preparationResult.body.data.usageRecord.consumption, {
      durationMs: 0,
      externalCalls: 0,
      tokens: 0,
      billableAmount: null,
      source: 'not_executed',
    });
    const usageId = preparationResult.body.data.usageRecord.toolUsageId;

    const usageList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/tool-usage-records?toolId=${tool.toolId}`,
    );
    assert.equal(usageList.response.status, 200);
    assert.equal(usageList.body.meta.count, 1);
    assert.equal(usageList.body.data[0].executionStatus, 'not_executed');

    const capabilityAfterPreparation = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/capabilities?category=tool`,
    );
    assert.equal(
      capabilityAfterPreparation.body.data[0].recentUsage.toolUsageId,
      usageId,
    );

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persistedUsage = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/tool-usage-records/${usageId}`,
    );
    assert.equal(persistedUsage.response.status, 200);
    assert.equal(persistedUsage.body.data.toolId, tool.toolId);
    const persistedMcp = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/mcp-registrations/${mcp.mcpId}`,
    );
    assert.equal(persistedMcp.response.status, 200);
    assert.equal(persistedMcp.body.data.connectionStatus, 'not_connected');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('tool preparation uses Permission and Security confirmation but never invokes a tool', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'capability-confirmation@example.com',
    );
    const toolResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/tools`,
      {
        name: 'Future action tool',
        description: 'An executable capability definition without an executor.',
        toolType: 'action',
        inputDefinition: { type: 'object' },
        outputDefinition: { type: 'object' },
        status: 'enabled',
      },
    );
    assert.equal(toolResult.response.status, 201);
    const tool = toolResult.body.data;
    await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'tool',
      resourceId: tool.toolId,
      action: 'execute',
      permissionLevel: 'always_allow',
    });

    const firstPreparation = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/tools/${tool.toolId}/execution-preparations`,
      {},
    );
    assert.equal(firstPreparation.response.status, 201);
    assert.equal(firstPreparation.body.data.preparationStatus, 'confirmation_required');
    assert.equal(firstPreparation.body.data.security.decision, 'confirm');
    assert.equal(firstPreparation.body.data.security.risk.level, 'medium');
    assert.equal(firstPreparation.body.data.execution.status, 'not_executed');
    const confirmationId = firstPreparation.body.data.security.confirmation.confirmationId;

    const approvalResult = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(approvalResult.response.status, 200);

    const confirmedPreparation = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/tools/${tool.toolId}/execution-preparations`,
      { confirmationId },
    );
    assert.equal(confirmedPreparation.response.status, 201);
    assert.equal(confirmedPreparation.body.data.preparationStatus, 'ready');
    assert.equal(confirmedPreparation.body.data.security.decision, 'allow');
    assert.equal(confirmedPreparation.body.data.security.confirmation.status, 'consumed');
    assert.equal(confirmedPreparation.body.data.execution.supported, false);
    assert.equal(confirmedPreparation.body.data.usageRecord.executionStatus, 'not_executed');

    const usageList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/tool-usage-records?limit=10`,
    );
    assert.equal(usageList.response.status, 200);
    assert.equal(usageList.body.meta.count, 2);
    assert.deepEqual(
      new Set(usageList.body.data.map((record) => record.preparationStatus)),
      new Set(['confirmation_required', 'ready']),
    );
    assert.ok(
      usageList.body.data.every((record) => record.executionStatus === 'not_executed'),
    );

    const disabled = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/tools/${tool.toolId}/status`,
      { status: 'disabled' },
    );
    assert.equal(disabled.response.status, 200);
    const disabledPreparation = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/tools/${tool.toolId}/execution-preparations`,
      {},
    );
    assert.equal(disabledPreparation.response.status, 409);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('capability registries reject execution payloads, credentials and cross-user access', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const first = await createUserAndSubject(
      context.baseUrl,
      'capability-boundary@example.com',
    );
    const second = await createUserAndSubject(
      context.baseUrl,
      'capability-boundary-other@example.com',
    );
    const otherSubjectResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects`,
      { name: 'Other Subject', basicSettings: {} },
    );
    assert.equal(otherSubjectResult.response.status, 201);
    const otherSubjectId = otherSubjectResult.body.data.subjectId;

    const toolPayload = {
      name: 'Boundary tool',
      description: 'Metadata only.',
      toolType: 'action',
      inputDefinition: { type: 'object' },
      outputDefinition: { type: 'object' },
      status: 'enabled',
    };
    const toolResult = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/tools`,
      toolPayload,
    );
    assert.equal(toolResult.response.status, 201);
    const toolId = toolResult.body.data.toolId;

    const executablePayload = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/tools`,
      { ...toolPayload, name: 'Unsafe tool', command: 'do-something' },
    );
    assert.equal(executablePayload.response.status, 400);
    const duplicateTool = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/tools`,
      toolPayload,
    );
    assert.equal(duplicateTool.response.status, 409);

    const credentialUrl = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/mcp-registrations`,
      {
        name: 'Unsafe MCP',
        serviceUrl: 'https://mcp.example.test/v1?api_key=not-a-real-key',
        capabilityDescription: 'Must be rejected before storage.',
      },
    );
    assert.equal(credentialUrl.response.status, 400);

    const duplicateScenarios = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/skills`,
      {
        name: 'Invalid skill',
        description: 'Invalid duplicate metadata.',
        applicableScenarios: ['drafting', 'drafting'],
        version: '0.1.0',
      },
    );
    assert.equal(duplicateScenarios.response.status, 400);

    const crossUserTool = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/tools/${toolId}`,
    );
    assert.equal(crossUserTool.response.status, 404);
    const crossUserSubject = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/subjects/${first.subjectId}/capabilities`,
    );
    assert.equal(crossUserSubject.response.status, 404);

    const invalidCategory = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/capabilities?category=device`,
    );
    assert.equal(invalidCategory.response.status, 400);
    const invalidStatus = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/capabilities?status=connected`,
    );
    assert.equal(invalidStatus.response.status, 400);

    const deniedPreparation = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/tools/${toolId}/execution-preparations`,
      {},
    );
    assert.equal(deniedPreparation.response.status, 201);
    assert.equal(deniedPreparation.body.data.preparationStatus, 'denied');
    assert.equal(deniedPreparation.body.data.security.permission.decision, 'deny');
    assert.equal(deniedPreparation.body.data.execution.status, 'not_executed');
    const usageId = deniedPreparation.body.data.usageRecord.toolUsageId;

    const executionInput = await postJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/tools/${toolId}/execution-preparations`,
      { input: { noteId: 'note-1' } },
    );
    assert.equal(executionInput.response.status, 400);
    const otherSubjectUsage = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${otherSubjectId}/tool-usage-records`,
    );
    assert.equal(otherSubjectUsage.response.status, 200);
    assert.equal(otherSubjectUsage.body.meta.count, 0);
    const crossUserUsage = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/subjects/${second.subjectId}/tool-usage-records/${usageId}`,
    );
    assert.equal(crossUserUsage.response.status, 404);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
