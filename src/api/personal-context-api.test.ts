import { describe, expect, it, vi } from 'vitest'
import type { PersonalApi } from './personal-api'
import {
  createPersonalContextApi,
  parseContextAssembly,
  parseContextEvidence,
  parseContextRecoveryResult,
  parseConversationContextSettings,
} from './personal-context-api'

const at = '2026-09-06T08:00:00.000Z'
const digest = `sha256:${'a'.repeat(64)}`
const slots = [
  ['system_rules', 'included'],
  ['assistant_settings', 'included'],
  ['runtime_projection', 'not_available'],
  ['unresolved_events', 'empty'],
  ['recent_original_text', 'included'],
  ['long_term_memory', 'empty'],
  ['current_user_message', 'pending'],
].map(([slot, status]) => ({ slot, status }))
const source = {
  sourceRef: 'message-version:version-cross', sourceType: 'message_version', slot: 'recent_original_text', origin: 'cross_window', status: 'included', reason: null,
  conversationId: 'conversation-other', branchId: 'branch-other', messageId: 'message-cross', messageVersionId: 'version-cross', eventId: null, summaryId: null,
  contentHash: digest, estimatedTokens: 21, createdAt: at, evidence: { senderType: 'user', versionKind: 'original', preview: '旧窗口证据', selection: { strategy: 'lexical-overlap-recency/v1', relevanceScore: 7, matchedTermCount: 2, rank: 1, representation: 'original_fallback' } },
}
const plan = {
  contractVersion: 'vio-context-assembly/v1', schemaVersion: 'vio-context-assembly-snapshot/v1', assemblyId: null, turnId: null,
  conversationId: 'conversation-r4', branchId: 'branch-r4', mode: 'balanced', controlsSource: 'turn', state: 'planned',
  scope: { currentOwner: true, currentAssistant: true, currentConversationExcludedFromCrossWindow: true }, controls: { excludedSourceRefs: [], unavailableExcludedSourceRefs: [] }, slots, sources: [source],
  budget: { estimationMethod: 'utf8-byte-upper-bound/v1', contextLimitTokens: 16384, reservedOutputTokens: 4096, inputBudgetTokens: 12288, rawEstimatedInputTokens: 120, estimatedInputTokens: 120, withinLimit: true, foldPlanned: false, trimmingApplied: false, trimmingReason: null },
  folding: { status: 'not_required', summaryId: null, reason: null, sourceSetHash: null, sourceCount: 0, recoveryAction: null },
  selection: { strategy: 'lexical-overlap-recency/v1', status: 'provisional', querySource: 'conversation_history', crossWindowCandidateCount: 1, crossWindowSelectedCount: 1 },
  runtimeProjection: { status: 'not_available', sourceRef: null }, memory: { status: 'empty', selectionStrategy: 'lexical-overlap-recency/v1', eligibleCount: 0, selectedCount: 0 },
  planHash: digest, providerMessagesHash: null, snapshotHash: null, createdAt: at, lockedAt: null, externalCall: 'not_performed',
}
const settings = {
  contractVersion: 'vio-context-assembly/v1', conversationId: 'conversation-r4', personalDefault: { mode: 'balanced', source: 'assistant_settings' },
  conversation: { mode: 'custom', excludedSourceRefs: ['message-version:version-cross'], unavailableExcludedSourceRefs: [], version: 2, updatedAt: at },
  effective: { mode: 'custom', excludedSourceRefs: ['message-version:version-cross'], unavailableExcludedSourceRefs: [], source: 'conversation' }, externalCall: 'not_performed',
}
const lockedContext = { ...plan, assemblyId: 'assembly-r4', turnId: 'turn-r4', state: 'locked', selection: { ...plan.selection, status: 'final', querySource: 'current_user_message' }, providerMessagesHash: digest, snapshotHash: digest, lockedAt: at }

describe('R4 personal context API', () => {
  it('strictly parses a scoped plan, fixed slot order and deterministic budget', () => {
    expect(parseContextAssembly(plan, { conversationId: 'conversation-r4', branchId: 'branch-r4' })).toMatchObject({ mode: 'balanced', sources: [{ origin: 'cross_window' }], memory: { status: 'empty', selectedCount: 0 } })
    expect(() => parseContextAssembly({ ...plan, conversationId: 'foreign' }, { conversationId: 'conversation-r4' })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, slots: [...slots].reverse() })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, budget: { ...plan.budget, withinLimit: false } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, sources: [{ ...source, conversationId: 'conversation-r4' }] })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, selection: { ...plan.selection, status: 'final' } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('accepts R5 unavailable and trimmed only for the long-term-memory slot', () => {
    const memorySlots = (status: 'unavailable' | 'trimmed') => slots.map((entry) => entry.slot === 'long_term_memory' ? { ...entry, status } : entry)
    expect(parseContextAssembly({ ...plan, slots: memorySlots('unavailable'), memory: { ...plan.memory, status: 'unavailable' } })).toMatchObject({ memory: { status: 'unavailable' }, slots: expect.arrayContaining([{ slot: 'long_term_memory', status: 'unavailable' }]) })
    expect(parseContextAssembly({ ...plan, slots: memorySlots('trimmed'), memory: { ...plan.memory, status: 'trimmed', eligibleCount: 1 } })).toMatchObject({ memory: { status: 'trimmed', eligibleCount: 1 } })
    expect(() => parseContextAssembly({ ...plan, slots: slots.map((entry) => entry.slot === 'system_rules' ? { ...entry, status: 'unavailable' } : entry) })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, slots: memorySlots('unavailable'), memory: plan.memory })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('accepts post-fold sendability and keeps failed candidates distinct from locked snapshots', () => {
    const foldPlan = { ...plan, budget: { ...plan.budget, rawEstimatedInputTokens: 16000, estimatedInputTokens: 7000, foldPlanned: true }, folding: { status: 'planned', summaryId: null, reason: null, sourceSetHash: digest, sourceCount: 9, recoveryAction: null } }
    expect(parseContextAssembly(foldPlan)).toMatchObject({ state: 'planned', budget: { rawEstimatedInputTokens: 16000, estimatedInputTokens: 7000, withinLimit: true }, folding: { status: 'planned', sourceCount: 9 } })
    const failed = { ...foldPlan, assemblyId: 'assembly-failed', turnId: 'turn-failed', state: 'fold_failed', selection: { ...plan.selection, status: 'final', querySource: 'current_user_message' }, budget: { ...foldPlan.budget, estimatedInputTokens: 16000, withinLimit: false }, folding: { status: 'failed', summaryId: 'summary-failed', reason: 'CONTEXT_FOLDING_FAILED', sourceSetHash: digest, sourceCount: 9, recoveryAction: 'retry_fold' } }
    expect(parseContextAssembly(failed)).toMatchObject({ state: 'fold_failed', providerMessagesHash: null, snapshotHash: null, folding: { recoveryAction: 'retry_fold' } })
    expect(() => parseContextAssembly({ ...failed, providerMessagesHash: digest })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...foldPlan, budget: { ...foldPlan.budget, withinLimit: false } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('rejects unknown fields and every unfrozen assembly status at its exact boundary', () => {
    expect(() => parseContextAssembly({ ...plan, futureField: true })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, scope: { ...plan.scope, ownerId: 'hidden' } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, slots: plan.slots.map((slot, index) => index === 0 ? { ...slot, status: 'future_status' } : slot) })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, folding: { ...plan.folding, status: 'silent_drop' } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, runtimeProjection: { ...plan.runtimeProjection, status: 'connected' } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...plan, sources: [{ ...source, evidence: { ...source.evidence, unknown: true } }] })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('parses persisted settings and rejects impossible effective sources or non-custom exclusions', () => {
    expect(parseConversationContextSettings(settings, 'conversation-r4')).toEqual(settings)
    expect(() => parseConversationContextSettings({ ...settings, conversation: null }, 'conversation-r4')).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseConversationContextSettings({ ...settings, conversation: { ...settings.conversation, mode: 'balanced' } }, 'conversation-r4')).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseConversationContextSettings({ ...settings, effective: { ...settings.effective, futureField: true } }, 'conversation-r4')).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(parseConversationContextSettings({ ...settings, conversation: { ...settings.conversation, excludedSourceRefs: ['message-version:version-cross', 'message-version:removed'], unavailableExcludedSourceRefs: ['message-version:removed'] }, effective: { ...settings.effective, unavailableExcludedSourceRefs: ['message-version:removed'] } }, 'conversation-r4')).toMatchObject({ effective: { excludedSourceRefs: ['message-version:version-cross'], unavailableExcludedSourceRefs: ['message-version:removed'] } })
    expect(() => parseConversationContextSettings({ ...settings, effective: { ...settings.effective, unavailableExcludedSourceRefs: ['message-version:version-cross'] } }, 'conversation-r4')).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('parses exact message, event and structured-summary evidence', () => {
    const message = { sourceRef: source.sourceRef, sourceType: 'message_version', conversationId: 'conversation-other', branchId: 'branch-other', messageId: 'message-cross', messageVersionId: 'version-cross', senderType: 'user', content: '精确版本正文', createdAt: at, contentHash: digest, externalCall: 'not_performed' }
    const event = { sourceRef: 'event:event-r4', sourceType: 'event', conversationId: null, branchId: null, eventId: 'event-r4', eventType: 'conversation.changed', summary: '会话发生变化', data: { status: 'open' }, occurredAt: at, contentHash: digest, externalCall: 'not_performed' }
    const structuredSummary = { schemaVersion: 'vio-context-summary/v1', summaryId: 'summary-r4', scope: { conversationId: 'conversation-other', branchId: 'branch-other' }, decisions: ['保留来源'], tasks: [], unresolvedItems: [], importantRelationships: [], supportingExcerpts: ['旧窗口证据'], sourceRefs: [source.sourceRef], createdAt: at }
    const summary = { sourceRef: 'summary:summary-r4', sourceType: 'summary', conversationId: 'conversation-other', branchId: 'branch-other', summaryId: 'summary-r4', structuredSummary, sourceRefs: [source.sourceRef], sourceHashes: [{ sourceRef: source.sourceRef, contentHash: digest }], createdAt: at, contentHash: digest, externalCall: 'not_performed' }
    expect(parseContextEvidence(message, source.sourceRef)).toMatchObject({ sourceType: 'message_version', content: '精确版本正文' })
    expect(parseContextEvidence(event)).toMatchObject({ sourceType: 'event', data: { status: 'open' } })
    expect(parseContextEvidence(summary)).toMatchObject({ sourceType: 'summary', sourceRefs: [source.sourceRef] })
    expect(() => parseContextEvidence({ ...message, contentHash: 'not-a-hash' })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextEvidence({ ...message, rawOwnerId: 'forbidden' })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextEvidence({ ...summary, structuredSummary: { ...structuredSummary, futureField: true } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextEvidence({ ...summary, sourceRefs: ['message-version:other'] })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    const secondRef = 'message-version:version-second'
    const twoSources = { ...summary, sourceRefs: [source.sourceRef, secondRef], sourceHashes: [{ sourceRef: source.sourceRef, contentHash: digest }, { sourceRef: secondRef, contentHash: `sha256:${'b'.repeat(64)}` }], structuredSummary: { ...structuredSummary, sourceRefs: [source.sourceRef, secondRef] } }
    expect(parseContextEvidence(twoSources)).toMatchObject({ sourceHashes: [{ sourceRef: source.sourceRef }, { sourceRef: secondRef }] })
    expect(() => parseContextEvidence({ ...twoSources, sourceHashes: [...twoSources.sourceHashes].reverse() })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextEvidence({ ...summary, sourceHashes: [{ ...summary.sourceHashes[0], futureField: true }] })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('parses the exact R5 memory slot and keeps its three hashes distinct', () => {
    const memoryHash = `sha256:${'b'.repeat(64)}`
    const sourceHash = `sha256:${'c'.repeat(64)}`
    const memorySource = {
      sourceRef: 'memory-slot:memory-r5:memory-version-r5', sourceType: 'memory_slot', slot: 'long_term_memory', origin: 'memory', status: 'included', reason: null,
      conversationId: null, branchId: null, messageId: null, messageVersionId: null, eventId: null, summaryId: null,
      contentHash: digest, estimatedTokens: 18, createdAt: at,
      evidence: { memoryId: 'memory-r5', memoryVersionId: 'memory-version-r5', kind: 'preference', sourceType: 'manual', sourceRef: 'manual:operation-r5', sourceContentHash: sourceHash, memoryContentHash: memoryHash, selection: { strategy: 'lexical-overlap-recency/v1', relevanceScore: 9, matchedTermCount: 2, rank: 1 }, preview: '用户明确保存的偏好' },
    }
    const withMemory = { ...plan, slots: slots.map((entry) => entry.slot === 'long_term_memory' ? { ...entry, status: 'included' } : entry), sources: [source, memorySource], memory: { status: 'included', selectionStrategy: 'lexical-overlap-recency/v1', eligibleCount: 1, selectedCount: 1 } }
    expect(parseContextAssembly(withMemory)).toMatchObject({ memory: { status: 'included', selectedCount: 1 }, sources: [{ sourceType: 'message_version' }, { sourceType: 'memory_slot', evidence: { memoryContentHash: memoryHash, sourceContentHash: sourceHash } }] })
    expect(() => parseContextAssembly({ ...withMemory, sources: [source, { ...memorySource, origin: 'cross_window' }] })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextAssembly({ ...withMemory, sources: [source, { ...memorySource, evidence: { ...memorySource.evidence, selection: { ...memorySource.evidence.selection, representation: 'original_fallback' } } }] })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    const evidence = { sourceRef: memorySource.sourceRef, sourceType: 'memory_slot', memoryId: 'memory-r5', memoryVersionId: 'memory-version-r5', kind: 'preference', body: '用户明确保存的偏好', source: { sourceType: 'manual', sourceRef: 'manual:operation-r5', sourceContentHash: sourceHash }, occurredAt: null, recordedAt: at, memoryContentHash: memoryHash, contentHash: digest, externalCall: 'not_performed' }
    expect(parseContextEvidence(evidence, memorySource.sourceRef)).toMatchObject({ sourceType: 'memory_slot', memoryId: 'memory-r5', body: '用户明确保存的偏好', memoryContentHash: memoryHash })
    expect(() => parseContextEvidence({ ...evidence, ownerId: 'forbidden' })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextEvidence({ ...evidence, memoryContentHash: digest.slice(0, -1) })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('uses only frozen personal-session routes, context controls and idempotency keys', async () => {
    const calls: unknown[][] = []
    const request = vi.fn(async (...args: unknown[]) => {
      calls.push(args)
      const path = String(args[0])
      if (path.endsWith('/context-settings')) return settings
      if (path.includes('/context-plan?')) return plan
      if (path.includes('/context-sources/')) return { sourceRef: source.sourceRef, sourceType: 'message_version', conversationId: 'conversation-other', branchId: 'branch-other', messageId: 'message-cross', messageVersionId: 'version-cross', senderType: 'user', content: '精确版本正文', createdAt: at, contentHash: digest, externalCall: 'not_performed' }
      if (path.endsWith('/context-recovery')) return { context: lockedContext, turn: { turnId: 'turn-r4', conversationId: 'conversation-r4', status: 'processing', createdAt: at, updatedAt: at, completedAt: null, userMessage: { messageId: 'message-r4', messageVersionId: 'version-r4', senderType: 'user', content: '当前指令', sequenceNumber: 1, createdAt: at }, assistantMessage: null, confirmation: null, error: null, execution: null, externalCall: 'not_performed' }, externalCall: 'not_performed' }
      return lockedContext
    })
    const api = createPersonalContextApi({ request } as unknown as PersonalApi)
    const key = 'vio-r4-11111111-1111-4111-8111-111111111111'
    await api.settings('conversation-r4')
    await api.updateSettings('conversation-r4', { mode: 'custom', excludedSourceRefs: [source.sourceRef], expectedVersion: 2 }, key)
    await api.plan('conversation-r4', { branchId: 'branch-r4', mode: 'custom', excludedSourceRefs: [source.sourceRef] })
    await api.snapshot('turn-r4')
    await api.evidence(source.sourceRef)
    await api.retryFold('turn-r4', key)
    expect(calls).toEqual([
      ['/chat/conversations/conversation-r4/context-settings', 'GET', undefined, undefined],
      ['/chat/conversations/conversation-r4/context-settings', 'PATCH', { mode: 'custom', excludedSourceRefs: [source.sourceRef], expectedVersion: 2 }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r4/context-plan?branchId=branch-r4&mode=custom&excludeSourceRef=message-version%3Aversion-cross', 'GET', undefined, undefined],
      ['/chat/turns/turn-r4/context', 'GET', undefined, undefined],
      ['/chat/context-sources/message-version%3Aversion-cross', 'GET', undefined, undefined],
      ['/chat/turns/turn-r4/context-recovery', 'POST', { action: 'retry_fold' }, { idempotencyKey: key }],
    ])
    expect(JSON.stringify(calls)).not.toMatch(/userId|assistantId|subjectId|x-vio-user-id|LOCAL_CONVERSATION_PROFILE/)
  })

  it('strictly parses the fold recovery wrapper and rejects response drift', () => {
    const turn = { turnId: 'turn-r4', conversationId: 'conversation-r4', status: 'processing', createdAt: at, updatedAt: at, completedAt: null, userMessage: { messageId: 'message-r4', messageVersionId: 'version-r4', senderType: 'user', content: '当前指令', sequenceNumber: 1, createdAt: at }, assistantMessage: null, confirmation: null, error: null, execution: null, externalCall: 'not_performed' }
    const context = lockedContext
    expect(parseContextRecoveryResult({ context, turn, externalCall: 'not_performed' }, 'turn-r4')).toMatchObject({ context: { state: 'locked' }, turn: { turnId: 'turn-r4' } })
    expect(() => parseContextRecoveryResult({ context, turn, externalCall: 'not_performed', futureField: true }, 'turn-r4')).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseContextRecoveryResult({ context, turn: { ...turn, turnId: 'other-turn' }, externalCall: 'not_performed' }, 'turn-r4')).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })
})
