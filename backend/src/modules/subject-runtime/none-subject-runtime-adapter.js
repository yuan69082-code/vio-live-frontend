import {
  SUBJECT_RUNTIME_ERROR_RULES,
  SUBJECT_RUNTIME_PORT_VERSION,
  createSubjectRuntimeConnectionSnapshot,
  negotiateSubjectRuntimeVersion,
  validateSubjectRuntimeAdapterManifest,
  validateSubjectRuntimeCancellationRequest,
  validateSubjectRuntimeObservationInput,
  validateSubjectRuntimeRecoveryRequest,
  validateSubjectRuntimeResult,
} from './subject-runtime-port-v1.js';

const NONE_ADAPTER_MANIFEST = Object.freeze({
  portVersion: SUBJECT_RUNTIME_PORT_VERSION,
  adapterId: 'none',
  adapterKind: 'none',
  adapterVersion: 'none-adapter/v1',
  runtimeMode: 'none',
  runtimeName: null,
  runtimeVersion: null,
  supportedPortVersions: Object.freeze([SUBJECT_RUNTIME_PORT_VERSION]),
  capabilities: Object.freeze([]),
  specializedContracts: Object.freeze([]),
});

function unavailableResult(request, completedAt) {
  const rule = SUBJECT_RUNTIME_ERROR_RULES.SUBJECT_RUNTIME_NOT_CONFIGURED;
  return validateSubjectRuntimeResult({
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    requestId: request.requestId,
    operationId: request.operationId,
    status: 'unavailable',
    expression: null,
    stateProjection: null,
    error: {
      code: 'SUBJECT_RUNTIME_NOT_CONFIGURED',
      message: rule.message,
      retryClass: rule.retryClass,
    },
    completedAt,
  });
}

export function noneSubjectRuntimeAdapterManifest() {
  return validateSubjectRuntimeAdapterManifest(NONE_ADAPTER_MANIFEST);
}

export function createNoneSubjectRuntimeAdapter({
  clock = () => new Date().toISOString(),
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
  const manifest = noneSubjectRuntimeAdapterManifest();
  const status = createSubjectRuntimeConnectionSnapshot({
    manifest,
    state: 'disconnected',
    reason: 'external_runtime_not_configured',
  });

  return Object.freeze({
    mode: 'none',
    externalCall: 'not_performed',
    getManifest() {
      return structuredClone(manifest);
    },
    getConnectionStatus() {
      return structuredClone(status);
    },
    negotiateVersion(vioSupportedVersions = [SUBJECT_RUNTIME_PORT_VERSION]) {
      return negotiateSubjectRuntimeVersion({
        vioSupportedVersions,
        adapterManifest: manifest,
      });
    },
    submitObservation(input) {
      const request = validateSubjectRuntimeObservationInput(input);
      return unavailableResult(request, clock());
    },
    cancel(input) {
      const request = validateSubjectRuntimeCancellationRequest(input);
      return unavailableResult(request, clock());
    },
    recover(input) {
      const request = validateSubjectRuntimeRecoveryRequest(input);
      return unavailableResult(request, clock());
    },
  });
}
