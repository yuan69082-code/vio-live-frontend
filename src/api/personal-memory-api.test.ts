import { describe, expect, it, vi } from 'vitest'
import type { PersonalApi } from './personal-api'
import {
  MEMORY_CONTRACT_VERSION,
  MEMORY_EXPORT_VERSION,
  MEMORY_IMPORT_VERSION,
  createPersonalMemoryApi,
  parseMemory,
  parseMemoryDeletion,
  parseMemoryList,
  parseMemoryRecovery,
  parseMemoryVersions,
} from './personal-memory-api'

const at = '2026-09-08T00:00:00.000Z'
const digest = `sha256:${'a'.repeat(64)}`
const source = { sourceType: 'manual', sourceRef: 'manual:operation-r5', sourceContentHash: digest }
const memory = {
  contractVersion: MEMORY_CONTRACT_VERSION, memoryId: 'memory-r5', assistantId: 'assistant-current', kind: 'preference', currentVersionId: 'memory-version-r5', version: 1,
  body: '只属于当前助手的真实记忆', summary: '偏好摘要', source, occurredAt: null, recordedAt: at, includeInContext: true,
  visibilityScope: 'current_assistant', sensitivity: 'normal', status: 'active',
  retention: { deletionState: 'not_requested', deletionId: null, requestedAt: null, finalizedAt: null }, updatedAt: at, externalCall: 'not_performed',
}
const operation = (operationType = 'memory.create', resourceType = 'memory', resourceId: string | null = 'memory-r5', status = 'completed') => ({
  operationId: 'operation-r5', operationType, status, resourceType, resourceId, errorCode: status === 'failed' ? 'MEMORY_OPERATION_INTERRUPTED' : null,
  createdAt: at, completedAt: ['processing', 'confirmation_required'].includes(status) ? null : at,
})
const write = { contractVersion: MEMORY_CONTRACT_VERSION, operationStatus: 'completed', operation: operation(), memory, reference: null, deletion: null, confirmation: null, externalCall: 'not_performed' }
const list = { contractVersion: MEMORY_CONTRACT_VERSION, items: [memory], nextCursor: 'opaque-cursor', query: '真实', selection: { strategy: 'lexical-overlap-recency/v1', scope: 'current_owner_current_assistant' }, externalCall: 'not_performed' }

describe('R5 personal memory API', () => {
  it('strictly parses memory ownership, retention and body boundaries without accepting drift', () => {
    expect(parseMemory(memory)).toMatchObject({ memoryId: 'memory-r5', assistantId: 'assistant-current', body: '只属于当前助手的真实记忆' })
    expect(() => parseMemory({ ...memory, userId: 'forbidden' })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseMemory({ ...memory, retention: { ...memory.retention, deletionState: 'requested' } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseMemory({ ...memory, body: 'x'.repeat(8193) })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    const pending = { ...memory, status: 'deletion_pending', retention: { deletionState: 'requested', deletionId: 'deletion-r5', requestedAt: at, finalizedAt: null } }
    expect(parseMemory(pending)).toMatchObject({ status: 'deletion_pending', retention: { deletionId: 'deletion-r5' } })
  })

  it('validates list selection, immutable version chains and deletion body retention', () => {
    expect(parseMemoryList(list)).toMatchObject({ items: [{ memoryId: 'memory-r5' }], nextCursor: 'opaque-cursor' })
    expect(() => parseMemoryList({ ...list, selection: { ...list.selection, future: true } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    const version = { memoryVersionId: 'memory-version-r5', memoryId: 'memory-r5', version: 1, kind: 'preference', body: memory.body, summary: memory.summary, source, occurredAt: null, recordedAt: at, includeInContext: true, visibilityScope: 'current_assistant', sensitivity: 'normal', contentHash: digest, previousVersionId: null, externalCall: 'not_performed' }
    expect(parseMemoryVersions({ contractVersion: MEMORY_CONTRACT_VERSION, memoryId: 'memory-r5', items: [version], externalCall: 'not_performed' })).toMatchObject({ items: [{ version: 1 }] })
    expect(() => parseMemoryVersions({ contractVersion: MEMORY_CONTRACT_VERSION, memoryId: 'memory-r5', items: [{ ...version, version: 2 }], externalCall: 'not_performed' })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    const pending = { deletionId: 'deletion-r5', memoryId: 'memory-r5', status: 'pending', requestedAt: at, cancelledAt: null, finalizedAt: null, result: 'pending', bodyRetained: true }
    const completed = { ...pending, status: 'completed', result: 'deleted', finalizedAt: at, bodyRetained: false }
    expect(parseMemoryDeletion(pending)).toMatchObject({ bodyRetained: true })
    expect(parseMemoryDeletion(completed)).toMatchObject({ bodyRetained: false })
    expect(() => parseMemoryDeletion({ ...completed, bodyRetained: true })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('uses only frozen current-session routes and sensitive GET headers, never ownership parameters', async () => {
    const request = vi.fn(async (path: string) => path.includes('/operations/') ? write : path.includes('/versions') ? { contractVersion: MEMORY_CONTRACT_VERSION, memoryId: 'memory-r5', items: [], externalCall: 'not_performed' } : path.includes('/references') && path.endsWith('/references') ? { contractVersion: MEMORY_CONTRACT_VERSION, memoryId: 'memory-r5', items: [], externalCall: 'not_performed' } : path === '/memories/memory-r5' ? memory : list)
    const api = createPersonalMemoryApi({ request } as unknown as PersonalApi)
    await api.list({ query: '真实', kind: 'preference', status: 'active', includeInContext: true, cursor: 'cursor / value', limit: 20 }, { confirmationId: 'confirmation-r5', securitySessionId: 'security-r5' })
    await api.detail('memory-r5')
    await api.versions('memory-r5')
    await api.references('memory-r5')
    await api.recover('vio-personal-11111111-1111-4111-8111-111111111111')
    expect(request.mock.calls[0]).toEqual(['/memories?query=%E7%9C%9F%E5%AE%9E&kind=preference&status=active&includeInContext=true&cursor=cursor+%2F+value&limit=20', 'GET', undefined, { confirmationId: 'confirmation-r5', securitySessionId: 'security-r5' }])
    expect(request.mock.calls.map(([path]) => path)).toContain('/memories/operations/by-idempotency-key/vio-personal-11111111-1111-4111-8111-111111111111')
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/userId|assistantId|subjectId|x-vio-user-id/)
  })

  it('preserves exact input and idempotency key across confirmation writes', async () => {
    const confirmation = { contractVersion: MEMORY_CONTRACT_VERSION, operationStatus: 'confirmation_required', operation: operation('memory.create', 'memory', null, 'confirmation_required'), memory: null, reference: null, deletion: null, confirmation: { confirmationId: 'confirmation-r5', status: 'pending' }, externalCall: 'not_performed' }
    const request = vi.fn().mockResolvedValueOnce(confirmation).mockResolvedValueOnce(write)
    const api = createPersonalMemoryApi({ request } as unknown as PersonalApi)
    const key = 'vio-personal-22222222-2222-4222-8222-222222222222'
    const input = { kind: 'preference' as const, body: memory.body, summary: null, occurredAt: null, includeInContext: true, sensitivity: 'sensitive' as const, source: { sourceType: 'manual' as const, sourceRef: null }, confirmationId: null, securitySessionId: null }
    expect((await api.create(input, key)).operationStatus).toBe('confirmation_required')
    await api.create({ ...input, confirmationId: 'confirmation-r5' }, key)
    expect(request.mock.calls).toEqual([
      ['/memories', 'POST', input, { idempotencyKey: key }],
      ['/memories', 'POST', { ...input, confirmationId: 'confirmation-r5' }, { idempotencyKey: key }],
    ])
  })

  it('strictly reconstructs ordinary, import and export recovery envelopes', () => {
    expect(parseMemoryRecovery(write)).toMatchObject({ operationStatus: 'completed', memory: { memoryId: 'memory-r5' } })
    const imported = { contractVersion: MEMORY_IMPORT_VERSION, operationStatus: 'completed', operation: operation('memory.import', 'import', 'import-r5'), import: { importId: 'import-r5', mode: 'atomic', status: 'completed', totalCount: 1, createdCount: 1, reusedCount: 0, invalidCount: 0, conflictCount: 0, items: [{ clientItemId: 'item-1', status: 'created', memoryId: 'memory-r5', errorCode: null }], createdAt: at, completedAt: at }, confirmation: null, externalCall: 'not_performed' }
    expect(parseMemoryRecovery(imported)).toMatchObject({ import: { createdCount: 1 } })
    const exported = { contractVersion: MEMORY_EXPORT_VERSION, operationStatus: 'completed', operation: operation('memory.export', 'export', 'export-r5'), export: { exportId: 'export-r5', format: MEMORY_EXPORT_VERSION, status: 'completed', items: [], itemCount: 0, contentHash: digest, createdAt: at }, confirmation: null, externalCall: 'not_performed' }
    expect(parseMemoryRecovery(exported)).toMatchObject({ export: { itemCount: 0 } })
    expect(() => parseMemoryRecovery({ ...exported, export: { ...exported.export, body: 'forbidden ledger copy' } })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
  })
})
