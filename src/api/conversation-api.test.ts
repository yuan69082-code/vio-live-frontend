import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { createConversationApi } from './conversation-api'

function envelope(data: unknown) {
  return new Response(JSON.stringify({
    success: true,
    data,
    error: null,
    timestamp: '2026-08-12T00:00:00.000Z',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function turnData() {
  return {
    turnId: 'turn-001',
    userId: 'user-001',
    subjectId: 'assistant-001',
    conversationId: 'conversation-001',
    status: 'completed',
    userMessage: {
      messageId: 'user-message-001',
      messageVersionId: 'user-version-001',
      senderType: 'user',
      content: '你好',
      sequenceNumber: 1,
      createdAt: '2026-08-12T00:00:00.000Z',
    },
    subjectMessage: {
      messageId: 'subject-message-001',
      messageVersionId: 'subject-version-001',
      senderType: 'subject',
      content: '你好',
      sequenceNumber: 2,
      createdAt: '2026-08-12T00:00:01.000Z',
    },
    confirmation: null,
    failure: null,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:01.000Z',
    completedAt: '2026-08-12T00:00:01.000Z',
  }
}

describe('conversation API contract', () => {
  it('creates a V5 turn with the fixed profile, identity header, key and content-only body', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(turnData()))
    const api = createConversationApi(createApiClient({ fetchImplementation }))

    await api.createTurn('你好', 'vio-turn-test-001')

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    const [path, options] = fetchImplementation.mock.calls[0]
    expect(path).toBe('/api/v1/users/user-001/subjects/assistant-001/conversations/conversation-001/turns')
    expect(options?.method).toBe('POST')
    expect(new Headers(options?.headers).get('x-vio-user-id')).toBe('user-001')
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe('vio-turn-test-001')
    expect(JSON.parse(String(options?.body))).toEqual({ content: '你好' })
  })

  it('maps history sender types, ignores system messages and sorts by sequence number', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope([
      {
        messageId: 'message-2', currentVersionId: 'version-2', senderType: 'subject',
        content: '回复', sequenceNumber: 2, createdAt: '2026-08-12T00:00:02.000Z',
      },
      {
        messageId: 'system-1', currentVersionId: 'version-system', senderType: 'system',
        content: '系统', sequenceNumber: 0, createdAt: '2026-08-12T00:00:00.000Z',
      },
      {
        messageId: 'message-1', currentVersionId: 'version-1', senderType: 'user',
        content: '问题', sequenceNumber: 1, createdAt: '2026-08-12T00:00:01.000Z',
      },
    ]))
    const api = createConversationApi(createApiClient({ fetchImplementation }))

    const messages = await api.listMessages()

    expect(messages.map((message) => [message.messageId, message.senderType])).toEqual([
      ['message-1', 'user'],
      ['message-2', 'subject'],
    ])
  })

  it('fails closed when the public response shape is invalid', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope({ ...turnData(), status: 'invented' }))
    const api = createConversationApi(createApiClient({ fetchImplementation }))

    await expect(api.getTurn('turn-001')).rejects.toThrow('unsupported turn status')
  })
})
