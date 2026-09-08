import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError } from '../api/client'
import {
  MAX_R3_ATTACHMENT_BYTES,
  MAX_R3_TITLE_LENGTH,
  MAX_R3_TURN_ATTACHMENT_BYTES,
  createPersonalMultiChatApi,
  parseAttachmentMetadata,
  parseConversationExport,
  parseRegenerationResult,
} from '../api/personal-multi-chat-api'
import type {
  AttachmentMetadata,
  BranchSummary,
  ConversationDetail,
  ConversationSort,
  ConversationSummary,
  MessageVersion,
  PersonalMultiChatApi,
  R3Message,
  RegenerationResult,
} from '../api/personal-multi-chat-api'
import { MAX_PERSONAL_CHAT_CONTENT_LENGTH } from '../api/personal-chat-api'
import type { PersonalChatTurn } from '../api/personal-chat-api'
import type { PersonalAssistant } from '../api/personal-api'
import { finishOperation, operationKey } from '../api/personal-api'
import {
  createPersonalContextApi,
} from '../api/personal-context-api'
import type {
  ContextAssembly,
  ContextEvidence,
  ContextMode,
  ContextSource,
  ConversationContextSettings,
  PersonalContextApi,
} from '../api/personal-context-api'
import {
  clearMultiChatRecovery,
  readMultiChatRecovery,
  writeMultiChatRecovery,
} from '../api/personal-multi-chat-recovery'
import type { MultiChatRecoveryFact } from '../api/personal-multi-chat-recovery'
import ConversationComposer from '../components/conversation/ConversationComposer'
import ContextControlPanel from '../components/conversation/ContextControlPanel'
import ConversationHeader from '../components/conversation/ConversationHeader'
import ConversationIcon from '../components/conversation/ConversationIcon'
import MessageList from '../components/conversation/MessageList'
import { usePersonal } from '../state/PersonalContext'
import styles from './PersonalMultiConversationPage.module.css'

const QUERY_TIMEOUT = 15_000
const WRITE_TIMEOUT = 90_000
const POLL_INTERVAL = 1_500
const POLL_LIMIT = 6
const terminalTurn = new Set(['completed', 'failed', 'cancelled', 'quarantined'])
const pollingTurn = new Set(['processing', 'executing', 'publishing', 'result_ready'])

type Props = {
  assistant: PersonalAssistant | null
  assistantsLoaded: boolean
  onNavigate: (target: 'capability' | 'profile') => void
  api?: PersonalMultiChatApi
  contextApi?: PersonalContextApi
  storage?: Storage | null
}

type ConversationDialog =
  | { kind: 'create'; title: string }
  | { kind: 'rename'; conversation: ConversationSummary; title: string }
  | { kind: 'archive' | 'restore' | 'delete'; conversation: ConversationSummary }
  | null

type MessageDialog =
  | { kind: 'edit'; message: R3Message; content: string }
  | { kind: 'versions'; message: R3Message }
  | { kind: 'delete' | 'restart'; message: R3Message }
  | null

type RegenerationConfirmation = {
  message: R3Message
  confirmationId: string
  confirmationKind: 'security' | 'budget'
}

type WriteDisposition = boolean | void | { confirmed?: boolean; retainPending?: boolean }

function browserStorage() { try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null } }
function isUncertain(error: unknown) {
  return !(error instanceof ApiClientError)
    || ['invalid_response', 'network_error', 'request_timeout'].includes(error.code)
    || (error.status !== null && error.status >= 500)
}
function errorText(error: unknown) {
  if (!(error instanceof ApiClientError)) return '后端响应无法验证，当前结果未知。'
  const labels: Record<string, string> = {
    request_aborted: '', network_error: '无法连接 Vio 服务，当前结果未知。', request_timeout: '请求超时，当前结果未知。', invalid_response: '后端响应无法验证，当前结果未知。',
    ASSISTANT_NOT_SELECTED: '尚未选择助手。', CONVERSATION_NOT_FOUND: '会话不存在或已删除。', CONVERSATION_ARCHIVED: '会话已归档，不能继续写入。',
    CONVERSATION_CURSOR_INVALID: '会话分页游标已失效，请从第一页重新读取。',
    CONVERSATION_VERSION_CONFLICT: '会话已在其他位置更新，已重新读取。', CONVERSATION_SELECTION_CONFLICT: '当前会话选择已变化，已重新读取。',
    BRANCH_NOT_FOUND: '分支不存在。', BRANCH_VERSION_CONFLICT: '分支已在其他位置更新，已重新读取。', MESSAGE_NOT_VISIBLE: '消息在当前分支不可见。',
    MESSAGE_VERSION_CONFLICT: '消息版本已变化，已重新读取。', MESSAGE_VERSION_SCOPE_MISMATCH: '消息版本不属于当前会话。', ATTACHMENT_TOO_LARGE: '附件超过服务端大小限制。',
    ATTACHMENT_MEDIA_TYPE_UNSUPPORTED: '附件类型不受支持。', ATTACHMENT_CONTENT_INVALID: '附件内容校验失败。', ATTACHMENT_SCOPE_MISMATCH: '附件不属于当前会话。',
    ATTACHMENT_STORAGE_UNAVAILABLE: '附件存储暂不可用。', ATTACHMENT_STORAGE_INCONSISTENT: '附件存储校验异常。', IDEMPOTENCY_CONFLICT: '幂等键与原操作不一致，已停止提交。',
    OPERATION_OUTCOME_UNKNOWN: '操作结果未知，禁止盲目重发。', DEFAULT_CHAT_MODEL_NOT_CONFIGURED: '未配置默认聊天模型。', MODEL_DISABLED: '默认聊天模型已停用。', PROVIDER_DISABLED: '供应商已停用。',
    VAULT_LOCKED: '凭据库尚未解锁。', CREDENTIAL_UNAVAILABLE: '供应商凭据不可用。', PERMISSION_DENIED: '权限规则拒绝了本次操作。', SECURITY_DENIED: '安全规则拒绝了本次操作。',
    SECURITY_CONFIRMATION_REQUIRED: '等待本次安全确认。', TOKEN_BUDGET_CONFIRMATION_REQUIRED: '等待本次预算确认。', TOKEN_BUDGET_NOT_CONFIGURED: '尚未配置 Token 预算。', TOKEN_BUDGET_DISABLED: 'Token 预算已停用。',
    TOKEN_BUDGET_BLOCKED: 'Token 预算不允许本次操作。', TOKEN_BUDGET_DEFERRED: 'Token 预算确认已延后。', PROVIDER_REQUEST_NOT_SENT: '请求未发送到供应商，可以安全重试。',
    PROVIDER_RETRYABLE_FAILURE: '供应商请求失败，可以安全重试。', PROVIDER_OUTCOME_UNKNOWN: '供应商结果未知，禁止盲目重试。', PROVIDER_TERMINAL_FAILURE: '供应商请求最终失败。',
    TURN_CANCELLED: '本轮已终止。', TURN_ALREADY_ACTIVE: '当前会话已有进行中的轮次。', TURN_RETRY_NOT_ALLOWED: '当前轮次不允许重试。', STANDALONE_LEDGER_INCONSISTENT: '轮次事实异常，已隔离。',
    ASSISTANT_CONFIGURATION_TOO_LARGE: '当前助手配置超过独立聊天限制。', STANDALONE_MODE_REQUIRED: '当前不是独立聊天模式。', PROVIDER_INTERFACE_UNSUPPORTED: '供应商接口不受支持。',
    CONTEXT_MODE_INVALID: '上下文模式无效，请重新选择。', CONTEXT_EXCLUSIONS_INVALID: '自定义排除项无效，必需来源不能排除。', CONTEXT_RESPONSE_INVALID: '上下文数据无法安全读取。', CONTEXT_SUMMARY_INVALID: '结构化摘要未通过严格校验，本轮未调用供应商。',
    CONTEXT_SOURCE_FORBIDDEN: '该上下文来源不在当前权限范围内。', CONTEXT_SOURCE_NOT_FOUND: '该精确来源不存在、已受治理删除或不属于当前助手。', CONTEXT_SNAPSHOT_NOT_FOUND: '当前轮次的锁定上下文尚未生成。',
    CONTEXT_PLAN_STALE: '上下文来源已经变化，请重新预览后再发送。', CONTEXT_FOLDING_FAILED: '上下文摘要失败且原文无法安全装入；供应商尚未调用。', CONTEXT_BUDGET_EXCEEDED: '必需上下文超过模型上限；本轮未调用供应商。',
    CONTEXT_RECOVERY_NOT_ALLOWED: '当前上下文折叠不允许重试，请重新读取轮次状态。', CONTEXT_SETTINGS_VERSION_CONFLICT: '会话上下文设置已在其他位置更新，请重新读取。', CONTEXT_LEDGER_INCONSISTENT: '上下文账本异常，已停止本轮。',
  }
  return labels[error.code] ?? (error.status === 401 ? '个人访问已失效，正在返回访问验证。' : error.status === 409 ? '服务端状态冲突，已重新读取。' : error.status === 404 ? '服务端未找到目标事实。' : error.message || '操作未完成。')
}
function configurationTarget(code?: string) {
  if (code === 'ASSISTANT_NOT_SELECTED' || code === 'PERMISSION_DENIED' || code === 'SECURITY_DENIED') return 'profile' as const
  if (code && ['DEFAULT_CHAT_MODEL_NOT_CONFIGURED', 'MODEL_DISABLED', 'PROVIDER_DISABLED', 'PROVIDER_INTERFACE_UNSUPPORTED', 'CREDENTIAL_UNAVAILABLE', 'VAULT_LOCKED', 'TOKEN_BUDGET_NOT_CONFIGURED', 'TOKEN_BUDGET_DISABLED', 'TOKEN_BUDGET_BLOCKED', 'TOKEN_BUDGET_DEFERRED'].includes(code)) return 'capability' as const
  return null
}
function randomKey() { return `vio-r3-${crypto.randomUUID()}` }
function initials(value: string) { return Array.from(value.trim())[0] ?? 'V' }
function base64(bytes: Uint8Array) {
  let value = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(value)
}
async function attachmentPayload(file: File, kind: 'image' | 'file' | 'audio') {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return {
    fileName: file.name,
    mediaType: file.type || 'application/octet-stream',
    kind,
    sizeBytes: bytes.byteLength,
    sha256: `sha256:${Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')}`,
    contentBase64: base64(bytes),
  }
}

export default function PersonalMultiConversationPage({ assistant, assistantsLoaded, onNavigate, api: suppliedApi, contextApi: suppliedContextApi, storage: suppliedStorage }: Props) {
  const personal = usePersonal()
  const api = useMemo(() => suppliedApi ?? createPersonalMultiChatApi(personal.api), [personal.api, suppliedApi])
  const contextApi = useMemo(() => suppliedContextApi ?? createPersonalContextApi(personal.api), [personal.api, suppliedContextApi])
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage
  const personalScope = personal.scope
  const ownerId = personal.state.kind === 'ready' ? personal.state.session.user.userId : ''
  const assistantId = assistant?.assistantId ?? ''
  const [assistantName, setAssistantName] = useState(assistant?.name ?? '')
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectionVersion, setSelectionVersion] = useState<number | undefined>()
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [branches, setBranches] = useState<BranchSummary[]>([])
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([])
  const [attachmentNames, setAttachmentNames] = useState<Record<string, string>>({})
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active')
  const [sort, setSort] = useState<ConversationSort>('updated_desc')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [branchOpen, setBranchOpen] = useState(false)
  const [conversationDialog, setConversationDialog] = useState<ConversationDialog>(null)
  const [messageDialog, setMessageDialog] = useState<MessageDialog>(null)
  const [versions, setVersions] = useState<MessageVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [regenerationConfirmation, setRegenerationConfirmation] = useState<RegenerationConfirmation | null>(null)
  const [loading, setLoading] = useState(Boolean(assistant))
  const [listLoading, setListLoading] = useState(Boolean(assistant))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [errorCode, setErrorCode] = useState<string | undefined>()
  const [pending, setPending] = useState<MultiChatRecoveryFact | null>(() => assistant ? readMultiChatRecovery(storage, ownerId, assistant.assistantId) : null)
  const [safeRetry, setSafeRetry] = useState(false)
  const [pollingStopped, setPollingStopped] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextSaving, setContextSaving] = useState(false)
  const [contextSettings, setContextSettings] = useState<ConversationContextSettings | null>(null)
  const [contextMode, setContextMode] = useState<ContextMode>('balanced')
  const [contextExcluded, setContextExcluded] = useState<string[]>([])
  const [contextPlan, setContextPlan] = useState<ContextAssembly | null>(null)
  const [contextSnapshot, setContextSnapshot] = useState<ContextAssembly | null>(null)
  const [contextError, setContextError] = useState('')
  const [contextNotice, setContextNotice] = useState('')
  const [contextEvidence, setContextEvidence] = useState<ContextEvidence | null>(null)
  const [contextEvidenceLoading, setContextEvidenceLoading] = useState(false)
  const [contextEvidenceError, setContextEvidenceError] = useState('')
  const mounted = useRef(true)
  const generation = useRef(0)
  const listGeneration = useRef(0)
  const detailGeneration = useRef(0)
  const lock = useRef<symbol | null>(null)
  const controllers = useRef(new Set<AbortController>())
  const loadedConversationId = useRef<string | null>(null)
  const contextGeneration = useRef(0)
  const contextPreviewGeneration = useRef(0)
  const contextWriteLock = useRef<symbol | null>(null)
  const contextControllers = useRef(new Set<AbortController>())
  const contextEvidenceController = useRef<AbortController | null>(null)
  const contextSnapshotFact = useRef<{ scope: string; turnId: string } | null>(null)

  const current = useCallback((version: number) => mounted.current && generation.current === version, [])
  const makeController = useCallback(() => { const controller = new AbortController(); controllers.current.add(controller); return controller }, [])
  const release = useCallback((controller: AbortController) => { controllers.current.delete(controller) }, [])
  const showError = useCallback((caught: unknown) => {
    setError(errorText(caught))
    setErrorCode(caught instanceof ApiClientError ? caught.code : 'invalid_response')
  }, [])
  const savePending = useCallback((value: MultiChatRecoveryFact | null) => {
    setPending(value)
    if (!ownerId || !assistantId) return
    if (value) writeMultiChatRecovery(storage, ownerId, assistantId, value)
    else clearMultiChatRecovery(storage, ownerId, assistantId)
  }, [assistantId, ownerId, storage])

  const loadAttachmentNames = useCallback(async (conversationId: string, messages: R3Message[], version: number) => {
    const ids = [...new Set(messages.flatMap((message) => message.attachmentIds))]
    if (ids.length === 0) { if (current(version)) setAttachmentNames({}); return }
    const request = makeController()
    try {
      const values = await Promise.all(ids.map((id) => api.attachment(conversationId, id, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }).catch(() => null)))
      if (current(version) && loadedConversationId.current === conversationId) setAttachmentNames(Object.fromEntries(values.filter((item): item is AttachmentMetadata => Boolean(item)).map((item) => [item.attachmentId, item.fileName])))
    } finally { release(request) }
  }, [api, current, makeController, release])

  const loadList = useCallback(async (version = generation.current, cursor?: string) => {
    if (!assistantId) return
    const requestGeneration = ++listGeneration.current
    const request = makeController()
    if (current(version)) setListLoading(true)
    try {
      const value = await api.conversations(assistantId, { status: statusFilter, query: appliedQuery, sort, cursor, limit: 50 }, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (!current(version) || listGeneration.current !== requestGeneration) return
      setAssistantName(value.assistant.name)
      setConversations((existing) => cursor
        ? [...existing, ...value.conversations.filter((item) => !existing.some((entry) => entry.conversationId === item.conversationId))]
        : value.conversations)
      setNextCursor(value.nextCursor)
      setSelectionVersion(value.selectionVersion)
      setListError('')
    } catch (caught) { if (current(version) && listGeneration.current === requestGeneration && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) setListError(errorText(caught)) }
    finally { release(request); if (current(version) && listGeneration.current === requestGeneration) setListLoading(false) }
  }, [api, appliedQuery, assistantId, current, makeController, release, showError, sort, statusFilter])

  const acceptDetail = useCallback((value: ConversationDetail, version: number) => {
    if (!current(version)) return
    const nextConversationId = value.conversation?.conversationId ?? null
    if (loadedConversationId.current !== nextConversationId) {
      setInput('')
      setAttachments([])
      setRegenerationConfirmation(null)
      loadedConversationId.current = nextConversationId
    }
    setAssistantName(value.assistant.name); setDetail(value); setLoading(false); setPollingStopped(false)
    setSelectionVersion(value.selectionVersion)
    if (value.conversation) void loadAttachmentNames(value.conversation.conversationId, value.messages, version)
    else setAttachmentNames({})
  }, [current, loadAttachmentNames])

  const downloadExport = useCallback((value: ReturnType<typeof parseConversationExport>) => {
    const blob = new Blob([value.content], { type: value.mediaType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = value.fileName
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const loadCurrent = useCallback(async (version = generation.current) => {
    if (!assistantId) return
    const requestGeneration = ++detailGeneration.current
    const request = makeController()
    if (current(version)) setLoading(true)
    try {
      const value = await api.current(assistantId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (detailGeneration.current === requestGeneration) acceptDetail(value, version)
    }
    catch (caught) { if (current(version) && detailGeneration.current === requestGeneration && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) { showError(caught); setLoading(false) } }
    finally { release(request) }
  }, [acceptDetail, api, assistantId, current, makeController, release, showError])

  const loadConversation = useCallback(async (conversationId: string, version = generation.current) => {
    if (!assistantId) return
    const requestGeneration = ++detailGeneration.current
    const request = makeController()
    if (current(version)) setLoading(true)
    try {
      const value = await api.conversation(assistantId, conversationId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (detailGeneration.current === requestGeneration) acceptDetail(value, version)
    }
    catch (caught) { if (current(version) && detailGeneration.current === requestGeneration && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) { showError(caught); setLoading(false) } }
    finally { release(request) }
  }, [acceptDetail, api, assistantId, current, makeController, release, showError])

  const refresh = useCallback(async (conversationId?: string) => {
    const version = generation.current
    await Promise.all([loadList(version), conversationId ? loadConversation(conversationId, version) : loadCurrent(version)])
  }, [loadConversation, loadCurrent, loadList])

  const recoverPending = useCallback(async (fact: MultiChatRecoveryFact, version: number) => {
    const request = makeController()
    setNotice('正在按原幂等键查询操作结果，不会盲目重发…')
    try {
      if (fact.operationType === 'conversation.turn') {
        const turn = fact.turnId ? await api.turn(fact.turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }) : await api.turnByKey(fact.idempotencyKey, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
        if (!current(version)) return
        if (turn.conversationId !== fact.conversationId) throw new ApiClientError('Recovered turn scope mismatch', { code: 'invalid_response', status: null })
        savePending(null); setSafeRetry(false); setInput(''); setAttachments([]); setError(''); setErrorCode(undefined); setNotice('已按原提交键恢复真实轮次。'); await refresh(fact.conversationId)
        if (turn.status !== 'completed') setDetail((value) => value?.conversation?.conversationId === turn.conversationId ? { ...value, activeTurn: turn } : value)
      } else if (fact.operationType.startsWith('turn.') && fact.turnId) {
        const observed = await api.turn(fact.turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
        if (!current(version)) return
        await refresh(fact.conversationId)
        setDetail((value) => value?.conversation?.conversationId === observed.conversationId ? { ...value, activeTurn: observed } : value)
        if (fact.statusBefore && observed.status !== fact.statusBefore) {
          savePending(null); setSafeRetry(false); setNotice('原轮次状态已变化，恢复操作结果已由服务端事实确认。'); setError(''); setErrorCode(undefined)
        } else {
          setSafeRetry(Boolean(fact.statusBefore))
          setNotice('')
          setError(fact.statusBefore ? '原轮次状态尚未变化；可沿用原恢复键重试同一动作。' : '恢复索引缺少原状态，禁止盲目重发；只能继续查询轮次。')
        }
      } else {
        const operation = await api.operationByKey(fact.idempotencyKey, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
        if (!current(version)) return
        if (fact.operationType === 'message.regenerate' && operation.result && fact.conversationId && fact.messageId && fact.messageVersionId) {
          const result = parseRegenerationResult(operation.result)
          if ('operationStatus' in result) {
            const requestGeneration = ++detailGeneration.current
            const view = await api.conversation(assistantId, fact.conversationId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
            if (!current(version) || detailGeneration.current !== requestGeneration) return
            const message = view.messages.find((item) => item.messageId === fact.messageId && item.messageVersionId === fact.messageVersionId)
            if (!message) throw new ApiClientError('Recovered regeneration message is no longer selected', { code: 'MESSAGE_VERSION_CONFLICT', status: 409 })
            acceptDetail(view, version)
            setRegenerationConfirmation({ message, confirmationId: result.confirmation.confirmationId, confirmationKind: result.confirmation.kind })
            savePending(null); setSafeRetry(false); setError(''); setErrorCode(undefined); setNotice('已恢复服务端确认要求；尚未调用供应商。')
            return
          }
          if (!('operationId' in result)) {
            savePending(null); setSafeRetry(false); setError(''); setErrorCode(undefined); setNotice('重新生成已由服务端确认完成。'); await refresh(fact.conversationId)
            return
          }
        }
        if (operation.status === 'completed') {
          if (!operation.result) throw new ApiClientError('Completed operation omitted its result', { code: 'invalid_response', status: null })
          if (fact.operationType === 'attachment.create') {
            const uploaded = parseAttachmentMetadata(operation.result)
            setAttachments((items) => items.some((item) => item.attachmentId === uploaded.attachmentId) ? items : [...items, uploaded])
          } else if (fact.operationType === 'attachment.delete' && fact.attachmentId) {
            setAttachments((items) => items.filter((item) => item.attachmentId !== fact.attachmentId))
          } else if (fact.operationType === 'conversation.export') {
            downloadExport(parseConversationExport(operation.result))
          }
          savePending(null); setSafeRetry(false); setError(''); setErrorCode(undefined); setNotice('原操作已由服务端确认完成。'); await refresh(fact.conversationId)
        }
        else if (operation.status === 'failed' || operation.status === 'cancelled') {
          savePending(null)
          const code = operation.error?.code
          setErrorCode(code)
          setError(code ? errorText(new ApiClientError(code, { code, status: null })) : '原操作未完成。'); setNotice('')
        } else {
          setErrorCode(operation.status === 'outcome_unknown' ? 'OPERATION_OUTCOME_UNKNOWN' : undefined)
          setError(operation.status === 'outcome_unknown' ? '原操作结果未知，禁止盲目重发。' : '原操作仍在处理中，可继续查询。'); setNotice('')
        }
      }
    } catch (caught) {
      if (!current(version)) return
      setNotice(''); showError(caught)
      if (caught instanceof ApiClientError && caught.status === 404) {
        setSafeRetry(true)
        setError('服务端未找到原操作；可复用原幂等键安全重试原动作。')
      }
    } finally { release(request) }
  }, [acceptDetail, api, assistantId, current, downloadExport, makeController, refresh, release, savePending, showError])

  const contextConversationId = detail?.conversation?.conversationId ?? ''
  const contextBranchId = detail?.branch?.branchId ?? ''
  const contextScope = `${personalScope}:${assistantId}:${contextConversationId}:${contextBranchId}`
  const contextCurrent = useCallback((version: number) => current(generation.current) && contextGeneration.current === version, [current])
  const makeContextController = useCallback(() => { const controller = new AbortController(); contextControllers.current.add(controller); return controller }, [])
  const releaseContextController = useCallback((controller: AbortController) => { contextControllers.current.delete(controller) }, [])

  const previewContext = useCallback(async (conversationId: string, branchId: string, mode: ContextMode, excludedSourceRefs: string[], version = contextGeneration.current, preserveNotice = false) => {
    const requestVersion = ++contextPreviewGeneration.current
    const request = makeContextController()
    if (contextCurrent(version)) { setContextLoading(true); setContextError(''); if (!preserveNotice) setContextNotice('正在按服务端规则预览装配范围…') }
    try {
      const value = await contextApi.plan(conversationId, { branchId, mode, excludedSourceRefs }, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (!contextCurrent(version) || contextPreviewGeneration.current !== requestVersion) return
      setContextPlan(value); setContextError(''); if (!preserveNotice) setContextNotice('预览只读取范围；保存后才会成为本会话设置，发送时由服务端锁定。')
    } catch (caught) {
      if (contextCurrent(version) && contextPreviewGeneration.current === requestVersion && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) {
        if (caught instanceof ApiClientError && caught.code === 'CONTEXT_SOURCE_FORBIDDEN') {
          try {
            const settings = await contextApi.settings(conversationId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
            const recovered = await contextApi.plan(conversationId, { branchId, mode: settings.effective.mode, excludedSourceRefs: settings.effective.excludedSourceRefs }, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
            if (contextCurrent(version) && contextPreviewGeneration.current === requestVersion) {
              setContextSettings(settings); setContextMode(settings.effective.mode); setContextExcluded(settings.effective.excludedSourceRefs); setContextPlan(recovered); setContextError(''); setContextNotice('部分排除来源已不可用，已按服务端当前有效范围恢复预览。')
            }
            return
          } catch (recoveryError) {
            caught = recoveryError
          }
        }
        setContextPlan(null); setContextNotice(''); setContextError(errorText(caught))
      }
    } finally {
      releaseContextController(request)
      if (contextCurrent(version) && contextPreviewGeneration.current === requestVersion) setContextLoading(false)
    }
  }, [contextApi, contextCurrent, makeContextController, releaseContextController])

  const loadContext = useCallback(async (conversationId: string, branchId: string, turnId?: string) => {
    const requestedScope = `${personalScope}:${assistantId}:${conversationId}:${branchId}`
    const version = ++contextGeneration.current
    contextPreviewGeneration.current += 1
    contextControllers.current.forEach((controller) => controller.abort()); contextControllers.current.clear()
    contextEvidenceController.current?.abort(); contextEvidenceController.current = null
    setContextLoading(true); setContextError(''); setContextNotice('正在读取服务端会话设置…'); setContextSettings(null); setContextPlan(null); setContextSnapshot(null); setContextEvidence(null); setContextEvidenceError('')
    const request = makeContextController()
    try {
      const settings = await contextApi.settings(conversationId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (!contextCurrent(version)) return
      let liveSettings = settings
      let planValue: ContextAssembly
      try {
        planValue = await contextApi.plan(conversationId, { branchId, mode: liveSettings.effective.mode, excludedSourceRefs: liveSettings.effective.excludedSourceRefs }, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      } catch (caught) {
        if (!(caught instanceof ApiClientError) || caught.code !== 'CONTEXT_SOURCE_FORBIDDEN') throw caught
        liveSettings = await contextApi.settings(conversationId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
        planValue = await contextApi.plan(conversationId, { branchId, mode: liveSettings.effective.mode, excludedSourceRefs: liveSettings.effective.excludedSourceRefs }, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      }
      const snapshotValue = turnId ? await contextApi.snapshot(turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }).catch((caught) => {
        if (caught instanceof ApiClientError && caught.code === 'CONTEXT_SNAPSHOT_NOT_FOUND') return null
        throw caught
      }) : null
      if (!contextCurrent(version)) return
      setContextSettings(liveSettings); setContextMode(liveSettings.effective.mode); setContextExcluded(liveSettings.effective.excludedSourceRefs)
      if (snapshotValue?.turnId) contextSnapshotFact.current = { scope: requestedScope, turnId: snapshotValue.turnId }
      setContextPlan(planValue); setContextSnapshot(snapshotValue); setContextError(''); setContextNotice('上下文设置和预览已由服务端恢复。')
    } catch (caught) {
      if (contextCurrent(version) && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) { setContextNotice(''); setContextError(errorText(caught)) }
    } finally {
      releaseContextController(request)
      if (contextCurrent(version)) setContextLoading(false)
    }
  }, [assistantId, contextApi, contextCurrent, makeContextController, personalScope, releaseContextController])

  const selectContextMode = useCallback((mode: ContextMode) => {
    if (!contextConversationId || !contextBranchId || contextLoading || contextSaving) return
    const excluded = mode === 'custom' ? contextExcluded : []
    setContextMode(mode); setContextExcluded(excluded); setContextSnapshot((value) => value)
    void previewContext(contextConversationId, contextBranchId, mode, excluded)
  }, [contextBranchId, contextConversationId, contextExcluded, contextLoading, contextSaving, previewContext])

  const toggleContextSource = useCallback((source: ContextSource) => {
    if (contextMode !== 'custom' || contextLoading || contextSaving) return
    const excluded = contextExcluded.includes(source.sourceRef) ? contextExcluded.filter((value) => value !== source.sourceRef) : [...contextExcluded, source.sourceRef]
    setContextExcluded(excluded)
    void previewContext(contextConversationId, contextBranchId, contextMode, excluded)
  }, [contextBranchId, contextConversationId, contextExcluded, contextLoading, contextMode, contextSaving, previewContext])

  const saveContextSettings = useCallback(async () => {
    if (!contextSettings || !contextConversationId || !contextBranchId || contextLoading || contextSaving || contextWriteLock.current || lock.current) return
    const lockToken = Symbol('context.settings')
    const key = operationKey(contextScope, `context-settings/${contextConversationId}`)
    const version = contextGeneration.current
    const expectedVersion = contextSettings.conversation?.version ?? 0
    contextWriteLock.current = lockToken; setContextSaving(true); setContextError(''); setContextNotice('正在保存真实会话设置…')
    const request = makeContextController()
    try {
      const value = await contextApi.updateSettings(contextConversationId, { mode: contextMode, excludedSourceRefs: contextExcluded, expectedVersion }, key, { signal: request.signal, timeoutMs: WRITE_TIMEOUT })
      if (!contextCurrent(version)) return
      finishOperation(contextScope, `context-settings/${contextConversationId}`, key)
      setContextSettings(value); setContextMode(value.effective.mode); setContextExcluded(value.effective.excludedSourceRefs); setContextNotice('本会话上下文设置已由服务端保存。')
      await previewContext(contextConversationId, contextBranchId, value.effective.mode, value.effective.excludedSourceRefs, version, true)
      if (contextCurrent(version)) setContextNotice('本会话上下文设置已由服务端保存。')
    } catch (caught) {
      if (!contextCurrent(version)) return
      setContextNotice(''); setContextError(errorText(caught))
      if (!isUncertain(caught)) finishOperation(contextScope, `context-settings/${contextConversationId}`, key)
      if (caught instanceof ApiClientError && ['CONTEXT_SETTINGS_VERSION_CONFLICT', 'CONTEXT_SOURCE_FORBIDDEN'].includes(caught.code)) await loadContext(contextConversationId, contextBranchId, detail?.activeTurn?.turnId)
    } finally {
      releaseContextController(request)
      if (contextWriteLock.current === lockToken) contextWriteLock.current = null
      if (contextCurrent(version)) setContextSaving(false)
    }
  }, [contextApi, contextBranchId, contextConversationId, contextCurrent, contextExcluded, contextLoading, contextMode, contextSaving, contextScope, contextSettings, detail?.activeTurn?.turnId, loadContext, makeContextController, previewContext, releaseContextController])

  const openContextEvidence = useCallback(async (source: ContextSource) => {
    contextEvidenceController.current?.abort()
    const request = new AbortController(); contextEvidenceController.current = request
    const version = contextGeneration.current
    setContextEvidence(null); setContextEvidenceError(''); setContextEvidenceLoading(true)
    try {
      const value = await contextApi.evidence(source.sourceRef, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (value.contentHash !== source.contentHash) throw new ApiClientError('Context evidence hash does not match the locked source', { code: 'invalid_response', status: null })
      if (!request.signal.aborted && contextCurrent(version)) setContextEvidence(value)
    } catch (caught) {
      if (!request.signal.aborted && contextCurrent(version) && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) setContextEvidenceError(errorText(caught))
    } finally {
      if (contextEvidenceController.current === request) contextEvidenceController.current = null
      if (!request.signal.aborted && contextCurrent(version)) setContextEvidenceLoading(false)
    }
  }, [contextApi, contextCurrent])

  const closeContextEvidence = useCallback(() => {
    contextEvidenceController.current?.abort(); contextEvidenceController.current = null
    setContextEvidence(null); setContextEvidenceLoading(false); setContextEvidenceError('')
  }, [])

  const retryContextFold = useCallback(async () => {
    const turnId = contextSnapshot?.turnId
    if (!turnId || contextSaving || contextWriteLock.current || lock.current) return
    const lockToken = Symbol('context.retry_fold')
    const operation = `context-fold/${turnId}`
    const key = operationKey(contextScope, operation)
    const version = contextGeneration.current
    contextWriteLock.current = lockToken; setContextSaving(true); setContextError(''); setContextNotice('正在沿用恢复键重试折叠，不会创建第二次模型调用…')
    const request = makeContextController()
    try {
      const result = await contextApi.retryFold(turnId, key, { signal: request.signal, timeoutMs: WRITE_TIMEOUT })
      if (!contextCurrent(version)) return
      finishOperation(contextScope, operation, key)
      contextSnapshotFact.current = { scope: contextScope, turnId: result.context.turnId! }
      setContextSnapshot(result.context)
      setDetail((value) => value?.conversation?.conversationId === result.turn.conversationId ? { ...value, activeTurn: result.turn } : value)
      await refresh(result.turn.conversationId)
      if (contextCurrent(version)) setContextNotice('折叠恢复结果已由服务端确认。')
    } catch (caught) {
      if (!contextCurrent(version)) return
      setContextNotice(''); setContextError(errorText(caught))
      if (!isUncertain(caught)) finishOperation(contextScope, operation, key)
    } finally {
      releaseContextController(request)
      if (contextWriteLock.current === lockToken) contextWriteLock.current = null
      if (contextCurrent(version)) setContextSaving(false)
    }
  }, [contextApi, contextCurrent, contextSaving, contextScope, contextSnapshot?.turnId, makeContextController, releaseContextController])

  useEffect(() => {
    mounted.current = true
    const version = ++generation.current
    listGeneration.current += 1
    detailGeneration.current += 1
    contextGeneration.current += 1
    contextPreviewGeneration.current += 1
    lock.current = null
    contextWriteLock.current = null
    controllers.current.forEach((controller) => controller.abort()); controllers.current.clear()
    contextControllers.current.forEach((controller) => controller.abort()); contextControllers.current.clear()
    contextEvidenceController.current?.abort(); contextEvidenceController.current = null
    contextSnapshotFact.current = null
    loadedConversationId.current = null
    const recoveryFact = assistant ? readMultiChatRecovery(storage, ownerId, assistant.assistantId) : null
    setAssistantName(assistant?.name ?? ''); setConversations([]); setNextCursor(null); setDetail(null); setBranches([]); setAttachments([]); setAttachmentNames({}); setInput(''); setError(''); setListError(''); setErrorCode(undefined); setNotice(''); setPending(recoveryFact); setSafeRetry(false); setPollingStopped(false); setBusy(false); setUploading(false); setLoading(Boolean(assistant)); setListLoading(Boolean(assistant)); setBranchesLoading(false); setVersionsLoading(false); setDrawerOpen(false); setBranchOpen(false); setConversationDialog(null); setMessageDialog(null); setRegenerationConfirmation(null); setContextOpen(false); setContextLoading(false); setContextSaving(false); setContextSettings(null); setContextMode('balanced'); setContextExcluded([]); setContextPlan(null); setContextSnapshot(null); setContextError(''); setContextNotice(''); setContextEvidence(null); setContextEvidenceLoading(false); setContextEvidenceError('')
    if (assistant) queueMicrotask(async () => {
      if (!current(version)) return
      await loadCurrent(version)
      if (current(version) && recoveryFact) await recoverPending(recoveryFact, version)
    })
    return () => { mounted.current = false; generation.current += 1; contextGeneration.current += 1; lock.current = null; contextWriteLock.current = null; controllers.current.forEach((controller) => controller.abort()); controllers.current.clear(); contextControllers.current.forEach((controller) => controller.abort()); contextControllers.current.clear(); contextEvidenceController.current?.abort(); contextEvidenceController.current = null }
  // Scope changes invalidate every in-flight observation. The next effect owns
  // catalog loading, so mount and assistant changes issue exactly one list read.
  // List filters are intentionally excluded: changing search/sort must not
  // reset the drawer or the current conversation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, assistantId, ownerId, personalScope, storage])

  useEffect(() => {
    if (!assistantId) return
    const version = generation.current
    queueMicrotask(() => { if (current(version)) void loadList(version) })
  }, [appliedQuery, assistantId, current, loadList, sort, statusFilter])

  useEffect(() => {
    if (!contextConversationId || !contextBranchId) return
    const turnId = detail?.activeTurn?.turnId
      ?? (contextSnapshotFact.current?.scope === contextScope ? contextSnapshotFact.current.turnId : undefined)
    queueMicrotask(() => { if (mounted.current) void loadContext(contextConversationId, contextBranchId, turnId) })
    return () => {
      contextGeneration.current += 1
      contextPreviewGeneration.current += 1
      contextWriteLock.current = null
      contextControllers.current.forEach((controller) => controller.abort()); contextControllers.current.clear()
      contextEvidenceController.current?.abort(); contextEvidenceController.current = null
    }
  // A conversation or branch switch is a hard R4 context boundary. Persisted
  // message-count and terminal turn changes also invalidate planHash, so the
  // next send must read a fresh plan instead of reusing the previous turn's
  // source inventory.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId, contextApi, contextBranchId, contextConversationId, contextScope, detail?.activeTurn?.status, detail?.messages.length, ownerId])

  const runWrite = useCallback(async <T,>(operationType: string, scope: { conversationId?: string; branchId?: string; turnId?: string; messageId?: string; messageVersionId?: string; attachmentId?: string; confirmationId?: string; statusBefore?: string }, work: (key: string, signal: AbortSignal) => Promise<T>, done: (value: T) => Promise<WriteDisposition> | WriteDisposition, reuseKey?: string) => {
    if (lock.current) return
    const samePending = safeRetry && pending?.operationType === operationType
      && pending.conversationId === scope.conversationId
      && pending.branchId === scope.branchId
      && pending.turnId === scope.turnId
      && pending.messageId === scope.messageId
      && pending.messageVersionId === scope.messageVersionId
      && pending.attachmentId === scope.attachmentId
    if (pending && !samePending && !reuseKey) {
      setError('已有结果未确认的操作；请先按原键核对，不能用新操作覆盖恢复索引。')
      return
    }
    const key = reuseKey ?? (samePending ? pending.idempotencyKey : randomKey())
    const fact: MultiChatRecoveryFact = { version: 1, idempotencyKey: key, operationType, ...scope }
    const lockToken = Symbol(operationType)
    savePending(fact); setSafeRetry(false); lock.current = lockToken; setBusy(true); setError(''); setErrorCode(undefined); setNotice('正在提交真实操作…')
    const version = generation.current; const request = makeController()
    let responseReceived = false
    try {
      const value = await work(key, request.signal)
      if (!current(version)) return
      responseReceived = true
      const disposition = await done(value)
      const retainPending = typeof disposition === 'object' && disposition?.retainPending
      if (retainPending) savePending(fact)
      else savePending(null)
      const confirmed = typeof disposition === 'object' ? disposition.confirmed : disposition
      setNotice(confirmed === false ? '' : '操作已由服务端确认完成。')
    } catch (caught) {
      if (!current(version)) return
      setNotice(''); showError(caught)
      if (responseReceived || !isUncertain(caught)) savePending(null)
      if (caught instanceof ApiClientError && ['CONVERSATION_VERSION_CONFLICT', 'CONVERSATION_SELECTION_CONFLICT', 'BRANCH_VERSION_CONFLICT', 'MESSAGE_VERSION_CONFLICT'].includes(caught.code)) await refresh(scope.conversationId)
    } finally {
      release(request)
      if (lock.current === lockToken) lock.current = null
      if (current(version)) setBusy(false)
    }
  }, [current, makeController, pending, refresh, release, safeRetry, savePending, showError])

  const requiredVersion = (value: number | undefined, label: string) => {
    if (value !== undefined) return value
    setError(`服务端未返回${label}，当前不能安全提交；已停止操作。`)
    return null
  }

  const submitConversationDialog = async () => {
    const dialog = conversationDialog
    if (!dialog) return
    if (dialog.kind === 'create') {
      const title = dialog.title.trim()
      if (!title || title.length > MAX_R3_TITLE_LENGTH) { setError(`会话名称为 1–${MAX_R3_TITLE_LENGTH} 个字符。`); return }
      await runWrite('conversation.create', {}, (key, signal) => api.createConversation(title, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setConversationDialog(null); await refresh() })
      return
    }
    const version = requiredVersion(dialog.conversation.version, '会话版本')
    if (version === null) return
    if (dialog.kind === 'rename') {
      const title = dialog.title.trim()
      if (!title || title.length > MAX_R3_TITLE_LENGTH) { setError(`会话名称为 1–${MAX_R3_TITLE_LENGTH} 个字符。`); return }
      await runWrite('conversation.rename', { conversationId: dialog.conversation.conversationId }, (key, signal) => api.renameConversation(dialog.conversation.conversationId, title, version, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setConversationDialog(null); await refresh(dialog.conversation.conversationId) })
    } else if (dialog.kind === 'archive') {
      await runWrite('conversation.archive', { conversationId: dialog.conversation.conversationId }, (key, signal) => api.archiveConversation(dialog.conversation.conversationId, version, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setConversationDialog(null); setDrawerOpen(true); await refresh() })
    } else if (dialog.kind === 'restore') {
      await runWrite('conversation.restore', { conversationId: dialog.conversation.conversationId }, (key, signal) => api.restoreConversation(dialog.conversation.conversationId, version, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setConversationDialog(null); await loadList() })
    } else {
      await runWrite('conversation.delete', { conversationId: dialog.conversation.conversationId }, (key, signal) => api.deleteConversation(dialog.conversation.conversationId, version, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setConversationDialog(null); await refresh() })
    }
  }

  const chooseConversation = async (conversation: ConversationSummary) => {
    if (conversation.status === 'archived') { await loadConversation(conversation.conversationId); setDrawerOpen(false); return }
    if (conversation.isCurrent) { await loadConversation(conversation.conversationId); setDrawerOpen(false); return }
    const version = requiredVersion(selectionVersion, '会话选择版本')
    if (version === null) return
    await runWrite('conversation.select', { conversationId: conversation.conversationId }, (key, signal) => api.selectConversation(conversation.conversationId, version, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setDrawerOpen(false); await refresh(conversation.conversationId) })
  }

  const openBranches = async () => {
    if (!detail?.conversation) return
    setBranchOpen(true); setBranchesLoading(true); setError(''); setErrorCode(undefined)
    const request = makeController(); const version = generation.current
    try { const value = await api.branches(detail.conversation.conversationId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }); if (current(version)) setBranches(value) }
    catch (caught) { if (current(version) && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) setError(errorText(caught)) }
    finally { release(request); if (current(version)) setBranchesLoading(false) }
  }

  const chooseBranch = async (branch: BranchSummary) => {
    const conversation = detail?.conversation
    if (!conversation || branch.isCurrent) return
    const version = requiredVersion(branch.conversationVersion ?? conversation.version, '会话版本')
    if (version === null) return
    await runWrite('branch.select', { conversationId: conversation.conversationId, branchId: branch.branchId }, (key, signal) => api.selectBranch(conversation.conversationId, branch.branchId, version, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setBranchOpen(false); await refresh(conversation.conversationId) })
  }

  const clearBranch = async () => {
    const conversation = detail?.conversation; const branch = detail?.branch
    if (!conversation || !branch || !window.confirm('仅清空当前分支的可见窗口？历史版本、费用和其他分支不会删除。')) return
    const version = requiredVersion(branch.version, '分支版本')
    if (version === null) return
    await runWrite('branch.clear', { conversationId: conversation.conversationId, branchId: branch.branchId }, (key, signal) => api.clearBranch(conversation.conversationId, branch.branchId, version, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setBranchOpen(false); await refresh(conversation.conversationId) })
  }

  const openVersions = async (message: R3Message) => {
    if (!detail?.conversation) return
    setMessageDialog({ kind: 'versions', message }); setVersions([]); setVersionsLoading(true)
    const request = makeController(); const version = generation.current
    try { const value = await api.versions(detail.conversation.conversationId, message.messageId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }); if (current(version)) setVersions(value) }
    catch (caught) { if (current(version) && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) setError(errorText(caught)) }
    finally { release(request); if (current(version)) setVersionsLoading(false) }
  }

  const submitMessageDialog = async () => {
    const dialog = messageDialog; const conversation = detail?.conversation; const branch = detail?.branch
    if (!dialog || !conversation || !branch) return
    if (dialog.kind === 'edit') {
      const content = dialog.content.trim()
      if (!content || content.length > MAX_PERSONAL_CHAT_CONTENT_LENGTH) { setError(`消息为 1–${MAX_PERSONAL_CHAT_CONTENT_LENGTH} 个字符。`); return }
      await runWrite('message.edit', { conversationId: conversation.conversationId, branchId: branch.branchId }, (key, signal) => api.editMessage(conversation.conversationId, dialog.message.messageId, { branchId: branch.branchId, baseVersionId: dialog.message.messageVersionId, content }, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setMessageDialog(null); await refresh(conversation.conversationId) })
      return
    }
    const branchVersion = requiredVersion(branch.version, '分支版本')
    if (branchVersion === null) return
    if (dialog.kind === 'delete') {
      await runWrite('message.delete', { conversationId: conversation.conversationId, branchId: branch.branchId }, (key, signal) => api.deleteMessage(conversation.conversationId, dialog.message.messageId, { branchId: branch.branchId, expectedBranchVersion: branchVersion }, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setMessageDialog(null); await refresh(conversation.conversationId) })
    } else if (dialog.kind === 'restart') {
      await runWrite('branch.create', { conversationId: conversation.conversationId, branchId: branch.branchId }, (key, signal) => api.createBranch(conversation.conversationId, { sourceBranchId: branch.branchId, restartAfterMessageId: dialog.message.messageId, title: `从消息 ${dialog.message.sequenceNumber} 重来` }, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setMessageDialog(null); await refresh(conversation.conversationId) })
    }
  }

  const selectVersion = async (message: R3Message, versionItem: MessageVersion) => {
    const conversation = detail?.conversation; const branch = detail?.branch
    if (!conversation || !branch || versionItem.messageVersionId === message.messageVersionId) return
    const branchVersion = requiredVersion(branch.version, '分支版本')
    if (branchVersion === null) return
    await runWrite('message.version.select', { conversationId: conversation.conversationId, branchId: branch.branchId }, (key, signal) => api.selectVersion(conversation.conversationId, message.messageId, { branchId: branch.branchId, messageVersionId: versionItem.messageVersionId, expectedBranchVersion: branchVersion }, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setMessageDialog(null); await refresh(conversation.conversationId) })
  }

  const handleRegenerationResult = async (result: RegenerationResult, message: R3Message): Promise<WriteDisposition> => {
    if ('operationStatus' in result) {
      setRegenerationConfirmation({
        message,
        confirmationId: result.confirmation.confirmationId,
        confirmationKind: result.confirmation.kind,
      })
      setNotice(result.confirmation.kind === 'security' ? '重新生成需要安全确认；尚未调用供应商。' : '重新生成需要预算确认；尚未调用供应商。')
      return { confirmed: false }
    }
    if ('operationId' in result) {
      // A confirmation is single-use once it has been approved. Terminal
      // provider failures and outcome-unknown operations must return to the
      // server-fact recovery flow instead of leaving an already-consumed
      // confirmation actionable in the dialog.
      setRegenerationConfirmation(null)
      const code = result.error?.code ?? (result.status === 'outcome_unknown' ? 'OPERATION_OUTCOME_UNKNOWN' : 'PROVIDER_TERMINAL_FAILURE')
      setErrorCode(code)
      setError(errorText(new ApiClientError(code, { code, status: null })))
      return { confirmed: false, retainPending: result.status === 'processing' || result.status === 'outcome_unknown' }
    }
    setRegenerationConfirmation(null)
    await refresh(detail?.conversation?.conversationId)
    return true
  }

  const regenerate = async (message: R3Message) => {
    const conversation = detail?.conversation; const branch = detail?.branch
    if (!conversation || !branch || lock.current) return
    await runWrite('message.regenerate', { conversationId: conversation.conversationId, branchId: branch.branchId, messageId: message.messageId, messageVersionId: message.messageVersionId }, (key, signal) => api.regenerateMessage(conversation.conversationId, message.messageId, { branchId: branch.branchId, baseVersionId: message.messageVersionId }, key, { signal, timeoutMs: WRITE_TIMEOUT }), (result) => handleRegenerationResult(result, message))
  }

  const decideRegeneration = async (decision: 'approve' | 'reject') => {
    const confirmation = regenerationConfirmation
    const conversation = detail?.conversation; const branch = detail?.branch
    if (!confirmation || !conversation || !branch || lock.current) return
    if (decision === 'reject') {
      const version = generation.current; const request = makeController()
      const lockToken = Symbol('regeneration.reject')
      lock.current = lockToken; setBusy(true); setError(''); setErrorCode(undefined)
      try {
        await api.decide(confirmation.confirmationId, 'reject', { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
        if (current(version)) { setRegenerationConfirmation(null); setNotice('已拒绝本次重新生成；未调用供应商。') }
      } catch (caught) {
        if (current(version) && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) showError(caught)
      } finally {
        release(request); if (lock.current === lockToken) lock.current = null; if (current(version)) setBusy(false)
      }
      return
    }
    // Approval consumes this confirmation. Hide it before the request so a
    // lost response cannot expose an enabled action that approves or executes
    // the same confirmation a second time; recovery must query the saved key.
    setRegenerationConfirmation(null)
    await runWrite('message.regenerate', { conversationId: conversation.conversationId, branchId: branch.branchId, messageId: confirmation.message.messageId, messageVersionId: confirmation.message.messageVersionId, confirmationId: confirmation.confirmationId }, async (key, signal) => {
      await api.decide(confirmation.confirmationId, 'approve', { signal, timeoutMs: QUERY_TIMEOUT })
      return api.regenerateMessage(conversation.conversationId, confirmation.message.messageId, {
        branchId: branch.branchId,
        baseVersionId: confirmation.message.messageVersionId,
        confirmationId: confirmation.confirmationId,
        confirmationKind: confirmation.confirmationKind,
      }, key, { signal, timeoutMs: WRITE_TIMEOUT })
    }, (result) => handleRegenerationResult(result, confirmation.message))
  }

  const uploadAttachment = async (kind: 'image' | 'file' | 'audio', file: File) => {
    const conversation = detail?.conversation
    if (!conversation || lock.current) return
    if (file.size > MAX_R3_ATTACHMENT_BYTES) { setError('单个附件不能超过 10 MiB。'); return }
    if (attachments.reduce((total, item) => total + item.sizeBytes, 0) + file.size > MAX_R3_TURN_ATTACHMENT_BYTES) { setError('本轮附件总大小不能超过 20 MiB。'); return }
    const version = generation.current
    setUploading(true); setError(''); setErrorCode(undefined)
    try {
      const payload = await attachmentPayload(file, kind)
      if (!current(version)) return
      let uploaded: AttachmentMetadata | null = null
      await runWrite('attachment.create', { conversationId: conversation.conversationId }, async (key, signal) => { uploaded = await api.uploadAttachment(conversation.conversationId, payload, key, { signal, timeoutMs: WRITE_TIMEOUT }); return uploaded }, async () => { if (uploaded) setAttachments((currentItems) => [...currentItems, uploaded!]) })
    } catch (caught) { if (current(version)) showError(caught) }
    finally { if (current(version)) setUploading(false) }
  }

  const removeAttachment = async (attachment: AttachmentMetadata) => {
    const conversation = detail?.conversation
    if (!conversation) return
    await runWrite('attachment.delete', { conversationId: conversation.conversationId, attachmentId: attachment.attachmentId }, (key, signal) => api.removeAttachment(conversation.conversationId, attachment.attachmentId, key, { signal, timeoutMs: WRITE_TIMEOUT }), async () => { setAttachments((items) => items.filter((item) => item.attachmentId !== attachment.attachmentId)) })
  }

  const send = async () => {
    const conversation = detail?.conversation; const branch = detail?.branch; const content = input.trim()
    if (!conversation || !branch || !content || lock.current || detail.activeTurn && !terminalTurn.has(detail.activeTurn.status)) return
    if (content.length > MAX_PERSONAL_CHAT_CONTENT_LENGTH) { setError(`消息最多 ${MAX_PERSONAL_CHAT_CONTENT_LENGTH} 个字符。`); return }
    if (!contextSettings || !contextPlan || contextLoading || contextSaving || contextPlan.conversationId !== conversation.conversationId || contextPlan.branchId !== branch.branchId || contextPlan.mode !== contextMode) {
      setContextOpen(true); setContextError('上下文预览尚未就绪，请重新读取后再发送。'); return
    }
    if (!contextPlan.budget.withinLimit) { setContextOpen(true); setContextError('必需上下文超过模型输入预算；本轮不会调用供应商。'); return }
    const reuse = safeRetry && pending?.operationType === 'conversation.turn' ? pending.idempotencyKey : undefined
    await runWrite('conversation.turn', { conversationId: conversation.conversationId, branchId: branch.branchId }, (key, signal) => api.createTurn(conversation.conversationId, {
      branchId: branch.branchId,
      content,
      attachmentIds: attachments.map((item) => item.attachmentId),
      context: { mode: contextMode, excludedSourceRefs: contextExcluded, expectedPlanHash: contextPlan.planHash },
    }, key, { signal, timeoutMs: WRITE_TIMEOUT }), async (turn) => {
      setInput(''); setAttachments([]); setSafeRetry(false)
      const snapshotRequest = makeContextController()
      try {
        const snapshot = await contextApi.snapshot(turn.turnId, { signal: snapshotRequest.signal, timeoutMs: QUERY_TIMEOUT })
        if (snapshot.conversationId === conversation.conversationId && snapshot.branchId === branch.branchId) {
          contextSnapshotFact.current = { scope: contextScope, turnId: snapshot.turnId! }
          setContextSnapshot(snapshot)
        }
      } catch (caught) {
        if (!(caught instanceof ApiClientError && caught.code === 'request_aborted')) setContextError(errorText(caught))
      } finally { releaseContextController(snapshotRequest) }
      await refresh(turn.conversationId)
      if (turn.status !== 'completed') setDetail((value) => value?.conversation?.conversationId === turn.conversationId ? { ...value, activeTurn: turn } : value)
      return turn.status === 'completed'
    }, reuse)
  }

  const performTurnRecovery = async (turn: PersonalChatTurn, action: 'resume' | 'retry' | 'cancel') => {
    const conversation = detail?.conversation
    if (!conversation) return
    const confirmationId = action === 'resume' ? turn.confirmation?.confirmationId ?? (pending?.operationType === 'turn.resume' ? pending.confirmationId : undefined) : undefined
    await runWrite(`turn.${action}`, { conversationId: conversation.conversationId, branchId: detail.branch?.branchId, turnId: turn.turnId, confirmationId, statusBefore: turn.status }, async (key, signal) => {
      if (confirmationId) await api.decide(confirmationId, 'approve', { signal, timeoutMs: QUERY_TIMEOUT })
      return api.recover(turn.turnId, { action, ...(confirmationId ? { confirmationId } : {}) }, key, { signal, timeoutMs: WRITE_TIMEOUT })
    }, async (result) => {
      await refresh(conversation.conversationId)
      if (result.status !== 'completed') setDetail((value) => value?.conversation?.conversationId === result.conversationId ? { ...value, activeTurn: result } : value)
      return result.status === 'completed'
    })
  }

  useEffect(() => {
    const turn = detail?.activeTurn
    if (!turn || !pollingTurn.has(turn.status) || !detail?.conversation) return
    const version = generation.current; const conversationId = detail.conversation.conversationId
    let stopped = false; let timer = 0; let count = 0
    const poll = () => { timer = window.setTimeout(async () => {
      if (stopped) return
      const request = makeController(); count += 1
      try {
        const next = await api.turn(turn.turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
        if (!stopped && current(version)) {
          setDetail((value) => value?.conversation?.conversationId === next.conversationId ? { ...value, activeTurn: next } : value)
          if (terminalTurn.has(next.status)) { savePending(null); await refresh(conversationId) }
          else if (pollingTurn.has(next.status) && count < POLL_LIMIT) poll()
          else if (pollingTurn.has(next.status)) setPollingStopped(true)
          else setPollingStopped(false)
        }
      } catch (caught) { if (!stopped && current(version) && !(caught instanceof ApiClientError && caught.code === 'request_aborted')) { showError(caught); setPollingStopped(true) } }
      finally { release(request) }
    }, POLL_INTERVAL) }
    poll()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [api, current, detail?.activeTurn, detail?.conversation, makeController, refresh, release, savePending, showError])

  const exportConversation = async (format: 'json' | 'markdown') => {
    const conversation = detail?.conversation
    if (!conversation) return
    await runWrite('conversation.export', { conversationId: conversation.conversationId }, (key, signal) => api.exportConversation(conversation.conversationId, format, key, { signal, timeoutMs: WRITE_TIMEOUT }), async (value) => {
      downloadExport(value)
    })
  }

  if (!assistantsLoaded) return <section className="conversation-page"><div className="conversation-empty" role="status">正在读取当前助手…</div></section>
  if (!assistant) return <section className="conversation-page"><div className="conversation-empty"><strong>尚未选择助手</strong><span>多会话只使用服务端当前助手。</span><button type="button" onClick={() => onNavigate('profile')}>进入“我的”选择助手</button></div></section>

  const conversation = detail?.conversation
  const branch = detail?.branch
  const turn = detail?.activeTurn
  const turnCode = turn?.error?.code
  const configTarget = configurationTarget(turnCode ?? errorCode)
  const pendingTurnAction = pending?.operationType === 'turn.resume' ? 'resume' : pending?.operationType === 'turn.retry' ? 'retry' : pending?.operationType === 'turn.cancel' ? 'cancel' : null
  const contextDirty = Boolean(contextSettings && (contextSettings.effective.unavailableExcludedSourceRefs.length > 0 || contextMode !== contextSettings.effective.mode || contextExcluded.length !== contextSettings.effective.excludedSourceRefs.length || contextExcluded.some((value, index) => value !== contextSettings.effective.excludedSourceRefs[index])))
  const composerDisabled = busy || loading || uploading || contextLoading || contextSaving || !contextSettings || !contextPlan || !contextPlan.budget.withinLimit || !conversation || conversation.status === 'archived' || Boolean(turn && !terminalTurn.has(turn.status)) || Boolean(pending && !safeRetry)
  const avatar = assistant.avatar ? '' : initials(assistantName || assistant.name)
  const messageViews = detail?.messages.map((message) => ({
    ...message,
    attachmentNames: message.attachmentIds.map((id) => attachmentNames[id] ?? `附件 ${id.slice(0, 8)}`),
  })) ?? []

  return <div className={`conversation-page ${styles.page}`}>
    <ConversationHeader agentName={assistantName || assistant.name} agentAvatar={avatar} avatarImage={assistant.avatar} sessionName={conversation?.title ?? '尚未选择会话'} sessionLabel="会话" sessionTitle="打开会话列表" sessionDisabled={false} sessionExpanded={drawerOpen} onSessionSwitch={() => setDrawerOpen((value) => !value)} />
    <div className="personal-chat-boundary"><strong>独立多会话</strong> · 当前用户、助手、会话和分支均以服务端事实为准。</div>

    {drawerOpen && <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false) }}>
      <aside className={styles.drawer} aria-label="会话列表">
        <div className={styles.drawerHeader}><div><small>当前助手</small><strong>{assistantName || assistant.name}</strong></div><button type="button" onClick={() => setDrawerOpen(false)}>关闭</button></div>
        <form className={styles.search} onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()) }}>
          <input aria-label="搜索会话" value={query} maxLength={MAX_R3_TITLE_LENGTH} onChange={(event) => setQuery(event.target.value)} placeholder="按标题搜索" />
          <button type="submit">搜索</button>
        </form>
        <div className={styles.filters}>
          <button type="button" className={statusFilter === 'active' ? styles.active : ''} onClick={() => setStatusFilter('active')}>进行中</button>
          <button type="button" className={statusFilter === 'archived' ? styles.active : ''} onClick={() => setStatusFilter('archived')}>已归档</button>
          <select aria-label="会话排序" value={sort} onChange={(event) => setSort(event.target.value as ConversationSort)}>
            <option value="updated_desc">最近更新</option><option value="updated_asc">最早更新</option><option value="created_desc">最近创建</option><option value="created_asc">最早创建</option><option value="title_asc">标题</option>
          </select>
        </div>
        <button className={styles.createButton} type="button" onClick={() => setConversationDialog({ kind: 'create', title: '' })}>＋ 新建会话</button>
        <div className={styles.conversationList} aria-busy={listLoading}>
          {listLoading ? <p role="status">正在读取会话…</p> : listError ? <div className={styles.listError} role="alert"><span>{listError}</span><button type="button" onClick={() => void loadList(generation.current)}>重试读取会话列表</button></div> : conversations.length === 0 ? <p>这里还没有{statusFilter === 'archived' ? '归档' : '进行中'}会话。</p> : conversations.map((item) => <article key={item.conversationId} className={item.isCurrent ? styles.currentConversation : ''}>
            <button type="button" className={styles.conversationMain} onClick={() => void chooseConversation(item)}><strong>{item.title}</strong><span>{item.messageCount} 条消息 · {new Date(item.updatedAt).toLocaleString('zh-CN')}</span></button>
            <div className={styles.rowActions}>
              {item.status === 'active' ? <><button type="button" onClick={() => setConversationDialog({ kind: 'rename', conversation: item, title: item.title })}>重命名</button><button type="button" onClick={() => setConversationDialog({ kind: 'archive', conversation: item })}>归档</button></> : <button type="button" onClick={() => setConversationDialog({ kind: 'restore', conversation: item })}>恢复</button>}
              <button type="button" className={styles.dangerText} onClick={() => setConversationDialog({ kind: 'delete', conversation: item })}>删除</button>
            </div>
          </article>)}
          {!listLoading && nextCursor && <button className={styles.loadMore} type="button" onClick={() => void loadList(generation.current, nextCursor)}>加载更多会话</button>}
        </div>
      </aside>
    </div>}

    {conversation && <div className={styles.conversationTools}>
      <button type="button" onClick={() => void openBranches()}>分支：{branch?.title ?? '读取中'}</button>
      <button type="button" onClick={() => void exportConversation('json')} disabled={busy}>导出 JSON</button>
      <button type="button" onClick={() => void exportConversation('markdown')} disabled={busy}>导出 Markdown</button>
    </div>}

    {conversation && branch && <ContextControlPanel
      open={contextOpen}
      loading={contextLoading}
      saving={contextSaving || busy}
      settings={contextSettings}
      mode={contextMode}
      excludedSourceRefs={contextExcluded}
      plan={contextPlan}
      snapshot={contextSnapshot}
      error={contextError}
      notice={contextNotice}
      dirty={contextDirty}
      evidence={contextEvidence}
      evidenceLoading={contextEvidenceLoading}
      evidenceError={contextEvidenceError}
      onToggleOpen={() => setContextOpen((value) => !value)}
      onMode={selectContextMode}
      onToggleSource={toggleContextSource}
      onSave={() => void saveContextSettings()}
      onRefresh={() => void loadContext(conversation.conversationId, branch.branchId, turn?.turnId)}
      onEvidence={(source) => void openContextEvidence(source)}
      onCloseEvidence={closeContextEvidence}
      onRetryFold={() => void retryContextFold()}
    />}

    {(error || notice || pending || turn && turn.status !== 'completed' || pollingStopped) && <section className={`conversation-status ${turn?.status === 'failed' || turn?.status === 'quarantined' ? 'is-danger' : 'is-warning'}`} aria-live="polite" aria-busy={busy}>
      <div>{notice && <span>{notice}</span>}{error && <span role="alert">{error}</span>}{pending?.operationType === 'turn.cancel' && error && <strong>终止失败，恢复结果尚未确认。</strong>}{turn && turn.status !== 'completed' && <><strong>{turn.status === 'retryable' ? '可以安全重试' : turn.status === 'outcome_unknown' ? '结果未知，禁止重试' : turn.status === 'waiting_confirmation' ? '等待安全确认' : turn.status === 'waiting_budget' ? '等待预算确认' : turn.status === 'cancelled' ? '本轮已终止' : turn.status === 'failed' ? '本轮失败' : turn.status === 'quarantined' ? '本轮已隔离' : '轮次处理中'}</strong><span>{turnCode ? errorText(new ApiClientError(turnCode, { code: turnCode, status: null })) : `真实状态：${turn.status}`}</span></>}{pending && <span>已保留原随机操作键；先查询服务端事实，不会换键盲目重发。</span>}{pollingStopped && <span>自动查询已停止，可手动核对。</span>}</div>
      <div className="personal-chat-status-actions">
        {pending && !safeRetry && <button type="button" disabled={busy} onClick={() => void recoverPending(pending, generation.current)}>按原键查询</button>}
        {pending && safeRetry && !pendingTurnAction && <span>原操作未被服务端记录；再次执行原动作会复用同一幂等键。</span>}
        {pending && safeRetry && pendingTurnAction && <span>原轮次状态尚未变化；只允许沿用原恢复键重试同一动作。</span>}
        {pending && safeRetry && pendingTurnAction && turn && <button type="button" disabled={busy} onClick={() => void performTurnRecovery(turn, pendingTurnAction)}>沿用原恢复键重试</button>}
        {error && !pending && <button type="button" disabled={busy} onClick={() => void refresh(conversation?.conversationId)}>重新读取</button>}
        {turn && !pending && pollingTurn.has(turn.status) && <button type="button" disabled={busy} onClick={() => void refresh(conversation?.conversationId)}>刷新轮次</button>}
        {turn && !pending && turn.status === 'outcome_unknown' && <button type="button" disabled={busy} onClick={() => void refresh(conversation?.conversationId)}>按轮次核对结果</button>}
        {turn && !pending && ['waiting_confirmation', 'waiting_budget', 'ready', 'result_ready'].includes(turn.status) && <button type="button" disabled={busy} onClick={() => void performTurnRecovery(turn, 'resume')}>批准并继续</button>}
        {turn && !pending && turn.status === 'retryable' && <button type="button" disabled={busy} onClick={() => void performTurnRecovery(turn, 'retry')}>安全重试一次</button>}
        {turn && !pending && ['processing', 'waiting_confirmation', 'waiting_budget', 'ready', 'retryable'].includes(turn.status) && <button type="button" disabled={busy} onClick={() => void performTurnRecovery(turn, 'cancel')}>终止本轮</button>}
        {configTarget && <button type="button" onClick={() => onNavigate(configTarget)}>{configTarget === 'capability' ? '进入“能力”配置' : '进入“我的”设置'}</button>}
      </div>
    </section>}

    {!conversation && !loading ? <div className="conversation-empty"><strong>尚未选择会话</strong><span>打开会话列表，新建或选择当前助手的会话。</span><button type="button" onClick={() => setDrawerOpen(true)}>打开会话列表</button></div> : <MessageList messages={messageViews} agentAvatar={avatar} agentAvatarImage={assistant.avatar} agentName={assistantName || assistant.name} loading={loading} emptyDescription="消息只会在 Vio 后端确认保存后显示。" renderActions={(message) => <div className="message-actions">
      {message.senderType === 'user' ? <button type="button" disabled={busy || conversation?.status === 'archived'} onClick={() => setMessageDialog({ kind: 'edit', message: message as R3Message, content: message.content })}><ConversationIcon name="edit" />编辑</button> : <button type="button" disabled={busy || conversation?.status === 'archived'} onClick={() => void regenerate(message as R3Message)}><ConversationIcon name="regenerate" />重新生成</button>}
      <button type="button" disabled={busy} onClick={() => void openVersions(message as R3Message)}>版本</button>
      <button type="button" disabled={busy || conversation?.status === 'archived'} onClick={() => setMessageDialog({ kind: 'restart', message: message as R3Message })}><ConversationIcon name="branch" />从这里重来</button>
      <button type="button" disabled={busy || conversation?.status === 'archived'} onClick={() => setMessageDialog({ kind: 'delete', message: message as R3Message })}><ConversationIcon name="delete" />删除</button>
    </div>} />}

    {attachments.length > 0 && <ul className={styles.attachmentTray} aria-label="待发送附件">{attachments.map((item) => <li key={item.attachmentId}><span><strong>{item.fileName}</strong><small>{item.kind} · {(item.sizeBytes / 1024).toFixed(1)} KiB · {item.status}</small></span><button type="button" disabled={busy} onClick={() => void removeAttachment(item)}>移除</button></li>)}</ul>}
    <ConversationComposer value={input} disabled={composerDisabled} busy={busy || uploading} maxLength={MAX_PERSONAL_CHAT_CONTENT_LENGTH} onChange={(value) => { setInput(value); setError(''); setErrorCode(undefined) }} onSend={() => void send()} onAttachment={(kind, file) => void uploadAttachment(kind, file)} attachmentsDisabled={!conversation || conversation.status === 'archived'} />

    {branchOpen && <div className={styles.modalBackdrop}><section className={styles.panel} role="dialog" aria-modal="true" aria-label="会话分支"><header><div><small>当前会话</small><h2>分支与窗口</h2></div><button type="button" onClick={() => setBranchOpen(false)}>关闭</button></header><div className={styles.branchList}>{branchesLoading ? <p role="status">正在读取分支…</p> : branches.length === 0 ? <p>没有可用分支。</p> : branches.map((item) => <button key={item.branchId} type="button" disabled={conversation?.status === 'archived'} className={item.isCurrent ? styles.active : ''} onClick={() => void chooseBranch(item)}><strong>{item.title}</strong><span>{item.isCurrent ? '当前分支' : '切换到此分支'}</span></button>)}</div><button type="button" className={styles.dangerButton} disabled={branchesLoading || !branch || conversation?.status === 'archived'} onClick={() => void clearBranch()}>清空当前可见窗口</button><p>只追加清空边界，不删除历史消息、版本、费用或其他分支。</p></section></div>}

    {conversationDialog && <div className={styles.modalBackdrop}><section className={styles.panel} role="dialog" aria-modal="true" aria-label="会话操作"><header><h2>{conversationDialog.kind === 'create' ? '新建会话' : conversationDialog.kind === 'rename' ? '重命名会话' : conversationDialog.kind === 'archive' ? '归档会话' : conversationDialog.kind === 'restore' ? '恢复会话' : '删除会话'}</h2><button type="button" onClick={() => setConversationDialog(null)}>取消</button></header>{(conversationDialog.kind === 'create' || conversationDialog.kind === 'rename') ? <label className={styles.field}>会话名称<input autoFocus maxLength={MAX_R3_TITLE_LENGTH} value={conversationDialog.title} onChange={(event) => setConversationDialog({ ...conversationDialog, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void submitConversationDialog() }} /></label> : <p>{conversationDialog.kind === 'delete' ? '删除后不会出现在普通读取中；最小操作与审计事实仍保留。' : conversationDialog.kind === 'archive' ? '归档会清除当前选择，但不会删除消息历史。' : '恢复后不会自动设为当前会话。'}</p>}<button type="button" className={conversationDialog.kind === 'delete' ? styles.dangerButton : styles.primaryButton} disabled={busy} onClick={() => void submitConversationDialog()}>{busy ? '处理中…' : '确认'}</button></section></div>}

    {messageDialog && <div className={styles.modalBackdrop}><section className={styles.panel} role="dialog" aria-modal="true" aria-label="消息操作"><header><h2>{messageDialog.kind === 'edit' ? '编辑消息' : messageDialog.kind === 'versions' ? '消息版本' : messageDialog.kind === 'restart' ? '从这里重来' : '删除消息'}</h2><button type="button" onClick={() => setMessageDialog(null)}>取消</button></header>{messageDialog.kind === 'edit' ? <label className={styles.field}>新内容<textarea autoFocus maxLength={MAX_PERSONAL_CHAT_CONTENT_LENGTH} value={messageDialog.content} onChange={(event) => setMessageDialog({ ...messageDialog, content: event.target.value })} /></label> : messageDialog.kind === 'versions' ? <div className={styles.versionList}>{versionsLoading ? <p role="status">正在读取版本…</p> : versions.length === 0 ? <p>没有可用版本。</p> : versions.map((item) => <button key={item.messageVersionId} type="button" className={item.messageVersionId === messageDialog.message.messageVersionId ? styles.active : ''} onClick={() => void selectVersion(messageDialog.message, item)}><strong>{item.versionKind === 'original' ? '原始版本' : item.versionKind === 'edited' ? '编辑版本' : '重新生成版本'}</strong><span>{item.content}</span><small>{new Date(item.versionCreatedAt).toLocaleString('zh-CN')}</small></button>)}</div> : <p>{messageDialog.kind === 'restart' ? '将从这条消息之后创建新分支；原分支保持可审计。' : '只在当前分支追加隐藏事实，不物理删除消息或版本。'}</p>}{messageDialog.kind !== 'versions' && <button type="button" className={messageDialog.kind === 'delete' ? styles.dangerButton : styles.primaryButton} disabled={busy} onClick={() => void submitMessageDialog()}>{busy ? '处理中…' : '确认'}</button>}</section></div>}

    {regenerationConfirmation && <div className={styles.modalBackdrop}><section className={styles.panel} role="dialog" aria-modal="true" aria-label="重新生成确认"><header><h2>确认重新生成</h2><button type="button" disabled={busy} onClick={() => void decideRegeneration('reject')}>拒绝</button></header><p>{regenerationConfirmation.confirmationKind === 'security' ? '服务端要求安全确认。批准后才会用新的操作键调用受控供应商。' : '服务端要求预算确认。批准后才会用新的操作键调用受控供应商。'}</p><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void decideRegeneration('approve')}>{busy ? '处理中…' : '批准并重新生成'}</button></section></div>}
  </div>
}
