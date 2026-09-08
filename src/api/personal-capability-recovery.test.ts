import { afterEach, describe, expect, it } from 'vitest'
import {
  clearCapabilityDiscoveryRecovery,
  clearCapabilityRecovery,
  clearCapabilityRecoveryForOwner,
  readCapabilityDiscoveryRecovery,
  readCapabilityRecovery,
  writeCapabilityDiscoveryRecovery,
  writeCapabilityRecovery,
} from './personal-capability-recovery'

afterEach(() => sessionStorage.clear())

describe('R6 capability recovery index', () => {
  it('stores only the opaque key and optional execution id for one owner and assistant', () => {
    writeCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, idempotencyKey: 'vio-r6-key-0001', executionId: 'execution-r6' })
    expect(readCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a')).toEqual({ version: 1, idempotencyKey: 'vio-r6-key-0001', executionId: 'execution-r6' })
    expect(readCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-b')).toBeNull()
    const persisted = JSON.stringify({ ...sessionStorage })
    expect(persisted).not.toMatch(/input|output|credential|authorization/i)
  })

  it('fails closed for malformed facts and only clears the expected key', () => {
    sessionStorage.setItem('vio:personal:capability-execution:owner-a:assistant-a', JSON.stringify({ version: 1, idempotencyKey: 'bad key', executionId: null, input: { secret: true } }))
    expect(readCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
    writeCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, idempotencyKey: 'vio-r6-key-0002', executionId: null })
    clearCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a', 'vio-r6-key-other')
    expect(readCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a')?.idempotencyKey).toBe('vio-r6-key-0002')
    clearCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a', 'vio-r6-key-0002')
    expect(readCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
  })

  it('clears every assistant index for one owner without affecting another owner', () => {
    writeCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, idempotencyKey: 'vio-r6-key-0003', executionId: null })
    writeCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-b', { version: 1, idempotencyKey: 'vio-r6-key-0004', executionId: null })
    writeCapabilityRecovery(sessionStorage, 'owner-b', 'assistant-a', { version: 1, idempotencyKey: 'vio-r6-key-0005', executionId: null })
    clearCapabilityRecoveryForOwner(sessionStorage, 'owner-a')
    expect(readCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
    expect(readCapabilityRecovery(sessionStorage, 'owner-a', 'assistant-b')).toBeNull()
    expect(readCapabilityRecovery(sessionStorage, 'owner-b', 'assistant-a')).not.toBeNull()
  })

  it('persists only the opaque MCP discovery lookup index and clears it by expected key', () => {
    writeCapabilityDiscoveryRecovery(sessionStorage, 'owner-a', 'assistant-a', {
      version: 1,
      idempotencyKey: 'vio-r6-discovery-0001',
      capabilityId: 'cap-mcp-001',
    })
    expect(readCapabilityDiscoveryRecovery(sessionStorage, 'owner-a', 'assistant-a')).toEqual({
      version: 1,
      idempotencyKey: 'vio-r6-discovery-0001',
      capabilityId: 'cap-mcp-001',
    })
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/serviceUrl|description|credential|authorization|response/i)
    clearCapabilityDiscoveryRecovery(sessionStorage, 'owner-a', 'assistant-a', 'vio-r6-discovery-other')
    expect(readCapabilityDiscoveryRecovery(sessionStorage, 'owner-a', 'assistant-a')).not.toBeNull()
    clearCapabilityDiscoveryRecovery(sessionStorage, 'owner-a', 'assistant-a', 'vio-r6-discovery-0001')
    expect(readCapabilityDiscoveryRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
  })

  it('owner cleanup also removes every discovery index without touching another owner', () => {
    writeCapabilityDiscoveryRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, idempotencyKey: 'vio-r6-discovery-0002', capabilityId: 'cap-mcp-a' })
    writeCapabilityDiscoveryRecovery(sessionStorage, 'owner-b', 'assistant-a', { version: 1, idempotencyKey: 'vio-r6-discovery-0003', capabilityId: 'cap-mcp-b' })
    clearCapabilityRecoveryForOwner(sessionStorage, 'owner-a')
    expect(readCapabilityDiscoveryRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
    expect(readCapabilityDiscoveryRecovery(sessionStorage, 'owner-b', 'assistant-a')).not.toBeNull()
  })
})
