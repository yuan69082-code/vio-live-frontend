import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../src/core/errors.js';
import {
  CONTINUITY_ENGINE_ADAPTER_CONTRACT,
  defineThirdPartySubjectRuntimeAdapter,
} from '../src/modules/subject-runtime/subject-runtime-adapter-contracts.js';
import { subjectRuntimeContractExamples } from '../src/modules/subject-runtime/subject-runtime-contract-examples.js';
import { createNoneSubjectRuntimeAdapter } from '../src/modules/subject-runtime/none-subject-runtime-adapter.js';
import {
  OPTIONAL_SUBJECT_RUNTIME_RESPONSIBILITIES,
  SUBJECT_RUNTIME_ADAPTER_METHODS,
  SUBJECT_RUNTIME_CAPABILITIES,
  SUBJECT_RUNTIME_CONNECTION_STATES,
  SUBJECT_RUNTIME_ERROR_CODES,
  SUBJECT_RUNTIME_ERROR_RULES,
  SUBJECT_RUNTIME_MODES,
  SUBJECT_RUNTIME_OPERATIONS,
  SUBJECT_RUNTIME_PORT_COMPATIBILITY,
  SUBJECT_RUNTIME_PORT_VERSION,
  VIO_CORE_RESPONSIBILITIES,
  createSubjectRuntimeConnectionSnapshot,
  negotiateSubjectRuntimeVersion,
  requireSubjectRuntimeAdapter,
  validateSubjectRuntimeAdapterManifest,
  validateSubjectRuntimeCancellationRequest,
  validateSubjectRuntimeObservationInput,
  validateSubjectRuntimeRecoveryRequest,
  validateSubjectRuntimeResult,
} from '../src/modules/subject-runtime/subject-runtime-port-v1.js';
import {
  SUBJECT_RUNTIME_CONNECTION_EVENTS,
  SUBJECT_RUNTIME_CONNECTION_TRANSITIONS,
  canTransitionSubjectRuntimeConnection,
  transitionSubjectRuntimeConnection,
} from '../src/modules/subject-runtime/subject-runtime-state-machine.js';

const fixedNow = '2026-08-25T01:00:00Z';

function observationInput(overrides = {}) {
  return {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    requestId: 'request-contract-example',
    operationId: 'operation-contract-example',
    identity: {
      userId: 'example-user-runtime',
      assistantId: 'example-assistant-runtime',
      subjectId: 'example-subject-runtime',
    },
    observation: {
      observationId: 'observation-contract-example',
      observationType: 'message_created',
      source: {
        system: 'vio',
        sourceType: 'event',
        sourceId: 'event-contract-example',
      },
      occurredAt: '2026-08-25T00:00:00Z',
      factRefs: [
        { factType: 'message_version', factId: 'message-version-contract-example' },
      ],
    },
    timeout: {
      timeoutMs: 5_000,
      deadlineAt: '2026-08-25T00:00:05Z',
    },
    createdAt: '2026-08-25T00:00:00Z',
    ...overrides,
  };
}

function cancellationRequest(overrides = {}) {
  return {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    requestId: 'request-contract-example',
    operationId: 'operation-contract-example',
    cancellationId: 'cancellation-contract-example',
    reason: 'The caller cancelled the optional runtime operation.',
    requestedAt: '2026-08-25T00:00:01Z',
    ...overrides,
  };
}

function recoveryRequest(overrides = {}) {
  return {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    requestId: 'request-contract-example',
    operationId: 'operation-contract-example',
    recoveryId: 'recovery-contract-example',
    checkpointRef: 'checkpoint-contract-example',
    requestedAt: '2026-08-25T00:00:01Z',
    ...overrides,
  };
}

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

function completedRuntimeResult(payload) {
  const result = subjectRuntimeContractExamples().validExpressionResult;
  result.stateProjection.payload = arguments.length === 0
    ? { summary: 'Strict JSON projection.' }
    : payload;
  return result;
}

function assertContractValidationError(callback, expectedPath, messagePattern) {
  assert.throws(callback, (error) => (
    error instanceof ValidationError
    && error.details?.path === expectedPath
    && messagePattern.test(error.message)
  ));
}

test('R0-A freezes the exact Vio Core and optional subject runtime responsibility lists', () => {
  assert.deepEqual(VIO_CORE_RESPONSIBILITIES, [
    'accounts',
    'assistants',
    'conversations_and_messages',
    'models_and_providers',
    'mcp_skill_plugin_and_tool',
    'phones_and_devices',
    'local_memory',
    'context',
    'permissions_and_security',
    'workflows_and_life_data',
    'cost_export_backup_and_recovery',
  ]);
  assert.deepEqual(OPTIONAL_SUBJECT_RUNTIME_RESPONSIBILITIES, [
    'subject_state',
    'subject_continuity',
    'subject_expression',
  ]);
});

test('R0-A freezes mode, state, capability, operation, and error enumerations', () => {
  assert.equal(SUBJECT_RUNTIME_PORT_VERSION, 'vio-subject-runtime-port/v1');
  assert.deepEqual(SUBJECT_RUNTIME_MODES, ['none', 'external']);
  assert.deepEqual(SUBJECT_RUNTIME_CONNECTION_STATES, [
    'disconnected',
    'connecting',
    'ready',
    'degraded',
    'incompatible',
    'paused',
    'reconnecting',
  ]);
  assert.deepEqual(SUBJECT_RUNTIME_CAPABILITIES, [
    'observation_input',
    'expression_result',
    'state_projection',
    'cancellation',
    'recovery',
  ]);
  assert.deepEqual(SUBJECT_RUNTIME_OPERATIONS, [
    'submit_observation',
    'cancel_operation',
    'recover_operation',
  ]);
  assert.equal(SUBJECT_RUNTIME_ERROR_CODES.length, 10);
  assert.ok(SUBJECT_RUNTIME_ERROR_CODES.includes('SUBJECT_RUNTIME_NOT_CONFIGURED'));
  assert.ok(SUBJECT_RUNTIME_ERROR_CODES.includes('SUBJECT_RUNTIME_RECOVERY_REQUIRED'));
});

test('generic port vocabulary does not expose Continuity capability task names', () => {
  const genericVocabulary = [
    ...SUBJECT_RUNTIME_CAPABILITIES,
    ...SUBJECT_RUNTIME_OPERATIONS,
    ...VIO_CORE_RESPONSIBILITIES,
  ];
  assert.equal(genericVocabulary.includes('model.generate'), false);
  assert.equal(genericVocabulary.includes('conversation_response'), false);
  assert.equal(genericVocabulary.includes('CapabilityRequest'), false);
  assert.equal(genericVocabulary.includes('CapabilityResult'), false);
});

test('external adapter manifest is strict and machine-validatable', () => {
  assert.deepEqual(validateSubjectRuntimeAdapterManifest(externalManifest()), externalManifest());
  assert.throws(
    () => validateSubjectRuntimeAdapterManifest(externalManifest({ extra: true })),
    /unknown extra/,
  );
  assert.throws(
    () => validateSubjectRuntimeAdapterManifest(externalManifest({ capabilities: [] })),
    /observation_input/,
  );
  assert.throws(
    () => validateSubjectRuntimeAdapterManifest(externalManifest({ runtimeMode: 'none' })),
    /external adapters must use external mode/,
  );
});

test('third-party adapter entry uses the generic port without a Continuity contract dependency', () => {
  const manifest = defineThirdPartySubjectRuntimeAdapter({
    adapterId: 'third-party.custom-runtime',
    adapterVersion: 'custom-adapter/v1',
    runtimeName: 'Custom Subject Runtime',
    capabilities: ['observation_input', 'expression_result', 'recovery'],
    specializedContracts: [{
      contractId: 'custom-runtime-interaction',
      contractVersion: 'custom-runtime/v1',
      scope: 'adapter_only',
      status: 'extension',
    }],
  });
  assert.equal(manifest.adapterKind, 'third_party');
  assert.equal(manifest.runtimeMode, 'external');
  assert.equal(manifest.specializedContracts[0].scope, 'adapter_only');
});

test('reserved adapter identifiers cannot be claimed by third-party entries', () => {
  assert.throws(() => defineThirdPartySubjectRuntimeAdapter({
    adapterId: 'continuity-engine',
    adapterVersion: 'custom-adapter/v1',
    runtimeName: 'Imposter',
    capabilities: ['observation_input', 'expression_result'],
  }), /reserved identifiers/);
});

test('version negotiation selects the first common Vio preference', () => {
  const manifest = externalManifest({
    supportedPortVersions: ['vio-subject-runtime-port/v0', SUBJECT_RUNTIME_PORT_VERSION],
  });
  assert.deepEqual(negotiateSubjectRuntimeVersion({
    vioSupportedVersions: [SUBJECT_RUNTIME_PORT_VERSION, 'vio-subject-runtime-port/v0'],
    adapterManifest: manifest,
  }), {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId: 'third-party.example',
    status: 'compatible',
    selectedVersion: SUBJECT_RUNTIME_PORT_VERSION,
    reason: 'version_match',
  });
});

test('version negotiation reports incompatible without coercion', () => {
  const manifest = externalManifest({
    supportedPortVersions: ['vio-subject-runtime-port/v2'],
  });
  const result = negotiateSubjectRuntimeVersion({
    vioSupportedVersions: [SUBJECT_RUNTIME_PORT_VERSION],
    adapterManifest: manifest,
  });
  assert.equal(result.status, 'incompatible');
  assert.equal(result.selectedVersion, null);
  assert.equal(result.reason, 'no_common_port_version');
  assert.deepEqual(SUBJECT_RUNTIME_PORT_COMPATIBILITY.map((item) => item.result), [
    'compatible',
    'incompatible',
  ]);
});

test('observation input validates identity, source, fact references, and timeout exactly', () => {
  const input = observationInput();
  assert.deepEqual(validateSubjectRuntimeObservationInput(input), input);
  assert.throws(
    () => validateSubjectRuntimeObservationInput(observationInput({ engineRevision: 1 })),
    /unknown engineRevision/,
  );
  assert.throws(
    () => validateSubjectRuntimeObservationInput(observationInput({
      timeout: { timeoutMs: 5_000, deadlineAt: '2026-08-25T00:00:06Z' },
    })),
    /deadlineAt must equal createdAt plus timeoutMs/,
  );
});

test('observation input rejects duplicate facts and non-Vio source claims', () => {
  const duplicate = observationInput();
  duplicate.observation.factRefs.push({ ...duplicate.observation.factRefs[0] });
  assert.throws(() => validateSubjectRuntimeObservationInput(duplicate), /unique references/);
  const externalSource = observationInput();
  externalSource.observation.source.system = 'engine';
  assert.throws(() => validateSubjectRuntimeObservationInput(externalSource), /must be vio/);
});

test('cancellation and recovery contracts reject unknown fields', () => {
  assert.deepEqual(
    validateSubjectRuntimeCancellationRequest(cancellationRequest()),
    cancellationRequest(),
  );
  assert.deepEqual(validateSubjectRuntimeRecoveryRequest(recoveryRequest()), recoveryRequest());
  assert.throws(
    () => validateSubjectRuntimeCancellationRequest(cancellationRequest({ force: true })),
    /unknown force/,
  );
  assert.throws(
    () => validateSubjectRuntimeRecoveryRequest(recoveryRequest({ stateSnapshot: {} })),
    /unknown stateSnapshot/,
  );
});

test('completed expression and opaque external state projection validate without making Vio authoritative', () => {
  const result = subjectRuntimeContractExamples().validExpressionResult;
  assert.deepEqual(validateSubjectRuntimeResult(result), result);
  assert.equal(result.stateProjection.runtimeRevision, 'example-revision-a');
  assert.equal(Object.hasOwn(result.stateProjection, 'vioRevision'), false);
});

test('state projection payload must exist and be a plain JSON object', () => {
  const missing = completedRuntimeResult();
  delete missing.stateProjection.payload;
  assertContractValidationError(
    () => validateSubjectRuntimeResult(missing),
    '$.stateProjection.payload',
    /is required/,
  );
  for (const value of [undefined, null, [], 'text', 1, new Date('2026-08-25T00:00:00Z')]) {
    assertContractValidationError(
      () => validateSubjectRuntimeResult(completedRuntimeResult(value)),
      '$.stateProjection.payload',
      /plain JSON object/,
    );
  }
});

test('state projection payload rejects undefined properties at every nesting level', () => {
  const cases = [
    [{ illegal: undefined }, '$.stateProjection.payload.illegal'],
    [{ nested: { deeper: { illegal: undefined } } }, '$.stateProjection.payload.nested.deeper.illegal'],
    [{ items: ['legal', undefined] }, '$.stateProjection.payload.items[1]'],
  ];
  for (const [payload, path] of cases) {
    assertContractValidationError(
      () => validateSubjectRuntimeResult(completedRuntimeResult(payload)),
      path,
      /only JSON-compatible values/,
    );
  }
});

test('state projection payload rejects sparse arrays with the exact missing index path', () => {
  const sparse = [];
  sparse[1] = 'present';
  assertContractValidationError(
    () => validateSubjectRuntimeResult(completedRuntimeResult({ sparse })),
    '$.stateProjection.payload.sparse[0]',
    /sparse array element/,
  );
});

test('state projection payload rejects every non-finite number recursively', () => {
  for (const [key, value] of [['nan', NaN], ['positive', Infinity], ['negative', -Infinity]]) {
    assertContractValidationError(
      () => validateSubjectRuntimeResult(completedRuntimeResult({ [key]: value })),
      `$.stateProjection.payload.${key}`,
      /finite JSON number/,
    );
  }
});

test('state projection payload rejects non-JSON primitives and object implementations', () => {
  class CustomProjectionValue {}
  const cases = [
    ['bigint', 1n, /only JSON-compatible values/],
    ['functionValue', () => 'no', /only JSON-compatible values/],
    ['symbolValue', Symbol('no'), /only JSON-compatible values/],
    ['date', new Date('2026-08-25T00:00:00Z'), /plain JSON object/],
    ['map', new Map([['key', 'value']]), /plain JSON object/],
    ['set', new Set(['value']), /plain JSON object/],
    ['buffer', Buffer.from('value'), /plain JSON object/],
    ['instance', new CustomProjectionValue(), /plain JSON object/],
  ];
  for (const [key, value, pattern] of cases) {
    assertContractValidationError(
      () => validateSubjectRuntimeResult(completedRuntimeResult({ [key]: value })),
      `$.stateProjection.payload.${key}`,
      pattern,
    );
  }
});

test('state projection payload enforces the 32768 UTF-8 byte limit after strict validation', () => {
  assertContractValidationError(
    () => validateSubjectRuntimeResult(completedRuntimeResult({ text: '界'.repeat(11_000) })),
    '$.stateProjection.payload',
    /must not exceed 32768 bytes/,
  );
});

test('valid complex JSON payload is returned intact without mutating caller data', () => {
  const payload = {
    nullable: null,
    enabled: true,
    count: 42,
    fraction: 0.125,
    text: '合法 JSON 😀',
    nested: {
      items: [false, 0, 'value', null, { leaf: 'kept' }],
    },
  };
  const before = structuredClone(payload);
  const input = completedRuntimeResult(payload);
  const validated = validateSubjectRuntimeResult(input);
  assert.deepEqual(payload, before);
  assert.deepEqual(validated.stateProjection.payload, before);
  assert.notEqual(validated.stateProjection.payload, payload);
  assert.deepEqual(Object.keys(validated.stateProjection.payload), Object.keys(payload));
});

test('UTC timestamps reject normalized calendar dates and accept leap day and fractions', () => {
  for (const invalid of [
    '2026-02-30T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2025-02-29T00:00:00Z',
  ]) {
    const input = observationInput();
    input.observation.occurredAt = invalid;
    assertContractValidationError(
      () => validateSubjectRuntimeObservationInput(input),
      '$.observation.occurredAt',
      /real UTC calendar date and time/,
    );
  }

  const leapDay = observationInput();
  leapDay.observation.occurredAt = '2024-02-29T00:00:00Z';
  assert.deepEqual(validateSubjectRuntimeObservationInput(leapDay), leapDay);

  const fractional = observationInput({
    createdAt: '2024-02-29T00:00:00.125Z',
    timeout: { timeoutMs: 5_000, deadlineAt: '2024-02-29T00:00:05.125Z' },
  });
  fractional.observation.occurredAt = '2024-02-29T00:00:00.125Z';
  assert.deepEqual(validateSubjectRuntimeObservationInput(fractional), fractional);

  const mismatchedDeadline = structuredClone(fractional);
  mismatchedDeadline.timeout.deadlineAt = '2024-02-29T00:00:05.126Z';
  assertContractValidationError(
    () => validateSubjectRuntimeObservationInput(mismatchedDeadline),
    '$.timeout',
    /deadlineAt must equal createdAt plus timeoutMs/,
  );
});

test('non-completed results cannot smuggle expression or projection data', () => {
  const rule = SUBJECT_RUNTIME_ERROR_RULES.SUBJECT_RUNTIME_TIMEOUT;
  const result = {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    requestId: 'request-contract-example',
    operationId: 'operation-contract-example',
    status: 'timed_out',
    expression: null,
    stateProjection: null,
    error: {
      code: 'SUBJECT_RUNTIME_TIMEOUT',
      message: rule.message,
      retryClass: rule.retryClass,
    },
    completedAt: fixedNow,
  };
  assert.deepEqual(validateSubjectRuntimeResult(result), result);
  assert.throws(
    () => validateSubjectRuntimeResult({
      ...result,
      expression: subjectRuntimeContractExamples().validExpressionResult.expression,
    }),
    /non-completed results require null expression\/projection/,
  );
});

test('result error code, message, retry class, and status are a fixed combination', () => {
  const rule = SUBJECT_RUNTIME_ERROR_RULES.SUBJECT_RUNTIME_NOT_CONFIGURED;
  const result = {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    requestId: 'request-contract-example',
    operationId: 'operation-contract-example',
    status: 'unavailable',
    expression: null,
    stateProjection: null,
    error: {
      code: 'SUBJECT_RUNTIME_NOT_CONFIGURED',
      message: rule.message,
      retryClass: rule.retryClass,
    },
    completedAt: fixedNow,
  };
  assert.deepEqual(validateSubjectRuntimeResult(result), result);
  assert.throws(
    () => validateSubjectRuntimeResult({
      ...result,
      error: { ...result.error, retryClass: 'recover' },
    }),
    /must be fixed/,
  );
});

test('every non-completed status accepts only its registered error family', () => {
  const cases = [
    ['failed', 'SUBJECT_RUNTIME_PROTOCOL_ERROR'],
    ['unavailable', 'SUBJECT_RUNTIME_UNAVAILABLE'],
    ['cancelled', 'SUBJECT_RUNTIME_CANCELLED'],
    ['timed_out', 'SUBJECT_RUNTIME_TIMEOUT'],
    ['recovery_required', 'SUBJECT_RUNTIME_RECOVERY_REQUIRED'],
  ];
  for (const [status, code] of cases) {
    const rule = SUBJECT_RUNTIME_ERROR_RULES[code];
    assert.equal(validateSubjectRuntimeResult({
      portVersion: SUBJECT_RUNTIME_PORT_VERSION,
      requestId: 'request-contract-example',
      operationId: 'operation-contract-example',
      status,
      expression: null,
      stateProjection: null,
      error: { code, message: rule.message, retryClass: rule.retryClass },
      completedAt: fixedNow,
    }).status, status);
  }
  const wrongRule = SUBJECT_RUNTIME_ERROR_RULES.SUBJECT_RUNTIME_NOT_CONFIGURED;
  assert.throws(() => validateSubjectRuntimeResult({
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    requestId: 'request-contract-example',
    operationId: 'operation-contract-example',
    status: 'failed',
    expression: null,
    stateProjection: null,
    error: {
      code: 'SUBJECT_RUNTIME_NOT_CONFIGURED',
      message: wrongRule.message,
      retryClass: wrongRule.retryClass,
    },
    completedAt: fixedNow,
  }), /does not match status failed/);
});

test('published legal examples validate and illegal examples fail closed', () => {
  const examples = subjectRuntimeContractExamples();
  validateSubjectRuntimeObservationInput(examples.validObservationInput);
  validateSubjectRuntimeResult(examples.validExpressionResult);
  assert.throws(
    () => validateSubjectRuntimeObservationInput(examples.invalidObservationUnknownField),
    /unknown engineRevision/,
  );
  assert.throws(
    () => validateSubjectRuntimeObservationInput(examples.invalidObservationTimeout),
    /deadlineAt must equal/,
  );
  assert.throws(
    () => validateSubjectRuntimeResult(examples.invalidExpressionUnknownField),
    /unknown stateMutation/,
  );
});

test('every declared connection transition is accepted by the state machine', () => {
  assert.ok(SUBJECT_RUNTIME_CONNECTION_TRANSITIONS.length >= 20);
  for (const transition of SUBJECT_RUNTIME_CONNECTION_TRANSITIONS) {
    assert.equal(
      canTransitionSubjectRuntimeConnection(
        transition.from,
        transition.event,
        transition.to,
      ),
      true,
      JSON.stringify(transition),
    );
    assert.deepEqual(
      transitionSubjectRuntimeConnection({ from: transition.from, event: transition.event }),
      transition,
    );
  }
});

test('disconnect and reconnect use explicit states rather than pretending readiness', () => {
  const disconnected = transitionSubjectRuntimeConnection({
    from: 'ready',
    event: 'runtime_disconnected',
  });
  const reconnecting = transitionSubjectRuntimeConnection({
    from: disconnected.to,
    event: 'reconnect_requested',
  });
  const ready = transitionSubjectRuntimeConnection({
    from: reconnecting.to,
    event: 'reconnect_succeeded',
  });
  assert.deepEqual([disconnected.to, reconnecting.to, ready.to], [
    'disconnected',
    'reconnecting',
    'ready',
  ]);
});

test('invalid connection transitions and events fail closed', () => {
  assert.equal(canTransitionSubjectRuntimeConnection('ready', 'connect_requested', 'connecting'), false);
  assert.throws(
    () => transitionSubjectRuntimeConnection({ from: 'ready', event: 'connect_requested' }),
    /invalid from ready/,
  );
  assert.throws(
    () => transitionSubjectRuntimeConnection({ from: 'unknown', event: 'connect_requested' }),
    /not a Subject Runtime Port v1 connection state/,
  );
  assert.throws(
    () => transitionSubjectRuntimeConnection({ from: 'ready', event: 'unknown_event' }),
    /not a Subject Runtime Port v1 connection event/,
  );
  assert.ok(SUBJECT_RUNTIME_CONNECTION_EVENTS.includes('reconnect_requested'));
});

test('connection snapshots keep Vio available while optional runtime state varies', () => {
  for (const state of SUBJECT_RUNTIME_CONNECTION_STATES) {
    const snapshot = createSubjectRuntimeConnectionSnapshot({
      manifest: externalManifest(),
      state,
      reason: null,
    });
    assert.equal(snapshot.platformStatus, 'available');
    assert.equal(snapshot.state, state);
  }
});

test('None Adapter is a valid disconnected state with no runtime claims', () => {
  const adapter = createNoneSubjectRuntimeAdapter({ clock: () => fixedNow });
  const manifest = adapter.getManifest();
  const status = adapter.getConnectionStatus();
  assert.equal(adapter.mode, 'none');
  assert.equal(adapter.externalCall, 'not_performed');
  assert.equal(manifest.runtimeMode, 'none');
  assert.equal(manifest.runtimeName, null);
  assert.equal(manifest.runtimeVersion, null);
  assert.deepEqual(manifest.capabilities, []);
  assert.equal(status.state, 'disconnected');
  assert.equal(status.platformStatus, 'available');
  assert.equal(status.runtimeStatus, 'not_configured');
});

test('None Adapter returns a stable unavailable result without expression, projection, or revision', () => {
  const adapter = createNoneSubjectRuntimeAdapter({ clock: () => fixedNow });
  const first = adapter.submitObservation(observationInput());
  const second = adapter.submitObservation(observationInput());
  assert.deepEqual(first, second);
  assert.equal(first.status, 'unavailable');
  assert.equal(first.error.code, 'SUBJECT_RUNTIME_NOT_CONFIGURED');
  assert.equal(first.error.retryClass, 'never');
  assert.equal(first.expression, null);
  assert.equal(first.stateProjection, null);
  assert.equal(JSON.stringify(first).includes('revision'), false);
});

test('None Adapter cancellation and recovery are stable no-external-runtime results', () => {
  const adapter = createNoneSubjectRuntimeAdapter({ clock: () => fixedNow });
  const cancelled = adapter.cancel(cancellationRequest());
  const recovered = adapter.recover(recoveryRequest());
  for (const result of [cancelled, recovered]) {
    assert.equal(result.status, 'unavailable');
    assert.equal(result.error.code, 'SUBJECT_RUNTIME_NOT_CONFIGURED');
    assert.equal(result.expression, null);
    assert.equal(result.stateProjection, null);
  }
});

test('None Adapter still negotiates the Vio port implementation version locally', () => {
  const adapter = createNoneSubjectRuntimeAdapter();
  assert.deepEqual(adapter.negotiateVersion(), {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId: 'none',
    status: 'compatible',
    selectedVersion: SUBJECT_RUNTIME_PORT_VERSION,
    reason: 'version_match',
  });
});

test('adapter interface is explicit and rejects incomplete implementations', () => {
  assert.deepEqual(SUBJECT_RUNTIME_ADAPTER_METHODS, [
    'getManifest',
    'getConnectionStatus',
    'negotiateVersion',
    'submitObservation',
    'cancel',
    'recover',
  ]);
  const adapter = createNoneSubjectRuntimeAdapter();
  assert.equal(requireSubjectRuntimeAdapter(adapter), adapter);
  assert.throws(() => requireSubjectRuntimeAdapter({}), /must implement getManifest/);
});

test('Continuity contracts are registered as optional adapter-only contracts and not wired in R0-A', () => {
  assert.equal(CONTINUITY_ENGINE_ADAPTER_CONTRACT.adapterRole, 'optional');
  assert.equal(CONTINUITY_ENGINE_ADAPTER_CONTRACT.coreContract, false);
  assert.equal(
    CONTINUITY_ENGINE_ADAPTER_CONTRACT.portIntegrationStatus,
    'registered_not_wired',
  );
  assert.deepEqual(
    CONTINUITY_ENGINE_ADAPTER_CONTRACT.specializedContracts.map((item) => item.contractId),
    [
      'ContinuityInteractionRequest/FirstRoundSuccessResult',
      'CapabilityRequest',
      'CapabilityResult',
      'continuity-capability-envelope',
      'model.generate',
      'conversation_response',
    ],
  );
  assert.ok(CONTINUITY_ENGINE_ADAPTER_CONTRACT.specializedContracts.every((item) => (
    item.scope === 'adapter_only' && item.status === 'existing'
  )));
  assert.equal(
    CONTINUITY_ENGINE_ADAPTER_CONTRACT.specializedContracts[0].contractVersion,
    'continuity-integration/v1.1',
  );
  assert.ok(CONTINUITY_ENGINE_ADAPTER_CONTRACT.specializedContracts.slice(3).every((item) => (
    item.contractVersion === 'continuity-capability/v1'
  )));
});

test('R0-A contract validation is pure local code and never accepts transport dependencies', () => {
  const adapter = createNoneSubjectRuntimeAdapter({ clock: () => fixedNow });
  assert.equal(Object.hasOwn(adapter, 'transport'), false);
  assert.equal(Object.hasOwn(adapter, 'baseUrl'), false);
  assert.equal(Object.hasOwn(adapter, 'serviceToken'), false);
  assert.throws(
    () => validateSubjectRuntimeAdapterManifest(externalManifest({ networkClient: {} })),
    ValidationError,
  );
});
