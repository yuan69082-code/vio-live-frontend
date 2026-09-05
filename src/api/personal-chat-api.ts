import { ApiClientError } from './client'
import type { PersonalApi, PersonalRequestOptions } from './personal-api'

export const MAX_PERSONAL_CHAT_CONTENT_LENGTH = 32_768

export type PersonalChatMessage = { messageId: string; messageVersionId: string; senderType: 'user' | 'subject'; content: string; sequenceNumber: number; createdAt: string }
export type PersonalChatStatus = 'processing' | 'waiting_confirmation' | 'waiting_budget' | 'ready' | 'executing' | 'retryable' | 'outcome_unknown' | 'result_ready' | 'publishing' | 'completed' | 'failed' | 'cancelled' | 'quarantined'
export type PersonalChatTurn = {
  turnId: string; conversationId: string; status: PersonalChatStatus; createdAt: string; updatedAt: string; completedAt: string | null
  userMessage: PersonalChatMessage; assistantMessage: PersonalChatMessage | null
  confirmation: { confirmationId: string; kind: 'security' | 'budget' } | null
  error: { code: string; retryable: boolean } | null
  execution: { executionId: string; providerId: string; modelId: string; status: 'prepared' | 'in_flight' | 'retryable' | 'succeeded' | 'failed_terminal' | 'outcome_unknown' | 'cancelled'; attemptCount: number; lastAttemptStatus: string | null } | null
  externalCall: 'not_performed' | 'performed' | 'outcome_unknown'
}
export type PersonalDefaultChat = {
  assistant: { assistantId: string; name: string }
  conversation: { conversationId: string; status: string; createdAt: string; updatedAt: string } | null
  messages: PersonalChatMessage[]; activeTurn: PersonalChatTurn | null; externalCall: 'not_performed'
}
export type PersonalChatRecoveryInput = { action: 'resume'; confirmationId?: string } | { action: 'retry' } | { action: 'cancel' }

function invalid(): never { throw new ApiClientError('Invalid personal chat response', { code: 'invalid_response', status: null }) }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown> }
function text(value: unknown, max = 512) { if (typeof value !== 'string' || !value || value.length > max) invalid(); return value }
function time(value: unknown) { const result = text(value); if (!Number.isFinite(Date.parse(result))) invalid(); return result }
function nullableTime(value: unknown) { return value === null ? null : time(value) }
function integer(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(); return Number(value) }
function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] { if (typeof value !== 'string' || !values.includes(value)) invalid(); return value as T[number] }

export function parsePersonalChatMessage(value: unknown): PersonalChatMessage {
  const item = record(value)
  return { messageId: text(item.messageId), messageVersionId: text(item.messageVersionId), senderType: oneOf(item.senderType, ['user', 'subject'] as const), content: text(item.content, MAX_PERSONAL_CHAT_CONTENT_LENGTH), sequenceNumber: integer(item.sequenceNumber), createdAt: time(item.createdAt) }
}

export function parsePersonalChatTurn(value: unknown): PersonalChatTurn {
  const wrapped = record(value)
  const item = 'turn' in wrapped ? record(wrapped.turn) : wrapped
  const status = oneOf(item.status, ['processing', 'waiting_confirmation', 'waiting_budget', 'ready', 'executing', 'retryable', 'outcome_unknown', 'result_ready', 'publishing', 'completed', 'failed', 'cancelled', 'quarantined'] as const)
  const confirmationItem = item.confirmation === null ? null : record(item.confirmation)
  const confirmation = confirmationItem ? { confirmationId: text(confirmationItem.confirmationId), kind: oneOf(confirmationItem.kind, ['security', 'budget'] as const) } : null
  const errorItem = item.error === null ? null : record(item.error)
  const error = errorItem ? { code: text(errorItem.code), retryable: typeof errorItem.retryable === 'boolean' ? errorItem.retryable : invalid() } : null
  const executionItem = item.execution === null ? null : record(item.execution)
  const execution = executionItem ? {
    executionId: text(executionItem.executionId), providerId: text(executionItem.providerId), modelId: text(executionItem.modelId),
    status: oneOf(executionItem.status, ['prepared', 'in_flight', 'retryable', 'succeeded', 'failed_terminal', 'outcome_unknown', 'cancelled'] as const),
    attemptCount: integer(executionItem.attemptCount), lastAttemptStatus: executionItem.lastAttemptStatus === null ? null : text(executionItem.lastAttemptStatus),
  } : null
  const turn: PersonalChatTurn = {
    turnId: text(item.turnId), conversationId: text(item.conversationId), status, createdAt: time(item.createdAt), updatedAt: time(item.updatedAt), completedAt: nullableTime(item.completedAt),
    userMessage: parsePersonalChatMessage(item.userMessage), assistantMessage: item.assistantMessage === null ? null : parsePersonalChatMessage(item.assistantMessage), confirmation, error, execution,
    externalCall: oneOf(item.externalCall, ['not_performed', 'performed', 'outcome_unknown'] as const),
  }
  if (turn.userMessage.senderType !== 'user' || (turn.assistantMessage && turn.assistantMessage.senderType !== 'subject')) invalid()
  if (turn.status === 'completed' && (!turn.assistantMessage || !turn.completedAt)) invalid()
  if (['waiting_confirmation', 'waiting_budget'].includes(turn.status) !== Boolean(turn.confirmation)) invalid()
  if (turn.status === 'waiting_confirmation' && turn.confirmation?.kind !== 'security') invalid()
  if (turn.status === 'waiting_budget' && turn.confirmation?.kind !== 'budget') invalid()
  if (turn.status === 'retryable' && turn.error?.retryable !== true) invalid()
  return turn
}

export function parsePersonalDefaultChat(value: unknown, expectedAssistantId: string): PersonalDefaultChat {
  const item = record(value); const assistant = record(item.assistant)
  const assistantResult = { assistantId: text(assistant.assistantId), name: text(assistant.name, 80) }
  if (assistantResult.assistantId !== expectedAssistantId || !Array.isArray(item.messages)) invalid()
  const conversationItem = item.conversation === null ? null : record(item.conversation)
  const conversation = conversationItem ? { conversationId: text(conversationItem.conversationId), status: text(conversationItem.status), createdAt: time(conversationItem.createdAt), updatedAt: time(conversationItem.updatedAt) } : null
  const messages = item.messages.map(parsePersonalChatMessage).sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  if (new Set(messages.map((message) => message.messageId)).size !== messages.length) invalid()
  return { assistant: assistantResult, conversation, messages, activeTurn: item.activeTurn === null ? null : parsePersonalChatTurn(item.activeTurn), externalCall: oneOf(item.externalCall, ['not_performed'] as const) }
}

export function createPersonalChatApi(api: PersonalApi) {
  return {
    async defaultChat(expectedAssistantId: string, options?: PersonalRequestOptions) { return parsePersonalDefaultChat(await api.request('/chat/default', 'GET', undefined, options), expectedAssistantId) },
    async createTurn(content: string, key: string, options?: PersonalRequestOptions) { return parsePersonalChatTurn(await api.request('/chat/turns', 'POST', { content }, { ...options, idempotencyKey: key })) },
    async turn(turnId: string, options?: PersonalRequestOptions) { return parsePersonalChatTurn(await api.request(`/chat/turns/${encodeURIComponent(turnId)}`, 'GET', undefined, options)) },
    async turnByKey(key: string, options?: PersonalRequestOptions) { return parsePersonalChatTurn(await api.request(`/chat/turns/by-idempotency-key/${encodeURIComponent(key)}`, 'GET', undefined, options)) },
    async decide(confirmationId: string, decision: 'approve' | 'reject', options?: PersonalRequestOptions) { return api.request(`/confirmations/${encodeURIComponent(confirmationId)}/decision`, 'POST', { decision }, options) },
    async recover(turnId: string, input: PersonalChatRecoveryInput, key: string, options?: PersonalRequestOptions) { return parsePersonalChatTurn(await api.request(`/chat/turns/${encodeURIComponent(turnId)}/recovery`, 'POST', input, { ...options, idempotencyKey: key })) },
  }
}
export type PersonalChatApi = ReturnType<typeof createPersonalChatApi>
