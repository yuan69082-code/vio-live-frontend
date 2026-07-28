import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

async function createUserAndSubject(baseUrl, email, name = 'Device Subject') {
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

async function createDevice(baseUrl, userId, input) {
  return postJson(baseUrl, `/api/v1/users/${userId}/devices`, input);
}

async function authorizeDevice(baseUrl, userId, deviceId, input) {
  return postJson(
    baseUrl,
    `/api/v1/users/${userId}/devices/${deviceId}/authorizations`,
    input,
  );
}

async function prepareDevice(baseUrl, userId, subjectId, deviceId, input) {
  return postJson(
    baseUrl,
    `/api/v1/users/${userId}/subjects/${subjectId}/devices/${deviceId}/operation-preparations`,
    input,
  );
}

const deviceCases = Object.freeze([
  { deviceType: 'phone', brand: 'apple', name: 'Registered phone' },
  { deviceType: 'watch', brand: 'android', name: 'Registered watch' },
  { deviceType: 'air_conditioner', brand: 'midea', name: 'Registered air conditioner' },
  { deviceType: 'robot_vacuum', brand: 'xiaomi', name: 'Registered robot vacuum' },
  { deviceType: 'washing_machine', brand: 'midea', name: 'Registered washing machine' },
  { deviceType: 'camera', brand: 'generic_camera', name: 'Registered camera' },
  { deviceType: 'appliance', brand: 'generic_appliance', name: 'Registered appliance' },
]);

test('seven device types and future adapter contracts persist without connections', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const adapterResult = await getJson(context.baseUrl, '/api/v1/device-adapters');
    assert.equal(adapterResult.response.status, 200);
    assert.deepEqual(
      adapterResult.body.data.map((adapter) => adapter.adapterType),
      ['xiaomi', 'midea', 'apple', 'android', 'generic'],
    );
    assert.ok(adapterResult.body.data.every((adapter) => (
      adapter.implementationStatus === 'not_implemented'
      && adapter.connectionSupported === false
      && adapter.controlSupported === false
      && adapter.externalApiCallsSupported === false
      && adapter.contract.every((operation) => operation.supported === false)
    )));

    const { userId } = await createUserAndSubject(
      context.baseUrl,
      'device-registry@example.com',
    );
    const createdDevices = [];
    for (const deviceCase of deviceCases) {
      const result = await createDevice(context.baseUrl, userId, {
        ...deviceCase,
        capabilities: ['view_status', 'power', 'adjust_parameter', 'get_data'],
      });
      assert.equal(result.response.status, 201);
      assert.equal(result.body.data.device.status, 'disabled');
      assert.equal(result.body.data.device.connectionStatus, 'not_connected');
      assert.equal(result.body.data.device.stateStatus, 'not_observed');
      assert.equal(result.body.data.device.controlSupport, 'not_implemented');
      assert.equal(result.body.data.event.eventType, 'device_changed');
      assert.equal(result.body.data.event.data.changeType, 'connection_registered');
      assert.equal(result.body.data.event.data.connectionStatus, 'not_connected');
      assert.equal(result.body.data.event.data.executionStatus, 'not_executed');
      assert.ok(result.body.data.device.capabilityDefinitions.every((capability) => (
        capability.permissionRequirement.resourceType === 'device'
        && capability.executionSupport === 'not_implemented'
      )));
      createdDevices.push(result.body.data.device);
    }

    assert.equal(createdDevices[0].adapter.adapterType, 'apple');
    assert.equal(createdDevices[2].adapter.adapterType, 'midea');
    assert.equal(createdDevices[3].adapter.adapterType, 'xiaomi');
    assert.equal(createdDevices[5].adapter.adapterType, 'generic');

    const phone = createdDevices[0];
    const enabled = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/devices/${phone.deviceId}/status`,
      { status: 'enabled' },
    );
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.data.device.status, 'enabled');
    assert.equal(enabled.body.data.device.connectionStatus, 'not_connected');
    assert.equal(enabled.body.data.event.data.changeType, 'registry_status_changed');

    const phoneList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/devices?deviceType=phone&status=enabled&brand=APPLE`,
    );
    assert.equal(phoneList.response.status, 200);
    assert.equal(phoneList.body.meta.count, 1);
    assert.equal(phoneList.body.data[0].deviceId, phone.deviceId);

    const disabledList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/devices?status=disabled`,
    );
    assert.equal(disabledList.response.status, 200);
    assert.equal(disabledList.body.meta.count, 6);

    const events = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=device_changed&limit=20`,
    );
    assert.equal(events.response.status, 200);
    assert.equal(events.body.meta.count, 8);
    assert.ok(events.body.data.every((event) => (
      event.data.connectionStatus === 'not_connected'
      && event.data.executionStatus === 'not_executed'
    )));

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persisted = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/devices/${phone.deviceId}`,
    );
    assert.equal(persisted.response.status, 200);
    assert.equal(persisted.body.data.status, 'enabled');
    assert.equal(persisted.body.data.connectionStatus, 'not_connected');
    assert.deepEqual(persisted.body.data.capabilities, [
      'view_status',
      'power',
      'adjust_parameter',
      'get_data',
    ]);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('device authorization and critical operation preparation are event-linked but never execute', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'device-security@example.com',
    );
    const deviceResult = await createDevice(context.baseUrl, userId, {
      deviceType: 'camera',
      brand: 'generic_camera',
      name: 'Security camera registry',
      status: 'enabled',
      capabilities: ['view_status', 'power', 'get_data'],
    });
    assert.equal(deviceResult.response.status, 201);
    const device = deviceResult.body.data.device;

    const authorization = await authorizeDevice(
      context.baseUrl,
      userId,
      device.deviceId,
      {
        subjectId,
        capability: 'view_status',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(authorization.response.status, 201);
    assert.equal(authorization.body.data.permission.resourceType, 'device');
    assert.equal(authorization.body.data.permission.resourceId, device.deviceId);
    assert.equal(authorization.body.data.permission.action, 'read');
    assert.equal(authorization.body.data.event.data.changeType, 'authorization_changed');
    assert.equal(authorization.body.data.event.subjectId, subjectId);

    const firstPreparation = await prepareDevice(
      context.baseUrl,
      userId,
      subjectId,
      device.deviceId,
      { capability: 'view_status' },
    );
    assert.equal(firstPreparation.response.status, 201);
    assert.equal(firstPreparation.body.data.preparationStatus, 'confirmation_required');
    assert.equal(firstPreparation.body.data.security.decision, 'confirm');
    assert.equal(firstPreparation.body.data.security.risk.level, 'critical');
    assert.equal(firstPreparation.body.data.security.confirmation.mode, 'every_time');
    assert.equal(firstPreparation.body.data.execution.status, 'not_executed');
    assert.equal(firstPreparation.body.data.execution.deviceCall, 'not_performed');
    assert.equal(firstPreparation.body.data.execution.vendorApiCall, 'not_performed');
    assert.equal(firstPreparation.body.data.operationLog.executionStatus, 'not_executed');
    assert.equal(firstPreparation.body.data.event.data.changeType, 'operation_requested');
    const confirmationId = firstPreparation.body.data.security.confirmation.confirmationId;

    const approved = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(approved.response.status, 200);

    const confirmedPreparation = await prepareDevice(
      context.baseUrl,
      userId,
      subjectId,
      device.deviceId,
      { capability: 'view_status', confirmationId },
    );
    assert.equal(confirmedPreparation.response.status, 201);
    assert.equal(confirmedPreparation.body.data.preparationStatus, 'ready');
    assert.equal(confirmedPreparation.body.data.security.decision, 'allow');
    assert.equal(confirmedPreparation.body.data.security.confirmation.status, 'consumed');
    assert.equal(confirmedPreparation.body.data.execution.supported, false);
    assert.equal(confirmedPreparation.body.data.operationLog.executionStatus, 'not_executed');

    const deniedPower = await prepareDevice(
      context.baseUrl,
      userId,
      subjectId,
      device.deviceId,
      { capability: 'power' },
    );
    assert.equal(deniedPower.response.status, 201);
    assert.equal(deniedPower.body.data.preparationStatus, 'denied');
    assert.equal(deniedPower.body.data.security.permission.decision, 'deny');
    assert.equal(deniedPower.body.data.execution.status, 'not_executed');

    const logs = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/device-operation-logs?deviceId=${device.deviceId}&limit=10`,
    );
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.meta.count, 3);
    assert.ok(logs.body.data.every((log) => log.executionStatus === 'not_executed'));
    assert.deepEqual(
      new Set(logs.body.data.map((log) => log.preparationStatus)),
      new Set(['confirmation_required', 'ready', 'denied']),
    );

    const readyLog = confirmedPreparation.body.data.operationLog;
    const logRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/subjects/${subjectId}/device-operation-logs/${readyLog.deviceOperationLogId}`,
    );
    assert.equal(logRead.response.status, 200);
    assert.equal(logRead.body.data.eventId, confirmedPreparation.body.data.event.eventId);
    assert.equal(logRead.body.data.auditLogId, confirmedPreparation.body.data.security.auditLogId);

    const linkedAudit = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/audit-logs/${readyLog.auditLogId}`,
    );
    assert.equal(linkedAudit.response.status, 200);
    assert.equal(linkedAudit.body.data.operationType, 'device_control');
    assert.equal(linkedAudit.body.data.resourceType, 'device');
    assert.equal(linkedAudit.body.data.result, 'allowed');

    const deviceEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/events?eventType=device_changed&subjectId=${subjectId}&limit=20`,
    );
    assert.equal(deviceEvents.response.status, 200);
    assert.deepEqual(
      new Set(deviceEvents.body.data.map((event) => event.data.changeType)),
      new Set(['authorization_changed', 'operation_requested']),
    );
    assert.equal(
      deviceEvents.body.data.filter(
        (event) => event.data.changeType === 'operation_requested',
      ).length,
      3,
    );
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('device boundaries reject control payloads, cross-user access and partial writes', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const first = await createUserAndSubject(
      context.baseUrl,
      'device-boundary@example.com',
    );
    const second = await createUserAndSubject(
      context.baseUrl,
      'device-boundary-other@example.com',
    );
    const validInput = {
      deviceType: 'air_conditioner',
      brand: 'MIDEA',
      name: 'Boundary air conditioner',
      capabilities: ['view_status', 'adjust_parameter'],
    };
    const deviceResult = await createDevice(
      context.baseUrl,
      first.userId,
      validInput,
    );
    assert.equal(deviceResult.response.status, 201);
    assert.equal(deviceResult.body.data.device.brand, 'midea');
    const deviceId = deviceResult.body.data.device.deviceId;

    const unsupportedField = await createDevice(context.baseUrl, first.userId, {
      ...validInput,
      name: 'Unsafe device',
      vendorToken: 'not-a-real-token',
    });
    assert.equal(unsupportedField.response.status, 400);
    const invalidType = await createDevice(context.baseUrl, first.userId, {
      ...validInput,
      name: 'Invalid type device',
      deviceType: 'door_lock',
    });
    assert.equal(invalidType.response.status, 400);
    const duplicateCapabilities = await createDevice(context.baseUrl, first.userId, {
      ...validInput,
      name: 'Duplicate capability device',
      capabilities: ['view_status', 'view_status'],
    });
    assert.equal(duplicateCapabilities.response.status, 400);
    const duplicateName = await createDevice(
      context.baseUrl,
      first.userId,
      validInput,
    );
    assert.equal(duplicateName.response.status, 409);

    const crossUserDevice = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/devices/${deviceId}`,
    );
    assert.equal(crossUserDevice.response.status, 404);
    const crossUserAuthorization = await authorizeDevice(
      context.baseUrl,
      first.userId,
      deviceId,
      {
        subjectId: second.subjectId,
        capability: 'view_status',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(crossUserAuthorization.response.status, 404);

    const disabledPreparation = await prepareDevice(
      context.baseUrl,
      first.userId,
      first.subjectId,
      deviceId,
      { capability: 'view_status' },
    );
    assert.equal(disabledPreparation.response.status, 409);
    const enabled = await patchJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/devices/${deviceId}/status`,
      { status: 'enabled' },
    );
    assert.equal(enabled.response.status, 200);

    const undeclaredCapability = await prepareDevice(
      context.baseUrl,
      first.userId,
      first.subjectId,
      deviceId,
      { capability: 'power' },
    );
    assert.equal(undeclaredCapability.response.status, 409);
    const executionPayload = await prepareDevice(
      context.baseUrl,
      first.userId,
      first.subjectId,
      deviceId,
      { capability: 'adjust_parameter', parameters: { temperature: 22 } },
    );
    assert.equal(executionPayload.response.status, 400);

    const deniedPreparation = await prepareDevice(
      context.baseUrl,
      first.userId,
      first.subjectId,
      deviceId,
      { capability: 'view_status' },
    );
    assert.equal(deniedPreparation.response.status, 201);
    assert.equal(deniedPreparation.body.data.preparationStatus, 'denied');
    const deniedLogId = deniedPreparation.body.data.operationLog.deviceOperationLogId;
    const crossUserLog = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/subjects/${second.subjectId}/device-operation-logs/${deniedLogId}`,
    );
    assert.equal(crossUserLog.response.status, 404);

    const invalidFilter = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/devices?deviceType=door_lock`,
    );
    assert.equal(invalidFilter.response.status, 400);
    const invalidLogLimit = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/device-operation-logs?limit=0`,
    );
    assert.equal(invalidLogLimit.response.status, 400);

    const beforeFailedCreate = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/devices`,
    );
    context.application.database.connection.exec(`
      CREATE TRIGGER fail_device_event_for_test
      BEFORE INSERT ON events
      WHEN NEW.event_type = 'device_changed'
      BEGIN
        SELECT RAISE(ABORT, 'forced device event failure');
      END;
    `);
    const failedCreate = await createDevice(context.baseUrl, first.userId, {
      deviceType: 'watch',
      brand: 'apple',
      name: 'Must roll back',
      capabilities: ['view_status'],
    });
    assert.equal(failedCreate.response.status, 500);
    context.application.database.connection.exec('DROP TRIGGER fail_device_event_for_test;');
    const afterFailedCreate = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/devices`,
    );
    assert.equal(
      afterFailedCreate.body.meta.count,
      beforeFailedCreate.body.meta.count,
    );

    const beforeLogs = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/device-operation-logs`,
    );
    const beforeEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/events?eventType=device_changed&subjectId=${first.subjectId}`,
    );
    const beforeAudits = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/audit-logs?operationType=device_control&limit=20`,
    );
    context.application.database.connection.exec(`
      CREATE TRIGGER fail_device_log_for_test
      BEFORE INSERT ON device_operation_logs
      BEGIN
        SELECT RAISE(ABORT, 'forced device operation log failure');
      END;
    `);
    const failedPreparation = await prepareDevice(
      context.baseUrl,
      first.userId,
      first.subjectId,
      deviceId,
      { capability: 'view_status' },
    );
    assert.equal(failedPreparation.response.status, 409);
    context.application.database.connection.exec('DROP TRIGGER fail_device_log_for_test;');
    const afterLogs = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/subjects/${first.subjectId}/device-operation-logs`,
    );
    const afterEvents = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/events?eventType=device_changed&subjectId=${first.subjectId}`,
    );
    const afterAudits = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/audit-logs?operationType=device_control&limit=20`,
    );
    assert.equal(afterLogs.body.meta.count, beforeLogs.body.meta.count);
    assert.equal(afterEvents.body.meta.count, beforeEvents.body.meta.count);
    assert.equal(afterAudits.body.meta.count, beforeAudits.body.meta.count);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
