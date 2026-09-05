import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError } from '../api/client'
import { createPersonalChatApi, MAX_PERSONAL_CHAT_CONTENT_LENGTH } from '../api/personal-chat-api'
import type { PersonalChatApi, PersonalChatMessage, PersonalChatRecoveryInput, PersonalChatTurn } from '../api/personal-chat-api'
import { clearPersonalChatRecovery, readPersonalChatRecovery, writePersonalChatRecovery } from '../api/personal-chat-recovery'
import type { PersonalChatRecoveryFact } from '../api/personal-chat-recovery'
import type { PersonalAssistant } from '../api/personal-api'
import { usePersonal } from '../state/PersonalContext'
import ConversationComposer from '../components/conversation/ConversationComposer'
import ConversationHeader from '../components/conversation/ConversationHeader'
import MessageList from '../components/conversation/MessageList'

const QUERY_TIMEOUT = 15_000
const TURN_TIMEOUT = 90_000
const POLL_LIMIT = 6
const POLL_INTERVAL = 1_500
const terminal = new Set(['completed', 'failed', 'cancelled', 'quarantined'])
const polling = new Set(['processing', 'executing'])

type Props = {
  assistant: PersonalAssistant | null
  assistantsLoaded: boolean
  onNavigate: (target: 'capability' | 'profile') => void
  api?: PersonalChatApi
  storage?: Storage | null
}

function browserStorage() { try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null } }
function mergeMessages(current: PersonalChatMessage[], incoming: Array<PersonalChatMessage | null>) {
  const items = new Map(current.map((message) => [message.messageId, message]))
  incoming.forEach((message) => { if (message) items.set(message.messageId, message) })
  return [...items.values()].sort((left, right) => left.sequenceNumber - right.sequenceNumber || left.messageId.localeCompare(right.messageId))
}
function messageFor(error: unknown) {
  if (!(error instanceof ApiClientError)) return '后端响应无法验证，请先查询真实状态。'
  if (error.code === 'request_aborted') return ''
  if (error.code === 'network_error') return '无法连接 Vio 服务，当前结果尚未确认。'
  if (error.code === 'request_timeout') return '请求超时，当前结果尚未确认。'
  if (error.code === 'invalid_response') return '后端响应无法验证，当前结果尚未确认。'
  if (error.code === 'ASSISTANT_NOT_SELECTED') return '尚未选择可用助手。'
  if (error.code === 'STANDALONE_MODE_REQUIRED') return '当前不是独立聊天模式，R1 不会绕过运行时边界。'
  if (error.status === 401) return '个人访问已失效，正在返回访问验证。'
  if (error.status === 404) return '服务端尚未找到这次提交。'
  if (error.status === 409) return '服务端当前状态冲突，请刷新后核对。'
  if (error.status === 400 || error.status === 422) return '消息未通过服务端校验，请修改后重试。'
  return '本次操作未完成，请核对真实轮次状态。'
}
function uncertain(error: unknown) { return !(error instanceof ApiClientError) || error.code === 'invalid_response' || error.code === 'network_error' || error.code === 'request_timeout' || (error.status !== null && error.status >= 500) }
function configurationTarget(code?: string) {
  if (code === 'ASSISTANT_NOT_SELECTED') return 'profile' as const
  if (code && ['PERMISSION_DENIED', 'SECURITY_DENIED', 'ASSISTANT_CONFIGURATION_TOO_LARGE'].includes(code)) return 'profile' as const
  if (code && ['DEFAULT_CHAT_MODEL_NOT_CONFIGURED', 'MODEL_DISABLED', 'PROVIDER_DISABLED', 'PROVIDER_INTERFACE_UNSUPPORTED', 'CREDENTIAL_UNAVAILABLE', 'VAULT_LOCKED', 'TOKEN_BUDGET_NOT_CONFIGURED', 'TOKEN_BUDGET_DISABLED', 'TOKEN_BUDGET_BLOCKED', 'TOKEN_BUDGET_DEFERRED', 'TOKEN_BUDGET_CONFIRMATION_REQUIRED'].includes(code)) return 'capability' as const
  return null
}
function failureLabel(code?: string) {
  const labels: Record<string, string> = {
    DEFAULT_CHAT_MODEL_NOT_CONFIGURED: '未配置默认聊天模型', MODEL_DISABLED: '默认聊天模型已停用', PROVIDER_DISABLED: '供应商已停用',
    PROVIDER_INTERFACE_UNSUPPORTED: '供应商接口不受支持', VAULT_LOCKED: '凭据库尚未解锁', CREDENTIAL_UNAVAILABLE: '供应商凭据不可用',
    PERMISSION_DENIED: '当前权限不允许执行', SECURITY_DENIED: '安全确认已拒绝', TOKEN_BUDGET_NOT_CONFIGURED: '尚未配置 Token 预算',
    SECURITY_CONFIRMATION_REQUIRED: '等待本次安全确认', TOKEN_BUDGET_DISABLED: 'Token 预算已停用', TOKEN_BUDGET_BLOCKED: 'Token 预算不允许本次执行',
    TOKEN_BUDGET_DEFERRED: 'Token 预算确认已延后', TOKEN_BUDGET_CONFIRMATION_REQUIRED: '等待本次预算确认', PROVIDER_REQUEST_NOT_SENT: '请求确认未发送到供应商',
    PROVIDER_RETRYABLE_FAILURE: '供应商请求失败，可以安全重试', PROVIDER_OUTCOME_UNKNOWN: '供应商结果未知，禁止盲目重试',
    PROVIDER_TERMINAL_FAILURE: '供应商请求最终失败', TURN_CANCELLED: '本轮已终止', STANDALONE_LEDGER_INCONSISTENT: '轮次事实异常，已隔离',
    TURN_ALREADY_ACTIVE: '当前助手已有进行中的轮次', TURN_RETRY_NOT_ALLOWED: '当前轮次不允许重试', ASSISTANT_CONFIGURATION_TOO_LARGE: '当前助手配置超过独立聊天限制',
    STANDALONE_MODE_REQUIRED: '当前不是独立聊天模式',
  }
  return code ? labels[code] ?? `后端状态：${code}` : ''
}

export default function PersonalConversationPage({ assistant, assistantsLoaded, onNavigate, api: suppliedApi, storage: suppliedStorage }: Props) {
  const personal = usePersonal()
  const api = useMemo(() => suppliedApi ?? createPersonalChatApi(personal.api), [personal.api, suppliedApi])
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage
  const ownerId = personal.state.kind === 'ready' ? personal.state.session.user.userId : ''
  const assistantId = assistant?.assistantId ?? ''
  const [assistantName, setAssistantName] = useState(assistant?.name ?? '')
  const [messages, setMessages] = useState<PersonalChatMessage[]>([])
  const [turn, setTurn] = useState<PersonalChatTurn | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(Boolean(assistant))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fact, setFact] = useState<PersonalChatRecoveryFact | null>(() => assistant ? readPersonalChatRecovery(storage, ownerId, assistant.assistantId) : null)
  const [safeRetry, setSafeRetry] = useState(false)
  const [pollingStopped, setPollingStopped] = useState(false)
  const mounted = useRef(true)
  const lock = useRef(false)
  const generation = useRef(0)
  const controllers = useRef(new Set<AbortController>())

  const current = useCallback((version: number) => mounted.current && generation.current === version, [])
  const controller = useCallback(() => { const value = new AbortController(); controllers.current.add(value); return value }, [])
  const release = useCallback((value: AbortController) => controllers.current.delete(value), [])
  const saveFact = useCallback((value: PersonalChatRecoveryFact | null) => {
    setFact(value)
    if (!ownerId || !assistantId) return
    if (value) writePersonalChatRecovery(storage, ownerId, assistantId, value)
    else clearPersonalChatRecovery(storage, ownerId, assistantId)
  }, [assistantId, ownerId, storage])
  const acceptTurn = useCallback((value: PersonalChatTurn) => {
    setTurn(value); setMessages((existing) => mergeMessages(existing, [value.userMessage, value.assistantMessage])); setError(''); setNotice(''); setSafeRetry(false); setPollingStopped(false)
    saveFact(null)
    if (value.status === 'completed') setInput('')
  }, [saveFact])

  const load = useCallback(async () => {
    if (!assistantId || lock.current) return
    const version = generation.current; const request = controller()
    setLoading(true); setError(''); setNotice('正在读取当前助手的默认会话…')
    try {
      const chat = await api.defaultChat(assistantId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (!current(version)) return
      setAssistantName(chat.assistant.name); setMessages(chat.messages); setTurn(chat.activeTurn); setNotice(''); setPollingStopped(false)
      const pending = readPersonalChatRecovery(storage, ownerId, assistantId)
      setFact(pending)
      if (pending?.kind === 'turn') {
        try {
          const recovered = pending.turnId ? await api.turn(pending.turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }) : await api.turnByKey(pending.idempotencyKey, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
          if (current(version)) acceptTurn(recovered)
        } catch (recoveryError) {
          if (!current(version)) return
          if (recoveryError instanceof ApiClientError && recoveryError.status === 404 && !pending.turnId) { setSafeRetry(true); setError('服务端尚未接收原提交，可以安全地沿用原幂等键重试；刷新后需重新输入原消息。') }
          else setError(messageFor(recoveryError))
        }
      } else if (pending?.kind === 'recovery') {
        setError('上次恢复操作结果尚未确认，请先查询原轮次。')
      }
    } catch (loadError) { if (current(version)) { setError(messageFor(loadError)); setNotice('') } }
    finally { release(request); if (current(version)) setLoading(false) }
  }, [acceptTurn, api, assistantId, controller, current, ownerId, release, storage])

  useEffect(() => {
    mounted.current = true; const version = ++generation.current
    if (assistant) queueMicrotask(() => { if (current(version)) void load() })
    return () => { mounted.current = false; generation.current += 1; lock.current = false; controllers.current.forEach((item) => item.abort()); controllers.current.clear() }
  }, [assistant, current, load])

  const queryTurn = useCallback(async (value: PersonalChatTurn) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('正在查询真实轮次状态…')
    const version = generation.current; const request = controller()
    try { const result = await api.turn(value.turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }); if (current(version)) acceptTurn(result) }
    catch (queryError) { if (current(version)) { setError(messageFor(queryError)); setNotice('') } }
    finally { release(request); lock.current = false; if (current(version)) setBusy(false) }
  }, [acceptTurn, api, controller, current, release])

  useEffect(() => {
    if (!turn || !polling.has(turn.status)) return
    const version = generation.current; let stopped = false; let timer = 0; let count = 0
    const poll = () => { timer = window.setTimeout(async () => {
      if (stopped) return
      const request = controller(); count += 1
      try { const result = await api.turn(turn.turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }); if (!stopped && current(version)) { acceptTurn(result); if (polling.has(result.status) && count < POLL_LIMIT) poll(); else if (polling.has(result.status)) setPollingStopped(true) } }
      catch (pollError) { if (!stopped && current(version)) { setError(messageFor(pollError)); setPollingStopped(true) } }
      finally { release(request) }
    }, POLL_INTERVAL) }
    poll(); return () => { stopped = true; window.clearTimeout(timer) }
  }, [acceptTurn, api, controller, current, release, turn])

  const send = useCallback(async () => {
    if (lock.current || !assistantId || loading || (turn && !terminal.has(turn.status)) || (fact && !safeRetry)) return
    const content = input.trim()
    if (!content) { setError(safeRetry ? '请重新输入原消息，再沿用原幂等键安全重试。' : '请输入消息后再发送。'); return }
    if (content.length > MAX_PERSONAL_CHAT_CONTENT_LENGTH) { setError(`消息最多 ${MAX_PERSONAL_CHAT_CONTENT_LENGTH} 个字符。`); return }
    const key = fact?.kind === 'turn' ? fact.idempotencyKey : `vio-chat-${crypto.randomUUID()}`
    const pending: PersonalChatRecoveryFact = { version: 1, kind: 'turn', idempotencyKey: key }
    saveFact(pending); setSafeRetry(false); lock.current = true; setBusy(true); setError(''); setNotice('消息正在提交并由后端处理…')
    const version = generation.current; const request = controller()
    try { const result = await api.createTurn(content, key, { signal: request.signal, timeoutMs: TURN_TIMEOUT }); if (current(version)) acceptTurn(result) }
    catch (sendError) {
      if (current(version)) {
        setNotice(''); setError(messageFor(sendError))
        if (!uncertain(sendError)) { saveFact(null); if (sendError instanceof ApiClientError && sendError.code === 'ASSISTANT_NOT_SELECTED') setTurn(null) }
      }
    } finally { release(request); lock.current = false; if (current(version)) setBusy(false) }
  }, [acceptTurn, api, assistantId, controller, current, fact, input, loading, release, safeRetry, saveFact, turn])

  const recoverSend = useCallback(async () => {
    if (!fact || fact.kind !== 'turn' || lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('正在按原幂等键查询，不会重发消息…')
    const version = generation.current; const request = controller()
    try {
      const result = fact.turnId ? await api.turn(fact.turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT }) : await api.turnByKey(fact.idempotencyKey, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (current(version)) acceptTurn(result)
    } catch (recoveryError) {
      if (current(version)) {
        setNotice(''); setError(messageFor(recoveryError))
        if (recoveryError instanceof ApiClientError && recoveryError.status === 404 && !fact.turnId) { setSafeRetry(true); setError('服务端确认尚无此提交，可以安全沿用原幂等键重试。') }
      }
    } finally { release(request); lock.current = false; if (current(version)) setBusy(false) }
  }, [acceptTurn, api, controller, current, fact, release])

  const performRecovery = useCallback(async (inputValue: PersonalChatRecoveryInput) => {
    if (!turn || lock.current) return
    const key = `vio-chat-${crypto.randomUUID()}`
    const recovery: PersonalChatRecoveryFact = { version: 1, kind: 'recovery', idempotencyKey: key, turnId: turn.turnId, action: inputValue.action, ...(inputValue.action === 'resume' && inputValue.confirmationId ? { confirmationId: inputValue.confirmationId } : {}), statusBefore: turn.status }
    saveFact(recovery); lock.current = true; setBusy(true); setError(''); setNotice(inputValue.action === 'cancel' ? '正在请求终止当前轮次…' : '正在恢复同一轮次…')
    const version = generation.current; const request = controller()
    try {
      if (inputValue.action === 'resume' && inputValue.confirmationId) await api.decide(inputValue.confirmationId, 'approve', { signal: request.signal })
      const result = await api.recover(turn.turnId, inputValue, key, { signal: request.signal, timeoutMs: TURN_TIMEOUT })
      if (current(version)) acceptTurn(result)
    } catch (recoveryError) { if (current(version)) { setNotice(''); setError(`${inputValue.action === 'cancel' ? '终止失败：' : ''}${messageFor(recoveryError)}`); if (!uncertain(recoveryError)) saveFact(null) } }
    finally { release(request); lock.current = false; if (current(version)) setBusy(false) }
  }, [acceptTurn, api, controller, current, release, saveFact, turn])

  const recoverAction = useCallback(async () => {
    if (!fact || fact.kind !== 'recovery' || lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('正在先查询原轮次，再核对原恢复操作…')
    const version = generation.current; const request = controller()
    try {
      const observed = await api.turn(fact.turnId, { signal: request.signal, timeoutMs: QUERY_TIMEOUT })
      if (!current(version)) return
      if (observed.status !== fact.statusBefore) { acceptTurn(observed); return }
      const inputValue: PersonalChatRecoveryInput = fact.action === 'resume' ? { action: 'resume', ...(fact.confirmationId ? { confirmationId: fact.confirmationId } : {}) } : { action: fact.action }
      if (fact.action === 'resume' && fact.confirmationId) await api.decide(fact.confirmationId, 'approve', { signal: request.signal })
      const result = await api.recover(fact.turnId, inputValue, fact.idempotencyKey, { signal: request.signal, timeoutMs: TURN_TIMEOUT })
      if (current(version)) acceptTurn(result)
    } catch (recoveryError) { if (current(version)) { setNotice(''); setError(messageFor(recoveryError)); if (!uncertain(recoveryError)) saveFact(null) } }
    finally { release(request); lock.current = false; if (current(version)) setBusy(false) }
  }, [acceptTurn, api, controller, current, fact, release, saveFact])

  if (!assistantsLoaded) return <section className="conversation-page"><div className="conversation-empty" role="status">正在读取当前助手…</div></section>
  if (!assistant) return <section className="conversation-page"><div className="conversation-empty"><strong>尚未选择助手</strong><span>R1 聊天必须使用服务端当前助手。</span><button type="button" onClick={() => onNavigate('profile')}>进入“我的”选择助手</button></div></section>

  const code = turn?.error?.code
  const config = configurationTarget(code)
  const actionFact = fact?.kind === 'recovery'
  const nonterminal = Boolean(turn && !terminal.has(turn.status))
  const composerDisabled = busy || loading || nonterminal || Boolean(fact && !safeRetry)
  const avatar = assistant.avatar ? '' : Array.from(assistantName || assistant.name)[0] ?? 'V'
  return <div className="conversation-page">
    <ConversationHeader agentName={assistantName || assistant.name} agentAvatar={avatar} avatarImage={assistant.avatar} sessionName="默认会话" sessionLabel="唯一会话" sessionTitle="R1 每个助手只有一个默认会话；多会话在 R3 实现" />
    <div className="personal-chat-boundary"><strong>独立聊天</strong> · 当前用户与助手由服务端会话决定；每个助手仅显示唯一默认会话。</div>
    {(error || notice || turn && turn.status !== 'completed' || pollingStopped || fact) && <section className={`conversation-status ${turn?.status === 'failed' || turn?.status === 'quarantined' ? 'is-danger' : 'is-warning'}`} aria-live="polite" aria-busy={busy}>
      <div>
        {loading && <strong>正在加载真实历史</strong>}
        {notice && <span>{notice}</span>}
        {error && <span role="alert">{error}</span>}
        {turn && turn.status !== 'completed' && <><strong>{turn.status === 'retryable' ? '可以安全重试' : turn.status === 'outcome_unknown' ? '结果未知，禁止重试' : turn.status === 'waiting_confirmation' ? '等待安全确认' : turn.status === 'waiting_budget' ? '等待预算确认' : turn.status === 'cancelled' ? '本轮已终止' : turn.status === 'failed' ? '本轮失败' : turn.status === 'quarantined' ? '本轮已隔离' : '轮次处理中'}</strong><span>{failureLabel(code) || `真实状态：${turn.status}`}</span></>}
        {pollingStopped && <span>自动查询已停止，可手动刷新真实状态。</span>}
        {fact?.kind === 'turn' && <span>已保留原随机提交键；先查询，不会换键盲目重发。</span>}
        {actionFact && <span>恢复结果尚未确认；将先查询 turnId，再沿用原恢复键。</span>}
      </div>
      <div className="personal-chat-status-actions">
        {error && !fact && <button type="button" disabled={busy} onClick={() => void load()}>重试读取</button>}
        {fact?.kind === 'turn' && !safeRetry && <button type="button" disabled={busy} onClick={() => void recoverSend()}>按原键查询</button>}
        {actionFact && <button type="button" disabled={busy} onClick={() => void recoverAction()}>查询并恢复原操作</button>}
        {turn && !fact && polling.has(turn.status) && <button type="button" disabled={busy} onClick={() => void queryTurn(turn)}>刷新轮次</button>}
        {turn && !fact && ['waiting_confirmation', 'waiting_budget'].includes(turn.status) && turn.confirmation && <button type="button" disabled={busy} onClick={() => void performRecovery({ action: 'resume', confirmationId: turn.confirmation!.confirmationId })}>批准并继续</button>}
        {turn && !fact && turn.status === 'retryable' && <button type="button" disabled={busy} onClick={() => void performRecovery({ action: 'retry' })}>安全重试一次</button>}
        {turn && !fact && ['processing', 'ready', 'result_ready', 'publishing'].includes(turn.status) && <button type="button" disabled={busy} onClick={() => void performRecovery({ action: 'resume' })}>继续同一轮次</button>}
        {turn && !fact && ['processing', 'waiting_confirmation', 'waiting_budget', 'ready', 'retryable'].includes(turn.status) && <button type="button" disabled={busy} onClick={() => void performRecovery({ action: 'cancel' })}>终止本轮</button>}
        {config && <button type="button" disabled={busy} onClick={() => onNavigate(config)}>{config === 'capability' ? '进入“能力”配置' : '进入“我的”选择助手'}</button>}
      </div>
    </section>}
    <MessageList messages={messages} agentAvatar={avatar} agentAvatarImage={assistant.avatar} agentName={assistantName || assistant.name} emptyDescription="消息只会在 Vio 独立后端返回真实结果后显示。" loading={loading} />
    <ConversationComposer value={input} disabled={composerDisabled} busy={busy} maxLength={MAX_PERSONAL_CHAT_CONTENT_LENGTH} onChange={(value) => { setInput(value); setError('') }} onSend={() => void send()} />
  </div>
}
