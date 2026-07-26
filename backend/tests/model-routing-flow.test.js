import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

async function createUser(baseUrl, email) {
  const result = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(result.response.status, 201);
  return result.body.data.userId;
}

async function createProvider(baseUrl, userId, input = {}) {
  return postJson(baseUrl, `/api/v1/users/${userId}/api-providers`, {
    displayName: 'OpenAI Configuration',
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

test('providers and models persist while the router selects by capability', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const userId = await createUser(context.baseUrl, 'model-routing@example.com');
    const providerResult = await createProvider(context.baseUrl, userId);
    assert.equal(providerResult.response.status, 201);
    assert.equal(providerResult.body.data.providerType, 'openai');
    assert.equal(providerResult.body.data.status, 'enabled');
    assert.deepEqual(providerResult.body.data.credentials, {
      apiKey: { status: 'not_configured' },
    });
    assert.equal('apiKeySecretRef' in providerResult.body.data, false);
    const providerId = providerResult.body.data.providerId;

    const providerRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers/${providerId}`,
    );
    assert.equal(providerRead.response.status, 200);
    assert.equal(providerRead.body.data.providerId, providerId);

    const providerList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers`,
    );
    assert.equal(providerList.response.status, 200);
    assert.equal(providerList.body.meta.count, 1);

    const chatModel = await createModel(context.baseUrl, userId, providerId, {
      modelName: 'vio-chat-model',
      modelType: 'language',
      capabilities: ['embedding', 'chat', 'chat'],
    });
    assert.equal(chatModel.response.status, 201);
    assert.deepEqual(chatModel.body.data.capabilities, ['chat', 'embedding']);

    const visionModel = await createModel(context.baseUrl, userId, providerId, {
      modelName: 'vio-vision-model',
      modelType: 'multimodal',
      capabilities: ['vision'],
    });
    assert.equal(visionModel.response.status, 201);

    const chatModels = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/models?capability=chat`,
    );
    assert.equal(chatModels.response.status, 200);
    assert.equal(chatModels.body.meta.count, 1);
    assert.equal(chatModels.body.data[0].modelId, chatModel.body.data.modelId);

    const modelRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/models/${visionModel.body.data.modelId}`,
    );
    assert.equal(modelRead.response.status, 200);
    assert.equal(modelRead.body.data.modelName, 'vio-vision-model');

    const chatSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-router/select`,
      { taskType: 'chat' },
    );
    assert.equal(chatSelection.response.status, 200);
    assert.equal(chatSelection.body.data.selectionRule, 'first_enabled_capability_match');
    assert.equal(chatSelection.body.data.model.modelId, chatModel.body.data.modelId);

    const disabledProvider = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers/${providerId}/status`,
      { status: 'disabled' },
    );
    assert.equal(disabledProvider.response.status, 200);
    assert.equal(disabledProvider.body.data.status, 'disabled');

    const disabledSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-router/select`,
      { taskType: 'chat' },
    );
    assert.equal(disabledSelection.response.status, 404);

    const enabledProvider = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers/${providerId}/status`,
      { status: 'enabled' },
    );
    assert.equal(enabledProvider.response.status, 200);

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);

    const persistedSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/model-router/select`,
      { taskType: 'vision' },
    );
    assert.equal(persistedSelection.response.status, 200);
    assert.equal(persistedSelection.body.data.model.modelId, visionModel.body.data.modelId);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('provider ownership, supported capabilities and credential boundaries are enforced', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const firstUserId = await createUser(context.baseUrl, 'first-provider@example.com');
    const secondUserId = await createUser(context.baseUrl, 'second-provider@example.com');

    const credentialInput = await createProvider(context.baseUrl, firstUserId, {
      apiKey: 'must-not-be-accepted',
    });
    assert.equal(credentialInput.response.status, 400);
    assert.equal(credentialInput.body.error.code, 'validation_error');

    const credentialUrl = await createProvider(context.baseUrl, firstUserId, {
      baseUrl: 'https://models.example/v1?token=must-not-be-accepted',
    });
    assert.equal(credentialUrl.response.status, 400);

    const providerResult = await createProvider(context.baseUrl, firstUserId, {
      displayName: 'Custom Relay Configuration',
      providerType: 'custom',
      status: 'disabled',
    });
    assert.equal(providerResult.response.status, 201);
    const providerId = providerResult.body.data.providerId;

    const crossUserProvider = await getJson(
      context.baseUrl,
      `/api/v1/users/${secondUserId}/api-providers/${providerId}`,
    );
    assert.equal(crossUserProvider.response.status, 404);

    const crossUserModel = await createModel(context.baseUrl, secondUserId, providerId, {
      modelName: 'cross-user-model',
      modelType: 'language',
      capabilities: ['chat'],
    });
    assert.equal(crossUserModel.response.status, 404);

    const invalidCapability = await createModel(context.baseUrl, firstUserId, providerId, {
      modelName: 'unsupported-model',
      modelType: 'audio',
      capabilities: ['audio'],
    });
    assert.equal(invalidCapability.response.status, 400);

    const imageModel = await createModel(context.baseUrl, firstUserId, providerId, {
      modelName: 'image-model',
      modelType: 'image-generation',
      capabilities: ['image'],
    });
    assert.equal(imageModel.response.status, 201);

    const imageModels = await getJson(
      context.baseUrl,
      `/api/v1/users/${firstUserId}/models?capability=image`,
    );
    assert.equal(imageModels.response.status, 200);
    assert.equal(imageModels.body.meta.count, 1);

    const disabledSelection = await postJson(
      context.baseUrl,
      `/api/v1/users/${firstUserId}/model-router/select`,
      { taskType: 'image' },
    );
    assert.equal(disabledSelection.response.status, 404);

    const invalidTask = await postJson(
      context.baseUrl,
      `/api/v1/users/${firstUserId}/model-router/select`,
      { taskType: 'audio' },
    );
    assert.equal(invalidTask.response.status, 400);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
