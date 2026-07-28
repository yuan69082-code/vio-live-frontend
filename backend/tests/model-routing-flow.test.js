import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { runMigrations } from '../src/integrations/database/migrations.js';
import {
  createTestDatabasePath,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

const LEGACY_MIGRATION_FILENAMES = Object.freeze([
  '001_create_users_and_subjects.sql',
  '002_create_events.sql',
  '003_create_api_providers_and_models.sql',
  '004_create_permissions.sql',
  '005_create_security_system.sql',
  '006_create_conversations_messages_and_events.sql',
  '007_create_context_summaries_and_subject_states.sql',
  '008_create_assistant_global_settings.sql',
]);

async function createUser(baseUrl, email) {
  const result = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(result.response.status, 201);
  return result.body.data.userId;
}

async function createProvider(baseUrl, userId, input = {}) {
  return postJson(baseUrl, `/api/v1/users/${userId}/api-providers`, {
    displayName: 'OpenAI-compatible Configuration',
    providerType: 'openai',
    baseUrl: 'https://models.example/v1',
    ...input,
  });
}

async function createModel(baseUrl, userId, providerId, input) {
  return postJson(
    baseUrl,
    `/api/v1/users/${userId}/api-providers/${providerId}/models`,
    input,
  );
}

async function createRule(baseUrl, userId, input) {
  return postJson(baseUrl, `/api/v1/users/${userId}/model-routing-rules`, input);
}

test('migration 009 upgrades existing provider and model data without losing routing compatibility', async () => {
  const testDatabase = createTestDatabasePath();
  const legacyMigrationsPath = join(testDatabase.directory, 'legacy-migrations');
  mkdirSync(legacyMigrationsPath);

  for (const filename of LEGACY_MIGRATION_FILENAMES) {
    copyFileSync(
      new URL(`../migrations/${filename}`, import.meta.url),
      join(legacyMigrationsPath, filename),
    );
  }

  const legacyConnection = new DatabaseSync(testDatabase.databasePath);
  legacyConnection.exec('PRAGMA foreign_keys = ON;');
  runMigrations(legacyConnection, legacyMigrationsPath);
  const timestamp = '2026-07-28T00:00:00.000Z';
  legacyConnection.prepare(`
    INSERT INTO users (
      user_id, primary_email, display_name, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'legacy-user',
    'legacy-routing@example.com',
    '',
    'active',
    timestamp,
    timestamp,
  );
  legacyConnection.prepare(`
    INSERT INTO api_providers (
      api_provider_id, owner_user_id, display_name, provider_type, base_url,
      status, api_key_secret_ref, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    'legacy-provider',
    'legacy-user',
    'Legacy OpenAI-compatible provider',
    'openai',
    'https://legacy-models.example/v1',
    'enabled',
    timestamp,
    timestamp,
  );
  legacyConnection.prepare(`
    INSERT INTO models (
      model_id, owner_user_id, provider_id, model_name, model_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'legacy-model',
    'legacy-user',
    'legacy-provider',
    'legacy-chat-model',
    'language',
    timestamp,
  );
  legacyConnection.prepare(`
    INSERT INTO model_capabilities (model_id, capability) VALUES (?, ?)
  `).run('legacy-model', 'chat');
  legacyConnection.close();

  const context = await startTestApplication(testDatabase.databasePath);
  try {
    const provider = await getJson(
      context.baseUrl,
      '/api/v1/users/legacy-user/api-providers/legacy-provider',
    );
    assert.equal(provider.response.status, 200);
    assert.equal(provider.body.data.interfaceFormat, 'openai_compatible');
    assert.equal(provider.body.data.testStatus, 'not_tested');

    const models = await getJson(
      context.baseUrl,
      '/api/v1/users/legacy-user/models?capability=chat',
    );
    assert.equal(models.response.status, 200);
    assert.equal(models.body.data[0].modelId, 'legacy-model');
    assert.equal(models.body.data[0].costDescription, '');
    assert.equal(models.body.data[0].testStatus, 'not_tested');

    const rule = await createRule(context.baseUrl, 'legacy-user', {
      taskType: 'chat',
      defaultModelId: 'legacy-model',
    });
    assert.equal(rule.response.status, 201);
    const selection = await postJson(
      context.baseUrl,
      '/api/v1/users/legacy-user/model-router/select',
      { taskType: 'chat' },
    );
    assert.equal(selection.response.status, 200);
    assert.equal(selection.body.data.model.modelId, 'legacy-model');
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('provider, model and configured default/fallback routing persist without model calls', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const userId = await createUser(context.baseUrl, 'model-routing@example.com');
    const primaryProviderResult = await createProvider(context.baseUrl, userId);
    assert.equal(primaryProviderResult.response.status, 201);
    assert.equal(primaryProviderResult.body.data.providerType, 'openai');
    assert.equal(primaryProviderResult.body.data.interfaceFormat, 'openai_compatible');
    assert.equal(primaryProviderResult.body.data.status, 'enabled');
    assert.equal(primaryProviderResult.body.data.testStatus, 'not_tested');
    assert.deepEqual(primaryProviderResult.body.data.credentials, {
      apiKey: {
        status: 'not_configured',
        storage: 'secure_store_required',
        writeSupported: false,
      },
    });
    assert.equal('apiKeySecretRef' in primaryProviderResult.body.data, false);
    const primaryProviderId = primaryProviderResult.body.data.providerId;

    const fallbackProviderResult = await createProvider(context.baseUrl, userId, {
      displayName: 'Custom fallback configuration',
      providerType: 'custom',
      interfaceFormat: 'custom_http',
      baseUrl: 'http://127.0.0.1:9000/models',
    });
    assert.equal(fallbackProviderResult.response.status, 201);
    const fallbackProviderId = fallbackProviderResult.body.data.providerId;

    const providerList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers`,
    );
    assert.equal(providerList.response.status, 200);
    assert.equal(providerList.body.meta.count, 2);

    const primaryModel = await createModel(
      context.baseUrl,
      userId,
      primaryProviderId,
      {
        modelName: 'vio-omni-model',
        modelType: 'multimodal',
        capabilities: [
          'search',
          'chat',
          'audio',
          'long_text',
          'image',
          'video',
          'vision',
          'embedding',
          'chat',
        ],
        costDescription: 'Local configuration note only; no billing call is made.',
      },
    );
    assert.equal(primaryModel.response.status, 201);
    assert.deepEqual(primaryModel.body.data.capabilities, [
      'chat',
      'long_text',
      'vision',
      'image',
      'video',
      'audio',
      'search',
      'embedding',
    ]);
    assert.equal(primaryModel.body.data.testStatus, 'not_tested');
    assert.equal(
      primaryModel.body.data.provider.interfaceFormat,
      'openai_compatible',
    );

    const fallbackModel = await createModel(
      context.baseUrl,
      userId,
      fallbackProviderId,
      {
        modelName: 'vio-chat-fallback',
        modelType: 'language',
        capabilities: ['chat', 'long_text'],
        costDescription: 'Fallback cost description.',
      },
    );
    assert.equal(fallbackModel.response.status, 201);

    for (const taskType of ['chat', 'long_text', 'image', 'video', 'audio', 'search']) {
      const models = await getJson(
        context.baseUrl,
        `/api/v1/users/${userId}/models?capability=${taskType}`,
      );
      assert.equal(models.response.status, 200);
      assert.ok(models.body.meta.count >= 1);
    }

    const rule = await createRule(context.baseUrl, userId, {
      taskType: 'chat',
      defaultModelId: primaryModel.body.data.modelId,
      fallbackModelId: fallbackModel.body.data.modelId,
    });
    assert.equal(rule.response.status, 201);
    assert.equal(rule.body.data.defaultModel.modelId, primaryModel.body.data.modelId);
    assert.equal(rule.body.data.fallbackModel.modelId, fallbackModel.body.data.modelId);

    const ruleRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-routing-rules/chat`,
    );
    assert.equal(ruleRead.response.status, 200);
    const ruleList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-routing-rules`,
    );
    assert.equal(ruleList.body.meta.count, 1);

    const swappedRule = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-routing-rules/chat`,
      {
        defaultModelId: fallbackModel.body.data.modelId,
        fallbackModelId: primaryModel.body.data.modelId,
      },
    );
    assert.equal(swappedRule.response.status, 200);
    assert.equal(
      swappedRule.body.data.defaultModel.modelId,
      fallbackModel.body.data.modelId,
    );
    assert.equal(
      swappedRule.body.data.fallbackModel.modelId,
      primaryModel.body.data.modelId,
    );

    const restoredRule = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-routing-rules/chat`,
      {
        defaultModelId: primaryModel.body.data.modelId,
        fallbackModelId: fallbackModel.body.data.modelId,
      },
    );
    assert.equal(restoredRule.response.status, 200);

    const defaultSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-router/select`,
      { taskType: 'chat' },
    );
    assert.equal(defaultSelection.response.status, 200);
    assert.equal(
      defaultSelection.body.data.selectionRule,
      'configured_default_with_fallback',
    );
    assert.equal(defaultSelection.body.data.selectionSource, 'default');
    assert.equal(
      defaultSelection.body.data.model.modelId,
      primaryModel.body.data.modelId,
    );
    assert.deepEqual(defaultSelection.body.data.execution, {
      modelCall: 'not_performed',
      externalApiCall: 'not_performed',
    });

    const disablePrimary = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers/${primaryProviderId}/status`,
      { status: 'disabled' },
    );
    assert.equal(disablePrimary.response.status, 200);
    const fallbackSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-router/select`,
      { taskType: 'chat' },
    );
    assert.equal(fallbackSelection.response.status, 200);
    assert.equal(fallbackSelection.body.data.selectionSource, 'fallback');
    assert.equal(
      fallbackSelection.body.data.model.modelId,
      fallbackModel.body.data.modelId,
    );

    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers/${fallbackProviderId}/status`,
      { status: 'disabled' },
    );
    const unavailable = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-router/select`,
      { taskType: 'chat' },
    );
    assert.equal(unavailable.response.status, 404);

    await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers/${primaryProviderId}/status`,
      { status: 'enabled' },
    );
    const catalogSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-router/select`,
      { taskType: 'image' },
    );
    assert.equal(catalogSelection.response.status, 200);
    assert.equal(catalogSelection.body.data.selectionSource, 'catalog_fallback');

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persistedSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-router/select`,
      { taskType: 'chat' },
    );
    assert.equal(persistedSelection.response.status, 200);
    assert.equal(persistedSelection.body.data.selectionSource, 'default');
    assert.equal(
      persistedSelection.body.data.model.modelId,
      primaryModel.body.data.modelId,
    );
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('routing configuration enforces ownership, task support and credential boundaries', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const firstUserId = await createUser(context.baseUrl, 'first-provider@example.com');
    const secondUserId = await createUser(context.baseUrl, 'second-provider@example.com');

    for (const credentialInput of [
      { apiKey: 'must-not-be-accepted' },
      { secretRef: 'must-not-be-accepted' },
      { testStatus: 'passed' },
    ]) {
      const rejected = await createProvider(context.baseUrl, firstUserId, credentialInput);
      assert.equal(rejected.response.status, 400);
    }

    const credentialUrl = await createProvider(context.baseUrl, firstUserId, {
      baseUrl: 'https://models.example/v1?token=must-not-be-accepted',
    });
    assert.equal(credentialUrl.response.status, 400);
    const invalidFormat = await createProvider(context.baseUrl, firstUserId, {
      interfaceFormat: 'real-provider-sdk',
    });
    assert.equal(invalidFormat.response.status, 400);

    const providerResult = await createProvider(context.baseUrl, firstUserId, {
      displayName: 'Custom local configuration',
      providerType: 'custom',
      interfaceFormat: 'custom_http',
      status: 'disabled',
    });
    assert.equal(providerResult.response.status, 201);
    const providerId = providerResult.body.data.providerId;

    const crossUserProvider = await getJson(
      context.baseUrl,
      `/api/v1/users/${secondUserId}/api-providers/${providerId}`,
    );
    assert.equal(crossUserProvider.response.status, 404);
    const crossUserModel = await createModel(
      context.baseUrl,
      secondUserId,
      providerId,
      {
        modelName: 'cross-user-model',
        modelType: 'language',
        capabilities: ['chat'],
      },
    );
    assert.equal(crossUserModel.response.status, 404);

    const invalidCapability = await createModel(
      context.baseUrl,
      firstUserId,
      providerId,
      {
        modelName: 'unsupported-model',
        modelType: 'unknown',
        capabilities: ['realtime'],
      },
    );
    assert.equal(invalidCapability.response.status, 400);
    const invalidTestStatus = await createModel(
      context.baseUrl,
      firstUserId,
      providerId,
      {
        modelName: 'manual-test-status',
        modelType: 'audio',
        capabilities: ['audio'],
        testStatus: 'passed',
      },
    );
    assert.equal(invalidTestStatus.response.status, 400);

    const audioModel = await createModel(
      context.baseUrl,
      firstUserId,
      providerId,
      {
        modelName: 'audio-search-model',
        modelType: 'audio',
        capabilities: ['audio', 'search'],
        costDescription: 'No live price lookup; informational text only.',
      },
    );
    assert.equal(audioModel.response.status, 201);
    assert.equal(audioModel.body.data.testStatus, 'not_tested');
    assert.equal(
      audioModel.body.data.costDescription,
      'No live price lookup; informational text only.',
    );

    const otherProvider = await createProvider(context.baseUrl, secondUserId, {
      displayName: 'Other user provider',
    });
    const otherModel = await createModel(
      context.baseUrl,
      secondUserId,
      otherProvider.body.data.providerId,
      {
        modelName: 'other-user-audio',
        modelType: 'audio',
        capabilities: ['audio'],
      },
    );

    const crossUserRule = await createRule(context.baseUrl, firstUserId, {
      taskType: 'audio',
      defaultModelId: otherModel.body.data.modelId,
    });
    assert.equal(crossUserRule.response.status, 404);
    const wrongCapabilityRule = await createRule(context.baseUrl, firstUserId, {
      taskType: 'image',
      defaultModelId: audioModel.body.data.modelId,
    });
    assert.equal(wrongCapabilityRule.response.status, 400);
    const sameFallbackRule = await createRule(context.baseUrl, firstUserId, {
      taskType: 'audio',
      defaultModelId: audioModel.body.data.modelId,
      fallbackModelId: audioModel.body.data.modelId,
    });
    assert.equal(sameFallbackRule.response.status, 400);

    const validRule = await createRule(context.baseUrl, firstUserId, {
      taskType: 'audio',
      defaultModelId: audioModel.body.data.modelId,
    });
    assert.equal(validRule.response.status, 201);
    const duplicateRule = await createRule(context.baseUrl, firstUserId, {
      taskType: 'audio',
      defaultModelId: audioModel.body.data.modelId,
    });
    assert.equal(duplicateRule.response.status, 409);

    const emptyUpdate = await patchJson(
      context.baseUrl,
      `/api/v1/users/${firstUserId}/model-routing-rules/audio`,
      {},
    );
    assert.equal(emptyUpdate.response.status, 400);
    const disabledRule = await patchJson(
      context.baseUrl,
      `/api/v1/users/${firstUserId}/model-routing-rules/audio`,
      { status: 'disabled' },
    );
    assert.equal(disabledRule.response.status, 200);

    await patchJson(
      context.baseUrl,
      `/api/v1/users/${firstUserId}/api-providers/${providerId}/status`,
      { status: 'enabled' },
    );
    const disabledRuleSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${firstUserId}/model-router/select`,
      { taskType: 'audio' },
    );
    assert.equal(disabledRuleSelection.response.status, 200);
    assert.equal(
      disabledRuleSelection.body.data.selectionSource,
      'catalog_fallback',
    );

    const invalidTask = await postJson(
      context.baseUrl,
      `/api/v1/users/${firstUserId}/model-router/select`,
      { taskType: 'vision' },
    );
    assert.equal(invalidTask.response.status, 400);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
