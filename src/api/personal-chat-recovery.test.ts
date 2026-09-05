import { beforeEach, describe, expect, it } from 'vitest'
import { clearPersonalChatRecoveryForOwner, readPersonalChatRecovery, writePersonalChatRecovery } from './personal-chat-recovery'

describe('personal chat recovery storage', () => {
  beforeEach(() => sessionStorage.clear())
  it('stores only random keys and necessary turn/action indexes, never content', () => {
    writePersonalChatRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, kind: 'turn', idempotencyKey: 'vio-chat-11111111-1111-4111-8111-111111111111', turnId: 'turn-a' })
    const raw = sessionStorage.getItem(sessionStorage.key(0)!)!
    expect(raw).not.toContain('message')
    expect(readPersonalChatRecovery(sessionStorage, 'owner-a', 'assistant-a')).toEqual({ version: 1, kind: 'turn', idempotencyKey: 'vio-chat-11111111-1111-4111-8111-111111111111', turnId: 'turn-a' })
    expect(readPersonalChatRecovery(sessionStorage, 'owner-a', 'assistant-b')).toBeNull()
  })
  it('rejects an old fact containing message content and clears only the current owner on logout', () => {
    sessionStorage.setItem('vio:personal:chat:recovery:v1:owner-a:assistant-a', JSON.stringify({ version: 1, kind: 'turn', idempotencyKey: 'vio-chat-11111111-1111-4111-8111-111111111111', content: 'private' }))
    writePersonalChatRecovery(sessionStorage, 'owner-b', 'assistant-b', { version: 1, kind: 'turn', idempotencyKey: 'vio-chat-22222222-2222-4222-8222-222222222222' })
    expect(readPersonalChatRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
    clearPersonalChatRecoveryForOwner(sessionStorage, 'owner-a')
    expect(readPersonalChatRecovery(sessionStorage, 'owner-b', 'assistant-b')).not.toBeNull()
  })
})
