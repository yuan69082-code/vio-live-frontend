import { describe, expect, it, vi } from 'vitest'
import type { PersonalApi } from './personal-api'
import {
  createPersonalMultiChatApi,
  parseBranchSummary,
  parseConversationDetail,
  parseConversationExport,
  parseConversationList,
  parseOperation,
  parseR3Message,
  parseRegenerationResult,
} from './personal-multi-chat-api'

const at = '2026-09-06T00:00:00.000Z'
const conversation = { conversationId: 'conversation-r3', title: '真实会话', status: 'active', isCurrent: true, currentBranchId: 'branch-main', messageCount: 1, createdAt: at, updatedAt: at, archivedAt: null, version: 3 }
const branch = { branchId: 'branch-main', parentBranchId: null, forkMessageId: null, title: 'Main', isCurrent: true, createdAt: at, updatedAt: at, version: 4, conversationVersion: 3 }
const message = { messageId: 'message-r3', messageVersionId: 'version-r3', senderType: 'user', content: '真实正文', sequenceNumber: 1, createdAt: at, versionCreatedAt: at, versionKind: 'original', attachmentIds: [], hidden: false }
const detail = { assistant: { assistantId: 'assistant-r3', name: '真实助手' }, conversation, branch, messages: [message], activeTurn: null, externalCall: 'not_performed', selectionVersion: 2 }

describe('R3 personal multi-conversation API', () => {
  it('validates scoped catalog, detail, branch, message and operation projections', () => {
    expect(parseConversationList({ assistant: detail.assistant, conversations: [conversation], nextCursor: null, externalCall: 'not_performed', selectionVersion: 2 }, 'assistant-r3').conversations[0]).toEqual(conversation)
    expect(parseConversationDetail(detail, 'assistant-r3', 'conversation-r3')).toEqual(detail)
    expect(parseBranchSummary(branch)).toEqual(branch)
    expect(parseR3Message(message)).toEqual(message)
    expect(parseOperation({ operationId: 'operation-r3', operationType: 'conversation.rename', idempotencyKey: 'vio-r3-key', status: 'completed', resourceType: 'conversation', resourceId: 'conversation-r3', error: null, result: { conversation }, createdAt: at, updatedAt: at, completedAt: at, externalCall: 'not_performed' })).toMatchObject({ status: 'completed', resourceId: 'conversation-r3', result: { conversation } })
  })

  it.each([
    [{ ...detail, assistant: { assistantId: 'other', name: '其他' } }],
    [{ ...detail, conversation: { ...conversation, currentBranchId: 'other' } }],
    [{ ...detail, messages: [{ ...message, hidden: true }] }],
    [{ ...detail, messages: [{ ...message, attachmentIds: ['same', 'same'] }] }],
  ])('rejects an invalid or cross-scope detail', (value) => expect(() => parseConversationDetail(value, 'assistant-r3', 'conversation-r3')).toThrow(expect.objectContaining({ code: 'invalid_response' })))

  it('requires server concurrency tokens and validates regeneration and export facts', () => {
    expect(() => parseConversationList({ assistant: detail.assistant, conversations: [], nextCursor: null, externalCall: 'not_performed' }, 'assistant-r3')).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(parseRegenerationResult({ operationStatus: 'confirmation_required', confirmation: { confirmationId: 'confirmation-r3', kind: 'security' }, externalCall: 'not_performed' })).toMatchObject({ operationStatus: 'confirmation_required' })
    expect(parseRegenerationResult({
      message: { ...message, senderType: 'subject', messageId: 'subject-r3', messageVersionId: 'subject-version-r3', versionKind: 'regenerated' },
      execution: { executionId: 'execution-r3', modelId: 'model-r3', providerId: 'provider-r3', status: 'completed', inputTokens: 3, outputTokens: 2, totalTokens: 5, finishReason: 'stop' },
      externalCall: 'performed',
    })).toMatchObject({ externalCall: 'performed', execution: { totalTokens: 5 } })
    expect(() => parseRegenerationResult({
      message: { ...message, senderType: 'subject' },
      execution: { executionId: 'execution-r3', modelId: 'model-r3', providerId: 'provider-r3', status: 'completed', inputTokens: 3, outputTokens: 2, totalTokens: 7, finishReason: 'stop' },
      externalCall: 'performed',
    })).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    expect(parseConversationExport({ export: { exportId: 'export-r3', fileName: 'conversation.md', mediaType: 'text/markdown', content: '# Export', sha256: `sha256:${'a'.repeat(64)}`, createdAt: at }, externalCall: 'not_performed' })).toMatchObject({ exportId: 'export-r3', fileName: 'conversation.md' })
  })

  it('sends exact R3 paths, concurrency tokens, bodies and idempotency keys without identity fields', async () => {
    const calls: unknown[][] = []
    const request = vi.fn(async (...args: unknown[]) => {
      calls.push(args)
      const path = String(args[0])
      if (path.includes('/versions')) return { versions: [{ ...message, sequenceNumber: undefined, attachmentIds: undefined, hidden: undefined }] }
      if (path.endsWith('/regenerations')) return { operationStatus: 'confirmation_required', confirmation: { confirmationId: 'confirmation-r3', kind: 'security' }, externalCall: 'not_performed' }
      if (path.endsWith('/exports')) return { export: { exportId: 'export-r3', fileName: 'conversation.md', mediaType: 'text/markdown', content: '# Export', sha256: `sha256:${'a'.repeat(64)}`, createdAt: at }, externalCall: 'not_performed' }
      if (path.endsWith('/branches') && args[1] === 'GET') return { branches: [branch] }
      if (path.includes('/operations/')) return { operationId: 'operation-r3', operationType: 'conversation.create', idempotencyKey: 'vio-r3-key', status: 'completed', resourceType: 'conversation', resourceId: 'conversation-r3', error: null, result: {}, createdAt: at, updatedAt: at, completedAt: at, externalCall: 'not_performed' }
      return {}
    })
    const api = createPersonalMultiChatApi({ request } as unknown as PersonalApi)
    const key = 'vio-r3-11111111-1111-4111-8111-111111111111'
    await api.createConversation('新会话', key)
    await api.selectConversation('conversation-r3', 2, key)
    await api.renameConversation('conversation-r3', '新标题', 3, key)
    await api.editMessage('conversation-r3', 'message-r3', { branchId: 'branch-main', baseVersionId: 'version-r3', content: '编辑正文' }, key)
    await api.regenerateMessage('conversation-r3', 'message-r3', { branchId: 'branch-main', baseVersionId: 'version-r3', confirmationId: 'confirmation-r3', confirmationKind: 'security' }, key)
    await api.selectVersion('conversation-r3', 'message-r3', { branchId: 'branch-main', messageVersionId: 'version-old', expectedBranchVersion: 4 }, key)
    await api.createBranch('conversation-r3', { sourceBranchId: 'branch-main', restartAfterMessageId: 'message-r3', title: 'Alternative' }, key)
    await api.clearBranch('conversation-r3', 'branch-main', 4, key)
    await api.removeAttachment('conversation-r3', 'attachment-r3', key)
    await api.exportConversation('conversation-r3', 'markdown', key)
    await api.operationByKey(key)
    expect(calls).toEqual([
      ['/chat/conversations', 'POST', { title: '新会话' }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3/selection', 'POST', { expectedSelectionVersion: 2 }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3', 'PATCH', { title: '新标题', expectedVersion: 3 }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3/messages/message-r3', 'PATCH', { branchId: 'branch-main', baseVersionId: 'version-r3', content: '编辑正文' }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3/messages/message-r3/regenerations', 'POST', { branchId: 'branch-main', baseVersionId: 'version-r3', confirmationId: 'confirmation-r3', confirmationKind: 'security' }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3/messages/message-r3/version-selection', 'POST', { branchId: 'branch-main', messageVersionId: 'version-old', expectedBranchVersion: 4 }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3/branches', 'POST', { sourceBranchId: 'branch-main', restartAfterMessageId: 'message-r3', title: 'Alternative' }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3/clear', 'POST', { branchId: 'branch-main', expectedBranchVersion: 4 }, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3/attachments/attachment-r3/deletion', 'POST', {}, { idempotencyKey: key }],
      ['/chat/conversations/conversation-r3/exports', 'POST', { format: 'markdown' }, { idempotencyKey: key }],
      [`/chat/operations/by-idempotency-key/${key}`, 'GET', undefined, undefined],
    ])
    expect(JSON.stringify(calls)).not.toMatch(/userId|assistantId|subjectId|x-vio-user-id|LOCAL_CONVERSATION_PROFILE/)
  })
})
