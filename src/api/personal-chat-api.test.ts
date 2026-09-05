import { describe, expect, it, vi } from 'vitest'
import { createPersonalChatApi, parsePersonalChatTurn } from './personal-chat-api'
import type { PersonalApi } from './personal-api'

const createdAt = '2026-09-05T01:00:00.000Z'
const userMessage = { messageId: 'message-user', messageVersionId: 'version-user', senderType: 'user', content: '真实问题', sequenceNumber: 1, createdAt }
const assistantMessage = { messageId: 'message-assistant', messageVersionId: 'version-assistant', senderType: 'subject', content: '真实回答', sequenceNumber: 2, createdAt }
function completed() { return { turnId: 'turn-r1', conversationId: 'conversation-r1', status: 'completed', createdAt, updatedAt: createdAt, completedAt: createdAt, userMessage, assistantMessage, confirmation: null, error: null, execution: { executionId: 'execution-r1', providerId: 'provider-r1', modelId: 'model-r1', status: 'succeeded', attemptCount: 1, lastAttemptStatus: 'response_received' }, externalCall: 'performed' } }

describe('personal R1 chat API', () => {
  it('projects the exact completed turn and allows the backend preflight wrapper', () => {
    expect(parsePersonalChatTurn(completed())).toEqual(completed())
    expect(parsePersonalChatTurn({ turn: completed(), rawProviderResponse: 'must-not-project' })).toEqual(completed())
  })

  it.each([
    { ...completed(), status: 'success' },
    { ...completed(), assistantMessage: null },
    { ...completed(), userMessage: { ...userMessage, senderType: 'subject' } },
    { ...completed(), execution: { ...completed().execution, attemptCount: -1 } },
    { ...completed(), status: 'waiting_budget', completedAt: null, assistantMessage: null, confirmation: { confirmationId: 'confirmation-r1', kind: 'security' } },
  ])('rejects an inconsistent public turn', (value) => expect(() => parsePersonalChatTurn(value)).toThrow(expect.objectContaining({ code: 'invalid_response' })))

  it('uses only personal chat paths, exact bodies, and idempotency options', async () => {
    const request = vi.fn(async (path: string) => path === '/chat/default'
      ? { assistant: { assistantId: 'assistant-r1', name: '当前助手' }, conversation: null, messages: [], activeTurn: null, externalCall: 'not_performed' }
      : completed())
    const api = createPersonalChatApi({ request } as unknown as PersonalApi)
    await api.defaultChat('assistant-r1')
    await api.createTurn('正文', 'vio-chat-11111111-1111-4111-8111-111111111111')
    await api.turnByKey('vio-chat-11111111-1111-4111-8111-111111111111')
    await api.recover('turn-r1', { action: 'retry' }, 'vio-chat-22222222-2222-4222-8222-222222222222')
    expect(request.mock.calls).toEqual([
      ['/chat/default', 'GET', undefined, undefined],
      ['/chat/turns', 'POST', { content: '正文' }, { idempotencyKey: 'vio-chat-11111111-1111-4111-8111-111111111111' }],
      ['/chat/turns/by-idempotency-key/vio-chat-11111111-1111-4111-8111-111111111111', 'GET', undefined, undefined],
      ['/chat/turns/turn-r1/recovery', 'POST', { action: 'retry' }, { idempotencyKey: 'vio-chat-22222222-2222-4222-8222-222222222222' }],
    ])
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/x-vio-user-id|user-001|assistant-001|conversation-001/)
  })

  it('rejects a default-chat response for another assistant and strips unknown private fields', async () => {
    const request = vi.fn(async () => ({ assistant: { assistantId: 'other', name: '其他' }, conversation: null, messages: [], activeTurn: null, externalCall: 'not_performed', credential: 'secret' }))
    const api = createPersonalChatApi({ request } as unknown as PersonalApi)
    await expect(api.defaultChat('expected')).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
