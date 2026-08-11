import { ConflictError, ValidationError } from '../../core/errors.js';
import {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_MODEL_OUTPUT_SCHEMA_ID,
  CAPABILITY_REQUEST_SCHEMA_ID,
  CAPABILITY_RESULT_RULES,
  CAPABILITY_RESULT_SCHEMA_ID,
} from './capability-contract.js';
import { canonicalizeJson, sha256Hash, verifyDeclaredHash } from './first-round-hashing.js';
import { CAPABILITY_SCHEMA_REGISTRY } from './capability-schema-registry.js';

function exactObject(value, fields, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${path} must be an object.`);
  }
  const expected = new Set(fields);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = Object.keys(value).filter((field) => !expected.has(field));
  if (missing.length || unknown.length) {
    throw new ValidationError(`${path} has invalid fields.`, { path, missing, unknown });
  }
  return value;
}

export function isStrictUtcDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}

export function validateCapabilityRequest(request) {
  CAPABILITY_SCHEMA_REGISTRY.validate(CAPABILITY_REQUEST_SCHEMA_ID, request);
  verifyDeclaredHash({
    declared: request.inputHash,
    calculated: sha256Hash(canonicalizeJson(request.input)),
    fieldName: 'inputHash',
  });
  if (Date.parse(request.deadlineAt) <= Date.parse(request.createdAt)) {
    throw new ValidationError('CapabilityRequest deadlineAt must be later than createdAt.');
  }
  return structuredClone(request);
}

export function validateCapabilityRequiredEnvelope(envelope, originalRequest) {
  exactObject(envelope, [
    'contractVersion', 'schemaVersion', 'status', 'requestId', 'requestHash',
    'operationId', 'subjectId', 'capabilityRequest', 'updatedAt',
  ], 'capability_required envelope');
  if (
    envelope.contractVersion !== CAPABILITY_CONTRACT_VERSION
    || envelope.schemaVersion !== 'continuity-capability-required/v1'
    || envelope.status !== 'capability_required'
  ) throw new ValidationError('Engine capability_required envelope version is unsupported.');
  if (!isStrictUtcDateTime(envelope.updatedAt)) {
    throw new ValidationError('capability_required updatedAt must be RFC 3339 UTC Z time.');
  }
  const capabilityRequest = validateCapabilityRequest(envelope.capabilityRequest);
  const identity = originalRequest.identity;
  const expected = {
    requestId: originalRequest.requestId,
    requestHash: originalRequest.requestHash,
    operationId: envelope.operationId,
    subjectId: identity.subjectId,
    bindingId: identity.bindingId,
    bindingVersion: identity.bindingVersion,
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    schemaVersion: 'continuity-capability-request/v1',
  };
  const actual = {
    requestId: capabilityRequest.requestId,
    requestHash: capabilityRequest.requestHash,
    operationId: capabilityRequest.operationId,
    subjectId: capabilityRequest.subjectId,
    bindingId: capabilityRequest.bindingId,
    bindingVersion: capabilityRequest.bindingVersion,
    contractVersion: capabilityRequest.contractVersion,
    schemaVersion: capabilityRequest.schemaVersion,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (actual[field] !== value) throw new ConflictError(`CapabilityRequest ${field} does not match the original interaction.`);
  }
  if (
    envelope.requestId !== expected.requestId
    || envelope.requestHash !== expected.requestHash
    || envelope.subjectId !== expected.subjectId
  ) throw new ConflictError('capability_required envelope does not match the original interaction.');
  const fact = originalRequest.platformFactPackage.facts[0];
  const observation = originalRequest.observations[0];
  if (
    capabilityRequest.input.messageFactId !== fact.factId
    || capabilityRequest.input.observationId !== observation.observationId
    || capabilityRequest.input.messageContent !== fact.content
    || capabilityRequest.input.sourceRevision !== originalRequest.expectedEngineRevision
  ) throw new ConflictError('CapabilityRequest input provenance does not match the immutable V1 request.');
  return structuredClone(envelope);
}

export function validateCapabilityResult(result, request) {
  CAPABILITY_SCHEMA_REGISTRY.validate(CAPABILITY_RESULT_SCHEMA_ID, result);
  if (
    result.capabilityRequestId !== request.capabilityRequestId
    || result.requestId !== request.requestId
    || result.requestHash !== request.requestHash
    || result.operationId !== request.operationId
    || result.subjectId !== request.subjectId
    || result.bindingId !== request.bindingId
    || result.bindingVersion !== request.bindingVersion
  ) throw new ConflictError('CapabilityResult identity does not match CapabilityRequest.');
  const rule = CAPABILITY_RESULT_RULES[result.status];
  if (!rule || result.retryClass !== rule.retryClass) {
    throw new ValidationError('CapabilityResult retryClass does not match status.');
  }
  if ((result.output !== null) !== rule.requiresOutput) {
    throw new ValidationError('CapabilityResult output does not match status.');
  }
  if (result.output) CAPABILITY_SCHEMA_REGISTRY.validate(CAPABILITY_MODEL_OUTPUT_SCHEMA_ID, result.output);
  verifyDeclaredHash({
    declared: result.contentHash,
    calculated: sha256Hash(canonicalizeJson(result.output)),
    fieldName: 'contentHash',
  });
  if (result.actualUsage.totalTokens !== result.actualUsage.inputTokens + result.actualUsage.outputTokens) {
    throw new ValidationError('CapabilityResult totalTokens must equal inputTokens plus outputTokens.');
  }
  if (
    Date.parse(result.startedAt) < Date.parse(request.createdAt)
    || Date.parse(result.completedAt) < Date.parse(result.startedAt)
  ) throw new ValidationError('CapabilityResult timestamps are out of order.');
  if (result.output && [...result.output.responseCandidate].length > request.input.maximumOutputCharacters) {
    throw new ValidationError('CapabilityResult output exceeds the requested character limit.');
  }
  return structuredClone(result);
}

export function calculateCapabilityResultHash(result) {
  return sha256Hash(canonicalizeJson(result));
}
