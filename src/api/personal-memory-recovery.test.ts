import { beforeEach, describe, expect, it } from 'vitest'
import { clearMemoryRecovery, clearMemoryRecoveryForOwner, createMemoryOperationKey, readMemoryRecovery, writeMemoryRecovery } from './personal-memory-recovery'

beforeEach(() => sessionStorage.clear())

describe('R5 memory recovery index', () => {
  it('stores only opaque operation facts and isolates owner plus assistant scope', () => {
    const key = createMemoryOperationKey()
    writeMemoryRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, idempotencyKey: key, operationType: 'memory.edit', memoryId: 'memory-a' })
    expect(readMemoryRecovery(sessionStorage, 'owner-a', 'assistant-a')).toEqual({ version: 1, idempotencyKey: key, operationType: 'memory.edit', memoryId: 'memory-a' })
    expect(readMemoryRecovery(sessionStorage, 'owner-a', 'assistant-b')).toBeNull()
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/memory body|summary|credential|passphrase/)
  })

  it('rejects body-bearing or malformed cache facts', () => {
    sessionStorage.setItem('vio:personal:memory:r5:recovery:v1:owner-a:assistant-a', JSON.stringify({ version: 1, idempotencyKey: createMemoryOperationKey(), operationType: 'memory.create', body: 'forbidden body' }))
    expect(readMemoryRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
  })

  it('does not let a late completion clear a replacement and clears only the selected owner', () => {
    const oldKey = createMemoryOperationKey(); const nextKey = createMemoryOperationKey(); const otherKey = createMemoryOperationKey()
    writeMemoryRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, idempotencyKey: oldKey, operationType: 'memory.create' })
    writeMemoryRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, idempotencyKey: nextKey, operationType: 'memory.edit', memoryId: 'memory-a' })
    writeMemoryRecovery(sessionStorage, 'owner-b', 'assistant-b', { version: 1, idempotencyKey: otherKey, operationType: 'memory.export' })
    clearMemoryRecovery(sessionStorage, 'owner-a', 'assistant-a', oldKey)
    expect(readMemoryRecovery(sessionStorage, 'owner-a', 'assistant-a')?.idempotencyKey).toBe(nextKey)
    clearMemoryRecoveryForOwner(sessionStorage, 'owner-a')
    expect(readMemoryRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
    expect(readMemoryRecovery(sessionStorage, 'owner-b', 'assistant-b')?.idempotencyKey).toBe(otherKey)
  })
})
