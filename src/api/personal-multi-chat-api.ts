import { ApiClientError } from './client'
import { parsePersonalChatTurn } from './personal-chat-api'
import type { PersonalChatTurn } from './personal-chat-api'
import type { PersonalApi, PersonalRequestOptions } from './personal-api'

export const MAX_R3_TITLE_LENGTH = 120
export const MAX_R3_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_R3_TURN_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type ConversationStatus = 'active' | 'archived'
export type ConversationSort = 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc' | 'title_asc'
export type ConversationSummary = {
  conversationId: string
  title: string
  status: ConversationStatus
  isCurrent: boolean
  currentBranchId: string
  messageCount: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  version: number
}
export type R3Message = {
  messageId: string
  messageVersionId: string
  senderType: 'user' | 'subject'
  content: string
  sequenceNumber: number
  createdAt: string
  versionCreatedAt: string
  versionKind: 'original' | 'edited' | 'regenerated'
  attachmentIds: string[]
  hidden: false
}
export type MessageVersion = Omit<R3Message, 'sequenceNumber' | 'attachmentIds' | 'hidden'> & { attachmentIds?: string[] }
export type BranchSummary = {
  branchId: string
  parentBranchId: string | null
  forkMessageId: string | null
  title: string
  isCurrent: boolean
  createdAt: string
  updatedAt: string
  version: number
  conversationVersion: number
}
export type AttachmentMetadata = {
  attachmentId: string
  fileName: string
  mediaType: string
  kind: 'image' | 'file' | 'audio'
  sizeBytes: number
  sha256: string
  status: string
  createdAt: string
  messageVersionId: string | null
}
export type R3Operation = {
  operationId: string
  operationType: string
  idempotencyKey: string
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'outcome_unknown'
  resourceType: string
  resourceId: string | null
  error: { code: string; message?: string } | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  externalCall: 'not_performed' | 'performed' | 'outcome_unknown'
  result: Record<string, unknown> | null
}
export type ConversationList = {
  assistant: { assistantId: string; name: string }
  conversations: ConversationSummary[]
  nextCursor: string | null
  externalCall: 'not_performed'
  selectionVersion: number
}
export type ConversationDetail = {
  assistant: { assistantId: string; name: string }
  conversation: ConversationSummary | null
  branch: BranchSummary | null
  messages: R3Message[]
  activeTurn: PersonalChatTurn | null
  externalCall: 'not_performed'
  selectionVersion: number
}
export type AttachmentUpload = {
  fileName: string
  mediaType: string
  kind: 'image' | 'file' | 'audio'
  sizeBytes: number
  sha256: string
  contentBase64: string
}
export type ConversationExport = {
  exportId: string
  fileName: string
  mediaType: string
  content: string
  sha256: string
  createdAt: string
}
export type RegenerationResult =
  | {
      operationStatus: 'confirmation_required'
      confirmation: { confirmationId: string; kind: 'security' | 'budget' }
      externalCall: 'not_performed'
    }
  | {
      message: R3Message
      execution: {
        executionId: string
        modelId: string
        providerId: string
        status: string
        inputTokens: number
        outputTokens: number
        totalTokens: number
        finishReason: string
      }
      externalCall: 'performed'
    }
  | R3Operation

function invalid(): never { throw new ApiClientError('Invalid R3 chat response', { code: 'invalid_response', status: null }) }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown> }
function text(value: unknown, max = 512, allowEmpty = false) { if (typeof value !== 'string' || (!allowEmpty && !value) || value.length > max) invalid(); return value }
function nullableText(value: unknown, max = 512) { return value === null ? null : text(value, max) }
function time(value: unknown) { const result = text(value); if (!Number.isFinite(Date.parse(result))) invalid(); return result }
function nullableTime(value: unknown) { return value === null ? null : time(value) }
function integer(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(); return Number(value) }
function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] { if (typeof value !== 'string' || !values.includes(value)) invalid(); return value as T[number] }
function assistant(value: unknown, expectedAssistantId: string) {
  const item = record(value)
  const result = { assistantId: text(item.assistantId), name: text(item.name, 80) }
  if (result.assistantId !== expectedAssistantId) invalid()
  return result
}

export function parseConversationSummary(value: unknown): ConversationSummary {
  const item = record(value)
  const result: ConversationSummary = {
    conversationId: text(item.conversationId),
    title: text(item.title, MAX_R3_TITLE_LENGTH),
    status: oneOf(item.status, ['active', 'archived'] as const),
    isCurrent: typeof item.isCurrent === 'boolean' ? item.isCurrent : invalid(),
    currentBranchId: text(item.currentBranchId),
    messageCount: integer(item.messageCount),
    createdAt: time(item.createdAt),
    updatedAt: time(item.updatedAt),
    archivedAt: nullableTime(item.archivedAt),
    version: integer(item.version),
  }
  if ((result.status === 'archived') !== Boolean(result.archivedAt)) invalid()
  return result
}

export function parseR3Message(value: unknown): R3Message {
  const item = record(value)
  if (!Array.isArray(item.attachmentIds)) invalid()
  const result: R3Message = {
    messageId: text(item.messageId),
    messageVersionId: text(item.messageVersionId),
    senderType: oneOf(item.senderType, ['user', 'subject'] as const),
    content: text(item.content, 32_768),
    sequenceNumber: integer(item.sequenceNumber),
    createdAt: time(item.createdAt),
    versionCreatedAt: time(item.versionCreatedAt),
    versionKind: oneOf(item.versionKind, ['original', 'edited', 'regenerated'] as const),
    attachmentIds: item.attachmentIds.map((id) => text(id)),
    hidden: item.hidden === false ? false : invalid(),
  }
  if (new Set(result.attachmentIds).size !== result.attachmentIds.length) invalid()
  return result
}

export function parseBranchSummary(value: unknown): BranchSummary {
  const item = record(value)
  return {
    branchId: text(item.branchId),
    parentBranchId: nullableText(item.parentBranchId),
    forkMessageId: nullableText(item.forkMessageId),
    title: text(item.title, MAX_R3_TITLE_LENGTH),
    isCurrent: typeof item.isCurrent === 'boolean' ? item.isCurrent : invalid(),
    createdAt: time(item.createdAt),
    updatedAt: time(item.updatedAt),
    version: integer(item.version),
    conversationVersion: integer(item.conversationVersion),
  }
}

export function parseConversationList(value: unknown, expectedAssistantId: string): ConversationList {
  const item = record(value)
  if (!Array.isArray(item.conversations)) invalid()
  const conversations = item.conversations.map(parseConversationSummary)
  if (new Set(conversations.map((entry) => entry.conversationId)).size !== conversations.length) invalid()
  return {
    assistant: assistant(item.assistant, expectedAssistantId),
    conversations,
    nextCursor: item.nextCursor === null ? null : text(item.nextCursor),
    externalCall: oneOf(item.externalCall, ['not_performed'] as const),
    selectionVersion: integer(item.selectionVersion),
  }
}

export function parseConversationDetail(value: unknown, expectedAssistantId: string, expectedConversationId?: string): ConversationDetail {
  const item = record(value)
  if (!Array.isArray(item.messages)) invalid()
  const conversation = item.conversation === null ? null : parseConversationSummary(item.conversation)
  if (expectedConversationId && conversation?.conversationId !== expectedConversationId) invalid()
  const messages = item.messages.map(parseR3Message).sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  if (new Set(messages.map((message) => message.messageId)).size !== messages.length) invalid()
  const branch = item.branch === undefined || item.branch === null ? null : parseBranchSummary(item.branch)
  if (conversation && branch && conversation.currentBranchId !== branch.branchId) invalid()
  return {
    assistant: assistant(item.assistant, expectedAssistantId),
    conversation,
    branch,
    messages,
    activeTurn: item.activeTurn === null ? null : parsePersonalChatTurn(item.activeTurn),
    externalCall: oneOf(item.externalCall, ['not_performed'] as const),
    selectionVersion: integer(item.selectionVersion),
  }
}

export function parseAttachmentMetadata(value: unknown): AttachmentMetadata {
  const item = record('attachment' in record(value) ? record(value).attachment : value)
  return {
    attachmentId: text(item.attachmentId), fileName: text(item.fileName, 255), mediaType: text(item.mediaType, 255),
    kind: oneOf(item.kind, ['image', 'file', 'audio'] as const), sizeBytes: integer(item.sizeBytes), sha256: text(item.sha256, 80),
    status: text(item.status, 80), createdAt: time(item.createdAt), messageVersionId: item.messageVersionId === null ? null : text(item.messageVersionId),
  }
}

export function parseOperation(value: unknown): R3Operation {
  const item = record('operation' in record(value) ? record(value).operation : value)
  const errorItem = item.error === null ? null : record(item.error)
  return {
    operationId: text(item.operationId), operationType: text(item.operationType, 80), idempotencyKey: text(item.idempotencyKey, 512),
    status: oneOf(item.status, ['processing', 'completed', 'failed', 'cancelled', 'outcome_unknown'] as const), resourceType: text(item.resourceType, 80),
    resourceId: item.resourceId === null ? null : text(item.resourceId), error: errorItem ? { code: text(errorItem.code, 120), ...(typeof errorItem.message === 'string' ? { message: text(errorItem.message, 512) } : {}) } : null,
    createdAt: time(item.createdAt), updatedAt: time(item.updatedAt), completedAt: nullableTime(item.completedAt),
    externalCall: oneOf(item.externalCall, ['not_performed', 'performed', 'outcome_unknown'] as const),
    result: item.result === undefined || item.result === null ? null : record(item.result),
  }
}

export function parseConversationExport(value: unknown): ConversationExport {
  const outer = record(value)
  const item = record('export' in outer ? outer.export : outer)
  return {
    exportId: text(item.exportId),
    fileName: text(item.fileName, 255),
    mediaType: text(item.mediaType, 120),
    content: text(item.content, 10_000_000, true),
    sha256: text(item.sha256, 80),
    createdAt: time(item.createdAt),
  }
}

export function parseRegenerationResult(value: unknown): RegenerationResult {
  const item = record(value)
  if (item.operationStatus === 'confirmation_required') {
    const confirmation = record(item.confirmation)
    return {
      operationStatus: 'confirmation_required',
      confirmation: {
        confirmationId: text(confirmation.confirmationId),
        kind: oneOf(confirmation.kind, ['security', 'budget'] as const),
      },
      externalCall: oneOf(item.externalCall, ['not_performed'] as const),
    }
  }
  if ('operationId' in item) return parseOperation(item)
  const execution = record(item.execution)
  const message = parseR3Message(item.message)
  const inputTokens = integer(execution.inputTokens)
  const outputTokens = integer(execution.outputTokens)
  const totalTokens = integer(execution.totalTokens)
  if (totalTokens !== inputTokens + outputTokens || message.senderType !== 'subject') invalid()
  return {
    message,
    execution: {
      executionId: text(execution.executionId),
      modelId: text(execution.modelId),
      providerId: text(execution.providerId),
      status: text(execution.status, 80),
      inputTokens,
      outputTokens,
      totalTokens,
      finishReason: text(execution.finishReason, 128),
    },
    externalCall: oneOf(item.externalCall, ['performed'] as const),
  }
}

function writeResult(value: unknown) { return record(value) }
function encodeQuery(input: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  Object.entries(input).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)) })
  return query.toString()
}

export function createPersonalMultiChatApi(api: PersonalApi) {
  return {
    async conversations(expectedAssistantId: string, input: { status: 'active' | 'archived' | 'all'; query?: string; sort: ConversationSort; cursor?: string; limit?: number }, options?: PersonalRequestOptions) {
      return parseConversationList(await api.request(`/chat/conversations?${encodeQuery(input)}`, 'GET', undefined, options), expectedAssistantId)
    },
    async current(expectedAssistantId: string, options?: PersonalRequestOptions) { return parseConversationDetail(await api.request('/chat/conversations/current', 'GET', undefined, options), expectedAssistantId) },
    async conversation(expectedAssistantId: string, conversationId: string, options?: PersonalRequestOptions) { return parseConversationDetail(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}`, 'GET', undefined, options), expectedAssistantId, conversationId) },
    async createConversation(title: string, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request('/chat/conversations', 'POST', { title }, { ...options, idempotencyKey: key })) },
    async selectConversation(conversationId: string, expectedSelectionVersion: number, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/selection`, 'POST', { expectedSelectionVersion }, { ...options, idempotencyKey: key })) },
    async renameConversation(conversationId: string, title: string, expectedVersion: number, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}`, 'PATCH', { title, expectedVersion }, { ...options, idempotencyKey: key })) },
    async archiveConversation(conversationId: string, expectedVersion: number, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/archive`, 'POST', { expectedVersion }, { ...options, idempotencyKey: key })) },
    async restoreConversation(conversationId: string, expectedVersion: number, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/restore`, 'POST', { expectedVersion }, { ...options, idempotencyKey: key })) },
    async deleteConversation(conversationId: string, expectedVersion: number, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/deletion`, 'POST', { expectedVersion, confirmation: 'delete' }, { ...options, idempotencyKey: key })) },
    async versions(conversationId: string, messageId: string, options?: PersonalRequestOptions) {
      const raw = await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/versions`, 'GET', undefined, options)
      const item = Array.isArray(raw) ? raw : record(raw).versions
      if (!Array.isArray(item)) invalid()
      return item.map((value) => {
        const parsed = record(value)
        return {
          messageId: text(parsed.messageId), messageVersionId: text(parsed.messageVersionId), senderType: oneOf(parsed.senderType, ['user', 'subject'] as const),
          content: text(parsed.content, 32_768), createdAt: time(parsed.createdAt), versionCreatedAt: time(parsed.versionCreatedAt),
          versionKind: oneOf(parsed.versionKind, ['original', 'edited', 'regenerated'] as const),
          ...(Array.isArray(parsed.attachmentIds) ? { attachmentIds: parsed.attachmentIds.map((id) => text(id)) } : {}),
        } satisfies MessageVersion
      })
    },
    async editMessage(conversationId: string, messageId: string, input: { branchId: string; baseVersionId: string; content: string }, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, 'PATCH', input, { ...options, idempotencyKey: key })) },
    async regenerateMessage(conversationId: string, messageId: string, input: { branchId: string; baseVersionId: string; confirmationId?: string; confirmationKind?: 'security' | 'budget' }, key: string, options?: PersonalRequestOptions) { return parseRegenerationResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/regenerations`, 'POST', input, { ...options, idempotencyKey: key })) },
    async selectVersion(conversationId: string, messageId: string, input: { branchId: string; messageVersionId: string; expectedBranchVersion: number }, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/version-selection`, 'POST', input, { ...options, idempotencyKey: key })) },
    async deleteMessage(conversationId: string, messageId: string, input: { branchId: string; expectedBranchVersion: number }, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/deletion`, 'POST', input, { ...options, idempotencyKey: key })) },
    async branches(conversationId: string, options?: PersonalRequestOptions) {
      const raw = await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/branches`, 'GET', undefined, options)
      const item = Array.isArray(raw) ? raw : record(raw).branches
      if (!Array.isArray(item)) invalid()
      return item.map(parseBranchSummary)
    },
    async createBranch(conversationId: string, input: { sourceBranchId: string; restartAfterMessageId: string; title: string }, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/branches`, 'POST', input, { ...options, idempotencyKey: key })) },
    async selectBranch(conversationId: string, branchId: string, expectedConversationVersion: number, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/branches/${encodeURIComponent(branchId)}/selection`, 'POST', { expectedConversationVersion }, { ...options, idempotencyKey: key })) },
    async clearBranch(conversationId: string, branchId: string, expectedBranchVersion: number, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/clear`, 'POST', { branchId, expectedBranchVersion }, { ...options, idempotencyKey: key })) },
    async createTurn(conversationId: string, input: { branchId: string; content: string; attachmentIds: string[] }, key: string, options?: PersonalRequestOptions) { return parsePersonalChatTurn(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/turns`, 'POST', input, { ...options, idempotencyKey: key })) },
    async turn(turnId: string, options?: PersonalRequestOptions) { return parsePersonalChatTurn(await api.request(`/chat/turns/${encodeURIComponent(turnId)}`, 'GET', undefined, options)) },
    async turnByKey(key: string, options?: PersonalRequestOptions) { return parsePersonalChatTurn(await api.request(`/chat/turns/by-idempotency-key/${encodeURIComponent(key)}`, 'GET', undefined, options)) },
    async recover(turnId: string, input: { action: 'resume' | 'retry' | 'cancel'; confirmationId?: string }, key: string, options?: PersonalRequestOptions) { return parsePersonalChatTurn(await api.request(`/chat/turns/${encodeURIComponent(turnId)}/recovery`, 'POST', input, { ...options, idempotencyKey: key })) },
    async decide(confirmationId: string, decision: 'approve' | 'reject', options?: PersonalRequestOptions) { return api.request(`/confirmations/${encodeURIComponent(confirmationId)}/decision`, 'POST', { decision }, options) },
    async uploadAttachment(conversationId: string, input: AttachmentUpload, key: string, options?: PersonalRequestOptions) { return parseAttachmentMetadata(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/attachments`, 'POST', input, { ...options, idempotencyKey: key })) },
    async attachment(conversationId: string, attachmentId: string, options?: PersonalRequestOptions) { return parseAttachmentMetadata(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`, 'GET', undefined, options)) },
    async removeAttachment(conversationId: string, attachmentId: string, key: string, options?: PersonalRequestOptions) { return writeResult(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}/deletion`, 'POST', {}, { ...options, idempotencyKey: key })) },
    async exportConversation(conversationId: string, format: 'json' | 'markdown', key: string, options?: PersonalRequestOptions) {
      return parseConversationExport(await api.request(`/chat/conversations/${encodeURIComponent(conversationId)}/exports`, 'POST', { format }, { ...options, idempotencyKey: key }))
    },
    async operationByKey(key: string, options?: PersonalRequestOptions) { return parseOperation(await api.request(`/chat/operations/by-idempotency-key/${encodeURIComponent(key)}`, 'GET', undefined, options)) },
  }
}

export type PersonalMultiChatApi = ReturnType<typeof createPersonalMultiChatApi>
