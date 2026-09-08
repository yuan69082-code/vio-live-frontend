import { ApiClientError } from './client'
import type { PersonalApi, PersonalRequestOptions } from './personal-api'

export const MEMORY_CONTRACT_VERSION = 'vio-local-memory/v1' as const
export const MEMORY_IMPORT_VERSION = 'vio-local-memory-import/v1' as const
export const MEMORY_EXPORT_VERSION = 'vio-local-memory-export/v1' as const

export type MemoryKind = 'preference' | 'profile_fact' | 'relationship' | 'decision' | 'project' | 'routine' | 'other'
export type MemorySensitivity = 'normal' | 'sensitive'
export type MemoryStatus = 'active' | 'archived' | 'deletion_pending'
export type MemorySourceType = 'manual' | 'import' | 'message_version' | 'event'
export type MemorySource = { sourceType: MemorySourceType; sourceRef: string; sourceContentHash: string }
export type Memory = {
  contractVersion: typeof MEMORY_CONTRACT_VERSION
  memoryId: string
  assistantId: string
  kind: MemoryKind
  currentVersionId: string
  version: number
  body: string
  summary: string | null
  source: MemorySource
  occurredAt: string | null
  recordedAt: string
  includeInContext: boolean
  visibilityScope: 'current_assistant'
  sensitivity: MemorySensitivity
  status: MemoryStatus
  retention: { deletionState: 'not_requested' | 'requested'; deletionId: string | null; requestedAt: string | null; finalizedAt: null }
  updatedAt: string
  externalCall: 'not_performed'
}
export type MemoryVersion = {
  memoryVersionId: string; memoryId: string; version: number; kind: MemoryKind; body: string; summary: string | null
  source: MemorySource; occurredAt: string | null; recordedAt: string; includeInContext: boolean
  visibilityScope: 'current_assistant'; sensitivity: MemorySensitivity; contentHash: string
  previousVersionId: string | null; externalCall: 'not_performed'
}
export type MemoryReference = {
  referenceId: string; memoryId: string; memoryVersionId: string; sourceType: 'message_version' | 'event'
  conversationId: string | null; messageId: string | null; messageVersionId: string | null; eventId: string | null
  sourceContentHash: string; status: 'active' | 'deleted'; createdAt: string; deletedAt: string | null; externalCall: 'not_performed'
}
export type MemoryDeletion = {
  deletionId: string; memoryId: string; status: 'pending' | 'cancelled' | 'completed' | 'failed'
  requestedAt: string; cancelledAt: string | null; finalizedAt: string | null
  result: 'pending' | 'cancelled' | 'deleted' | 'failed'; bodyRetained: boolean
}
export type MemoryOperationType =
  | 'memory.create' | 'memory.edit' | 'memory.context_inclusion' | 'memory.archive' | 'memory.restore'
  | 'memory.reference.create' | 'memory.reference.delete' | 'memory.deletion.request' | 'memory.deletion.cancel'
  | 'memory.deletion.finalize' | 'memory.import' | 'memory.export'
export type MemoryOperation = {
  operationId: string; operationType: MemoryOperationType; status: 'processing' | 'confirmation_required' | 'completed' | 'failed'
  resourceType: 'memory' | 'reference' | 'deletion' | 'import' | 'export'; resourceId: string | null
  errorCode: string | null; createdAt: string; completedAt: string | null
}
export type MemoryConfirmation = { confirmationId: string; status: 'pending' }
export type MemoryWriteResult = {
  contractVersion: typeof MEMORY_CONTRACT_VERSION
  operationStatus: 'completed' | 'confirmation_required' | 'failed'
  operation: MemoryOperation
  memory: Memory | null
  reference: MemoryReference | null
  deletion: MemoryDeletion | null
  confirmation: MemoryConfirmation | null
  externalCall: 'not_performed'
}
export type MemoryReadChallenge = {
  contractVersion: typeof MEMORY_CONTRACT_VERSION; operationStatus: 'confirmation_required'
  confirmation: MemoryConfirmation; externalCall: 'not_performed'
}
export type MemoryList = {
  contractVersion: typeof MEMORY_CONTRACT_VERSION; items: Memory[]; nextCursor: string | null; query: string | null
  selection: { strategy: 'lexical-overlap-recency/v1'; scope: 'current_owner_current_assistant' }
  externalCall: 'not_performed'
}
export type MemoryImportItemInput = {
  clientItemId: string; kind: unknown; body: unknown; summary: unknown; occurredAt: unknown
  includeInContext: unknown; sensitivity: unknown
}
export type MemoryImportRecord = {
  importId: string; mode: 'atomic' | 'best_effort'; status: 'completed'; totalCount: number; createdCount: number
  reusedCount: number; invalidCount: number; conflictCount: number
  items: Array<{ clientItemId: string; status: 'created' | 'reused' | 'invalid' | 'conflict'; memoryId: string | null; errorCode: string | null }>
  createdAt: string; completedAt: string
}
export type MemoryImportResult = {
  contractVersion: typeof MEMORY_IMPORT_VERSION; operationStatus: 'completed' | 'confirmation_required' | 'failed'
  operation: MemoryOperation; import: MemoryImportRecord | null; confirmation: MemoryConfirmation | null; externalCall: 'not_performed'
}
export type MemoryExportItem = Omit<MemoryVersion, 'externalCall' | 'previousVersionId'>
export type MemoryExportRecord = {
  exportId: string; format: typeof MEMORY_EXPORT_VERSION; status: 'completed'; items: MemoryExportItem[]
  itemCount: number; contentHash: string; createdAt: string
}
export type MemoryExportResult = {
  contractVersion: typeof MEMORY_EXPORT_VERSION; operationStatus: 'completed' | 'confirmation_required' | 'failed'
  operation: MemoryOperation; export: MemoryExportRecord | null; confirmation: MemoryConfirmation | null; externalCall: 'not_performed'
}
export type MemoryRecoveryResult = MemoryWriteResult | MemoryImportResult | MemoryExportResult

export type MemoryEditableInput = {
  kind: MemoryKind; body: string; summary: string | null; occurredAt: string | null
  includeInContext: boolean; sensitivity: MemorySensitivity; source: { sourceType: 'manual'; sourceRef: null }
  confirmationId: string | null; securitySessionId: string | null
}
export type MemoryListFilters = {
  query?: string; kind?: MemoryKind | ''; status?: MemoryStatus | ''; includeInContext?: boolean | ''; cursor?: string; limit?: number
}

const kinds = ['preference', 'profile_fact', 'relationship', 'decision', 'project', 'routine', 'other'] as const
const sourceTypes = ['manual', 'import', 'message_version', 'event'] as const
const operationTypes = ['memory.create', 'memory.edit', 'memory.context_inclusion', 'memory.archive', 'memory.restore', 'memory.reference.create', 'memory.reference.delete', 'memory.deletion.request', 'memory.deletion.cancel', 'memory.deletion.finalize', 'memory.import', 'memory.export'] as const
const resourceFor: Record<MemoryOperationType, MemoryOperation['resourceType']> = {
  'memory.create': 'memory', 'memory.edit': 'memory', 'memory.context_inclusion': 'memory', 'memory.archive': 'memory', 'memory.restore': 'memory',
  'memory.reference.create': 'reference', 'memory.reference.delete': 'reference',
  'memory.deletion.request': 'deletion', 'memory.deletion.cancel': 'deletion', 'memory.deletion.finalize': 'deletion',
  'memory.import': 'import', 'memory.export': 'export',
}

function invalid(): never { throw new ApiClientError('Invalid R5 memory response', { code: 'invalid_response', status: null }) }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown> }
function exact(value: unknown, keys: readonly string[]) { const item = record(value); if (Object.keys(item).length !== keys.length || Object.keys(item).some((key) => !keys.includes(key))) invalid(); return item }
function text(value: unknown, max = 512, empty = false) { if (typeof value !== 'string' || value.length > max || (!empty && !value)) invalid(); return value }
function nullableText(value: unknown, max = 512) { return value === null ? null : text(value, max) }
function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] { if (typeof value !== 'string' || !values.includes(value)) invalid(); return value as T[number] }
function integer(value: unknown, min = 0) { if (!Number.isSafeInteger(value) || Number(value) < min) invalid(); return Number(value) }
function bool(value: unknown) { if (typeof value !== 'boolean') invalid(); return value }
function hash(value: unknown) { const result = text(value, 71); if (!/^sha256:[a-f0-9]{64}$/.test(result)) invalid(); return result }
function instant(value: unknown) { const result = text(value, 40); if (!/Z$/.test(result) || !Number.isFinite(Date.parse(result))) invalid(); return result }
function nullableInstant(value: unknown) { return value === null ? null : instant(value) }
function body(value: unknown) { if (typeof value !== 'string' || !value || Array.from(value).length > 8192 || new TextEncoder().encode(value).length > 32768) invalid(); return value }
function nullableSummary(value: unknown) { if (value === null) return null; if (typeof value !== 'string' || !value || Array.from(value).length > 512) invalid(); return value }
function nullableId(value: unknown) { return value === null ? null : text(value) }

export function parseMemorySource(value: unknown): MemorySource {
  const item = exact(value, ['sourceType', 'sourceRef', 'sourceContentHash'])
  return { sourceType: oneOf(item.sourceType, sourceTypes), sourceRef: text(item.sourceRef), sourceContentHash: hash(item.sourceContentHash) }
}

export function parseMemory(value: unknown): Memory {
  const item = exact(value, ['contractVersion', 'memoryId', 'assistantId', 'kind', 'currentVersionId', 'version', 'body', 'summary', 'source', 'occurredAt', 'recordedAt', 'includeInContext', 'visibilityScope', 'sensitivity', 'status', 'retention', 'updatedAt', 'externalCall'])
  const retention = exact(item.retention, ['deletionState', 'deletionId', 'requestedAt', 'finalizedAt'])
  const status = oneOf(item.status, ['active', 'archived', 'deletion_pending'] as const)
  const deletionState = oneOf(retention.deletionState, ['not_requested', 'requested'] as const)
  const deletionId = nullableId(retention.deletionId); const requestedAt = nullableInstant(retention.requestedAt)
  if (retention.finalizedAt !== null) invalid()
  if (status === 'deletion_pending') { if (deletionState !== 'requested' || !deletionId || !requestedAt) invalid() }
  else if (deletionState !== 'not_requested' || deletionId || requestedAt) invalid()
  return {
    contractVersion: oneOf(item.contractVersion, [MEMORY_CONTRACT_VERSION] as const), memoryId: text(item.memoryId), assistantId: text(item.assistantId),
    kind: oneOf(item.kind, kinds), currentVersionId: text(item.currentVersionId), version: integer(item.version, 1), body: body(item.body),
    summary: nullableSummary(item.summary), source: parseMemorySource(item.source), occurredAt: nullableInstant(item.occurredAt), recordedAt: instant(item.recordedAt),
    includeInContext: bool(item.includeInContext), visibilityScope: oneOf(item.visibilityScope, ['current_assistant'] as const),
    sensitivity: oneOf(item.sensitivity, ['normal', 'sensitive'] as const), status,
    retention: { deletionState, deletionId, requestedAt, finalizedAt: null }, updatedAt: instant(item.updatedAt), externalCall: oneOf(item.externalCall, ['not_performed'] as const),
  }
}

export function parseMemoryVersion(value: unknown): MemoryVersion {
  const item = exact(value, ['memoryVersionId', 'memoryId', 'version', 'kind', 'body', 'summary', 'source', 'occurredAt', 'recordedAt', 'includeInContext', 'visibilityScope', 'sensitivity', 'contentHash', 'previousVersionId', 'externalCall'])
  return { memoryVersionId: text(item.memoryVersionId), memoryId: text(item.memoryId), version: integer(item.version, 1), kind: oneOf(item.kind, kinds), body: body(item.body), summary: nullableSummary(item.summary), source: parseMemorySource(item.source), occurredAt: nullableInstant(item.occurredAt), recordedAt: instant(item.recordedAt), includeInContext: bool(item.includeInContext), visibilityScope: oneOf(item.visibilityScope, ['current_assistant'] as const), sensitivity: oneOf(item.sensitivity, ['normal', 'sensitive'] as const), contentHash: hash(item.contentHash), previousVersionId: nullableId(item.previousVersionId), externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

export function parseMemoryReference(value: unknown): MemoryReference {
  const item = exact(value, ['referenceId', 'memoryId', 'memoryVersionId', 'sourceType', 'conversationId', 'messageId', 'messageVersionId', 'eventId', 'sourceContentHash', 'status', 'createdAt', 'deletedAt', 'externalCall'])
  const sourceType = oneOf(item.sourceType, ['message_version', 'event'] as const)
  const conversationId = nullableId(item.conversationId); const messageId = nullableId(item.messageId); const messageVersionId = nullableId(item.messageVersionId); const eventId = nullableId(item.eventId)
  if (sourceType === 'event' ? (!eventId || conversationId || messageId || messageVersionId) : (!conversationId || !messageId || !messageVersionId || eventId)) invalid()
  const status = oneOf(item.status, ['active', 'deleted'] as const); const deletedAt = nullableInstant(item.deletedAt)
  if ((status === 'deleted') !== Boolean(deletedAt)) invalid()
  return { referenceId: text(item.referenceId), memoryId: text(item.memoryId), memoryVersionId: text(item.memoryVersionId), sourceType, conversationId, messageId, messageVersionId, eventId, sourceContentHash: hash(item.sourceContentHash), status, createdAt: instant(item.createdAt), deletedAt, externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

export function parseMemoryDeletion(value: unknown): MemoryDeletion {
  const item = exact(value, ['deletionId', 'memoryId', 'status', 'requestedAt', 'cancelledAt', 'finalizedAt', 'result', 'bodyRetained'])
  const status = oneOf(item.status, ['pending', 'cancelled', 'completed', 'failed'] as const)
  const result = oneOf(item.result, ['pending', 'cancelled', 'deleted', 'failed'] as const)
  const pairs = { pending: 'pending', cancelled: 'cancelled', completed: 'deleted', failed: 'failed' } as const
  const cancelledAt = nullableInstant(item.cancelledAt); const finalizedAt = nullableInstant(item.finalizedAt); const bodyRetained = bool(item.bodyRetained)
  if (result !== pairs[status] || (status === 'cancelled') !== Boolean(cancelledAt) || (status === 'completed') !== Boolean(finalizedAt) || (status === 'completed') === bodyRetained) invalid()
  return { deletionId: text(item.deletionId), memoryId: text(item.memoryId), status, requestedAt: instant(item.requestedAt), cancelledAt, finalizedAt, result, bodyRetained }
}

function parseOperation(value: unknown): MemoryOperation {
  const item = exact(value, ['operationId', 'operationType', 'status', 'resourceType', 'resourceId', 'errorCode', 'createdAt', 'completedAt'])
  const operationType = oneOf(item.operationType, operationTypes); const status = oneOf(item.status, ['processing', 'confirmation_required', 'completed', 'failed'] as const)
  const resourceType = oneOf(item.resourceType, ['memory', 'reference', 'deletion', 'import', 'export'] as const); const resourceId = nullableId(item.resourceId)
  const errorCode = nullableText(item.errorCode, 128); const completedAt = nullableInstant(item.completedAt)
  if (resourceType !== resourceFor[operationType] || (['processing', 'confirmation_required'].includes(status) ? resourceId !== null || completedAt !== null : !resourceId || !completedAt) || (status === 'failed') !== Boolean(errorCode)) invalid()
  return { operationId: text(item.operationId), operationType, status, resourceType, resourceId, errorCode, createdAt: instant(item.createdAt), completedAt }
}

function parseConfirmation(value: unknown): MemoryConfirmation { const item = exact(value, ['confirmationId', 'status']); return { confirmationId: text(item.confirmationId), status: oneOf(item.status, ['pending'] as const) } }

export function parseMemoryWriteResult(value: unknown): MemoryWriteResult {
  const item = exact(value, ['contractVersion', 'operationStatus', 'operation', 'memory', 'reference', 'deletion', 'confirmation', 'externalCall'])
  const operationStatus = oneOf(item.operationStatus, ['completed', 'confirmation_required', 'failed'] as const); const operation = parseOperation(item.operation)
  const memory = item.memory === null ? null : parseMemory(item.memory); const reference = item.reference === null ? null : parseMemoryReference(item.reference); const deletion = item.deletion === null ? null : parseMemoryDeletion(item.deletion); const confirmation = item.confirmation === null ? null : parseConfirmation(item.confirmation)
  if (operationStatus === 'confirmation_required') { if (operation.status !== 'confirmation_required' || !confirmation || memory || reference || deletion) invalid() }
  else if (operationStatus === 'failed') { if (operation.status !== 'failed' || confirmation || memory || reference || deletion) invalid() }
  else if (operationStatus !== 'completed' || operation.status !== 'completed' || confirmation) invalid()
  if (operationStatus === 'completed') {
    if (operation.resourceType === 'memory' && (!memory || reference || deletion)) invalid()
    if (operation.resourceType === 'reference' && (memory || !reference || deletion)) invalid()
    if (operation.resourceType === 'deletion') {
      if (!deletion || reference || (operation.operationType === 'memory.deletion.finalize' ? memory !== null : memory === null)) invalid()
    }
  }
  return { contractVersion: oneOf(item.contractVersion, [MEMORY_CONTRACT_VERSION] as const), operationStatus, operation, memory, reference, deletion, confirmation, externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

export function parseMemoryReadChallenge(value: unknown): MemoryReadChallenge {
  const item = exact(value, ['contractVersion', 'operationStatus', 'confirmation', 'externalCall'])
  return { contractVersion: oneOf(item.contractVersion, [MEMORY_CONTRACT_VERSION] as const), operationStatus: oneOf(item.operationStatus, ['confirmation_required'] as const), confirmation: parseConfirmation(item.confirmation), externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

export function parseMemoryList(value: unknown): MemoryList | MemoryReadChallenge {
  const candidate = record(value)
  if (candidate.operationStatus === 'confirmation_required') return parseMemoryReadChallenge(value)
  const item = exact(value, ['contractVersion', 'items', 'nextCursor', 'query', 'selection', 'externalCall']); if (!Array.isArray(item.items) || item.items.length > 100) invalid()
  const selection = exact(item.selection, ['strategy', 'scope'])
  return { contractVersion: oneOf(item.contractVersion, [MEMORY_CONTRACT_VERSION] as const), items: item.items.map(parseMemory), nextCursor: nullableText(item.nextCursor, 4096), query: nullableText(item.query, 4096), selection: { strategy: oneOf(selection.strategy, ['lexical-overlap-recency/v1'] as const), scope: oneOf(selection.scope, ['current_owner_current_assistant'] as const) }, externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

export function parseMemoryVersions(value: unknown): { contractVersion: typeof MEMORY_CONTRACT_VERSION; memoryId: string; items: MemoryVersion[]; externalCall: 'not_performed' } | MemoryReadChallenge {
  const candidate = record(value); if (candidate.operationStatus === 'confirmation_required') return parseMemoryReadChallenge(value)
  const item = exact(value, ['contractVersion', 'memoryId', 'items', 'externalCall']); if (!Array.isArray(item.items)) invalid(); const memoryId = text(item.memoryId); const items = item.items.map(parseMemoryVersion)
  if (items.some((entry, index) => entry.memoryId !== memoryId || entry.version !== index + 1 || (index === 0 ? entry.previousVersionId !== null : entry.previousVersionId !== items[index - 1].memoryVersionId))) invalid()
  return { contractVersion: oneOf(item.contractVersion, [MEMORY_CONTRACT_VERSION] as const), memoryId, items, externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

export function parseMemoryReferences(value: unknown): { contractVersion: typeof MEMORY_CONTRACT_VERSION; memoryId: string; items: MemoryReference[]; externalCall: 'not_performed' } | MemoryReadChallenge {
  const candidate = record(value); if (candidate.operationStatus === 'confirmation_required') return parseMemoryReadChallenge(value)
  const item = exact(value, ['contractVersion', 'memoryId', 'items', 'externalCall']); if (!Array.isArray(item.items)) invalid(); const memoryId = text(item.memoryId); const items = item.items.map(parseMemoryReference); if (items.some((entry) => entry.memoryId !== memoryId)) invalid()
  return { contractVersion: oneOf(item.contractVersion, [MEMORY_CONTRACT_VERSION] as const), memoryId, items, externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

function parseImportRecord(value: unknown): MemoryImportRecord {
  const item = exact(value, ['importId', 'mode', 'status', 'totalCount', 'createdCount', 'reusedCount', 'invalidCount', 'conflictCount', 'items', 'createdAt', 'completedAt']); if (!Array.isArray(item.items)) invalid()
  const items = item.items.map((value) => { const entry = exact(value, ['clientItemId', 'status', 'memoryId', 'errorCode']); const status = oneOf(entry.status, ['created', 'reused', 'invalid', 'conflict'] as const); const memoryId = nullableId(entry.memoryId); const errorCode = nullableText(entry.errorCode, 128); if (['created', 'reused'].includes(status) ? !memoryId || errorCode : memoryId || !errorCode) invalid(); return { clientItemId: text(entry.clientItemId), status, memoryId, errorCode } })
  const totalCount = integer(item.totalCount, 1); const createdCount = integer(item.createdCount); const reusedCount = integer(item.reusedCount); const invalidCount = integer(item.invalidCount); const conflictCount = integer(item.conflictCount)
  if (items.length !== totalCount || createdCount + reusedCount + invalidCount + conflictCount !== totalCount || items.filter((entry) => entry.status === 'created').length !== createdCount || items.filter((entry) => entry.status === 'reused').length !== reusedCount || items.filter((entry) => entry.status === 'invalid').length !== invalidCount || items.filter((entry) => entry.status === 'conflict').length !== conflictCount) invalid()
  return { importId: text(item.importId), mode: oneOf(item.mode, ['atomic', 'best_effort'] as const), status: oneOf(item.status, ['completed'] as const), totalCount, createdCount, reusedCount, invalidCount, conflictCount, items, createdAt: instant(item.createdAt), completedAt: instant(item.completedAt) }
}

function parseExportItem(value: unknown): MemoryExportItem {
  const item = exact(value, ['memoryId', 'memoryVersionId', 'version', 'kind', 'body', 'summary', 'source', 'occurredAt', 'recordedAt', 'includeInContext', 'visibilityScope', 'sensitivity', 'contentHash'])
  return { memoryId: text(item.memoryId), memoryVersionId: text(item.memoryVersionId), version: integer(item.version, 1), kind: oneOf(item.kind, kinds), body: body(item.body), summary: nullableSummary(item.summary), source: parseMemorySource(item.source), occurredAt: nullableInstant(item.occurredAt), recordedAt: instant(item.recordedAt), includeInContext: bool(item.includeInContext), visibilityScope: oneOf(item.visibilityScope, ['current_assistant'] as const), sensitivity: oneOf(item.sensitivity, ['normal', 'sensitive'] as const), contentHash: hash(item.contentHash) }
}

function parseImportResult(value: unknown): MemoryImportResult {
  const item = exact(value, ['contractVersion', 'operationStatus', 'operation', 'import', 'confirmation', 'externalCall']); const operationStatus = oneOf(item.operationStatus, ['completed', 'confirmation_required', 'failed'] as const); const operation = parseOperation(item.operation); const imported = item.import === null ? null : parseImportRecord(item.import); const confirmation = item.confirmation === null ? null : parseConfirmation(item.confirmation)
  if (operation.operationType !== 'memory.import' || (operationStatus === 'completed' ? operation.status !== 'completed' || !imported || confirmation : operationStatus === 'confirmation_required' ? operation.status !== 'confirmation_required' || imported || !confirmation : operation.status !== 'failed' || imported || confirmation)) invalid()
  return { contractVersion: oneOf(item.contractVersion, [MEMORY_IMPORT_VERSION] as const), operationStatus, operation, import: imported, confirmation, externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

function parseExportResult(value: unknown): MemoryExportResult {
  const item = exact(value, ['contractVersion', 'operationStatus', 'operation', 'export', 'confirmation', 'externalCall']); const operationStatus = oneOf(item.operationStatus, ['completed', 'confirmation_required', 'failed'] as const); const operation = parseOperation(item.operation); const confirmation = item.confirmation === null ? null : parseConfirmation(item.confirmation)
  let exported: MemoryExportRecord | null = null
  if (item.export !== null) { const entry = exact(item.export, ['exportId', 'format', 'status', 'items', 'itemCount', 'contentHash', 'createdAt']); if (!Array.isArray(entry.items)) invalid(); const items = entry.items.map(parseExportItem); const itemCount = integer(entry.itemCount); if (items.length !== itemCount) invalid(); exported = { exportId: text(entry.exportId), format: oneOf(entry.format, [MEMORY_EXPORT_VERSION] as const), status: oneOf(entry.status, ['completed'] as const), items, itemCount, contentHash: hash(entry.contentHash), createdAt: instant(entry.createdAt) } }
  if (operation.operationType !== 'memory.export' || (operationStatus === 'completed' ? operation.status !== 'completed' || !exported || confirmation : operationStatus === 'confirmation_required' ? operation.status !== 'confirmation_required' || exported || !confirmation : operation.status !== 'failed' || exported || confirmation)) invalid()
  return { contractVersion: oneOf(item.contractVersion, [MEMORY_EXPORT_VERSION] as const), operationStatus, operation, export: exported, confirmation, externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

export function parseMemoryRecovery(value: unknown): MemoryRecoveryResult { const item = record(value); if (item.contractVersion === MEMORY_CONTRACT_VERSION) return parseMemoryWriteResult(value); if (item.contractVersion === MEMORY_IMPORT_VERSION) return parseImportResult(value); if (item.contractVersion === MEMORY_EXPORT_VERSION) return parseExportResult(value); return invalid() }

function readOptions(options?: PersonalRequestOptions & { confirmationId?: string | null; securitySessionId?: string | null }) { return { ...options, confirmationId: options?.confirmationId ?? undefined, securitySessionId: options?.securitySessionId ?? undefined } }
function query(filters: MemoryListFilters) { const params = new URLSearchParams(); if (filters.query) params.set('query', filters.query); if (filters.kind) params.set('kind', filters.kind); if (filters.status) params.set('status', filters.status); if (typeof filters.includeInContext === 'boolean') params.set('includeInContext', String(filters.includeInContext)); if (filters.cursor) params.set('cursor', filters.cursor); params.set('limit', String(filters.limit ?? 50)); return params.toString() }

function parseMemoryDetail(value: unknown): Memory | MemoryReadChallenge {
  const candidate = record(value)
  return candidate.operationStatus === 'confirmation_required' ? parseMemoryReadChallenge(value) : parseMemory(value)
}

export function createPersonalMemoryApi(api: PersonalApi) {
  return {
    async list(filters: MemoryListFilters = {}, options?: PersonalRequestOptions & { confirmationId?: string | null; securitySessionId?: string | null }) {
      return parseMemoryList(await api.request(`/memories?${query(filters)}`, 'GET', undefined, readOptions(options)))
    },
    async detail(memoryId: string, options?: PersonalRequestOptions & { confirmationId?: string | null; securitySessionId?: string | null }) {
      return parseMemoryDetail(await api.request(`/memories/${encodeURIComponent(memoryId)}`, 'GET', undefined, readOptions(options)))
    },
    async versions(memoryId: string, options?: PersonalRequestOptions & { confirmationId?: string | null; securitySessionId?: string | null }) {
      return parseMemoryVersions(await api.request(`/memories/${encodeURIComponent(memoryId)}/versions`, 'GET', undefined, readOptions(options)))
    },
    async references(memoryId: string, options?: PersonalRequestOptions & { confirmationId?: string | null; securitySessionId?: string | null }) {
      return parseMemoryReferences(await api.request(`/memories/${encodeURIComponent(memoryId)}/references`, 'GET', undefined, readOptions(options)))
    },
    async deletion(deletionId: string, options?: PersonalRequestOptions) {
      return parseMemoryDeletion(await api.request(`/memories/deletions/${encodeURIComponent(deletionId)}`, 'GET', undefined, options))
    },
    async create(input: MemoryEditableInput, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request('/memories', 'POST', input, { ...options, idempotencyKey: key }))
    },
    async edit(memoryId: string, input: MemoryEditableInput & { expectedVersion: number }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}`, 'PATCH', input, { ...options, idempotencyKey: key }))
    },
    async inclusion(memoryId: string, input: { includeInContext: boolean; expectedVersion: number; confirmationId: string | null; securitySessionId: string | null }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}/context-inclusion`, 'POST', input, { ...options, idempotencyKey: key }))
    },
    async archive(memoryId: string, input: { expectedVersion: number; confirmationId: string | null; securitySessionId: string | null }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}/archive`, 'POST', input, { ...options, idempotencyKey: key }))
    },
    async restore(memoryId: string, input: { expectedVersion: number; confirmationId: string | null; securitySessionId: string | null }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}/restore`, 'POST', input, { ...options, idempotencyKey: key }))
    },
    async createReference(memoryId: string, input: {
      sourceType: 'message_version'; conversationId: string; messageId: string; messageVersionId: string; eventId: null
      expectedVersion: number; confirmationId: string | null; securitySessionId: string | null
    } | {
      sourceType: 'event'; conversationId: null; messageId: null; messageVersionId: null; eventId: string
      expectedVersion: number; confirmationId: string | null; securitySessionId: string | null
    }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}/references`, 'POST', input, { ...options, idempotencyKey: key }))
    },
    async deleteReference(memoryId: string, referenceId: string, input: { expectedVersion: number; confirmationId: string | null; securitySessionId: string | null }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}/references/${encodeURIComponent(referenceId)}/deletion`, 'POST', input, { ...options, idempotencyKey: key }))
    },
    async requestDeletion(memoryId: string, input: { expectedVersion: number; confirmationId: string | null; securitySessionId: string | null }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}/deletion`, 'POST', input, { ...options, idempotencyKey: key }))
    },
    async cancelDeletion(memoryId: string, input: { deletionId: string }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}/deletion-cancellation`, 'POST', input, { ...options, idempotencyKey: key }))
    },
    async finalizeDeletion(memoryId: string, input: { deletionId: string; confirmationId: string | null; securitySessionId: string | null }, key: string, options?: PersonalRequestOptions) {
      return parseMemoryWriteResult(await api.request(`/memories/${encodeURIComponent(memoryId)}/deletion-finalization`, 'POST', input, { ...options, idempotencyKey: key }))
    },
    async importMemories(input: { contractVersion: typeof MEMORY_IMPORT_VERSION; mode: 'atomic' | 'best_effort'; items: MemoryImportItemInput[]; confirmationId: string | null; securitySessionId: string | null }, key: string, options?: PersonalRequestOptions) {
      return parseImportResult(await api.request('/memories/imports', 'POST', input, { ...options, idempotencyKey: key }))
    },
    async exportMemories(input: { contractVersion: typeof MEMORY_EXPORT_VERSION; memoryIds: string[]; includeArchived: boolean; confirmationId: string | null; securitySessionId: string | null }, key: string, options?: PersonalRequestOptions) {
      return parseExportResult(await api.request('/memories/exports', 'POST', input, { ...options, idempotencyKey: key }))
    },
    async recover(idempotencyKey: string, options?: PersonalRequestOptions) {
      return parseMemoryRecovery(await api.request(`/memories/operations/by-idempotency-key/${encodeURIComponent(idempotencyKey)}`, 'GET', undefined, options))
    },
    async decide(confirmationId: string, decision: 'approve' | 'reject', options?: PersonalRequestOptions) {
      return api.request(`/confirmations/${encodeURIComponent(confirmationId)}/decision`, 'POST', { decision }, options)
    },
  }
}

export type PersonalMemoryApi = ReturnType<typeof createPersonalMemoryApi>
