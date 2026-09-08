import { ApplicationError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { canonicalizeJson, sha256Hash } from '../../core/canonical-json.js';
import { createId } from '../../core/ids.js';
import { fields, text, version as expectedVersion } from '../personal/personal-validation.js';

export const MEMORY_CONTRACT_VERSION = 'vio-local-memory/v1';
export const MEMORY_IMPORT_VERSION = 'vio-local-memory-import/v1';
export const MEMORY_EXPORT_VERSION = 'vio-local-memory-export/v1';
export const MEMORY_KINDS = Object.freeze([
  'preference', 'profile_fact', 'relationship', 'decision', 'project', 'routine', 'other',
]);
const HASH = /^sha256:[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const REF = /^[A-Za-z0-9._:-]{3,256}$/;
const STRATEGY = 'lexical-overlap-recency/v1';
const LIMITS = Object.freeze({ concise: 2, balanced: 6, complete: 12, custom: 6 });

const coded = (code, message, statusCode = 409, details) =>
  new ApplicationError(message, { code, statusCode, details });
const hash = value => sha256Hash(canonicalizeJson(value));

function requireKey(value) {
  if (typeof value !== 'string' || !KEY.test(value)) {
    throw new ValidationError('Invalid Idempotency-Key.', { field: 'Idempotency-Key' });
  }
  return value;
}

function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) throw coded('MEMORY_REQUEST_INVALID', `${field} is invalid.`, 400,
    { field, allowedValues: allowed });
  return value;
}

function optionalNullableText(value, field, max) {
  if (value === null) return null;
  return text(value, field, max);
}

function memoryBody(value) {
  const body = text(value, 'body', 8192);
  if (Buffer.byteLength(body, 'utf8') > 32768) {
    throw coded('MEMORY_REQUEST_INVALID', 'body exceeds the UTF-8 byte limit.', 400,
      { field: 'body', maxBytes: 32768 });
  }
  return body;
}

function utc(value, field, nullable = true) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') {
    throw coded('MEMORY_REQUEST_INVALID', `${field} must be RFC 3339 UTC.`, 400, { field });
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/u.exec(value);
  if (!match) throw coded('MEMORY_REQUEST_INVALID', `${field} must be RFC 3339 UTC.`, 400, { field });
  const parts = match.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31
      || parts[3] > 23 || parts[4] > 59 || parts[5] > 59
      || date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1
      || date.getUTCDate() !== parts[2] || date.getUTCHours() !== parts[3]
      || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) {
    throw coded('MEMORY_REQUEST_INVALID', `${field} is not a real UTC instant.`, 400, { field });
  }
  return value;
}

function normalizeSource(value, { allowImport = false } = {}) {
  fields(value, ['sourceType', 'sourceRef'], ['sourceType', 'sourceRef']);
  const allowed = allowImport ? ['manual', 'import', 'message_version', 'event']
    : ['manual', 'message_version', 'event'];
  const sourceType = enumValue(value.sourceType, allowed, 'source.sourceType');
  if (value.sourceRef === null) {
    if (sourceType !== 'manual') throw coded('MEMORY_REQUEST_INVALID',
      'Only manual sourceRef may be null.', 400, { field: 'source.sourceRef' });
    return { sourceType, sourceRef: null };
  }
  if (typeof value.sourceRef !== 'string' || !REF.test(value.sourceRef)) {
    throw coded('MEMORY_REQUEST_INVALID', 'source.sourceRef is invalid.', 400,
      { field: 'source.sourceRef' });
  }
  if (sourceType === 'message_version' && !value.sourceRef.startsWith('message-version:')) {
    throw coded('MEMORY_REQUEST_INVALID', 'Message sourceRef is invalid.', 400,
      { field: 'source.sourceRef' });
  }
  if (sourceType === 'event' && !value.sourceRef.startsWith('event:')) {
    throw coded('MEMORY_REQUEST_INVALID', 'Event sourceRef is invalid.', 400,
      { field: 'source.sourceRef' });
  }
  return { sourceType, sourceRef: value.sourceRef };
}

function normalizeMemoryInput(value, { edit = false, allowImport = false } = {}) {
  const allowed = ['kind', 'body', 'summary', 'occurredAt', 'includeInContext', 'sensitivity',
    'source', 'confirmationId', 'securitySessionId', ...(edit ? ['expectedVersion'] : [])];
  const required = ['kind', 'body', 'summary', 'occurredAt', 'includeInContext', 'sensitivity',
    'source', ...(edit ? ['expectedVersion'] : [])];
  fields(value, allowed, required);
  if (typeof value.includeInContext !== 'boolean') {
    throw coded('MEMORY_REQUEST_INVALID', 'includeInContext must be boolean.', 400,
      { field: 'includeInContext' });
  }
  const result = {
    kind: enumValue(value.kind, MEMORY_KINDS, 'kind'),
    body: memoryBody(value.body),
    summary: optionalNullableText(value.summary, 'summary', 512),
    occurredAt: utc(value.occurredAt, 'occurredAt'),
    includeInContext: value.includeInContext,
    sensitivity: enumValue(value.sensitivity, ['normal', 'sensitive'], 'sensitivity'),
    source: normalizeSource(value.source, { allowImport }),
    confirmationId: value.confirmationId === undefined || value.confirmationId === null
      ? null : text(value.confirmationId, 'confirmationId', 128),
    securitySessionId: value.securitySessionId === undefined || value.securitySessionId === null
      ? null : text(value.securitySessionId, 'securitySessionId', 128),
  };
  if (edit) result.expectedVersion = expectedVersion(value.expectedVersion);
  return result;
}

function operationView(item) {
  return Object.freeze({ operationId: item.operationId, operationType: item.operationType,
    status: item.status, resourceType: item.resourceType, resourceId: item.resourceId,
    errorCode: item.errorCode, createdAt: item.createdAt, completedAt: item.completedAt });
}

function versionView(item) {
  return Object.freeze({ memoryVersionId: item.memoryVersionId, memoryId: item.memoryId,
    version: item.version, kind: item.kind, body: item.body, summary: item.summary,
    source: Object.freeze({ sourceType: item.sourceType, sourceRef: item.sourceRef,
      sourceContentHash: item.sourceContentHash }), occurredAt: item.occurredAt,
    recordedAt: item.recordedAt, includeInContext: item.includeInContext,
    visibilityScope: item.visibilityScope, sensitivity: item.sensitivity,
    contentHash: item.contentHash, previousVersionId: item.previousVersionId,
    externalCall: 'not_performed' });
}

function deletionView(item) {
  return Object.freeze({ deletionId: item.deletionId, memoryId: item.memoryId,
    status: item.status, requestedAt: item.requestedAt, cancelledAt: item.cancelledAt,
    finalizedAt: item.finalizedAt, result: item.result, bodyRetained: item.bodyRetained });
}

function referenceView(item, fixed = null) {
  return Object.freeze({ referenceId: item.referenceId, memoryId: item.memoryId,
    memoryVersionId: item.memoryVersionId, sourceType: item.sourceType,
    conversationId: item.conversationId, messageId: item.messageId,
    messageVersionId: item.messageVersionId, eventId: item.eventId,
    sourceContentHash: item.sourceContentHash, status: fixed?.status ?? item.status,
    createdAt: item.createdAt, deletedAt: fixed ? fixed.deletedAt : item.deletedAt,
    externalCall: 'not_performed' });
}

function lexicalTerms(value) {
  const normalized = String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US');
  const terms = new Set();
  for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      const points = [...token];
      for (const point of points) terms.add(point);
      for (let index = 0; index + 1 < points.length; index += 1) {
        terms.add(points[index] + points[index + 1]);
      }
    } else if (token.length >= 2) terms.add(token);
    if (terms.size >= 256) break;
  }
  return terms;
}

function relevance(content, query) {
  const queryTerms = lexicalTerms(query);
  if (!queryTerms.size) return { score: 0, matchedTermCount: 0 };
  const contentTerms = lexicalTerms(content);
  let matchedTermCount = 0;
  for (const term of queryTerms) if (contentTerms.has(term)) matchedTermCount += 1;
  return { score: matchedTermCount * 1000, matchedTermCount };
}

export function createLocalMemoryService({ repository, personalIdentityService,
  permissionChecker, securityService, messageVersionRepository, eventRepository,
  multiConversationRepository, runInTransaction,
  clock = () => new Date(), idFactory = createId }) {
  const now = () => clock().toISOString();

  function scope(context) {
    personalIdentityService.assertSessionActive(context);
    const identity = personalIdentityService.identity(context.userId);
    if (!identity.current_assistant_id) throw coded('ASSISTANT_NOT_SELECTED',
      'Select an assistant first.', 409);
    const assistant = personalIdentityService.assistant(context.userId,
      identity.current_assistant_id);
    if (assistant.status !== 'active') throw coded('ASSISTANT_NOT_SELECTED',
      'Selected assistant is inactive.', 409);
    return { userId: context.userId, assistantId: assistant.assistantId,
      sessionId: context.sessionId };
  }

  function security(s, action, { confirmationId = null, securitySessionId = null,
    sensitive = false, destructive = false } = {}) {
    const access = securityService.checkSecurity(s.userId, {
      subjectId: s.assistantId, resourceType: 'memory', resourceId: 'local-memory',
      action, operationType: destructive ? 'data_deletion'
        : sensitive ? 'sensitive_data_access' : 'general_access',
      sensitiveDataCategories: sensitive ? ['private_record'] : [],
      ...(confirmationId ? { confirmationId } : {}),
      securitySessionId: securitySessionId ?? s.sessionId,
    }, { minimumRiskLevel: destructive || sensitive ? 'high' : 'low' });
    if (access.decision === 'deny') {
      throw coded('MEMORY_PERMISSION_DENIED', 'Memory operation is not permitted.', 403);
    }
    return access;
  }

  function challenge(access) {
    return Object.freeze({ contractVersion: MEMORY_CONTRACT_VERSION,
      operationStatus: 'confirmation_required',
      confirmation: Object.freeze({ confirmationId: access.confirmation.confirmationId,
        status: 'pending' }), externalCall: 'not_performed' });
  }

  function resolveSource(s, source, operationId, inputHash = null) {
    if (source.sourceType === 'manual') {
      return { sourceType: 'manual', sourceRef: source.sourceRef ?? `manual:${operationId}`,
        sourceContentHash: inputHash ?? hash({ operationId }), sourceConversationId: null,
        sourceMessageId: null, sourceMessageVersionId: null, sourceEventId: null };
    }
    if (source.sourceType === 'import') {
      return { sourceType: 'import', sourceRef: source.sourceRef,
        sourceContentHash: inputHash, sourceConversationId: null, sourceMessageId: null,
        sourceMessageVersionId: null, sourceEventId: null };
    }
    if (source.sourceType === 'message_version') {
      const memoryVersionId = source.sourceRef.slice('message-version:'.length);
      const resolved = repository.resolveMessageVersion(s.userId, s.assistantId, memoryVersionId);
      if (!resolved) throw coded('MEMORY_SOURCE_NOT_FOUND', 'Memory source was not found.', 404);
      return { sourceType: 'message_version', sourceRef: source.sourceRef,
        sourceContentHash: hash({ senderType: resolved.senderType, content: resolved.content,
          messageVersionId: resolved.messageVersionId }),
        sourceConversationId: resolved.conversationId, sourceMessageId: resolved.messageId,
        sourceMessageVersionId: resolved.messageVersionId, sourceEventId: null };
    }
    const eventId = source.sourceRef.slice('event:'.length);
    const event = eventRepository.findById(s.userId, eventId);
    if (!event || event.subjectId !== s.assistantId) {
      throw coded('MEMORY_SOURCE_NOT_FOUND', 'Memory source was not found.', 404);
    }
    return { sourceType: 'event', sourceRef: source.sourceRef,
      sourceContentHash: hash({ eventId: event.eventId, occurredAt: event.occurredAt,
        summary: event.summary, data: event.data, status: event.status }),
      sourceConversationId: null, sourceMessageId: null,
      sourceMessageVersionId: null, sourceEventId: event.eventId };
  }

  function sourceStillValid(s, item) {
    try {
      if (item.sourceType === 'manual' || item.sourceType === 'import') return true;
      const resolved = resolveSource(s, { sourceType: item.sourceType,
        sourceRef: item.sourceRef }, 'reauthorize');
      return resolved.sourceContentHash === item.sourceContentHash;
    } catch { return false; }
  }

  function referencesValid(s, memoryId) {
    return repository.listReferences(s.userId, s.assistantId, memoryId)
      .filter(item => item.status === 'active').every(item => {
        const sourceRef = item.sourceType === 'event' ? `event:${item.eventId}`
          : `message-version:${item.messageVersionId}`;
        return sourceStillValid(s, { sourceType: item.sourceType, sourceRef,
          sourceContentHash: item.sourceContentHash });
      });
  }

  function entry(s, memoryId, { requireReadable = true } = {}) {
    const value = repository.findMemory(s.userId, s.assistantId, memoryId);
    if (!value) throw coded('MEMORY_NOT_FOUND', 'Memory was not found.', 404);
    if (requireReadable && (!sourceStillValid(s, value.version)
        || !referencesValid(s, memoryId))) {
      throw coded('MEMORY_SOURCE_NOT_FOUND', 'Memory source is no longer readable.', 404);
    }
    return value;
  }

  function memoryView(value, { fixedStatus = null, fixedDeletion = undefined,
    fixedUpdatedAt = null } = {}) {
    const status = fixedStatus ?? value.memory.status;
    let deletion = fixedDeletion;
    if (deletion === undefined && value.memory.deletionId) {
      deletion = repository.findDeletion(value.memory.userId, value.memory.assistantId,
        value.memory.deletionId);
    }
    const pending = status === 'deletion_pending';
    return Object.freeze({ contractVersion: MEMORY_CONTRACT_VERSION,
      memoryId: value.memory.memoryId, assistantId: value.memory.assistantId,
      kind: value.version.kind, currentVersionId: value.version.memoryVersionId,
      version: value.version.version, body: value.version.body, summary: value.version.summary,
      source: Object.freeze({ sourceType: value.version.sourceType,
        sourceRef: value.version.sourceRef,
        sourceContentHash: value.version.sourceContentHash }),
      occurredAt: value.version.occurredAt, recordedAt: value.version.recordedAt,
      includeInContext: value.version.includeInContext,
      visibilityScope: value.version.visibilityScope,
      sensitivity: value.version.sensitivity, status,
      retention: Object.freeze({ deletionState: pending ? 'requested' : 'not_requested',
        deletionId: pending ? deletion?.deletionId ?? value.memory.deletionId : null,
        requestedAt: pending ? deletion?.requestedAt ?? null : null, finalizedAt: null }),
      updatedAt: fixedUpdatedAt ?? value.memory.updatedAt,
      externalCall: 'not_performed' });
  }

  function writeEnvelope(operation, { memory = null, reference = null,
    deletion = null, confirmation = null, operationStatus = 'completed' } = {}) {
    return Object.freeze({ contractVersion: MEMORY_CONTRACT_VERSION, operationStatus,
      operation: operationView(operation), memory, reference, deletion, confirmation,
      externalCall: 'not_performed' });
  }

  function completedResponse(s, operation) {
    if (operation.status === 'failed') return writeEnvelope(operation,
      { operationStatus: 'failed' });
    if (operation.status === 'confirmation_required') return writeEnvelope(operation, {
      operationStatus: 'confirmation_required', confirmation: Object.freeze({
        confirmationId: operation.confirmationId, status: 'pending',
      }),
    });
    if (operation.resourceType === 'memory') {
      const current = repository.findMemory(s.userId, s.assistantId, operation.resourceId);
      if (!current) throw coded('MEMORY_BODY_UNAVAILABLE',
        'Memory body was removed by finalized deletion.', 410);
      const lockedVersion = operation.resourceVersionId
        ? repository.findVersion(s.userId, s.assistantId, operation.resourceId,
          operation.resourceVersionId) : current.version;
      if (!lockedVersion) throw coded('MEMORY_BODY_UNAVAILABLE',
        'Memory body was removed by finalized deletion.', 410);
      const status = operation.operationType === 'memory.archive' ? 'archived'
        : operation.operationType === 'memory.restore' ? 'active' : 'active';
      return writeEnvelope(operation, { memory: memoryView({ memory: current.memory,
        version: lockedVersion }, { fixedStatus: status, fixedDeletion: null,
        fixedUpdatedAt: operation.completedAt }) });
    }
    if (operation.resourceType === 'reference') {
      const ref = repository.findReferenceById(s.userId, s.assistantId, operation.resourceId);
      if (!ref) throw coded('MEMORY_BODY_UNAVAILABLE', 'Memory reference was removed.', 410);
      const created = operation.operationType === 'memory.reference.create';
      return writeEnvelope(operation, { reference: referenceView(ref, created
        ? { status: 'active', deletedAt: null } : null) });
    }
    if (operation.resourceType === 'deletion') {
      const item = repository.findDeletion(s.userId, s.assistantId, operation.resourceId);
      if (!item) throw coded('MEMORY_NOT_FOUND', 'Memory deletion was not found.', 404);
      const current = repository.findMemory(s.userId, s.assistantId, item.memoryId);
      return writeEnvelope(operation, { deletion: deletionView(item),
        memory: current ? memoryView(current, { fixedDeletion: item,
          fixedUpdatedAt: operation.completedAt }) : null });
    }
    if (operation.resourceType === 'import') return importResponse(operation,
      repository.getImport(operation.resourceId));
    if (operation.resourceType === 'export') return exportResponse(s, operation,
      repository.getExport(operation.resourceId));
    throw coded('MEMORY_LEDGER_INCONSISTENT', 'Memory operation is inconsistent.', 500);
  }

  function begin(s, operationType, resourceType, keyValue, coreInput) {
    const idempotencyKey = requireKey(keyValue);
    const requestHash = hash(coreInput);
    let operation = repository.findOperation(s.userId, s.assistantId, idempotencyKey);
    if (operation) {
      if (operation.operationType !== operationType || operation.requestHash !== requestHash) {
        throw coded('IDEMPOTENCY_CONFLICT',
          'Idempotency-Key is bound to another memory operation.', 409);
      }
      return { operation, replay: true };
    }
    operation = repository.insertOperation({ operationId: idFactory(), userId: s.userId,
      assistantId: s.assistantId, idempotencyKey, operationType, resourceType,
      requestHash, createdAt: now() });
    return { operation, replay: false };
  }

  function authorizeWrite(s, state, accessInput, action, options) {
    if (state.operation.status === 'completed' || state.operation.status === 'failed') {
      return { response: completedResponse(s, state.operation) };
    }
    if (state.operation.status === 'confirmation_required') {
      if (!accessInput.confirmationId) return { response: completedResponse(s, state.operation) };
      if (accessInput.confirmationId !== state.operation.confirmationId) {
        throw coded('IDEMPOTENCY_CONFLICT', 'Confirmation does not belong to this operation.');
      }
      state.operation = repository.resumeOperation(state.operation.operationId);
    }
    const access = security(s, action, { ...options,
      confirmationId: accessInput.confirmationId,
      securitySessionId: accessInput.securitySessionId });
    if (access.decision === 'confirm') {
      state.operation = repository.setOperationConfirmation(state.operation.operationId,
        access.confirmation.confirmationId);
      return { response: writeEnvelope(state.operation, {
        operationStatus: 'confirmation_required', confirmation: Object.freeze({
          confirmationId: access.confirmation.confirmationId, status: 'pending',
        }),
      }) };
    }
    return { access };
  }

  function complete(operation, resourceId, resourceVersionId = null) {
    return repository.completeOperation({ operationId: operation.operationId,
      status: 'completed', resourceId, resourceVersionId, completedAt: now() });
  }

  function failOperation(state, error, fallbackCode) {
    if (state.operation.status === 'processing') {
      state.operation = repository.completeOperation({
        operationId: state.operation.operationId,
        status: 'failed',
        errorCode: error.code ?? fallbackCode,
        completedAt: now(),
      });
    }
    throw error;
  }

  function executeOperation(state, fallbackCode, work) {
    try {
      return work();
    } catch (error) {
      return failOperation(state, error, fallbackCode);
    }
  }

  function createVersionRecord(s, memoryId, number, input, operationId,
    previousVersionId = null, importHash = null) {
    const source = resolveSource(s, input.source, operationId, importHash);
    const recordedAt = now();
    const basis = { kind: input.kind, body: input.body, summary: input.summary,
      source: { sourceType: source.sourceType, sourceRef: source.sourceRef,
        sourceContentHash: source.sourceContentHash }, occurredAt: input.occurredAt,
      recordedAt, includeInContext: input.includeInContext,
      visibilityScope: 'current_assistant', sensitivity: input.sensitivity };
    return { memoryVersionId: idFactory(), memoryId, userId: s.userId,
      assistantId: s.assistantId, version: number, ...input, ...source,
      recordedAt, visibilityScope: 'current_assistant', contentHash: hash(basis),
      previousVersionId };
  }

  function readAccess(s, items, readContext = {}) {
    const sensitive = items.some(item => item.version?.sensitivity === 'sensitive'
      || item.sensitivity === 'sensitive');
    const access = security(s, 'read', { sensitive,
      confirmationId: readContext.confirmationId,
      securitySessionId: readContext.securitySessionId });
    return access.decision === 'confirm' ? challenge(access) : null;
  }

  function normalizeFilters(params = {}) {
    const query = params.query === undefined || params.query === null || params.query === ''
      ? null : text(params.query, 'query', 256);
    const kind = params.kind === undefined || params.kind === null || params.kind === ''
      ? null : enumValue(params.kind, MEMORY_KINDS, 'kind');
    const status = params.status === undefined || params.status === null || params.status === ''
      ? null : enumValue(params.status, ['active', 'archived', 'deletion_pending'], 'status');
    let includeInContext = null;
    if (params.includeInContext !== undefined && params.includeInContext !== null
        && params.includeInContext !== '') {
      if (!['true', 'false', true, false].includes(params.includeInContext)) {
        throw coded('MEMORY_REQUEST_INVALID', 'includeInContext filter is invalid.', 400);
      }
      includeInContext = params.includeInContext === true || params.includeInContext === 'true';
    }
    const limit = params.limit === undefined || params.limit === null || params.limit === ''
      ? 50 : Number(params.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw coded('MEMORY_REQUEST_INVALID', 'limit is invalid.', 400, { field: 'limit' });
    }
    return { query, kind, status, includeInContext, limit, order: 'relevance-recency-id/v1' };
  }

  function cursorEncode(payload) {
    const base = { ...payload, integrity: hash(payload) };
    return Buffer.from(JSON.stringify(base)).toString('base64url');
  }

  function cursorDecode(value, fingerprint) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      fields(parsed, ['fingerprint', 'highWater', 'after', 'integrity'],
        ['fingerprint', 'highWater', 'after', 'integrity']);
      const { integrity, ...payload } = parsed;
      if (integrity !== hash(payload) || parsed.fingerprint !== fingerprint
          || !Array.isArray(parsed.highWater) || parsed.highWater.length !== 2
          || !Array.isArray(parsed.after) || parsed.after.length !== 3
          || !Number.isSafeInteger(parsed.after[0]) || parsed.after[0] < 0
          || parsed.highWater.some(item => typeof item !== 'string')
          || parsed.after.slice(1).some(item => typeof item !== 'string')) throw new Error('bad');
      return parsed;
    } catch {
      throw coded('MEMORY_CURSOR_INVALID', 'Memory cursor is invalid.', 400);
    }
  }

  function sortRows(rows, query) {
    return rows.map(item => ({ ...item, relevance: relevance(
      `${item.version.kind}\n${item.version.summary ?? ''}\n${item.version.body}`, query) }))
      .sort((a, b) => query ? b.relevance.score - a.relevance.score
        || b.memory.updatedAt.localeCompare(a.memory.updatedAt)
        || b.memory.memoryId.localeCompare(a.memory.memoryId)
        : b.memory.updatedAt.localeCompare(a.memory.updatedAt)
        || b.memory.memoryId.localeCompare(a.memory.memoryId));
  }

  function importResponse(operation, value) {
    if (!value) throw coded('MEMORY_LEDGER_INCONSISTENT', 'Memory import is missing.', 500);
    return Object.freeze({ contractVersion: MEMORY_IMPORT_VERSION,
      operationStatus: 'completed', operation: operationView(operation),
      import: Object.freeze({ importId: value.importId, mode: value.mode,
        status: value.status, totalCount: value.totalCount, createdCount: value.createdCount,
        reusedCount: value.reusedCount, invalidCount: value.invalidCount,
        conflictCount: value.conflictCount,
        items: Object.freeze(value.items.map(item => Object.freeze({
          clientItemId: item.clientItemId, status: item.status,
          memoryId: item.memoryId, errorCode: item.errorCode,
        }))), createdAt: value.createdAt, completedAt: value.completedAt }),
      confirmation: null, externalCall: 'not_performed' });
  }

  function exportResponse(s, operation, value) {
    if (!value) throw coded('MEMORY_LEDGER_INCONSISTENT', 'Memory export is missing.', 500);
    const items = value.items.map(item => {
      const record = repository.findVersion(s.userId, s.assistantId,
        item.memoryId, item.memoryVersionId);
      const current = repository.findMemory(s.userId, s.assistantId, item.memoryId);
      if (!record || !current || record.contentHash !== item.contentHash
          || !sourceStillValid(s, record) || !referencesValid(s, item.memoryId)) {
        throw coded('MEMORY_BODY_UNAVAILABLE', 'Export body is no longer available.', 410);
      }
      return Object.freeze({ memoryId: record.memoryId,
        memoryVersionId: record.memoryVersionId, version: record.version,
        kind: record.kind, body: record.body, summary: record.summary,
        source: Object.freeze({ sourceType: record.sourceType, sourceRef: record.sourceRef,
          sourceContentHash: record.sourceContentHash }), occurredAt: record.occurredAt,
        recordedAt: record.recordedAt, includeInContext: record.includeInContext,
        visibilityScope: record.visibilityScope, sensitivity: record.sensitivity,
        contentHash: record.contentHash });
    });
    const document = { exportId: value.exportId, format: MEMORY_EXPORT_VERSION,
      status: 'completed', items, itemCount: items.length,
      contentHash: hash(items), createdAt: value.createdAt };
    if (hash(value.items) !== value.manifestHash || document.itemCount !== value.itemCount) {
      throw coded('MEMORY_LEDGER_INCONSISTENT', 'Memory export manifest is inconsistent.', 500);
    }
    return Object.freeze({ contractVersion: MEMORY_EXPORT_VERSION,
      operationStatus: 'completed', operation: operationView(operation),
      export: Object.freeze(document), confirmation: null,
      externalCall: 'not_performed' });
  }

  function sourceForReference(s, input) {
    if (input.sourceType === 'event') {
      if (input.conversationId !== null || input.messageId !== null
          || input.messageVersionId !== null || typeof input.eventId !== 'string') {
        throw coded('MEMORY_REQUEST_INVALID', 'Event reference fields are invalid.', 400);
      }
      const event = eventRepository.findById(s.userId, input.eventId);
      if (!event || event.subjectId !== s.assistantId) {
        throw coded('MEMORY_SOURCE_NOT_FOUND', 'Memory source was not found.', 404);
      }
      return { conversationId: null, messageId: null, messageVersionId: null,
        eventId: event.eventId, sourceContentHash: hash({ eventId: event.eventId,
          occurredAt: event.occurredAt, summary: event.summary, data: event.data,
          status: event.status }) };
    }
    if (typeof input.conversationId !== 'string' || typeof input.messageId !== 'string'
        || typeof input.messageVersionId !== 'string' || input.eventId !== null) {
      throw coded('MEMORY_REQUEST_INVALID', 'Message reference fields are invalid.', 400);
    }
    const item = messageVersionRepository.findById(s.userId, s.assistantId,
      input.conversationId, input.messageId, input.messageVersionId);
    const conversation = multiConversationRepository.findConversation(s.userId,
      s.assistantId, input.conversationId);
    if (!item || !conversation || conversation.status !== 'active') {
      throw coded('MEMORY_SOURCE_NOT_FOUND', 'Memory source was not found.', 404);
    }
    const visible = multiConversationRepository.listBranchMessages(s.userId, s.assistantId,
      input.conversationId, conversation.currentBranchId).some(message =>
      message.messageId === input.messageId
      && message.messageVersionId === input.messageVersionId);
    if (!visible) throw coded('MEMORY_SOURCE_NOT_FOUND', 'Memory source was not found.', 404);
    return { conversationId: input.conversationId, messageId: input.messageId,
      messageVersionId: input.messageVersionId, eventId: null,
      sourceContentHash: hash({ senderType: item.senderType, content: item.content,
        messageVersionId: item.messageVersionId }) };
  }

  const api = {
    initialize() { repository.failInterrupted(now()); },
    list(context, params = {}, readContext = {}) {
      const s = scope(context); const filters = normalizeFilters(params);
      const fingerprint = hash({ userId: s.userId, assistantId: s.assistantId, ...filters });
      const cursor = cursorDecode(params.cursor, fingerprint);
      let rows = repository.listMemories(s.userId, s.assistantId)
        .filter(item => filters.status ? item.memory.status === filters.status
          : item.memory.status !== 'deletion_pending')
        .filter(item => !filters.kind || item.version.kind === filters.kind)
        .filter(item => filters.includeInContext === null
          || item.version.includeInContext === filters.includeInContext)
        .filter(item => sourceStillValid(s, item.version)
          && referencesValid(s, item.memory.memoryId));
      const highWater = cursor?.highWater ?? rows.reduce((latest, item) => {
        const candidate = [item.memory.updatedAt, item.memory.memoryId];
        return candidate[0] > latest[0]
          || (candidate[0] === latest[0] && candidate[1] > latest[1]) ? candidate : latest;
      }, ['', '']);
      rows = rows.filter(item => item.memory.updatedAt < highWater[0]
        || (item.memory.updatedAt === highWater[0] && item.memory.memoryId <= highWater[1]));
      rows = sortRows(rows, filters.query);
      if (cursor) rows = rows.filter(item => item.relevance.score < cursor.after[0]
        || (item.relevance.score === cursor.after[0]
          && (item.memory.updatedAt < cursor.after[1]
            || (item.memory.updatedAt === cursor.after[1]
              && item.memory.memoryId < cursor.after[2]))));
      const page = rows.slice(0, filters.limit);
      const securityChallenge = readAccess(s, page, readContext);
      if (securityChallenge) return securityChallenge;
      const nextCursor = rows.length > filters.limit ? cursorEncode({ fingerprint, highWater,
        after: [page.at(-1).relevance.score, page.at(-1).memory.updatedAt,
          page.at(-1).memory.memoryId] }) : null;
      return Object.freeze({ contractVersion: MEMORY_CONTRACT_VERSION,
        items: Object.freeze(page.map(item => memoryView(item))), nextCursor,
        query: filters.query, selection: Object.freeze({ strategy: STRATEGY,
          scope: 'current_owner_current_assistant' }), externalCall: 'not_performed' });
    },
    get(context, memoryId, readContext = {}) {
      const s = scope(context); const value = entry(s, memoryId);
      return readAccess(s, [value], readContext) ?? memoryView(value);
    },
    versions(context, memoryId, readContext = {}) {
      const s = scope(context); const value = entry(s, memoryId);
      const challengeValue = readAccess(s, [value], readContext);
      if (challengeValue) return challengeValue;
      const items = repository.listVersions(s.userId, s.assistantId, value.memory.memoryId);
      if (items.some(item => !sourceStillValid(s, item)) || !referencesValid(s, memoryId)) {
        throw coded('MEMORY_SOURCE_NOT_FOUND', 'Memory source is no longer readable.', 404);
      }
      return Object.freeze({ contractVersion: MEMORY_CONTRACT_VERSION,
        memoryId: value.memory.memoryId, items: Object.freeze(items.map(versionView)),
        externalCall: 'not_performed' });
    },
    references(context, memoryId, readContext = {}) {
      const s = scope(context); const value = entry(s, memoryId);
      const challengeValue = readAccess(s, [value], readContext);
      if (challengeValue) return challengeValue;
      return Object.freeze({ contractVersion: MEMORY_CONTRACT_VERSION,
        memoryId: value.memory.memoryId,
        items: Object.freeze(repository.listReferences(s.userId, s.assistantId, memoryId)
          .map(referenceView)), externalCall: 'not_performed' });
    },
    create(context, value, idempotencyKey) {
      const s = scope(context); const input = normalizeMemoryInput(value);
      const { confirmationId, securitySessionId, ...core } = input;
      const state = begin(s, 'memory.create', 'memory', idempotencyKey, core);
      return executeOperation(state, 'MEMORY_WRITE_FAILED', () => {
        const auth = authorizeWrite(s, state, { confirmationId, securitySessionId }, 'write',
          { sensitive: true });
        if (auth.response) return auth.response;
        return (
        runInTransaction(() => {
          const memoryId = idFactory();
          const record = createVersionRecord(s, memoryId, 1, input,
            state.operation.operationId);
          const stored = repository.insertMemory({ memoryId, ...s,
            createdAt: record.recordedAt }, record);
          const operation = complete(state.operation, memoryId, record.memoryVersionId);
          return writeEnvelope(operation, { memory: memoryView(stored,
            { fixedUpdatedAt: operation.completedAt }) });
        }));
      });
    },
    edit(context, memoryId, value, idempotencyKey) {
      const s = scope(context); const id = text(memoryId, 'memoryId', 128);
      const input = normalizeMemoryInput(value, { edit: true });
      const { confirmationId, securitySessionId, ...core } = input;
      const state = begin(s, 'memory.edit', 'memory', idempotencyKey,
        { memoryId: id, ...core });
      return executeOperation(state, 'MEMORY_WRITE_FAILED', () => {
        const auth = authorizeWrite(s, state, { confirmationId, securitySessionId }, 'write',
          { sensitive: true });
        if (auth.response) return auth.response;
        const current = entry(s, id);
        if (current.memory.currentVersion !== input.expectedVersion) {
          throw coded('MEMORY_VERSION_CONFLICT', 'Memory version changed.', 409);
        }
        try {
          return runInTransaction(() => {
          const record = createVersionRecord(s, id, input.expectedVersion + 1, input,
            state.operation.operationId, current.version.memoryVersionId);
          const stored = repository.advanceVersion(record);
          const operation = complete(state.operation, id, record.memoryVersionId);
          return writeEnvelope(operation, { memory: memoryView(stored,
            { fixedUpdatedAt: operation.completedAt }) });
          });
        } catch (error) {
          if (error instanceof ConflictError) throw coded('MEMORY_VERSION_CONFLICT',
            'Memory version changed.', 409);
          throw error;
        }
      });
    },
    setContextInclusion(context, memoryId, value, idempotencyKey) {
      fields(value, ['includeInContext', 'expectedVersion', 'confirmationId',
        'securitySessionId'], ['includeInContext', 'expectedVersion']);
      if (typeof value.includeInContext !== 'boolean') throw coded('MEMORY_REQUEST_INVALID',
        'includeInContext must be boolean.', 400);
      const s = scope(context); const id = text(memoryId, 'memoryId', 128);
      const core = { memoryId: id, includeInContext: value.includeInContext,
        expectedVersion: expectedVersion(value.expectedVersion) };
      const state = begin(s, 'memory.context_inclusion', 'memory', idempotencyKey, core);
      if (state.replay && ['completed', 'failed'].includes(state.operation.status)) {
        return completedResponse(s, state.operation);
      }
      return executeOperation(state, 'MEMORY_WRITE_FAILED', () => {
        const current = entry(s, id);
        const edit = { kind: current.version.kind, body: current.version.body,
          summary: current.version.summary, occurredAt: current.version.occurredAt,
          includeInContext: value.includeInContext, sensitivity: current.version.sensitivity,
          source: { sourceType: current.version.sourceType,
            sourceRef: current.version.sourceRef }, expectedVersion: value.expectedVersion,
          confirmationId: value.confirmationId ?? null,
          securitySessionId: value.securitySessionId ?? null };
        const input = normalizeMemoryInput(edit, { edit: true, allowImport: true });
        const { confirmationId, securitySessionId } = input;
        const auth = authorizeWrite(s, state, { confirmationId, securitySessionId }, 'write',
          { sensitive: current.version.sensitivity === 'sensitive' });
        if (auth.response) return auth.response;
        return runInTransaction(() => {
          if (current.memory.currentVersion !== input.expectedVersion) {
            throw coded('MEMORY_VERSION_CONFLICT', 'Memory version changed.', 409);
          }
          const record = createVersionRecord(s, id, input.expectedVersion + 1, input,
            state.operation.operationId, current.version.memoryVersionId,
            current.version.sourceContentHash);
          const stored = repository.advanceVersion(record);
          const operation = complete(state.operation, id, record.memoryVersionId);
          return writeEnvelope(operation, { memory: memoryView(stored,
            { fixedUpdatedAt: operation.completedAt }) });
        });
      });
    },
    transition(context, memoryId, value, idempotencyKey, action) {
      fields(value, ['expectedVersion', 'confirmationId', 'securitySessionId'],
        ['expectedVersion']);
      const s = scope(context); const id = text(memoryId, 'memoryId', 128);
      const core = { memoryId: id, expectedVersion: expectedVersion(value.expectedVersion) };
      const state = begin(s, `memory.${action}`, 'memory', idempotencyKey, core);
      if (state.replay && ['completed', 'failed'].includes(state.operation.status)) {
        return completedResponse(s, state.operation);
      }
      return executeOperation(state, 'MEMORY_STATE_CONFLICT', () => {
        const current = entry(s, id);
        const auth = authorizeWrite(s, state, value, 'manage', {
          sensitive: current.version.sensitivity === 'sensitive' });
        if (auth.response) return auth.response;
        return runInTransaction(() => {
          const wanted = action === 'archive' ? 'archived' : 'active';
          if ((action === 'archive' && current.memory.status !== 'active')
              || (action === 'restore' && current.memory.status !== 'archived')) {
            throw coded('MEMORY_STATE_CONFLICT', 'Memory lifecycle transition is not allowed.');
          }
          const stored = repository.setStatus(s.userId, s.assistantId,
            id, core.expectedVersion, wanted, null, now());
          const operation = complete(state.operation, id, current.version.memoryVersionId);
          return writeEnvelope(operation, { memory: memoryView(stored,
            { fixedUpdatedAt: operation.completedAt }) });
        });
      });
    },
    createReference(context, memoryId, value, idempotencyKey) {
      fields(value, ['sourceType', 'conversationId', 'messageId', 'messageVersionId',
        'eventId', 'expectedVersion', 'confirmationId', 'securitySessionId'],
      ['sourceType', 'conversationId', 'messageId', 'messageVersionId', 'eventId',
        'expectedVersion']);
      const s = scope(context); const id = text(memoryId, 'memoryId', 128);
      const input = { sourceType: enumValue(value.sourceType, ['message_version', 'event'],
        'sourceType'), conversationId: value.conversationId, messageId: value.messageId,
      messageVersionId: value.messageVersionId, eventId: value.eventId,
      expectedVersion: expectedVersion(value.expectedVersion) };
      const state = begin(s, 'memory.reference.create', 'reference', idempotencyKey,
        { memoryId: id, ...input });
      if (state.replay && ['completed', 'failed'].includes(state.operation.status)) {
        return completedResponse(s, state.operation);
      }
      return executeOperation(state, 'MEMORY_REFERENCE_FAILED', () => {
        const current = entry(s, id);
        const auth = authorizeWrite(s, state, value, 'manage', { sensitive: true });
        if (auth.response) return auth.response;
        return runInTransaction(() => {
          if (current.memory.currentVersion !== input.expectedVersion) {
            throw coded('MEMORY_VERSION_CONFLICT', 'Memory version changed.');
          }
          const source = sourceForReference(s, input);
          const referenceId = idFactory();
          const stored = repository.insertReference({ referenceId, memoryId: id,
            memoryVersionId: current.version.memoryVersionId, ...s, sourceType: input.sourceType,
            ...source, createdAt: now() });
          const operation = complete(state.operation, referenceId);
          return writeEnvelope(operation, { reference: referenceView(stored) });
        });
      });
    },
    deleteReference(context, memoryId, referenceId, value, idempotencyKey) {
      fields(value, ['expectedVersion', 'confirmationId', 'securitySessionId'],
        ['expectedVersion']);
      const s = scope(context); const id = text(memoryId, 'memoryId', 128);
      const current = entry(s, id, { requireReadable: false });
      const refId = text(referenceId, 'referenceId', 128);
      const core = { memoryId: id, referenceId: refId,
        expectedVersion: expectedVersion(value.expectedVersion) };
      const state = begin(s, 'memory.reference.delete', 'reference', idempotencyKey, core);
      return executeOperation(state, 'MEMORY_REFERENCE_FAILED', () => {
        const auth = authorizeWrite(s, state, value, 'manage', { sensitive: true });
        if (auth.response) return auth.response;
        return runInTransaction(() => {
          if (current.memory.currentVersion !== core.expectedVersion) {
            throw coded('MEMORY_VERSION_CONFLICT', 'Memory version changed.');
          }
          const stored = repository.deleteReference(s.userId, s.assistantId, id, refId, now());
          const operation = complete(state.operation, refId);
          return writeEnvelope(operation, { reference: referenceView(stored) });
        });
      });
    },
    requestDeletion(context, memoryId, value, idempotencyKey) {
      fields(value, ['expectedVersion', 'confirmationId', 'securitySessionId'],
        ['expectedVersion']);
      const s = scope(context); const id = text(memoryId, 'memoryId', 128);
      const core = { memoryId: id, expectedVersion: expectedVersion(value.expectedVersion) };
      const state = begin(s, 'memory.deletion.request', 'deletion', idempotencyKey, core);
      if (state.replay && ['completed', 'failed'].includes(state.operation.status)) {
        return completedResponse(s, state.operation);
      }
      return executeOperation(state, 'MEMORY_DELETION_NOT_ALLOWED', () => {
        const current = entry(s, id);
        const auth = authorizeWrite(s, state, value, 'delete', { destructive: true });
        if (auth.response) return auth.response;
        if (current.memory.currentVersion !== core.expectedVersion
            || current.memory.status === 'deletion_pending') {
          throw coded('MEMORY_DELETION_NOT_ALLOWED', 'Memory deletion is not allowed.');
        }
        return runInTransaction(() => {
          const deletion = repository.insertDeletion({ deletionId: idFactory(), memoryId: id,
            ...s, requestedAt: now() });
          const stored = repository.setStatus(s.userId, s.assistantId, id,
            core.expectedVersion, 'deletion_pending', deletion.deletionId, now());
          const operation = complete(state.operation, deletion.deletionId);
          return writeEnvelope(operation, { deletion: deletionView(deletion),
            memory: memoryView(stored, { fixedDeletion: deletion,
              fixedUpdatedAt: operation.completedAt }) });
        });
      });
    },
    cancelDeletion(context, memoryId, value, idempotencyKey) {
      fields(value, ['deletionId'], ['deletionId']);
      const s = scope(context); const id = text(memoryId, 'memoryId', 128);
      const deletionId = text(value.deletionId, 'deletionId', 128);
      const state = begin(s, 'memory.deletion.cancel', 'deletion', idempotencyKey,
        { memoryId: id, deletionId });
      if (state.replay && ['completed', 'failed'].includes(state.operation.status)) {
        return completedResponse(s, state.operation);
      }
      return executeOperation(state, 'MEMORY_DELETION_NOT_ALLOWED', () => {
        const current = entry(s, id, { requireReadable: false });
        if (current.memory.deletionId !== deletionId) {
          throw coded('MEMORY_DELETION_NOT_ALLOWED', 'Memory deletion is not cancellable.');
        }
        return runInTransaction(() => {
          const deletion = repository.cancelDeletion({ deletionId, memoryId: id, ...s,
            cancelledAt: now() });
          const stored = repository.setStatus(s.userId, s.assistantId, id,
            current.memory.currentVersion, 'active', null, now());
          const operation = complete(state.operation, deletionId);
          return writeEnvelope(operation, { deletion: deletionView(deletion),
            memory: memoryView(stored, { fixedDeletion: null,
              fixedUpdatedAt: operation.completedAt }) });
        });
      });
    },
    finalizeDeletion(context, memoryId, value, idempotencyKey) {
      fields(value, ['deletionId', 'confirmationId', 'securitySessionId'], ['deletionId']);
      const s = scope(context); const id = text(memoryId, 'memoryId', 128);
      const deletionId = text(value.deletionId, 'deletionId', 128);
      const current = repository.findMemory(s.userId, s.assistantId, id);
      const existingDeletion = repository.findDeletion(s.userId, s.assistantId, deletionId);
      const state = begin(s, 'memory.deletion.finalize', 'deletion', idempotencyKey,
        { memoryId: id, deletionId });
      if (!current && existingDeletion?.status === 'completed') {
        const operation = state.operation.status === 'completed' ? state.operation
          : complete(state.operation, deletionId);
        return writeEnvelope(operation, { deletion: deletionView(existingDeletion) });
      }
      if (state.replay && ['completed', 'failed'].includes(state.operation.status)) {
        return completedResponse(s, state.operation);
      }
      return executeOperation(state, 'MEMORY_DELETION_NOT_ALLOWED', () => {
        if (!current || !existingDeletion || current.memory.deletionId !== deletionId
            || existingDeletion.status !== 'pending') {
          throw coded('MEMORY_DELETION_NOT_ALLOWED', 'Memory deletion is not finalizable.');
        }
        const auth = authorizeWrite(s, state, value, 'delete', { destructive: true });
        if (auth.response) return auth.response;
        return runInTransaction(() => {
          const deletion = repository.finalizeDeletion({ deletionId, memoryId: id, ...s,
            finalizedAt: now() });
          const operation = complete(state.operation, deletionId);
          return writeEnvelope(operation, { deletion: deletionView(deletion) });
        });
      });
    },
    deletion(context, deletionId) {
      const s = scope(context); const value = repository.findDeletion(s.userId,
        s.assistantId, text(deletionId, 'deletionId', 128));
      if (!value) throw coded('MEMORY_NOT_FOUND', 'Memory deletion was not found.', 404);
      return Object.freeze({ contractVersion: MEMORY_CONTRACT_VERSION,
        deletion: deletionView(value), externalCall: 'not_performed' });
    },
    createImport(context, value, idempotencyKey) {
      fields(value, ['contractVersion', 'mode', 'items', 'confirmationId',
        'securitySessionId'], ['contractVersion', 'mode', 'items']);
      if (value.contractVersion !== MEMORY_IMPORT_VERSION
          || !['atomic', 'best_effort'].includes(value.mode)
          || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100) {
        throw coded('MEMORY_IMPORT_INVALID', 'Memory import envelope is invalid.', 400);
      }
      const ids = value.items.map(item => item?.clientItemId);
      if (ids.some(id => typeof id !== 'string' || !KEY.test(id))
          || new Set(ids).size !== ids.length) {
        throw coded('MEMORY_IMPORT_INVALID', 'Memory import item IDs are invalid.', 400);
      }
      const normalized = value.items.map((item, index) => {
        try {
          fields(item, ['clientItemId', 'kind', 'body', 'summary', 'occurredAt',
            'includeInContext', 'sensitivity'], ['clientItemId', 'kind', 'body', 'summary',
            'occurredAt', 'includeInContext', 'sensitivity']);
          return { clientItemId: item.clientItemId, input: normalizeMemoryInput({
            kind: item.kind, body: item.body, summary: item.summary,
            occurredAt: item.occurredAt, includeInContext: item.includeInContext,
            sensitivity: item.sensitivity,
            source: { sourceType: 'import', sourceRef: `import-item:${item.clientItemId}` },
          }, { allowImport: true }), itemHash: hash(item), errorCode: null };
        } catch (error) {
          return { clientItemId: item.clientItemId, input: null,
            itemHash: hash({ clientItemId: item.clientItemId }),
            errorCode: error.code ?? 'MEMORY_IMPORT_INVALID', index };
        }
      });
      if (value.mode === 'atomic' && normalized.some(item => item.errorCode)) {
        throw coded('MEMORY_IMPORT_INVALID', 'Atomic memory import contains invalid items.', 400);
      }
      const s = scope(context); const core = { contractVersion: value.contractVersion,
        mode: value.mode, itemHashes: normalized.map(item => ({ clientItemId: item.clientItemId,
          itemHash: item.itemHash })) };
      const state = begin(s, 'memory.import', 'import', idempotencyKey, core);
      return executeOperation(state, 'MEMORY_IMPORT_INVALID', () => {
        const auth = authorizeWrite(s, state, value, 'write', { sensitive: true });
        if (auth.response) return Object.freeze({ contractVersion: MEMORY_IMPORT_VERSION,
          operationStatus: 'confirmation_required', operation: operationView(state.operation),
          import: null, confirmation: auth.response.confirmation,
          externalCall: 'not_performed' });
        return runInTransaction(() => {
          const reportItems = [];
          for (const item of normalized) {
            if (item.errorCode) {
              reportItems.push({ clientItemId: item.clientItemId, itemHash: item.itemHash,
                status: 'invalid', memoryId: null, errorCode: 'MEMORY_IMPORT_INVALID' });
              continue;
            }
            const old = repository.findImportedItem(s.userId, s.assistantId, item.clientItemId);
            if (old) {
              reportItems.push({ clientItemId: item.clientItemId, itemHash: item.itemHash,
                status: old.itemHash === item.itemHash ? 'reused' : 'conflict',
                memoryId: old.itemHash === item.itemHash ? old.memoryId : null,
                errorCode: old.itemHash === item.itemHash ? null : 'MEMORY_IMPORT_CONFLICT' });
              continue;
            }
            const memoryId = idFactory();
            const record = createVersionRecord(s, memoryId, 1, item.input,
              state.operation.operationId, null, item.itemHash);
            repository.insertMemory({ memoryId, ...s, createdAt: record.recordedAt }, record);
            reportItems.push({ clientItemId: item.clientItemId, itemHash: item.itemHash,
              status: 'created', memoryId, errorCode: null });
          }
          if (value.mode === 'atomic' && reportItems.some(item => item.status === 'conflict')) {
            throw coded('MEMORY_IMPORT_INVALID', 'Atomic memory import conflicts.', 409);
          }
          const importId = idFactory(); const completedAt = now();
          const counts = status => reportItems.filter(item => item.status === status).length;
          const record = { importId, operationId: state.operation.operationId, ...s,
            mode: value.mode, reportHash: hash(reportItems), totalCount: reportItems.length,
            createdCount: counts('created'), reusedCount: counts('reused'),
            invalidCount: counts('invalid'), conflictCount: counts('conflict'),
            createdAt: state.operation.createdAt, completedAt };
          repository.insertImport(record, reportItems);
          const operation = complete(state.operation, importId);
          return importResponse(operation, repository.getImport(importId));
        });
      });
    },
    createExport(context, value, idempotencyKey) {
      fields(value, ['contractVersion', 'memoryIds', 'includeArchived', 'confirmationId',
        'securitySessionId'], ['contractVersion', 'memoryIds', 'includeArchived']);
      if (value.contractVersion !== MEMORY_EXPORT_VERSION || !Array.isArray(value.memoryIds)
          || value.memoryIds.length > 100 || new Set(value.memoryIds).size !== value.memoryIds.length
          || value.memoryIds.some(id => typeof id !== 'string' || !REF.test(id))
          || typeof value.includeArchived !== 'boolean') {
        throw coded('MEMORY_EXPORT_INVALID', 'Memory export request is invalid.', 400);
      }
      const s = scope(context); const core = { contractVersion: value.contractVersion,
        memoryIds: value.memoryIds, includeArchived: value.includeArchived };
      const state = begin(s, 'memory.export', 'export', idempotencyKey, core);
      return executeOperation(state, 'MEMORY_EXPORT_INVALID', () => {
        const auth = authorizeWrite(s, state, value, 'export', { sensitive: true });
        if (auth.response) return Object.freeze({ contractVersion: MEMORY_EXPORT_VERSION,
          operationStatus: 'confirmation_required', operation: operationView(state.operation),
          export: null, confirmation: auth.response.confirmation,
          externalCall: 'not_performed' });
        let entries = repository.listMemories(s.userId, s.assistantId)
          .filter(item => item.memory.status === 'active'
            || (value.includeArchived && item.memory.status === 'archived'));
        if (value.memoryIds.length) {
          entries = value.memoryIds.map(id => entry(s, id))
            .filter(item => value.includeArchived || item.memory.status === 'active');
        }
        if (entries.length > 100 || entries.some(item => !sourceStillValid(s, item.version)
            || !referencesValid(s, item.memory.memoryId))) {
          throw coded('MEMORY_EXPORT_INVALID', 'Memory export scope is not readable.', 400);
        }
        return runInTransaction(() => {
          const exportId = idFactory(); const items = entries.map(item => ({
            memoryId: item.memory.memoryId, memoryVersionId: item.version.memoryVersionId,
            contentHash: item.version.contentHash }));
          repository.insertExport({ exportId, operationId: state.operation.operationId,
            ...s, includeArchived: value.includeArchived, manifestHash: hash(items),
            createdAt: now() }, items);
          const operation = complete(state.operation, exportId);
          return exportResponse(s, operation, repository.getExport(exportId));
        });
      });
    },
    operation(context, idempotencyKey) {
      const s = scope(context); const operation = repository.findOperation(s.userId,
        s.assistantId, requireKey(idempotencyKey));
      if (!operation) throw coded('MEMORY_NOT_FOUND', 'Memory operation was not found.', 404);
      return completedResponse(s, operation);
    },
    selectForContext({ userId, assistantId, query, mode = 'balanced' }) {
      const s = { userId, assistantId, sessionId: null };
      const candidates = repository.listMemories(userId, assistantId)
        .filter(item => item.memory.status === 'active' && item.version.includeInContext);
      const eligible = [];
      let unavailableCount = 0;
      if (candidates.length === 0) {
        return Object.freeze({ eligibleCount: 0, unavailableCount: 0,
          items: Object.freeze([]) });
      }
      const accessBySensitivity = new Map();
      for (const sensitivity of new Set(candidates.map(item => item.version.sensitivity))) {
        try {
          const sensitive = sensitivity === 'sensitive';
          const access = securityService.checkSecurity(userId, {
            subjectId: assistantId, resourceType: 'memory', resourceId: 'local-memory',
            action: 'read', operationType: sensitive ? 'sensitive_data_access' : 'general_access',
            sensitiveDataCategories: sensitive ? ['private_record'] : [],
          }, { minimumRiskLevel: sensitive ? 'high' : 'low' });
          accessBySensitivity.set(sensitivity, access.decision === 'allow');
        } catch { accessBySensitivity.set(sensitivity, false); }
      }
      for (const item of candidates) {
        if (!accessBySensitivity.get(item.version.sensitivity)
            || !sourceStillValid(s, item.version)
            || !referencesValid(s, item.memory.memoryId)) unavailableCount += 1;
        else eligible.push(item);
      }
      const chosen = sortRows(eligible, query).slice(0, LIMITS[mode] ?? LIMITS.balanced);
      return Object.freeze({ eligibleCount: eligible.length,
        unavailableCount, items: Object.freeze(chosen.map((item, index) => Object.freeze({
          memoryId: item.memory.memoryId, memoryVersionId: item.version.memoryVersionId,
          kind: item.version.kind, body: item.version.body, summary: item.version.summary,
          sourceType: item.version.sourceType, sourceRef: item.version.sourceRef,
          sourceContentHash: item.version.sourceContentHash,
          memoryContentHash: item.version.contentHash,
          occurredAt: item.version.occurredAt, recordedAt: item.version.recordedAt,
          relevanceScore: relevance(`${item.version.kind}\n${item.version.summary ?? ''}\n${item.version.body}`, query).score,
          matchedTermCount: relevance(`${item.version.kind}\n${item.version.summary ?? ''}\n${item.version.body}`, query).matchedTermCount,
          rank: index + 1,
        }))) });
    },
    canReadContextVersion({ userId, assistantId, memoryId, memoryVersionId,
      memoryContentHash, sourceContentHash }) {
      const s = { userId, assistantId, sessionId: null };
      const current = repository.findMemory(userId, assistantId, memoryId);
      const item = repository.findVersion(userId, assistantId, memoryId, memoryVersionId);
      if (!current || current.memory.status !== 'active' || !item
          || item.contentHash !== memoryContentHash
          || item.sourceContentHash !== sourceContentHash
          || !sourceStillValid(s, item) || !referencesValid(s, memoryId)) return null;
      const permission = permissionChecker.checkPermission(userId, { subjectId: assistantId,
        resourceType: 'memory', resourceId: 'local-memory', action: 'read' },
      { consumeAllowOnce: false });
      if (permission.decision !== 'allow') return null;
      try {
        const sensitive = item.sensitivity === 'sensitive';
        const access = securityService.checkSecurity(userId, {
          subjectId: assistantId, resourceType: 'memory', resourceId: 'local-memory',
          action: 'read', operationType: sensitive ? 'sensitive_data_access' : 'general_access',
          sensitiveDataCategories: sensitive ? ['private_record'] : [],
        }, { minimumRiskLevel: sensitive ? 'high' : 'low' });
        return access.decision === 'allow' ? item : null;
      } catch { return null; }
    },
  };
  return Object.freeze(api);
}
