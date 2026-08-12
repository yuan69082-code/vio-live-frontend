import { apiClient } from './client'
import type { ApiSuccessEnvelope, RequestOptions } from './types'

export const LOCAL_CONVERSATION_PROFILE = {
  userId: 'user-001',
  assistantId: 'assistant-001',
  conversationId: 'conversation-001',
} as const

export const MAX_CONVERSATION_CONTENT_LENGTH = 32_768

export type ConversationTurnStatus =
  | 'processing'
  | 'confirmation_required'
  | 'budget_confirmation_required'
  | 'waiting_budget'
  | 'waiting_retry'
  | 'outcome_unknown'
  | 'completed'
  | 'failed'
  | 'quarantined'

export type ConversationMessage = {
  messageId: string
  messageVersionId: string
  senderType: 'user' | 'subject'
  content: string
  sequenceNumber: number
  createdAt: string
}

export type ConversationTurn = {
  turnId: string
  userId: string
  subjectId: string
  conversationId: string
  status: ConversationTurnStatus
  userMessage: ConversationMessage | null
  subjectMessage: ConversationMessage | null
  confirmation: { confirmationId: string } | null
  failure: { code: string } | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type ResumeTurnInput =
  | { confirmationId: string }
  | { retryApproved: true }
  | Record<string, never>

type RequestClient = {
  request<T>(
    path: string,
    options?: RequestOptions & {
      method?: 'GET' | 'POST' | 'PATCH'
      headers?: Record<string, string>
      body?: unknown
    },
  ): Promise<ApiSuccessEnvelope<T>>
}

const turnStatuses = new Set<ConversationTurnStatus>([
  'processing',
  'confirmation_required',
  'budget_confirmation_required',
  'waiting_budget',
  'waiting_retry',
  'outcome_unknown',
  'completed',
  'failed',
  'quarantined',
])

const profilePath = `/api/v1/users/${LOCAL_CONVERSATION_PROFILE.userId}/subjects/${LOCAL_CONVERSATION_PROFILE.assistantId}/conversations/${LOCAL_CONVERSATION_PROFILE.conversationId}`
const identityHeaders = { 'x-vio-user-id': LOCAL_CONVERSATION_PROFILE.userId }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new TypeError(`Conversation API response field ${key} must be a string.`)
  }
  return value
}

function requireNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`Conversation API response field ${key} must be an integer.`)
  }
  return value
}

function parseTurnMessage(value: unknown): ConversationMessage | null {
  if (value === null) return null
  if (!isRecord(value)) throw new TypeError('Conversation API returned an invalid turn message.')

  const senderType = requireString(value, 'senderType')
  if (senderType !== 'user' && senderType !== 'subject') {
    throw new TypeError('Conversation API returned an unsupported turn message sender.')
  }

  return {
    messageId: requireString(value, 'messageId'),
    messageVersionId: requireString(value, 'messageVersionId'),
    senderType,
    content: requireString(value, 'content'),
    sequenceNumber: requireNumber(value, 'sequenceNumber'),
    createdAt: requireString(value, 'createdAt'),
  }
}

function parseConfirmation(value: unknown) {
  if (value === null) return null
  if (!isRecord(value)) throw new TypeError('Conversation API returned an invalid confirmation.')
  return { confirmationId: requireString(value, 'confirmationId') }
}

function parseFailure(value: unknown) {
  if (value === null) return null
  if (!isRecord(value)) throw new TypeError('Conversation API returned an invalid failure.')
  return { code: requireString(value, 'code') }
}

function parseTurn(value: unknown): ConversationTurn {
  if (!isRecord(value)) throw new TypeError('Conversation API returned an invalid turn.')
  const status = requireString(value, 'status')
  if (!turnStatuses.has(status as ConversationTurnStatus)) {
    throw new TypeError('Conversation API returned an unsupported turn status.')
  }

  const completedAt = value.completedAt
  if (completedAt !== null && typeof completedAt !== 'string') {
    throw new TypeError('Conversation API returned an invalid completedAt value.')
  }

  const turn: ConversationTurn = {
    turnId: requireString(value, 'turnId'),
    userId: requireString(value, 'userId'),
    subjectId: requireString(value, 'subjectId'),
    conversationId: requireString(value, 'conversationId'),
    status: status as ConversationTurnStatus,
    userMessage: parseTurnMessage(value.userMessage),
    subjectMessage: parseTurnMessage(value.subjectMessage),
    confirmation: parseConfirmation(value.confirmation),
    failure: parseFailure(value.failure),
    createdAt: requireString(value, 'createdAt'),
    updatedAt: requireString(value, 'updatedAt'),
    completedAt,
  }

  if (
    turn.userId !== LOCAL_CONVERSATION_PROFILE.userId
    || turn.subjectId !== LOCAL_CONVERSATION_PROFILE.assistantId
    || turn.conversationId !== LOCAL_CONVERSATION_PROFILE.conversationId
  ) {
    throw new TypeError('Conversation API returned a turn outside the fixed local profile.')
  }
  if (!turn.userMessage) {
    throw new TypeError('Conversation API returned a turn without its user message.')
  }
  if (turn.status === 'completed' && !turn.subjectMessage) {
    throw new TypeError('Conversation API returned a completed turn without a subject message.')
  }
  if (
    (turn.status === 'confirmation_required' || turn.status === 'budget_confirmation_required')
    && !turn.confirmation
  ) {
    throw new TypeError('Conversation API returned a confirmation state without a confirmation.')
  }

  return turn
}

function parseHistoryMessage(value: unknown): ConversationMessage | null {
  if (!isRecord(value)) throw new TypeError('Conversation API returned an invalid message.')
  const senderType = requireString(value, 'senderType')
  if (senderType === 'system') return null
  if (senderType !== 'user' && senderType !== 'subject') {
    throw new TypeError('Conversation API returned an unsupported message sender.')
  }

  return {
    messageId: requireString(value, 'messageId'),
    messageVersionId: requireString(value, 'currentVersionId'),
    senderType,
    content: requireString(value, 'content'),
    sequenceNumber: requireNumber(value, 'sequenceNumber'),
    createdAt: requireString(value, 'createdAt'),
  }
}

export function createConversationApi(client: RequestClient = apiClient) {
  return {
    async listMessages(options: RequestOptions = {}) {
      const envelope = await client.request<unknown>(`${profilePath}/messages`, {
        ...options,
        headers: identityHeaders,
      })
      if (!Array.isArray(envelope.data)) {
        throw new TypeError('Conversation API returned an invalid message list.')
      }
      return envelope.data
        .map(parseHistoryMessage)
        .filter((message): message is ConversationMessage => message !== null)
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
    },

    async createTurn(content: string, idempotencyKey: string, options: RequestOptions = {}) {
      const envelope = await client.request<unknown>(`${profilePath}/turns`, {
        ...options,
        method: 'POST',
        headers: {
          ...identityHeaders,
          'Idempotency-Key': idempotencyKey,
        },
        body: { content },
      })
      return parseTurn(envelope.data)
    },

    async getTurn(turnId: string, options: RequestOptions = {}) {
      const envelope = await client.request<unknown>(
        `${profilePath}/turns/${encodeURIComponent(turnId)}`,
        { ...options, headers: identityHeaders },
      )
      return parseTurn(envelope.data)
    },

    async resumeTurn(turnId: string, input: ResumeTurnInput, options: RequestOptions = {}) {
      const envelope = await client.request<unknown>(
        `${profilePath}/turns/${encodeURIComponent(turnId)}/resumptions`,
        {
          ...options,
          method: 'POST',
          headers: identityHeaders,
          body: input,
        },
      )
      return parseTurn(envelope.data)
    },
  }
}

export type ConversationApi = ReturnType<typeof createConversationApi>

export const conversationApi = createConversationApi()
