import { isDeepStrictEqual } from 'node:util';

import { ValidationError } from '../../core/errors.js';
import { CONTRACT_VERSION } from './first-round-contract.js';
import {
  calculateProjectionContentHash,
  verifyDeclaredHash,
} from './first-round-hashing.js';
import {
  FIRST_ROUND_ERROR_CODES,
  FIRST_ROUND_ERROR_RULES,
  FIRST_ROUND_ERROR_STATUS,
  FIRST_ROUND_PROJECTION_SCHEMA_VERSION,
  FIRST_ROUND_SNAPSHOT_SCHEMA_VERSION,
  FIRST_ROUND_SUBJECT_ROLE,
  FIRST_ROUND_SUCCESS_STATUS,
} from './first-round-result-contract.js';

function fail(path, message) {
  throw new ValidationError(`Engine result validation failed at ${path}: ${message}`, {
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
  const expected = new Set(fields);
  const actual = Object.keys(value);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = actual.filter((field) => !expected.has(field));
  if (missing.length > 0 || unknown.length > 0) {
    fail(path, [
      missing.length > 0 ? `missing ${missing.join(', ')}` : null,
      unknown.length > 0 ? `unknown ${unknown.join(', ')}` : null,
    ].filter(Boolean).join('; '));
  }
  return value;
}

function text(value, path, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    fail(path, allowEmpty ? 'must be a string' : 'must be a non-empty string');
  }
  return value;
}

function integer(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(path, 'must be a non-negative safe integer');
  }
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function nullableText(value, path) {
  return value === null ? null : text(value, path);
}

function hash(value, path) {
  try {
    verifyDeclaredHash({ declared: value, calculated: value, fieldName: path });
  } catch {
    fail(path, 'must use sha256: followed by 64 lowercase hexadecimal digits');
  }
  return value;
}

function utcTimestamp(value, path) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
  ) {
    fail(path, 'must be an RFC 3339 UTC timestamp ending in uppercase Z');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(path, 'must be a valid UTC timestamp');
  return value;
}

function validateResponse(value) {
  const response = exactObject(value, '$.response', ['responseId', 'role', 'content']);
  text(response.responseId, '$.response.responseId');
  if (response.role !== FIRST_ROUND_SUBJECT_ROLE) {
    fail('$.response.role', `must be ${FIRST_ROUND_SUBJECT_ROLE}`);
  }
  text(response.content, '$.response.content', { allowEmpty: true });
}

function validateSnapshot(value) {
  const snapshot = exactObject(value, '$.stateProjection.snapshot', [
    'schemaVersion',
    'subjectId',
    'revision',
    'stateHash',
  ]);
  if (snapshot.schemaVersion !== FIRST_ROUND_SNAPSHOT_SCHEMA_VERSION) {
    fail('$.stateProjection.snapshot.schemaVersion', 'must be 1');
  }
  text(snapshot.subjectId, '$.stateProjection.snapshot.subjectId');
  integer(snapshot.revision, '$.stateProjection.snapshot.revision');
  hash(snapshot.stateHash, '$.stateProjection.snapshot.stateHash');
}

function validateProjection(value) {
  const projection = exactObject(value, '$.stateProjection', [
    'schemaVersion',
    'subjectId',
    'bindingId',
    'bindingVersion',
    'previousRevision',
    'currentRevision',
    'changed',
    'engineUpdateId',
    'snapshot',
    'contentHash',
  ]);
  if (projection.schemaVersion !== FIRST_ROUND_PROJECTION_SCHEMA_VERSION) {
    fail('$.stateProjection.schemaVersion', 'is unsupported');
  }
  text(projection.subjectId, '$.stateProjection.subjectId');
  text(projection.bindingId, '$.stateProjection.bindingId');
  if (projection.bindingVersion !== 1) {
    fail('$.stateProjection.bindingVersion', 'must be 1');
  }
  integer(projection.previousRevision, '$.stateProjection.previousRevision');
  integer(projection.currentRevision, '$.stateProjection.currentRevision');
  boolean(projection.changed, '$.stateProjection.changed');
  nullableText(projection.engineUpdateId, '$.stateProjection.engineUpdateId');
  validateSnapshot(projection.snapshot);
  hash(projection.contentHash, '$.stateProjection.contentHash');

  if (projection.snapshot.subjectId !== projection.subjectId) {
    fail('$.stateProjection.snapshot.subjectId', 'must match stateProjection.subjectId');
  }
  if (projection.snapshot.revision !== projection.currentRevision) {
    fail('$.stateProjection.snapshot.revision', 'must match currentRevision');
  }
  if (projection.changed) {
    if (projection.currentRevision !== projection.previousRevision + 1) {
      fail('$.stateProjection.currentRevision', 'changed projection must advance once');
    }
    if (projection.engineUpdateId === null) {
      fail('$.stateProjection.engineUpdateId', 'changed projection requires a value');
    }
  } else {
    if (projection.currentRevision !== projection.previousRevision) {
      fail('$.stateProjection.currentRevision', 'unchanged projection must retain revision');
    }
    if (projection.engineUpdateId !== null) {
      fail('$.stateProjection.engineUpdateId', 'unchanged projection requires null');
    }
  }
  let calculated;
  try {
    calculated = calculateProjectionContentHash(projection.snapshot);
    verifyDeclaredHash({
      declared: projection.contentHash,
      calculated,
      fieldName: 'stateProjection.contentHash',
    });
  } catch {
    fail('$.stateProjection.contentHash', 'does not match the minimal snapshot');
  }
}

export function validateFirstRoundSuccessResult(value) {
  const result = exactObject(value, '$', [
    'contractVersion',
    'requestId',
    'requestHash',
    'operationId',
    'status',
    'subjectId',
    'bindingId',
    'bindingVersion',
    'response',
    'stateProjection',
    'consumedObservationIds',
    'completedAt',
  ]);
  if (result.contractVersion !== CONTRACT_VERSION) fail('$.contractVersion', 'is unsupported');
  if (result.status !== FIRST_ROUND_SUCCESS_STATUS) fail('$.status', 'must be completed');
  text(result.requestId, '$.requestId');
  hash(result.requestHash, '$.requestHash');
  text(result.operationId, '$.operationId');
  text(result.subjectId, '$.subjectId');
  text(result.bindingId, '$.bindingId');
  if (result.bindingVersion !== 1) fail('$.bindingVersion', 'must be 1');
  validateResponse(result.response);
  validateProjection(result.stateProjection);
  if (!Array.isArray(result.consumedObservationIds) || result.consumedObservationIds.length !== 1) {
    fail('$.consumedObservationIds', 'must contain exactly one item');
  }
  text(result.consumedObservationIds[0], '$.consumedObservationIds[0]');
  utcTimestamp(result.completedAt, '$.completedAt');
  if (result.stateProjection.subjectId !== result.subjectId) {
    fail('$.stateProjection.subjectId', 'must match result subjectId');
  }
  if (result.stateProjection.bindingId !== result.bindingId) {
    fail('$.stateProjection.bindingId', 'must match result bindingId');
  }
  if (result.stateProjection.bindingVersion !== result.bindingVersion) {
    fail('$.stateProjection.bindingVersion', 'must match result bindingVersion');
  }
  return structuredClone(result);
}

export function validateFirstRoundErrorEnvelope(value) {
  const envelope = exactObject(value, '$', [
    'contractVersion',
    'requestId',
    'operationId',
    'status',
    'error',
  ]);
  if (envelope.contractVersion !== CONTRACT_VERSION) fail('$.contractVersion', 'is unsupported');
  text(envelope.requestId, '$.requestId');
  if (envelope.operationId !== null) fail('$.operationId', 'must be null');
  if (envelope.status !== FIRST_ROUND_ERROR_STATUS) {
    fail('$.status', 'must be failed_terminal');
  }
  const error = exactObject(envelope.error, '$.error', [
    'code',
    'message',
    'retryClass',
    'currentEngineRevision',
    'currentBindingVersion',
  ]);
  if (!FIRST_ROUND_ERROR_CODES.includes(error.code)) fail('$.error.code', 'is unsupported');
  const rule = FIRST_ROUND_ERROR_RULES[error.code];
  if (error.message !== rule.message) fail('$.error.message', `is fixed for ${error.code}`);
  if (error.retryClass !== rule.retryClass) {
    fail('$.error.retryClass', `is fixed for ${error.code}`);
  }
  if (error.code === 'REVISION_CONFLICT') {
    integer(error.currentEngineRevision, '$.error.currentEngineRevision');
  } else if (error.currentEngineRevision !== null) {
    fail('$.error.currentEngineRevision', `must be null for ${error.code}`);
  }
  if (error.currentBindingVersion !== null) {
    fail('$.error.currentBindingVersion', 'must be null in the first round');
  }
  return structuredClone(envelope);
}

export function validateFirstRoundEngineEnvelope(value) {
  if (value?.status === FIRST_ROUND_SUCCESS_STATUS) {
    return Object.freeze({
      type: 'success',
      envelope: validateFirstRoundSuccessResult(value),
    });
  }
  if (value?.status === FIRST_ROUND_ERROR_STATUS) {
    return Object.freeze({
      type: 'error',
      envelope: validateFirstRoundErrorEnvelope(value),
    });
  }
  fail('$.status', 'must be completed or failed_terminal');
}

export function projectionsHaveSameContent(left, right) {
  return isDeepStrictEqual(left.snapshot, right.snapshot)
    && left.contentHash === right.contentHash;
}
