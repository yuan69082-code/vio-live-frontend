import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  startTestApplication,
} from '../test-support/test-application.js';

test('service starts and reports a healthy development database', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const rootResult = await getJson(context.baseUrl, '/');
    assert.equal(rootResult.response.status, 200);
    assert.equal(rootResult.body.success, true);
    assert.equal(rootResult.body.error, null);
    assert.ok(!Number.isNaN(Date.parse(rootResult.body.timestamp)));
    assert.deepEqual(rootResult.body.data, {
      service: 'vio-live-backend',
      version: '0.18.0',
      status: 'running',
    });

    const healthResult = await getJson(context.baseUrl, '/health');
    assert.equal(healthResult.response.status, 200);
    assert.equal(healthResult.body.success, true);
    assert.equal(healthResult.body.error, null);
    assert.ok(!Number.isNaN(Date.parse(healthResult.body.timestamp)));
    assert.deepEqual(healthResult.body.data, {
      status: 'ok',
      service: 'vio-live-backend',
      version: '0.18.0',
      database: 'ok',
    });
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
