import { ValidationError } from '../../core/errors.js';
import {
  SUBJECT_RUNTIME_PORT_VERSION,
  createSubjectRuntimeConnectionSnapshot,
  negotiateSubjectRuntimeVersion,
  requireSubjectRuntimeAdapter,
  validateSubjectRuntimeAdapterManifest,
} from './subject-runtime-port-v1.js';

const CONNECTION_SNAPSHOT_FIELDS = Object.freeze([
  'portVersion',
  'adapterId',
  'runtimeMode',
  'state',
  'runtimeName',
  'runtimeVersion',
  'capabilities',
  'platformStatus',
  'runtimeStatus',
  'reason',
]);

const VERSION_NEGOTIATION_FIELDS = Object.freeze([
  'portVersion',
  'adapterId',
  'status',
  'selectedVersion',
  'reason',
]);

function fail(path, message) {
  throw new ValidationError(`Subject Runtime status validation failed at ${path}: ${message}`, {
    path,
  });
}

function exactDataObject(value, path, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be a plain data object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'must be a plain data object');
  }
  const allowed = new Set(fields);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) {
    fail(path, 'must not contain symbol fields');
  }
  const unknown = ownKeys.filter((key) => !allowed.has(key));
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (missing.length > 0 || unknown.length > 0) {
    fail(path, [
      missing.length > 0 ? `missing ${missing.join(', ')}` : null,
      unknown.length > 0 ? `unknown ${unknown.join(', ')}` : null,
    ].filter(Boolean).join('; '));
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(`${path}.${key}`, 'must be an enumerable data field');
    }
  }
  return value;
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function validateConnectionSnapshot(value, manifest) {
  const snapshot = exactDataObject(
    value,
    '$.connectionSnapshot',
    CONNECTION_SNAPSHOT_FIELDS,
  );
  const expected = createSubjectRuntimeConnectionSnapshot({
    manifest,
    state: snapshot.state,
    reason: snapshot.reason,
  });
  for (const field of CONNECTION_SNAPSHOT_FIELDS) {
    if (field === 'capabilities') {
      if (!sameStringArray(snapshot.capabilities, expected.capabilities)) {
        fail('$.connectionSnapshot.capabilities', 'must match the validated Adapter Manifest');
      }
    } else if (snapshot[field] !== expected[field]) {
      fail(`$.connectionSnapshot.${field}`, 'must match the validated Adapter Manifest and state');
    }
  }
  return expected;
}

function validateVersionNegotiation(value, manifest, connectionSnapshot) {
  const negotiation = exactDataObject(
    value,
    '$.versionNegotiation',
    VERSION_NEGOTIATION_FIELDS,
  );
  const expected = negotiateSubjectRuntimeVersion({
    vioSupportedVersions: [SUBJECT_RUNTIME_PORT_VERSION],
    adapterManifest: manifest,
  });
  for (const field of VERSION_NEGOTIATION_FIELDS) {
    if (negotiation[field] !== expected[field]) {
      fail(`$.versionNegotiation.${field}`, 'must match local port version negotiation');
    }
  }
  if (
    (expected.status === 'incompatible') !== (connectionSnapshot.state === 'incompatible')
  ) {
    fail(
      '$.connectionSnapshot.state',
      'must be incompatible exactly when version negotiation is incompatible',
    );
  }
  return expected;
}

function snapshotAdapter(adapter) {
  try {
    requireSubjectRuntimeAdapter(adapter);
  } catch (error) {
    fail('$.adapter', error instanceof Error ? error.message : 'must implement the port');
  }
  const manifest = validateSubjectRuntimeAdapterManifest(adapter.getManifest());
  const connectionSnapshot = validateConnectionSnapshot(
    adapter.getConnectionStatus(),
    manifest,
  );
  const versionNegotiation = validateVersionNegotiation(
    adapter.negotiateVersion([SUBJECT_RUNTIME_PORT_VERSION]),
    manifest,
    connectionSnapshot,
  );
  return { manifest, connectionSnapshot, versionNegotiation };
}

export function createSubjectRuntimeStatusService({ adapter }) {
  const { manifest, connectionSnapshot, versionNegotiation } = snapshotAdapter(adapter);
  const status = Object.freeze({
    portVersion: connectionSnapshot.portVersion,
    mode: connectionSnapshot.runtimeMode,
    adapterId: manifest.adapterId,
    adapterKind: manifest.adapterKind,
    adapterVersion: manifest.adapterVersion,
    state: connectionSnapshot.state,
    platformStatus: connectionSnapshot.platformStatus,
    runtimeStatus: connectionSnapshot.runtimeStatus,
    runtimeName: connectionSnapshot.runtimeName,
    runtimeVersion: connectionSnapshot.runtimeVersion,
    capabilities: Object.freeze([...connectionSnapshot.capabilities]),
    reason: connectionSnapshot.reason,
    versionNegotiation: Object.freeze({ ...versionNegotiation }),
    externalCall: 'not_performed',
  });
  const healthSummary = Object.freeze({
    portVersion: status.portVersion,
    mode: status.mode,
    adapterId: status.adapterId,
    adapterKind: status.adapterKind,
    state: status.state,
    platformStatus: status.platformStatus,
    runtimeStatus: status.runtimeStatus,
    reason: status.reason,
    externalCall: status.externalCall,
  });

  return Object.freeze({
    getStatus() {
      return structuredClone(status);
    },
    getHealthSummary() {
      return structuredClone(healthSummary);
    },
  });
}
