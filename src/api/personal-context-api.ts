import { ApiClientError } from './client'
import { parsePersonalChatTurn } from './personal-chat-api'
import type { PersonalChatTurn } from './personal-chat-api'
import type { PersonalApi, PersonalRequestOptions } from './personal-api'

export const R4_CONTEXT_CONTRACT_VERSION = 'vio-context-assembly/v1' as const
export const R4_CONTEXT_SCHEMA_VERSION = 'vio-context-assembly-snapshot/v1' as const
export const R4_CONTEXT_SUMMARY_VERSION = 'vio-context-summary/v1' as const

export type ContextMode = 'concise' | 'balanced' | 'complete' | 'custom'
export type ContextSlotName =
  | 'system_rules'
  | 'assistant_settings'
  | 'runtime_projection'
  | 'unresolved_events'
  | 'recent_original_text'
  | 'long_term_memory'
  | 'current_user_message'
export type ContextSourceType = 'message_version' | 'event' | 'summary' | 'assistant_settings' | 'system_rule' | 'runtime_projection'
export type ContextSourceStatus = 'included' | 'excluded' | 'trimmed' | 'summarized'
export type ContextSourceOrigin = 'system' | 'assistant' | 'runtime' | 'current_conversation' | 'cross_window' | 'event' | 'memory' | 'current_turn'
export type ContextSlotStatus = 'included' | 'empty' | 'not_available' | 'not_implemented' | 'pending'
export type ContextFoldingStatus = 'not_required' | 'planned' | 'ready' | 'failed' | 'failed_fallback_original'
export type ContextRuntimeProjectionStatus = 'included' | 'not_available'
export type ContextSelection = {
  strategy: 'lexical-overlap-recency/v1'
  status: 'provisional' | 'final'
  querySource: 'conversation_history' | 'current_user_message'
  crossWindowCandidateCount: number
  crossWindowSelectedCount: number
}
export type ContextSourceSelection = {
  strategy: 'lexical-overlap-recency/v1'
  relevanceScore: number
  matchedTermCount: number
  rank: number
  representation: 'latest_ready_summary' | 'original_fallback'
}
export type StructuredContextSummary = {
  schemaVersion: typeof R4_CONTEXT_SUMMARY_VERSION
  summaryId: string
  scope: { conversationId: string; branchId: string }
  decisions: string[]
  tasks: string[]
  unresolvedItems: string[]
  importantRelationships: string[]
  supportingExcerpts: string[]
  sourceRefs: string[]
  createdAt: string
}

export type ContextSource = {
  sourceRef: string
  sourceType: ContextSourceType
  slot: ContextSlotName
  origin: ContextSourceOrigin
  status: ContextSourceStatus
  reason: string | null
  conversationId: string | null
  branchId: string | null
  messageId: string | null
  messageVersionId: string | null
  eventId: string | null
  summaryId: string | null
  contentHash: string
  estimatedTokens: number
  createdAt: string
  evidence: {
    preview: string
    senderType?: 'user' | 'subject'
    versionKind?: 'original' | 'edited' | 'regenerated'
    selection?: ContextSourceSelection
  }
}

export type ContextAssembly = {
  contractVersion: typeof R4_CONTEXT_CONTRACT_VERSION
  schemaVersion: typeof R4_CONTEXT_SCHEMA_VERSION
  assemblyId: string | null
  turnId: string | null
  conversationId: string
  branchId: string
  mode: ContextMode
  controlsSource: 'turn' | 'conversation' | 'personal_default'
  state: 'planned' | 'locked' | 'fold_failed' | 'budget_blocked'
  scope: { currentOwner: true; currentAssistant: true; currentConversationExcludedFromCrossWindow: true }
  controls: { excludedSourceRefs: string[]; unavailableExcludedSourceRefs: string[] }
  slots: Array<{ slot: ContextSlotName; status: ContextSlotStatus }>
  sources: ContextSource[]
  budget: {
    estimationMethod: 'utf8-byte-upper-bound/v1'
    contextLimitTokens: number
    reservedOutputTokens: number
    inputBudgetTokens: number
    rawEstimatedInputTokens: number
    estimatedInputTokens: number
    withinLimit: boolean
    foldPlanned: boolean
    trimmingApplied: boolean
    trimmingReason: string | null
  }
  folding: {
    status: ContextFoldingStatus
    summaryId: string | null
    reason: string | null
    sourceSetHash: string | null
    sourceCount: number
    recoveryAction: 'retry_fold' | null
  }
  selection: ContextSelection
  runtimeProjection: { status: ContextRuntimeProjectionStatus; sourceRef: string | null }
  memory: { status: 'not_implemented' }
  planHash: string
  providerMessagesHash: string | null
  snapshotHash: string | null
  createdAt: string
  lockedAt: string | null
  externalCall: 'not_performed'
}

export type ConversationContextSettings = {
  contractVersion: typeof R4_CONTEXT_CONTRACT_VERSION
  conversationId: string
  personalDefault: { mode: ContextMode; source: 'assistant_settings' }
  conversation: { mode: ContextMode; excludedSourceRefs: string[]; unavailableExcludedSourceRefs: string[]; version: number; updatedAt: string } | null
  effective: { mode: ContextMode; excludedSourceRefs: string[]; unavailableExcludedSourceRefs: string[]; source: 'conversation' | 'personal_default' }
  externalCall: 'not_performed'
}

export type ContextEvidence =
  | {
      sourceRef: string; sourceType: 'message_version'; conversationId: string; branchId: string; messageId: string
      messageVersionId: string; senderType: 'user' | 'subject'; content: string; createdAt: string; contentHash: string; externalCall: 'not_performed'
    }
  | {
      sourceRef: string; sourceType: 'event'; conversationId: string | null; branchId: string | null; eventId: string
      eventType: string; summary: string; data: unknown; occurredAt: string; contentHash: string; externalCall: 'not_performed'
    }
  | {
      sourceRef: string; sourceType: 'summary'; conversationId: string; branchId: string; summaryId: string
      structuredSummary: StructuredContextSummary; sourceRefs: string[]; sourceHashes: Array<{ sourceRef: string; contentHash: string }>
      createdAt: string; contentHash: string; externalCall: 'not_performed'
    }

export type TurnContextControls = { mode: ContextMode; excludedSourceRefs: string[]; expectedPlanHash: string | null }
export type ContextRecoveryResult = {
  context: ContextAssembly
  turn: PersonalChatTurn
  externalCall: 'not_performed' | 'performed'
}

const SLOT_ORDER: ContextSlotName[] = [
  'system_rules',
  'assistant_settings',
  'runtime_projection',
  'unresolved_events',
  'recent_original_text',
  'long_term_memory',
  'current_user_message',
]

function invalid(): never { throw new ApiClientError('Invalid R4 context response', { code: 'invalid_response', status: null }) }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown> }
function exactRecord(value: unknown, allowed: readonly string[]) {
  const result = record(value)
  if (Object.keys(result).some((key) => !allowed.includes(key))) invalid()
  return result
}
function text(value: unknown, max = 2048, allowEmpty = false) { if (typeof value !== 'string' || (!allowEmpty && !value) || value.length > max) invalid(); return value }
function nullableText(value: unknown, max = 2048) { return value === null ? null : text(value, max) }
function integer(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(); return Number(value) }
function bool(value: unknown) { if (typeof value !== 'boolean') invalid(); return value }
function time(value: unknown) { const result = text(value, 128); if (!Number.isFinite(Date.parse(result))) invalid(); return result }
function nullableTime(value: unknown) { return value === null ? null : time(value) }
function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] { if (typeof value !== 'string' || !values.includes(value)) invalid(); return value as T[number] }
function hash(value: unknown) { const result = text(value, 128); if (!/^sha256:[a-f0-9]{64}$/.test(result)) invalid(); return result }
function nullableHash(value: unknown) { return value === null ? null : hash(value) }
function refs(value: unknown, max = 128) {
  if (!Array.isArray(value) || value.length > max) invalid()
  const result = value.map((entry) => text(entry, 512))
  if (new Set(result).size !== result.length) invalid()
  return result
}
function sameArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
function sameSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value))
}
function serializable(value: unknown, depth = 0): unknown {
  if (depth > 8) invalid()
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    if (value.length > 512) invalid()
    return value.map((entry) => serializable(entry, depth + 1))
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > 256) invalid()
    return Object.fromEntries(entries.map(([key, entry]) => [text(key, 128), serializable(entry, depth + 1)]))
  }
  return invalid()
}

function parseSourceSelection(value: unknown): ContextSourceSelection {
  const item = exactRecord(value, ['strategy', 'relevanceScore', 'matchedTermCount', 'rank', 'representation'])
  const rank = integer(item.rank)
  if (rank < 1) invalid()
  return {
    strategy: oneOf(item.strategy, ['lexical-overlap-recency/v1'] as const),
    relevanceScore: integer(item.relevanceScore),
    matchedTermCount: integer(item.matchedTermCount),
    rank,
    representation: oneOf(item.representation, ['latest_ready_summary', 'original_fallback'] as const),
  }
}

function parseSelection(value: unknown): ContextSelection {
  const item = exactRecord(value, ['strategy', 'status', 'querySource', 'crossWindowCandidateCount', 'crossWindowSelectedCount'])
  const result: ContextSelection = {
    strategy: oneOf(item.strategy, ['lexical-overlap-recency/v1'] as const),
    status: oneOf(item.status, ['provisional', 'final'] as const),
    querySource: oneOf(item.querySource, ['conversation_history', 'current_user_message'] as const),
    crossWindowCandidateCount: integer(item.crossWindowCandidateCount),
    crossWindowSelectedCount: integer(item.crossWindowSelectedCount),
  }
  if (result.crossWindowSelectedCount > result.crossWindowCandidateCount) invalid()
  if ((result.status === 'provisional') !== (result.querySource === 'conversation_history')) invalid()
  return result
}

function parseSourceEvidence(sourceType: ContextSourceType, value: unknown): ContextSource['evidence'] {
  const preview = (entry: Record<string, unknown>) => text(entry.preview, 1000, true)
  if (sourceType === 'message_version') {
    const item = exactRecord(value, ['senderType', 'versionKind', 'preview', 'selection'])
    return {
      preview: preview(item),
      senderType: oneOf(item.senderType, ['user', 'subject'] as const),
      versionKind: oneOf(item.versionKind, ['original', 'edited', 'regenerated'] as const),
      ...(item.selection === undefined ? {} : { selection: parseSourceSelection(item.selection) }),
    }
  }
  if (sourceType === 'event') {
    const item = exactRecord(value, ['eventType', 'summary', 'preview'])
    text(item.eventType, 120); text(item.summary, 2000, true)
    return { preview: preview(item) }
  }
  if (sourceType === 'summary') {
    const item = exactRecord(value, ['kind', 'sourceCount', 'preview', 'selection'])
    oneOf(item.kind, ['structured_summary'] as const); integer(item.sourceCount)
    return { preview: preview(item), ...(item.selection === undefined ? {} : { selection: parseSourceSelection(item.selection) }) }
  }
  if (sourceType === 'system_rule') {
    const item = exactRecord(value, ['kind', 'preview'])
    oneOf(item.kind, ['system_rules'] as const)
    return { preview: preview(item) }
  }
  if (sourceType === 'assistant_settings') {
    const item = exactRecord(value, ['version', 'preview'])
    integer(item.version)
    return { preview: preview(item) }
  }
  const item = exactRecord(value, ['runtimeName', 'verifiedAt', 'preview'])
  text(item.runtimeName, 256); time(item.verifiedAt)
  return { preview: preview(item) }
}

function parseSource(value: unknown): ContextSource {
  const item = exactRecord(value, ['sourceRef', 'sourceType', 'slot', 'origin', 'status', 'reason', 'conversationId', 'branchId', 'messageId', 'messageVersionId', 'eventId', 'summaryId', 'contentHash', 'estimatedTokens', 'createdAt', 'evidence'])
  const sourceType = oneOf(item.sourceType, ['message_version', 'event', 'summary', 'assistant_settings', 'system_rule', 'runtime_projection'] as const)
  const evidence = parseSourceEvidence(sourceType, item.evidence)
  const result: ContextSource = {
    sourceRef: text(item.sourceRef, 512),
    sourceType,
    slot: oneOf(item.slot, SLOT_ORDER),
    origin: oneOf(item.origin, ['system', 'assistant', 'runtime', 'current_conversation', 'cross_window', 'event', 'memory', 'current_turn'] as const),
    status: oneOf(item.status, ['included', 'excluded', 'trimmed', 'summarized'] as const),
    reason: nullableText(item.reason, 512),
    conversationId: nullableText(item.conversationId),
    branchId: nullableText(item.branchId),
    messageId: nullableText(item.messageId),
    messageVersionId: nullableText(item.messageVersionId),
    eventId: nullableText(item.eventId),
    summaryId: nullableText(item.summaryId),
    contentHash: hash(item.contentHash),
    estimatedTokens: integer(item.estimatedTokens),
    createdAt: time(item.createdAt),
    evidence,
  }
  if (result.origin === 'cross_window') {
    if (!result.evidence.selection || !['message_version', 'summary'].includes(result.sourceType)) invalid()
    if (result.sourceType === 'summary' && result.evidence.selection.representation !== 'latest_ready_summary') invalid()
    if (result.sourceType === 'message_version' && result.evidence.selection.representation !== 'original_fallback') invalid()
  } else if (result.evidence.selection) invalid()
  return result
}

export function parseContextAssembly(value: unknown, expected?: { conversationId?: string; branchId?: string; turnId?: string }): ContextAssembly {
  const item = exactRecord(value, ['contractVersion', 'schemaVersion', 'assemblyId', 'turnId', 'conversationId', 'branchId', 'mode', 'controlsSource', 'state', 'scope', 'controls', 'slots', 'sources', 'budget', 'folding', 'selection', 'runtimeProjection', 'memory', 'planHash', 'providerMessagesHash', 'snapshotHash', 'createdAt', 'lockedAt', 'externalCall'])
  const scope = exactRecord(item.scope, ['currentOwner', 'currentAssistant', 'currentConversationExcludedFromCrossWindow'])
  const controls = exactRecord(item.controls, ['excludedSourceRefs', 'unavailableExcludedSourceRefs'])
  const budget = exactRecord(item.budget, ['estimationMethod', 'contextLimitTokens', 'reservedOutputTokens', 'inputBudgetTokens', 'rawEstimatedInputTokens', 'estimatedInputTokens', 'withinLimit', 'foldPlanned', 'trimmingApplied', 'trimmingReason'])
  const folding = exactRecord(item.folding, ['status', 'summaryId', 'reason', 'sourceSetHash', 'sourceCount', 'recoveryAction'])
  const runtimeProjection = exactRecord(item.runtimeProjection, ['status', 'sourceRef'])
  const memory = exactRecord(item.memory, ['status'])
  if (!Array.isArray(item.slots) || !Array.isArray(item.sources)) invalid()
  const slots = item.slots.map((value) => {
    const entry = exactRecord(value, ['slot', 'status'])
    return { slot: oneOf(entry.slot, SLOT_ORDER), status: oneOf(entry.status, ['included', 'empty', 'not_available', 'not_implemented', 'pending'] as const) }
  })
  if (slots.length !== SLOT_ORDER.length || slots.some((entry, index) => entry.slot !== SLOT_ORDER[index])) invalid()
  const excludedSourceRefs = refs(controls.excludedSourceRefs)
  const unavailableExcludedSourceRefs = refs(controls.unavailableExcludedSourceRefs)
  if (excludedSourceRefs.some((sourceRef) => unavailableExcludedSourceRefs.includes(sourceRef))) invalid()
  const sources = item.sources.map(parseSource)
  if (new Set(sources.map((source) => source.sourceRef)).size !== sources.length) invalid()
  const mode = oneOf(item.mode, ['concise', 'balanced', 'complete', 'custom'] as const)
  if (mode !== 'custom' && (excludedSourceRefs.length > 0 || unavailableExcludedSourceRefs.length > 0)) invalid()
  const selection = parseSelection(item.selection)
  const result: ContextAssembly = {
    contractVersion: oneOf(item.contractVersion, [R4_CONTEXT_CONTRACT_VERSION] as const),
    schemaVersion: oneOf(item.schemaVersion, [R4_CONTEXT_SCHEMA_VERSION] as const),
    assemblyId: nullableText(item.assemblyId),
    turnId: nullableText(item.turnId),
    conversationId: text(item.conversationId),
    branchId: text(item.branchId),
    mode,
    controlsSource: oneOf(item.controlsSource, ['turn', 'conversation', 'personal_default'] as const),
    state: oneOf(item.state, ['planned', 'locked', 'fold_failed', 'budget_blocked'] as const),
    scope: {
      currentOwner: scope.currentOwner === true ? true : invalid(),
      currentAssistant: scope.currentAssistant === true ? true : invalid(),
      currentConversationExcludedFromCrossWindow: scope.currentConversationExcludedFromCrossWindow === true ? true : invalid(),
    },
    controls: { excludedSourceRefs, unavailableExcludedSourceRefs },
    slots,
    sources,
    budget: {
      estimationMethod: oneOf(budget.estimationMethod, ['utf8-byte-upper-bound/v1'] as const),
      contextLimitTokens: integer(budget.contextLimitTokens),
      reservedOutputTokens: integer(budget.reservedOutputTokens),
      inputBudgetTokens: integer(budget.inputBudgetTokens),
      rawEstimatedInputTokens: integer(budget.rawEstimatedInputTokens),
      estimatedInputTokens: integer(budget.estimatedInputTokens),
      withinLimit: bool(budget.withinLimit),
      foldPlanned: bool(budget.foldPlanned),
      trimmingApplied: bool(budget.trimmingApplied),
      trimmingReason: nullableText(budget.trimmingReason, 512),
    },
    folding: {
      status: oneOf(folding.status, ['not_required', 'planned', 'ready', 'failed', 'failed_fallback_original'] as const),
      summaryId: nullableText(folding.summaryId),
      reason: nullableText(folding.reason, 512),
      sourceSetHash: nullableHash(folding.sourceSetHash),
      sourceCount: integer(folding.sourceCount),
      recoveryAction: folding.recoveryAction === null ? null : oneOf(folding.recoveryAction, ['retry_fold'] as const),
    },
    selection,
    runtimeProjection: { status: oneOf(runtimeProjection.status, ['included', 'not_available'] as const), sourceRef: nullableText(runtimeProjection.sourceRef) },
    memory: { status: oneOf(memory.status, ['not_implemented'] as const) },
    planHash: hash(item.planHash),
    providerMessagesHash: nullableHash(item.providerMessagesHash),
    snapshotHash: nullableHash(item.snapshotHash),
    createdAt: time(item.createdAt),
    lockedAt: nullableTime(item.lockedAt),
    externalCall: oneOf(item.externalCall, ['not_performed'] as const),
  }
  if (expected?.conversationId && result.conversationId !== expected.conversationId) invalid()
  if (expected?.branchId && result.branchId !== expected.branchId) invalid()
  if (expected?.turnId && result.turnId !== expected.turnId) invalid()
  if (result.state === 'planned' && (result.assemblyId !== null || result.turnId !== null || result.providerMessagesHash !== null || result.snapshotHash !== null || result.lockedAt !== null || result.selection.status !== 'provisional')) invalid()
  if (result.state === 'locked' && (!result.assemblyId || !result.turnId || !result.providerMessagesHash || !result.snapshotHash || !result.lockedAt || result.selection.status !== 'final')) invalid()
  if (['fold_failed', 'budget_blocked'].includes(result.state) && (!result.assemblyId || !result.turnId || result.providerMessagesHash !== null || result.snapshotHash !== null || result.lockedAt !== null || result.selection.status !== 'final')) invalid()
  if (result.budget.inputBudgetTokens + result.budget.reservedOutputTokens > result.budget.contextLimitTokens) invalid()
  if (result.budget.withinLimit !== (result.budget.estimatedInputTokens <= result.budget.inputBudgetTokens)) invalid()
  if (result.budget.trimmingApplied !== Boolean(result.budget.trimmingReason)) invalid()
  if ((result.runtimeProjection.status === 'included') !== Boolean(result.runtimeProjection.sourceRef)) invalid()
  if (result.folding.status === 'not_required' && (result.folding.summaryId !== null || result.folding.reason !== null || result.folding.sourceSetHash !== null || result.folding.sourceCount !== 0 || result.folding.recoveryAction !== null)) invalid()
  if (result.folding.status === 'planned' && (result.folding.summaryId !== null || result.folding.reason !== null || !result.folding.sourceSetHash || result.folding.sourceCount < 1 || result.folding.recoveryAction !== null)) invalid()
  if (['ready', 'failed', 'failed_fallback_original'].includes(result.folding.status) && (!result.folding.summaryId || !result.folding.sourceSetHash || result.folding.sourceCount < 1)) invalid()
  if ((result.folding.status === 'failed') !== (result.folding.recoveryAction === 'retry_fold')) invalid()
  if (result.state === 'fold_failed' && result.folding.status !== 'failed') invalid()
  if (result.budget.foldPlanned !== ['planned', 'ready', 'failed'].includes(result.folding.status)) invalid()
  sources.forEach((source) => {
    if (source.origin === 'cross_window' && (!source.conversationId || source.conversationId === result.conversationId)) invalid()
    if (source.origin === 'current_conversation' && source.conversationId !== result.conversationId) invalid()
  })
  const selectedRanks = new Set(sources.filter((source) => source.origin === 'cross_window').map((source) => source.evidence.selection?.rank))
  if (selectedRanks.has(undefined) || selectedRanks.size !== result.selection.crossWindowSelectedCount) invalid()
  return result
}

export function parseConversationContextSettings(value: unknown, expectedConversationId?: string): ConversationContextSettings {
  const item = exactRecord(value, ['contractVersion', 'conversationId', 'personalDefault', 'conversation', 'effective', 'externalCall'])
  const personalDefault = exactRecord(item.personalDefault, ['mode', 'source'])
  const effective = exactRecord(item.effective, ['mode', 'excludedSourceRefs', 'unavailableExcludedSourceRefs', 'source'])
  const conversation = item.conversation === null ? null : exactRecord(item.conversation, ['mode', 'excludedSourceRefs', 'unavailableExcludedSourceRefs', 'version', 'updatedAt'])
  const parseControls = (target: Record<string, unknown>) => {
    const mode = oneOf(target.mode, ['concise', 'balanced', 'complete', 'custom'] as const)
    const excludedSourceRefs = refs(target.excludedSourceRefs)
    const unavailableExcludedSourceRefs = refs(target.unavailableExcludedSourceRefs)
    if (mode !== 'custom' && (excludedSourceRefs.length || unavailableExcludedSourceRefs.length)) invalid()
    return { mode, excludedSourceRefs, unavailableExcludedSourceRefs }
  }
  const result: ConversationContextSettings = {
    contractVersion: oneOf(item.contractVersion, [R4_CONTEXT_CONTRACT_VERSION] as const),
    conversationId: text(item.conversationId),
    personalDefault: { mode: oneOf(personalDefault.mode, ['concise', 'balanced', 'complete', 'custom'] as const), source: oneOf(personalDefault.source, ['assistant_settings'] as const) },
    conversation: conversation ? { ...parseControls(conversation), version: integer(conversation.version), updatedAt: time(conversation.updatedAt) } : null,
    effective: { ...parseControls(effective), source: oneOf(effective.source, ['conversation', 'personal_default'] as const) },
    externalCall: oneOf(item.externalCall, ['not_performed'] as const),
  }
  if (expectedConversationId && result.conversationId !== expectedConversationId) invalid()
  if (result.effective.source === 'conversation' && !result.conversation) invalid()
  if (result.effective.source === 'personal_default' && result.conversation) invalid()
  if (!result.conversation) {
    if (result.effective.mode !== result.personalDefault.mode || result.effective.excludedSourceRefs.length || result.effective.unavailableExcludedSourceRefs.length) invalid()
  } else {
    if (result.effective.mode !== result.conversation.mode) invalid()
    if (!sameArray(result.effective.unavailableExcludedSourceRefs, result.conversation.unavailableExcludedSourceRefs)) invalid()
    if (result.effective.excludedSourceRefs.some((sourceRef) => result.effective.unavailableExcludedSourceRefs.includes(sourceRef))) invalid()
    if (!sameSet(result.conversation.excludedSourceRefs, [...result.effective.excludedSourceRefs, ...result.effective.unavailableExcludedSourceRefs])) invalid()
  }
  return result
}

export function parseContextEvidence(value: unknown, expectedSourceRef?: string): ContextEvidence {
  const item = record(value)
  const sourceRef = text(item.sourceRef, 512)
  if (expectedSourceRef && sourceRef !== expectedSourceRef) invalid()
  const sourceType = oneOf(item.sourceType, ['message_version', 'event', 'summary'] as const)
  const common = { sourceRef, contentHash: hash(item.contentHash), externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
  if (sourceType === 'message_version') {
    exactRecord(item, ['sourceRef', 'sourceType', 'conversationId', 'branchId', 'messageId', 'messageVersionId', 'senderType', 'content', 'createdAt', 'contentHash', 'externalCall'])
    return {
    ...common, sourceType, conversationId: text(item.conversationId), branchId: text(item.branchId), messageId: text(item.messageId),
    messageVersionId: text(item.messageVersionId), senderType: oneOf(item.senderType, ['user', 'subject'] as const), content: text(item.content, 32_768, true), createdAt: time(item.createdAt),
  }
  }
  if (sourceType === 'event') {
    exactRecord(item, ['sourceRef', 'sourceType', 'conversationId', 'branchId', 'eventId', 'eventType', 'summary', 'data', 'occurredAt', 'contentHash', 'externalCall'])
    return {
    ...common, sourceType, conversationId: nullableText(item.conversationId), branchId: nullableText(item.branchId), eventId: text(item.eventId), eventType: text(item.eventType, 120),
    summary: text(item.summary, 2000, true), data: serializable(item.data), occurredAt: time(item.occurredAt),
  }
  }
  exactRecord(item, ['sourceRef', 'sourceType', 'conversationId', 'branchId', 'summaryId', 'structuredSummary', 'sourceRefs', 'sourceHashes', 'createdAt', 'contentHash', 'externalCall'])
  const conversationId = text(item.conversationId)
  const branchId = text(item.branchId)
  const summaryId = text(item.summaryId)
  const sourceRefs = refs(item.sourceRefs, Number.MAX_SAFE_INTEGER)
  if (!Array.isArray(item.sourceHashes) || item.sourceHashes.length !== sourceRefs.length) invalid()
  const sourceHashes = item.sourceHashes.map((value, index) => {
    const entry = exactRecord(value, ['sourceRef', 'contentHash'])
    const parsed = { sourceRef: text(entry.sourceRef, 512), contentHash: hash(entry.contentHash) }
    if (parsed.sourceRef !== sourceRefs[index]) invalid()
    return parsed
  })
  const structured = exactRecord(item.structuredSummary, ['schemaVersion', 'summaryId', 'scope', 'decisions', 'tasks', 'unresolvedItems', 'importantRelationships', 'supportingExcerpts', 'sourceRefs', 'createdAt'])
  const structuredScope = exactRecord(structured.scope, ['conversationId', 'branchId'])
  const parseSummaryStrings = (input: unknown) => {
    if (!Array.isArray(input) || input.length > 8) invalid()
    return input.map((entry) => text(entry, 2048, true))
  }
  const structuredSummary: StructuredContextSummary = {
    schemaVersion: oneOf(structured.schemaVersion, [R4_CONTEXT_SUMMARY_VERSION] as const),
    summaryId: text(structured.summaryId),
    scope: { conversationId: text(structuredScope.conversationId), branchId: text(structuredScope.branchId) },
    decisions: parseSummaryStrings(structured.decisions),
    tasks: parseSummaryStrings(structured.tasks),
    unresolvedItems: parseSummaryStrings(structured.unresolvedItems),
    importantRelationships: parseSummaryStrings(structured.importantRelationships),
    supportingExcerpts: parseSummaryStrings(structured.supportingExcerpts),
    sourceRefs: refs(structured.sourceRefs, Number.MAX_SAFE_INTEGER),
    createdAt: time(structured.createdAt),
  }
  if (structuredSummary.summaryId !== summaryId || structuredSummary.scope.conversationId !== conversationId || structuredSummary.scope.branchId !== branchId || !sameArray(structuredSummary.sourceRefs, sourceRefs)) invalid()
  return {
    ...common, sourceType, conversationId, branchId, summaryId,
    structuredSummary, sourceRefs, sourceHashes, createdAt: time(item.createdAt),
  }
}

export function parseContextRecoveryResult(value: unknown, expectedTurnId?: string): ContextRecoveryResult {
  const item = exactRecord(value, ['context', 'turn', 'externalCall'])
  const context = parseContextAssembly(item.context, expectedTurnId ? { turnId: expectedTurnId } : undefined)
  const turn = parsePersonalChatTurn(item.turn)
  const externalCall = oneOf(item.externalCall, ['not_performed', 'performed'] as const)
  if (context.state !== 'locked' || context.turnId !== turn.turnId || context.conversationId !== turn.conversationId || (expectedTurnId && turn.turnId !== expectedTurnId) || externalCall !== turn.externalCall) invalid()
  return { context, turn, externalCall }
}

function query(input: { branchId: string; mode: ContextMode; excludedSourceRefs: string[] }) {
  const value = new URLSearchParams({ branchId: input.branchId, mode: input.mode })
  input.excludedSourceRefs.forEach((sourceRef) => value.append('excludeSourceRef', sourceRef))
  return value.toString()
}

export function createPersonalContextApi(api: PersonalApi) {
  return {
    async settings(conversationId: string, options?: PersonalRequestOptions) {
      return parseConversationContextSettings(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/context-settings`, 'GET', undefined, options), conversationId)
    },
    async updateSettings(conversationId: string, input: { mode: ContextMode; excludedSourceRefs: string[]; expectedVersion: number }, key: string, options?: PersonalRequestOptions) {
      return parseConversationContextSettings(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/context-settings`, 'PATCH', input, { ...options, idempotencyKey: key }), conversationId)
    },
    async plan(conversationId: string, input: { branchId: string; mode: ContextMode; excludedSourceRefs: string[] }, options?: PersonalRequestOptions) {
      return parseContextAssembly(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/context-plan?${query(input)}`, 'GET', undefined, options), { conversationId, branchId: input.branchId })
    },
    async snapshot(turnId: string, options?: PersonalRequestOptions) {
      return parseContextAssembly(await api.request(`/chat/turns/${encodeURIComponent(turnId)}/context`, 'GET', undefined, options), { turnId })
    },
    async evidence(sourceRef: string, options?: PersonalRequestOptions) {
      return parseContextEvidence(await api.request(`/chat/context-sources/${encodeURIComponent(sourceRef)}`, 'GET', undefined, options), sourceRef)
    },
    async retryFold(turnId: string, key: string, options?: PersonalRequestOptions): Promise<ContextRecoveryResult> {
      return parseContextRecoveryResult(await api.request(`/chat/turns/${encodeURIComponent(turnId)}/context-recovery`, 'POST', { action: 'retry_fold' }, { ...options, idempotencyKey: key }), turnId)
    },
  }
}

export type PersonalContextApi = ReturnType<typeof createPersonalContextApi>
