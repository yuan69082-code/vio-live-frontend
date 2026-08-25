import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ValidationError } from '../src/core/errors.js';
import { createSubjectRuntimeStatusService } from '../src/modules/subject-runtime/subject-runtime-status-service.js';
import {
  SUBJECT_RUNTIME_PORT_VERSION,
  createSubjectRuntimeConnectionSnapshot,
  negotiateSubjectRuntimeVersion,
} from '../src/modules/subject-runtime/subject-runtime-port-v1.js';
import {
  createTestDatabasePath,
  getJson,
} from '../test-support/test-application.js';

const silentLogger = { error() {} };

function externalManifest(overrides = {}) {
  return {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId: 'third-party.example',
    adapterKind: 'third_party',
    adapterVersion: 'example-adapter/v1',
    runtimeMode: 'external',
    runtimeName: 'Example Runtime',
    runtimeVersion: 'example-runtime/v1',
    supportedPortVersions: [SUBJECT_RUNTIME_PORT_VERSION],
    capabilities: [
      'observation_input',
      'expression_result',
      'state_projection',
      'cancellation',
      'recovery',
    ],
    specializedContracts: [],
    ...overrides,
  };
}

function thirdPartyAdapter({
  state = 'ready',
  reason = null,
  manifest: manifestOverrides = {},
  mutateManifest = (value) => value,
  mutateSnapshot = (value) => value,
  mutateNegotiation = (value) => value,
} = {}) {
  const manifest = externalManifest(manifestOverrides);
  const snapshot = createSubjectRuntimeConnectionSnapshot({ manifest, state, reason });
  const counters = {
    manifest: 0,
    status: 0,
    negotiation: 0,
    submitObservation: 0,
    cancel: 0,
    recover: 0,
  };
  const adapter = {
    baseUrl: 'https://runtime.invalid/private',
    serviceToken: 'must-not-be-returned',
    binding: { private: 'must-not-be-returned' },
    databasePath: 'C:\\private\\runtime.sqlite',
    getManifest() {
      counters.manifest += 1;
      return mutateManifest(structuredClone(manifest));
    },
    getConnectionStatus() {
      counters.status += 1;
      return mutateSnapshot(structuredClone(snapshot));
    },
    negotiateVersion(vioSupportedVersions) {
      counters.negotiation += 1;
      return mutateNegotiation(negotiateSubjectRuntimeVersion({
        vioSupportedVersions,
        adapterManifest: manifest,
      }));
    },
    submitObservation() {
      counters.submitObservation += 1;
      throw new Error('R0-B must not submit observations.');
    },
    cancel() {
      counters.cancel += 1;
      throw new Error('R0-B must not cancel runtime operations.');
    },
    recover() {
      counters.recover += 1;
      throw new Error('R0-B must not recover runtime operations.');
    },
  };
  return { adapter, counters };
}

async function startApplication({ subjectRuntimeAdapter } = {}) {
  const testDatabase = createTestDatabasePath();
  const config = loadConfig({
    VIO_BACKEND_HOST: '127.0.0.1',
    VIO_BACKEND_PORT: '0',
    VIO_BACKEND_DB_PATH: testDatabase.databasePath,
  });
  const application = createApplication({
    config,
    logger: silentLogger,
    subjectRuntimeAdapter,
  });
  const address = await application.start();
  return {
    application,
    testDatabase,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopApplication(context) {
  await context.application.stop();
  context.testDatabase.remove();
}

test('R0-B defaults application assembly to the formal None Adapter', async () => {
  const context = await startApplication();
  try {
    const response = await getJson(context.baseUrl, '/api/v1/subject-runtime/status');
    assert.equal(response.response.status, 200);
    assert.deepEqual(response.body.data, {
      portVersion: SUBJECT_RUNTIME_PORT_VERSION,
      mode: 'none',
      adapterId: 'none',
      adapterKind: 'none',
      adapterVersion: 'none-adapter/v1',
      state: 'disconnected',
      platformStatus: 'available',
      runtimeStatus: 'not_configured',
      runtimeName: null,
      runtimeVersion: null,
      capabilities: [],
      reason: 'external_runtime_not_configured',
      versionNegotiation: {
        portVersion: SUBJECT_RUNTIME_PORT_VERSION,
        adapterId: 'none',
        status: 'compatible',
        selectedVersion: SUBJECT_RUNTIME_PORT_VERSION,
        reason: 'version_match',
      },
      externalCall: 'not_performed',
    });
  } finally {
    await stopApplication(context);
  }
});

test('R0-B health distinguishes an available Vio platform from an unconfigured runtime', async () => {
  const context = await startApplication();
  try {
    const response = await getJson(context.baseUrl, '/health');
    assert.equal(response.response.status, 200);
    assert.equal(response.body.data.status, 'ok');
    assert.deepEqual(response.body.data.subjectRuntime, {
      portVersion: SUBJECT_RUNTIME_PORT_VERSION,
      mode: 'none',
      adapterId: 'none',
      adapterKind: 'none',
      state: 'disconnected',
      platformStatus: 'available',
      runtimeStatus: 'not_configured',
      reason: 'external_runtime_not_configured',
      externalCall: 'not_performed',
    });
    assert.equal(response.body.data.continuityEngine, 'disabled');
    assert.deepEqual(response.body.data.continuityEngineCompatibility, {
      scope: 'adapter_only_legacy',
      status: 'disabled',
    });
  } finally {
    await stopApplication(context);
  }
});

test('R0-B public status uses validated third-party manifest, snapshot, and negotiation data', async () => {
  const { adapter, counters } = thirdPartyAdapter({ reason: 'runtime_ready' });
  const context = await startApplication({ subjectRuntimeAdapter: adapter });
  try {
    const first = await getJson(context.baseUrl, '/api/v1/subject-runtime/status');
    const second = await getJson(context.baseUrl, '/api/v1/subject-runtime/status');
    assert.deepEqual(first.body.data, second.body.data);
    assert.deepEqual(first.body.data, {
      portVersion: SUBJECT_RUNTIME_PORT_VERSION,
      mode: 'external',
      adapterId: 'third-party.example',
      adapterKind: 'third_party',
      adapterVersion: 'example-adapter/v1',
      state: 'ready',
      platformStatus: 'available',
      runtimeStatus: 'available',
      runtimeName: 'Example Runtime',
      runtimeVersion: 'example-runtime/v1',
      capabilities: [
        'observation_input',
        'expression_result',
        'state_projection',
        'cancellation',
        'recovery',
      ],
      reason: 'runtime_ready',
      versionNegotiation: {
        portVersion: SUBJECT_RUNTIME_PORT_VERSION,
        adapterId: 'third-party.example',
        status: 'compatible',
        selectedVersion: SUBJECT_RUNTIME_PORT_VERSION,
        reason: 'version_match',
      },
      externalCall: 'not_performed',
    });
    assert.deepEqual(counters, {
      manifest: 1,
      status: 1,
      negotiation: 1,
      submitObservation: 0,
      cancel: 0,
      recover: 0,
    });
  } finally {
    await stopApplication(context);
  }
});

test('R0-B reports every legal external connection state without a second state enum', () => {
  const expectedRuntimeStatus = {
    disconnected: 'disconnected',
    connecting: 'connecting',
    ready: 'available',
    degraded: 'degraded',
    paused: 'paused',
    reconnecting: 'connecting',
  };
  for (const [state, runtimeStatus] of Object.entries(expectedRuntimeStatus)) {
    const { adapter } = thirdPartyAdapter({ state });
    const status = createSubjectRuntimeStatusService({ adapter }).getStatus();
    assert.equal(status.state, state);
    assert.equal(status.runtimeStatus, runtimeStatus);
    assert.equal(status.platformStatus, 'available');
  }

  const { adapter } = thirdPartyAdapter({
    state: 'incompatible',
    manifest: { supportedPortVersions: ['vio-subject-runtime-port/v2'] },
  });
  const incompatible = createSubjectRuntimeStatusService({ adapter }).getStatus();
  assert.equal(incompatible.state, 'incompatible');
  assert.equal(incompatible.runtimeStatus, 'incompatible');
  assert.equal(incompatible.versionNegotiation.status, 'incompatible');
  assert.equal(incompatible.versionNegotiation.selectedVersion, null);
});

test('R0-B rejects invalid manifests and incomplete adapters before application assembly', () => {
  const invalid = thirdPartyAdapter({
    mutateManifest(value) {
      return { ...value, serviceToken: 'not-allowed' };
    },
  });
  assert.throws(
    () => createSubjectRuntimeStatusService({ adapter: invalid.adapter }),
    ValidationError,
  );
  assert.throws(
    () => createSubjectRuntimeStatusService({ adapter: {} }),
    ValidationError,
  );
});

test('R0-B rejects unknown, invalid, and unserializable connection snapshot data', () => {
  const cases = [
    (value) => ({ ...value, state: 'invented' }),
    (value) => ({ ...value, requestBody: 'not-allowed' }),
    (value) => ({ ...value, reason: Symbol('not-serializable') }),
  ];
  for (const mutateSnapshot of cases) {
    const { adapter } = thirdPartyAdapter({ mutateSnapshot });
    assert.throws(
      () => createSubjectRuntimeStatusService({ adapter }),
      ValidationError,
    );
  }
});

test('R0-B rejects forged negotiation results and version/state inconsistencies', () => {
  const forged = thirdPartyAdapter({
    mutateNegotiation(value) {
      return { ...value, selectedVersion: 'vio-subject-runtime-port/v2' };
    },
  });
  assert.throws(
    () => createSubjectRuntimeStatusService({ adapter: forged.adapter }),
    ValidationError,
  );

  const mismatched = thirdPartyAdapter({
    state: 'ready',
    manifest: { supportedPortVersions: ['vio-subject-runtime-port/v2'] },
  });
  assert.throws(
    () => createSubjectRuntimeStatusService({ adapter: mismatched.adapter }),
    (error) => error instanceof ValidationError
      && error.details?.path === '$.connectionSnapshot.state',
  );
});

test('R0-B response omits Adapter secrets, URLs, bindings, paths, and request content', async () => {
  const { adapter } = thirdPartyAdapter();
  const context = await startApplication({ subjectRuntimeAdapter: adapter });
  try {
    const response = await getJson(context.baseUrl, '/api/v1/subject-runtime/status');
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      'serviceToken',
      'must-not-be-returned',
      'https://runtime.invalid',
      'binding',
      'runtime.sqlite',
      'Authorization',
      'apiKey',
      'requestBody',
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await stopApplication(context);
  }
});

test('R0-B status and health reads never execute runtime operations or perform external calls', async () => {
  const { adapter, counters } = thirdPartyAdapter({ state: 'degraded' });
  const context = await startApplication({ subjectRuntimeAdapter: adapter });
  try {
    await getJson(context.baseUrl, '/api/v1/subject-runtime/status');
    await getJson(context.baseUrl, '/health');
    assert.equal(counters.submitObservation, 0);
    assert.equal(counters.cancel, 0);
    assert.equal(counters.recover, 0);
    assert.equal(counters.manifest, 1);
    assert.equal(counters.status, 1);
    assert.equal(counters.negotiation, 1);
  } finally {
    await stopApplication(context);
  }
});
