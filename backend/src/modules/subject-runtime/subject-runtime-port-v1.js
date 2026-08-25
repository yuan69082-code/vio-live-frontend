import { ValidationError } from '../../core/errors.js';

export const SUBJECT_RUNTIME_PORT_VERSION = 'vio-subject-runtime-port/v1';

export const SUBJECT_RUNTIME_MODES = Object.freeze([
  'none',
  'external',
]);

export const SUBJECT_RUNTIME_ADAPTER_KINDS = Object.freeze([
  'none',
  'continuity_engine',
  'third_party',
]);

export const SUBJECT_RUNTIME_CONNECTION_STATES = Object.freeze([
  'disconnected',
  'connecting',
  'ready',
  'degraded',
  'incompatible',
  'paused',
  'reconnecting',
]);

export const SUBJECT_RUNTIME_CAPABILITIES = Object.freeze([
  'observation_input',
  'expression_result',
  'state_projection',
  'cancellation',
  'recovery',
]);

export const SUBJECT_RUNTIME_OPERATIONS = Object.freeze([
  'submit_observation',
  'cancel_operation',
  'recover_operation',
]);

export const SUBJECT_RUNTIME_RESULT_STATUSES = Object.freeze([
  'completed',
  'failed',
  'unavailable',
  'cancelled',
  'timed_out',
  'recovery_required',
]);

export const SUBJECT_RUNTIME_ERROR_RULES = Object.freeze({
  SUBJECT_RUNTIME_NOT_CONFIGURED: Object.freeze({
    message: 'No external subject runtime is configured.',
    retryClass: 'never',
  }),
  SUBJECT_RUNTIME_UNAVAILABLE: Object.freeze({
    message: 'The external subject runtime is unavailable.',
    retryClass: 'after_reconnect',
  }),
  SUBJECT_RUNTIME_INCOMPATIBLE: Object.freeze({
    message: 'The external subject runtime is incompatible with this port version.',
    retryClass: 'never',
  }),
  SUBJECT_RUNTIME_TIMEOUT: Object.freeze({
    message: 'The subject runtime operation timed out.',
    retryClass: 'recover',
  }),
  SUBJECT_RUNTIME_CANCELLED: Object.freeze({
    message: 'The subject runtime operation was cancelled.',
    retryClass: 'never',
  }),
  SUBJECT_RUNTIME_RECOVERY_REQUIRED: Object.freeze({
    message: 'The subject runtime operation requires recovery.',
    retryClass: 'recover',
  }),
  SUBJECT_RUNTIME_INVALID_REQUEST: Object.freeze({
    message: 'The subject runtime request is invalid.',
    retryClass: 'never',
  }),
  SUBJECT_RUNTIME_INVALID_TRANSITION: Object.freeze({
    message: 'The subject runtime connection transition is invalid.',
    retryClass: 'never',
  }),
  SUBJECT_RUNTIME_CAPABILITY_UNSUPPORTED: Object.freeze({
    message: 'The subject runtime capability is not supported.',
    retryClass: 'never',
  }),
  SUBJECT_RUNTIME_PROTOCOL_ERROR: Object.freeze({
    message: 'The subject runtime response violates the negotiated contract.',
    retryClass: 'never',
  }),
});

export const SUBJECT_RUNTIME_ERROR_CODES = Object.freeze(
  Object.keys(SUBJECT_RUNTIME_ERROR_RULES),
);

export const VIO_CORE_RESPONSIBILITIES = Object.freeze([
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

export const OPTIONAL_SUBJECT_RUNTIME_RESPONSIBILITIES = Object.freeze([
  'subject_state',
  'subject_continuity',
  'subject_expression',
]);

export const SUBJECT_RUNTIME_PORT_COMPATIBILITY = Object.freeze([
  Object.freeze({
    vioPortVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterPortVersion: SUBJECT_RUNTIME_PORT_VERSION,
    result: 'compatible',
  }),
  Object.freeze({
    vioPortVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterPortVersion: 'vio-subject-runtime-port/v2',
    result: 'incompatible',
  }),
]);

const identifierPattern = /^[a-z][a-z0-9._-]{1,127}$/;
const contractVersionPattern = /^[a-z][a-z0-9._-]*(?:\/[a-z0-9._-]+)+$/;
const utcPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;
const MAX_STATE_PROJECTION_PAYLOAD_BYTES = 32_768;

function fail(path, message) {
  throw new ValidationError(`Subject Runtime Port v1 validation failed at ${path}: ${message}`, {
    path,
  });
}

function exactObject(value, path, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'must be a plain JSON object');
  }
  const allowed = new Set(fields);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (missing.length > 0 || unknown.length > 0) {
    fail(path, [
      missing.length > 0 ? `missing ${missing.join(', ')}` : null,
      unknown.length > 0 ? `unknown ${unknown.join(', ')}` : null,
    ].filter(Boolean).join('; '));
  }
  return value;
}

function text(value, path, { maxLength = 256, allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail(path, 'must be a string');
  if (!allowEmpty && value.trim().length === 0) fail(path, 'must not be empty');
  if ([...value].length > maxLength) fail(path, `must not exceed ${maxLength} characters`);
  return value;
}

function nullableText(value, path, options) {
  return value === null ? null : text(value, path, options);
}

function identifier(value, path) {
  const result = text(value, path, { maxLength: 128 });
  if (!identifierPattern.test(result)) fail(path, 'must be a stable opaque identifier');
  return result;
}

function portVersion(value, path) {
  const result = text(value, path, { maxLength: 128 });
  if (!contractVersionPattern.test(result)) fail(path, 'must be a versioned contract identifier');
  return result;
}

function oneOf(value, path, allowed) {
  if (!allowed.includes(value)) fail(path, `must be one of ${allowed.join(', ')}`);
  return value;
}

function daysFromCivil(year, month, day) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365
    + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100)
    + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function parseUtcTimestamp(value, path) {
  if (typeof value !== 'string') {
    fail(path, 'must be an RFC 3339 UTC timestamp ending in Z');
  }
  const match = utcPattern.exec(value);
  if (!match) fail(path, 'must be an RFC 3339 UTC timestamp ending in Z');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ''] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysByMonth[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    fail(path, 'must contain a real UTC calendar date and time');
  }
  const epochSecond = BigInt(daysFromCivil(year, month, day)) * 86_400n
    + BigInt(hour * 3_600 + minute * 60 + second);
  return { value, epochSecond, fraction };
}

function utcTimestamp(value, path) {
  parseUtcTimestamp(value, path);
  return value;
}

function deadlineMatchesTimeout(createdAt, deadlineAt, timeoutMs) {
  const created = parseUtcTimestamp(createdAt, '$.createdAt');
  const deadline = parseUtcTimestamp(deadlineAt, '$.timeout.deadlineAt');
  const precision = Math.max(3, created.fraction.length, deadline.fraction.length);
  const scale = 10n ** BigInt(precision);
  const millisecondScale = scale / 1_000n;
  const units = ({ epochSecond, fraction }) => (
    epochSecond * scale
    + BigInt((fraction || '0').padEnd(precision, '0'))
  );
  return units(deadline) - units(created) === BigInt(timeoutMs) * millisecondScale;
}

function jsonChildPath(path, key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function validateStrictJsonValue(value, path, ancestors) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'must be a finite JSON number');
    return;
  }
  if (typeof value !== 'object') {
    fail(path, 'must contain only JSON-compatible values');
  }
  if (ancestors.has(value)) fail(path, 'must not contain circular references');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const allowedKeys = new Set(['length']);
      for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${path}[${index}]`;
        if (!Object.hasOwn(value, index)) fail(itemPath, 'must not be a sparse array element');
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          fail(itemPath, 'must be an enumerable JSON array element');
        }
        allowedKeys.add(String(index));
        validateStrictJsonValue(descriptor.value, itemPath, ancestors);
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !allowedKeys.has(key)) {
          fail(path, 'must not contain non-JSON array properties');
        }
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(path, 'must be a plain JSON object');
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail(path, 'must not contain symbol properties');
      const childPath = jsonChildPath(path, key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail(childPath, 'must be an enumerable JSON data property');
      }
      validateStrictJsonValue(descriptor.value, childPath, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function validateStrictJsonObject(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be a plain JSON object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'must be a plain JSON object');
  }
  validateStrictJsonValue(value, path, new WeakSet());
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_PROJECTION_PAYLOAD_BYTES) {
    fail(path, `must not exceed ${MAX_STATE_PROJECTION_PAYLOAD_BYTES} bytes`);
  }
  return value;
}

function nonNegativeInteger(value, path, { minimum = 0, maximum } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(path, `must be a safe integer of at least ${minimum}`);
  }
  if (maximum !== undefined && value > maximum) {
    fail(path, `must not exceed ${maximum}`);
  }
  return value;
}

function uniqueStringArray(value, path, {
  allowed = null,
  maximum = 32,
  itemValidator = text,
} = {}) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  if (value.length > maximum) fail(path, `must not contain more than ${maximum} items`);
  const normalized = value.map((item, index) => itemValidator(item, `${path}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(path, 'must contain unique items');
  if (allowed && normalized.some((item) => !allowed.includes(item))) {
    fail(path, 'contains an unsupported value');
  }
  return normalized;
}

function validateIdentity(value, path = '$.identity') {
  const identity = exactObject(value, path, ['userId', 'assistantId', 'subjectId']);
  identifier(identity.userId, `${path}.userId`);
  identifier(identity.assistantId, `${path}.assistantId`);
  identifier(identity.subjectId, `${path}.subjectId`);
  return identity;
}

function validateSpecializedContract(value, path) {
  const contract = exactObject(value, path, [
    'contractId',
    'contractVersion',
    'scope',
    'status',
  ]);
  text(contract.contractId, `${path}.contractId`, { maxLength: 128 });
  text(contract.contractVersion, `${path}.contractVersion`, { maxLength: 128 });
  if (contract.scope !== 'adapter_only') fail(`${path}.scope`, 'must be adapter_only');
  oneOf(contract.status, `${path}.status`, ['existing', 'extension']);
  return contract;
}

export function validateSubjectRuntimeAdapterManifest(value) {
  const manifest = exactObject(value, '$', [
    'portVersion',
    'adapterId',
    'adapterKind',
    'adapterVersion',
    'runtimeMode',
    'runtimeName',
    'runtimeVersion',
    'supportedPortVersions',
    'capabilities',
    'specializedContracts',
  ]);
  if (manifest.portVersion !== SUBJECT_RUNTIME_PORT_VERSION) {
    fail('$.portVersion', `must be ${SUBJECT_RUNTIME_PORT_VERSION}`);
  }
  identifier(manifest.adapterId, '$.adapterId');
  oneOf(manifest.adapterKind, '$.adapterKind', SUBJECT_RUNTIME_ADAPTER_KINDS);
  text(manifest.adapterVersion, '$.adapterVersion', { maxLength: 128 });
  oneOf(manifest.runtimeMode, '$.runtimeMode', SUBJECT_RUNTIME_MODES);
  nullableText(manifest.runtimeName, '$.runtimeName', { maxLength: 128 });
  nullableText(manifest.runtimeVersion, '$.runtimeVersion', { maxLength: 128 });
  const supportedVersions = uniqueStringArray(
    manifest.supportedPortVersions,
    '$.supportedPortVersions',
    { maximum: 16, itemValidator: portVersion },
  );
  uniqueStringArray(manifest.capabilities, '$.capabilities', {
    allowed: SUBJECT_RUNTIME_CAPABILITIES,
    maximum: SUBJECT_RUNTIME_CAPABILITIES.length,
  });
  if (!Array.isArray(manifest.specializedContracts) || manifest.specializedContracts.length > 32) {
    fail('$.specializedContracts', 'must be an array with at most 32 items');
  }
  manifest.specializedContracts.forEach((item, index) => (
    validateSpecializedContract(item, `$.specializedContracts[${index}]`)
  ));

  if (manifest.adapterKind === 'none') {
    if (
      manifest.adapterId !== 'none'
      || manifest.runtimeMode !== 'none'
      || manifest.runtimeName !== null
      || manifest.runtimeVersion !== null
      || manifest.capabilities.length !== 0
      || manifest.specializedContracts.length !== 0
    ) {
      fail('$', 'None Adapter must not claim an external runtime, capabilities, or specialized contracts');
    }
  } else {
    if (manifest.runtimeMode !== 'external') {
      fail('$.runtimeMode', 'external adapters must use external mode');
    }
    if (manifest.runtimeName === null) {
      fail('$.runtimeName', 'external adapters must name their runtime');
    }
    if (!manifest.capabilities.includes('observation_input')) {
      fail('$.capabilities', 'external adapters must declare observation_input');
    }
    if (!manifest.capabilities.includes('expression_result')) {
      fail('$.capabilities', 'external adapters must declare expression_result');
    }
  }
  if (manifest.adapterKind === 'continuity_engine' && manifest.adapterId !== 'continuity-engine') {
    fail('$.adapterId', 'Continuity Engine adapter must use continuity-engine');
  }
  if (manifest.adapterKind === 'third_party' && ['none', 'continuity-engine'].includes(manifest.adapterId)) {
    fail('$.adapterId', 'third-party adapter identifiers must not use reserved identifiers');
  }
  if (supportedVersions.length === 0) fail('$.supportedPortVersions', 'must not be empty');
  return structuredClone(manifest);
}

export function negotiateSubjectRuntimeVersion(value) {
  const request = exactObject(value, '$', ['vioSupportedVersions', 'adapterManifest']);
  const vioSupportedVersions = uniqueStringArray(
    request.vioSupportedVersions,
    '$.vioSupportedVersions',
    { maximum: 16, itemValidator: portVersion },
  );
  if (vioSupportedVersions.length === 0) fail('$.vioSupportedVersions', 'must not be empty');
  const manifest = validateSubjectRuntimeAdapterManifest(request.adapterManifest);
  const selectedVersion = vioSupportedVersions.find((version) => (
    manifest.supportedPortVersions.includes(version)
  )) ?? null;
  return Object.freeze({
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId: manifest.adapterId,
    status: selectedVersion ? 'compatible' : 'incompatible',
    selectedVersion,
    reason: selectedVersion ? 'version_match' : 'no_common_port_version',
  });
}

export function validateSubjectRuntimeObservationInput(value) {
  const request = exactObject(value, '$', [
    'portVersion',
    'requestId',
    'operationId',
    'identity',
    'observation',
    'timeout',
    'createdAt',
  ]);
  if (request.portVersion !== SUBJECT_RUNTIME_PORT_VERSION) {
    fail('$.portVersion', `must be ${SUBJECT_RUNTIME_PORT_VERSION}`);
  }
  identifier(request.requestId, '$.requestId');
  identifier(request.operationId, '$.operationId');
  validateIdentity(request.identity);
  const observation = exactObject(request.observation, '$.observation', [
    'observationId',
    'observationType',
    'source',
    'occurredAt',
    'factRefs',
  ]);
  identifier(observation.observationId, '$.observation.observationId');
  text(observation.observationType, '$.observation.observationType', { maxLength: 128 });
  const source = exactObject(observation.source, '$.observation.source', [
    'system',
    'sourceType',
    'sourceId',
  ]);
  if (source.system !== 'vio') fail('$.observation.source.system', 'must be vio');
  text(source.sourceType, '$.observation.source.sourceType', { maxLength: 128 });
  identifier(source.sourceId, '$.observation.source.sourceId');
  utcTimestamp(observation.occurredAt, '$.observation.occurredAt');
  if (!Array.isArray(observation.factRefs) || observation.factRefs.length === 0) {
    fail('$.observation.factRefs', 'must contain at least one fact reference');
  }
  if (observation.factRefs.length > 64) fail('$.observation.factRefs', 'must not exceed 64 items');
  const factKeys = observation.factRefs.map((item, index) => {
    const fact = exactObject(item, `$.observation.factRefs[${index}]`, ['factType', 'factId']);
    text(fact.factType, `$.observation.factRefs[${index}].factType`, { maxLength: 128 });
    identifier(fact.factId, `$.observation.factRefs[${index}].factId`);
    return `${fact.factType}:${fact.factId}`;
  });
  if (new Set(factKeys).size !== factKeys.length) {
    fail('$.observation.factRefs', 'must contain unique references');
  }
  const timeout = exactObject(request.timeout, '$.timeout', ['timeoutMs', 'deadlineAt']);
  nonNegativeInteger(timeout.timeoutMs, '$.timeout.timeoutMs', {
    minimum: 1,
    maximum: 120_000,
  });
  utcTimestamp(request.createdAt, '$.createdAt');
  utcTimestamp(timeout.deadlineAt, '$.timeout.deadlineAt');
  if (!deadlineMatchesTimeout(request.createdAt, timeout.deadlineAt, timeout.timeoutMs)) {
    fail('$.timeout', 'deadlineAt must equal createdAt plus timeoutMs');
  }
  return structuredClone(request);
}

export function validateSubjectRuntimeCancellationRequest(value) {
  const request = exactObject(value, '$', [
    'portVersion',
    'requestId',
    'operationId',
    'cancellationId',
    'reason',
    'requestedAt',
  ]);
  if (request.portVersion !== SUBJECT_RUNTIME_PORT_VERSION) {
    fail('$.portVersion', `must be ${SUBJECT_RUNTIME_PORT_VERSION}`);
  }
  identifier(request.requestId, '$.requestId');
  identifier(request.operationId, '$.operationId');
  identifier(request.cancellationId, '$.cancellationId');
  text(request.reason, '$.reason', { maxLength: 512 });
  utcTimestamp(request.requestedAt, '$.requestedAt');
  return structuredClone(request);
}

export function validateSubjectRuntimeRecoveryRequest(value) {
  const request = exactObject(value, '$', [
    'portVersion',
    'requestId',
    'operationId',
    'recoveryId',
    'checkpointRef',
    'requestedAt',
  ]);
  if (request.portVersion !== SUBJECT_RUNTIME_PORT_VERSION) {
    fail('$.portVersion', `must be ${SUBJECT_RUNTIME_PORT_VERSION}`);
  }
  identifier(request.requestId, '$.requestId');
  identifier(request.operationId, '$.operationId');
  identifier(request.recoveryId, '$.recoveryId');
  nullableText(request.checkpointRef, '$.checkpointRef', { maxLength: 256 });
  utcTimestamp(request.requestedAt, '$.requestedAt');
  return structuredClone(request);
}

function validateProjection(value, expression, operationId) {
  if (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && !Object.hasOwn(value, 'payload')
  ) {
    fail('$.stateProjection.payload', 'is required');
  }
  const projection = exactObject(value, '$.stateProjection', [
    'projectionId',
    'subjectId',
    'runtimeId',
    'runtimeVersion',
    'sourceOperationId',
    'runtimeRevision',
    'schemaVersion',
    'payload',
    'capturedAt',
  ]);
  identifier(projection.projectionId, '$.stateProjection.projectionId');
  identifier(projection.subjectId, '$.stateProjection.subjectId');
  identifier(projection.runtimeId, '$.stateProjection.runtimeId');
  text(projection.runtimeVersion, '$.stateProjection.runtimeVersion', { maxLength: 128 });
  identifier(projection.sourceOperationId, '$.stateProjection.sourceOperationId');
  nullableText(projection.runtimeRevision, '$.stateProjection.runtimeRevision', {
    maxLength: 128,
  });
  text(projection.schemaVersion, '$.stateProjection.schemaVersion', { maxLength: 128 });
  validateStrictJsonObject(projection.payload, '$.stateProjection.payload');
  utcTimestamp(projection.capturedAt, '$.stateProjection.capturedAt');
  if (expression && projection.subjectId !== expression.subjectId) {
    fail('$.stateProjection.subjectId', 'must match expression.subjectId');
  }
  if (projection.sourceOperationId !== operationId) {
    fail('$.stateProjection.sourceOperationId', 'must match result operationId');
  }
  return projection;
}

function validateRuntimeError(value, status) {
  const error = exactObject(value, '$.error', ['code', 'message', 'retryClass']);
  if (!SUBJECT_RUNTIME_ERROR_CODES.includes(error.code)) {
    fail('$.error.code', 'is not a registered Subject Runtime Port error code');
  }
  const rule = SUBJECT_RUNTIME_ERROR_RULES[error.code];
  if (error.message !== rule.message) fail('$.error.message', `must be fixed for ${error.code}`);
  if (error.retryClass !== rule.retryClass) {
    fail('$.error.retryClass', `must be fixed for ${error.code}`);
  }
  const expectedCodes = {
    failed: [
      'SUBJECT_RUNTIME_INCOMPATIBLE',
      'SUBJECT_RUNTIME_INVALID_REQUEST',
      'SUBJECT_RUNTIME_INVALID_TRANSITION',
      'SUBJECT_RUNTIME_CAPABILITY_UNSUPPORTED',
      'SUBJECT_RUNTIME_PROTOCOL_ERROR',
    ],
    unavailable: ['SUBJECT_RUNTIME_NOT_CONFIGURED', 'SUBJECT_RUNTIME_UNAVAILABLE'],
    cancelled: ['SUBJECT_RUNTIME_CANCELLED'],
    timed_out: ['SUBJECT_RUNTIME_TIMEOUT'],
    recovery_required: ['SUBJECT_RUNTIME_RECOVERY_REQUIRED'],
  };
  if (expectedCodes[status] && !expectedCodes[status].includes(error.code)) {
    fail('$.error.code', `does not match status ${status}`);
  }
  return error;
}

export function validateSubjectRuntimeResult(value) {
  const result = exactObject(value, '$', [
    'portVersion',
    'requestId',
    'operationId',
    'status',
    'expression',
    'stateProjection',
    'error',
    'completedAt',
  ]);
  if (result.portVersion !== SUBJECT_RUNTIME_PORT_VERSION) {
    fail('$.portVersion', `must be ${SUBJECT_RUNTIME_PORT_VERSION}`);
  }
  identifier(result.requestId, '$.requestId');
  identifier(result.operationId, '$.operationId');
  oneOf(result.status, '$.status', SUBJECT_RUNTIME_RESULT_STATUSES);
  let expression = null;
  if (result.expression !== null) {
    expression = exactObject(result.expression, '$.expression', [
      'expressionId',
      'subjectId',
      'contentType',
      'content',
      'createdAt',
    ]);
    identifier(expression.expressionId, '$.expression.expressionId');
    identifier(expression.subjectId, '$.expression.subjectId');
    if (expression.contentType !== 'text/plain') {
      fail('$.expression.contentType', 'must be text/plain in v1');
    }
    text(expression.content, '$.expression.content', {
      maxLength: 65_536,
      allowEmpty: true,
    });
    utcTimestamp(expression.createdAt, '$.expression.createdAt');
  }
  if (result.stateProjection !== null) {
    validateProjection(result.stateProjection, expression, result.operationId);
  }
  utcTimestamp(result.completedAt, '$.completedAt');

  if (result.status === 'completed') {
    if (expression === null || result.error !== null) {
      fail('$', 'completed results require expression and null error');
    }
    if (new Date(expression.createdAt).getTime() > new Date(result.completedAt).getTime()) {
      fail('$.completedAt', 'must not precede expression.createdAt');
    }
    if (
      result.stateProjection !== null
      && new Date(result.stateProjection.capturedAt).getTime()
        > new Date(result.completedAt).getTime()
    ) {
      fail('$.completedAt', 'must not precede stateProjection.capturedAt');
    }
  } else {
    if (result.expression !== null || result.stateProjection !== null || result.error === null) {
      fail('$', 'non-completed results require null expression/projection and an error');
    }
    validateRuntimeError(result.error, result.status);
  }
  return structuredClone(result);
}

export function createSubjectRuntimeConnectionSnapshot({ manifest: input, state, reason = null }) {
  const manifest = validateSubjectRuntimeAdapterManifest(input);
  oneOf(state, '$.state', SUBJECT_RUNTIME_CONNECTION_STATES);
  nullableText(reason, '$.reason', { maxLength: 256 });
  const runtimeStatusByState = {
    disconnected: manifest.runtimeMode === 'none' ? 'not_configured' : 'disconnected',
    connecting: 'connecting',
    ready: 'available',
    degraded: 'degraded',
    incompatible: 'incompatible',
    paused: 'paused',
    reconnecting: 'connecting',
  };
  if (manifest.runtimeMode === 'none' && state !== 'disconnected') {
    fail('$.state', 'None Adapter must remain disconnected');
  }
  if (['ready', 'degraded'].includes(state) && manifest.runtimeVersion === null) {
    fail('$.runtimeVersion', `${state} external runtime status requires a runtime version`);
  }
  return Object.freeze({
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId: manifest.adapterId,
    runtimeMode: manifest.runtimeMode,
    state,
    runtimeName: manifest.runtimeName,
    runtimeVersion: manifest.runtimeVersion,
    capabilities: Object.freeze([...manifest.capabilities]),
    platformStatus: 'available',
    runtimeStatus: runtimeStatusByState[state],
    reason,
  });
}

export const SUBJECT_RUNTIME_ADAPTER_METHODS = Object.freeze([
  'getManifest',
  'getConnectionStatus',
  'negotiateVersion',
  'submitObservation',
  'cancel',
  'recover',
]);

export function requireSubjectRuntimeAdapter(adapter) {
  for (const method of SUBJECT_RUNTIME_ADAPTER_METHODS) {
    if (typeof adapter?.[method] !== 'function') {
      throw new TypeError(`Subject Runtime adapter must implement ${method}().`);
    }
  }
  return adapter;
}
