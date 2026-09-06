import { beforeEach, describe, expect, it } from 'vitest'
import { clearMultiChatRecoveryForOwner, readMultiChatRecovery, writeMultiChatRecovery } from './personal-multi-chat-recovery'

describe('R3 multi-conversation recovery index', () => {
  beforeEach(() => sessionStorage.clear())

  it('persists only random keys and necessary opaque indexes', () => {
    writeMultiChatRecovery(sessionStorage, 'owner-a', 'assistant-a', {
      version: 1,
      idempotencyKey: 'vio-r3-11111111-1111-4111-8111-111111111111',
      operationType: 'conversation.turn',
      conversationId: 'conversation-a',
      branchId: 'branch-a',
      turnId: 'turn-a',
      messageId: 'message-a',
      messageVersionId: 'version-a',
      attachmentId: 'attachment-a',
      confirmationId: 'confirmation-a',
      statusBefore: 'waiting_confirmation',
    })
    expect(readMultiChatRecovery(sessionStorage, 'owner-a', 'assistant-a')).toEqual({
      version: 1,
      idempotencyKey: 'vio-r3-11111111-1111-4111-8111-111111111111',
      operationType: 'conversation.turn',
      conversationId: 'conversation-a',
      branchId: 'branch-a',
      turnId: 'turn-a',
      messageId: 'message-a',
      messageVersionId: 'version-a',
      attachmentId: 'attachment-a',
      confirmationId: 'confirmation-a',
      statusBefore: 'waiting_confirmation',
    })
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toMatch(/正文|credential|passphrase|contentBase64/)
  })

  it('rejects payload-bearing or malformed records and clears only the owner scope', () => {
    sessionStorage.setItem('vio:personal:chat:r3:recovery:v1:owner-a:assistant-a', JSON.stringify({ version: 1, idempotencyKey: 'bad', operationType: 'turn', content: 'secret' }))
    expect(readMultiChatRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
    writeMultiChatRecovery(sessionStorage, 'owner-a', 'assistant-a', { version: 1, idempotencyKey: 'vio-r3-22222222-2222-4222-8222-222222222222', operationType: 'message.edit' })
    writeMultiChatRecovery(sessionStorage, 'owner-b', 'assistant-b', { version: 1, idempotencyKey: 'vio-r3-33333333-3333-4333-8333-333333333333', operationType: 'message.edit' })
    sessionStorage.setItem('unrelated', 'keep')
    clearMultiChatRecoveryForOwner(sessionStorage, 'owner-a')
    expect(readMultiChatRecovery(sessionStorage, 'owner-a', 'assistant-a')).toBeNull()
    expect(readMultiChatRecovery(sessionStorage, 'owner-b', 'assistant-b')).not.toBeNull()
    expect(sessionStorage.getItem('unrelated')).toBe('keep')
  })
})
