import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiClientError,
  MAX_CONVERSATION_CONTENT_LENGTH,
  conversationApi,
} from '../api'
import type {
  ConversationApi,
  ConversationMessage,
  ConversationTurn,
  ResumeTurnInput,
} from '../api'
import {
  clearPendingTurn,
  readPendingTurn,
  writePendingTurn,
} from '../api/conversation-recovery'
import type { PendingTurnFact } from '../api/conversation-recovery'
import ConversationComposer from '../components/conversation/ConversationComposer'
import ConversationHeader from '../components/conversation/ConversationHeader'
import ConversationStatus from '../components/conversation/ConversationStatus'
import MessageList from '../components/conversation/MessageList'
import SessionContextBar from '../components/conversation/SessionContextBar'
import ToolControls from '../components/conversation/ToolControls'

const TURN_REQUEST_TIMEOUT_MS = 90_000
const QUERY_REQUEST_TIMEOUT_MS = 15_000
const MAX_PROCESSING_POLLS = 6
const PROCESSING_POLL_INTERVAL_MS = 1_500

const terminalStatuses = new Set(['completed', 'failed', 'quarantined'])
const uncertainErrorCodes = new Set(['network_error', 'request_timeout', 'invalid_response'])

type ConversationPageProps = {
  api?: ConversationApi
  storage?: Storage | null
}

function getSessionStorage() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function mergeMessages(
  current: ConversationMessage[],
  incoming: Array<ConversationMessage | null>,
) {
  const byId = new Map(current.map((message) => [message.messageId, message]))
  incoming.forEach((message) => {
    if (message) byId.set(message.messageId, message)
  })
  return [...byId.values()].sort(
    (left, right) => left.sequenceNumber - right.sequenceNumber
      || left.messageId.localeCompare(right.messageId),
  )
}

function describeError(error: unknown) {
  if (error instanceof TypeError) return '后端返回了无法识别的响应，请稍后查询当前轮次。'
  if (!(error instanceof ApiClientError)) return '发生未知错误，请稍后重试。'

  if (error.code === 'request_timeout') return '请求超时，结果可能已经产生，请查询后再决定下一步。'
  if (error.code === 'network_error') return '暂时无法连接 Vio 后端，请确认本地服务已启动。'
  if (error.code === 'continuity_engine_unavailable' || error.status === 503) {
    return '连续性服务当前未启用或不可用，本轮尚未开始。'
  }
  if (error.status === 400) return '消息或请求格式不符合后端要求，请检查后重试。'
  if (error.status === 404) return '没有找到这个轮次；已保留恢复事实，不会自动重发。'
  if (error.status === 409) return '请求与现有幂等或并发事实冲突，没有自动创建新轮次。'
  if (error.code === 'invalid_response') return '后端响应无法校验，结果状态尚未确认。'
  if (error.code === 'request_aborted') return ''
  return 'Vio 后端未能完成请求，请稍后重试。'
}

function isUncertainMutationError(error: unknown) {
  return error instanceof TypeError
    || (error instanceof ApiClientError && uncertainErrorCodes.has(error.code))
}

function ConversationPage({ api = conversationApi, storage }: ConversationPageProps) {
  const sessionStorage = storage === undefined ? getSessionStorage() : storage
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [input, setInput] = useState('')
  const [activeTurn, setActiveTurn] = useState<ConversationTurn | null>(null)
  const [pendingFact, setPendingFact] = useState<PendingTurnFact | null>(() =>
    readPendingTurn(sessionStorage),
  )
  const [operationBusy, setOperationBusy] = useState(false)
  const [operationUncertain, setOperationUncertain] = useState(false)
  const [operationError, setOperationError] = useState('')
  const [notice, setNotice] = useState('')
  const [pollingStopped, setPollingStopped] = useState(false)
  const mountedRef = useRef(true)
  const operationLockRef = useRef(false)
  const controllersRef = useRef(new Set<AbortController>())
  const restoredTurnRef = useRef<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllersRef.current.forEach((controller) => controller.abort())
      controllersRef.current.clear()
    }
  }, [])

  const makeController = useCallback(() => {
    const controller = new AbortController()
    controllersRef.current.add(controller)
    return {
      controller,
      release: () => controllersRef.current.delete(controller),
    }
  }, [])

  const acceptTurn = useCallback((turn: ConversationTurn, idempotencyKey?: string) => {
    if (!mountedRef.current) return

    // A turn obtained by the current page is already known. The mount-only
    // recovery effect must not immediately query it as if it came from a reload.
    restoredTurnRef.current = turn.turnId
    setActiveTurn(turn)
    setMessages((current) => mergeMessages(current, [turn.userMessage, turn.subjectMessage]))
    setOperationUncertain(false)
    setOperationError('')
    setPollingStopped(false)

    if (terminalStatuses.has(turn.status)) {
      clearPendingTurn(sessionStorage)
      setPendingFact(null)
      return
    }

    setPendingFact((current) => {
      const key = idempotencyKey ?? current?.idempotencyKey
      if (!key) return current
      const next: PendingTurnFact = {
        version: 1,
        idempotencyKey: key,
        turnId: turn.turnId,
      }
      writePendingTurn(sessionStorage, next)
      return next
    })
  }, [sessionStorage])

  const loadHistory = useCallback(async () => {
    const { controller, release } = makeController()
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const history = await api.listMessages({
        signal: controller.signal,
        timeoutMs: QUERY_REQUEST_TIMEOUT_MS,
      })
      if (!mountedRef.current) return
      setMessages((current) => mergeMessages(history, current))
    } catch (error) {
      if (!mountedRef.current) return
      const message = describeError(error)
      if (message) setHistoryError(`会话记录读取失败：${message}`)
    } finally {
      release()
      if (mountedRef.current) setHistoryLoading(false)
    }
  }, [api, makeController])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const queryTurn = useCallback(async (turnId: string, showBusy = true) => {
    if (operationLockRef.current && showBusy) return null
    if (showBusy) {
      operationLockRef.current = true
      setOperationBusy(true)
      setOperationError('')
      setNotice('')
    }
    const { controller, release } = makeController()
    try {
      const turn = await api.getTurn(turnId, {
        signal: controller.signal,
        timeoutMs: QUERY_REQUEST_TIMEOUT_MS,
      })
      acceptTurn(turn)
      if (turn.status === 'processing' && showBusy) setPollingStopped(true)
      return turn
    } catch (error) {
      if (mountedRef.current) {
        const message = describeError(error)
        if (message) setOperationError(message)
      }
      return null
    } finally {
      release()
      if (showBusy) {
        operationLockRef.current = false
        if (mountedRef.current) setOperationBusy(false)
      }
    }
  }, [acceptTurn, api, makeController])

  useEffect(() => {
    if (!pendingFact?.turnId || restoredTurnRef.current === pendingFact.turnId) return
    restoredTurnRef.current = pendingFact.turnId
    void queryTurn(pendingFact.turnId, false)
  }, [pendingFact?.turnId, queryTurn])

  const processingTurnId = activeTurn?.status === 'processing' ? activeTurn.turnId : null
  useEffect(() => {
    if (!processingTurnId || operationUncertain) return
    let cancelled = false
    let timerId = 0
    let attempts = 0
    let pollController: AbortController | null = null

    const poll = () => {
      timerId = window.setTimeout(async () => {
        if (cancelled) return
        attempts += 1
        pollController = new AbortController()
        controllersRef.current.add(pollController)
        try {
          const turn = await api.getTurn(processingTurnId, {
            signal: pollController.signal,
            timeoutMs: QUERY_REQUEST_TIMEOUT_MS,
          })
          acceptTurn(turn)
          if (!cancelled && turn.status === 'processing' && attempts < MAX_PROCESSING_POLLS) {
            poll()
          } else if (!cancelled && turn.status === 'processing') {
            setPollingStopped(true)
          }
        } catch (error) {
          if (!cancelled) {
            const message = describeError(error)
            if (message) setOperationError(message)
            setPollingStopped(true)
          }
        } finally {
          if (pollController) controllersRef.current.delete(pollController)
        }
      }, PROCESSING_POLL_INTERVAL_MS)
    }

    poll()
    return () => {
      cancelled = true
      window.clearTimeout(timerId)
      pollController?.abort()
    }
  }, [acceptTurn, api, operationUncertain, processingTurnId])

  const send = useCallback(async () => {
    if (operationLockRef.current || activeTurn && !terminalStatuses.has(activeTurn.status) || pendingFact) {
      return
    }
    const content = input.trim()
    if (!content) {
      setOperationError('请输入消息后再发送。')
      return
    }
    if (content.length > MAX_CONVERSATION_CONTENT_LENGTH) {
      setOperationError(`消息最多 ${MAX_CONVERSATION_CONTENT_LENGTH} 个字符。`)
      return
    }

    operationLockRef.current = true
    setOperationBusy(true)
    setOperationUncertain(false)
    setOperationError('')
    setNotice('正在创建持久化轮次…')
    const idempotencyKey = `vio-turn-${crypto.randomUUID()}`
    const fact: PendingTurnFact = { version: 1, idempotencyKey, content }
    writePendingTurn(sessionStorage, fact)
    setPendingFact(fact)
    setInput('')
    const { controller, release } = makeController()

    try {
      const turn = await api.createTurn(content, idempotencyKey, {
        signal: controller.signal,
        timeoutMs: TURN_REQUEST_TIMEOUT_MS,
      })
      acceptTurn(turn, idempotencyKey)
      if (mountedRef.current) setNotice('')
    } catch (error) {
      if (!mountedRef.current) return
      const message = describeError(error)
      if (isUncertainMutationError(error)) {
        setOperationUncertain(true)
        setOperationError(message)
      } else {
        clearPendingTurn(sessionStorage)
        setPendingFact(null)
        setInput(content)
        setOperationError(message)
      }
      setNotice('')
    } finally {
      release()
      operationLockRef.current = false
      if (mountedRef.current) setOperationBusy(false)
    }
  }, [acceptTurn, activeTurn, api, input, makeController, pendingFact, sessionStorage])

  const resume = useCallback(async () => {
    if (!activeTurn || operationLockRef.current) return
    let body: ResumeTurnInput
    if (
      activeTurn.status === 'confirmation_required'
      || activeTurn.status === 'budget_confirmation_required'
    ) {
      if (!activeTurn.confirmation?.confirmationId) {
        setOperationError('后端没有返回可用的确认标识，无法继续。')
        return
      }
      body = { confirmationId: activeTurn.confirmation.confirmationId }
    } else if (activeTurn.status === 'waiting_retry') {
      body = { retryApproved: true }
    } else if (activeTurn.status === 'waiting_budget') {
      body = {}
    } else {
      return
    }

    operationLockRef.current = true
    setOperationBusy(true)
    setOperationError('')
    setNotice('正在继续同一轮次…')
    const { controller, release } = makeController()
    try {
      const turn = await api.resumeTurn(activeTurn.turnId, body, {
        signal: controller.signal,
        timeoutMs: TURN_REQUEST_TIMEOUT_MS,
      })
      acceptTurn(turn)
      if (mountedRef.current) setNotice('')
    } catch (error) {
      if (!mountedRef.current) return
      setOperationError(describeError(error))
      if (isUncertainMutationError(error)) setOperationUncertain(true)
      setNotice('')
    } finally {
      release()
      operationLockRef.current = false
      if (mountedRef.current) setOperationBusy(false)
    }
  }, [acceptTurn, activeTurn, api, makeController])

  const recover = useCallback(async () => {
    if (!pendingFact || operationLockRef.current) return
    operationLockRef.current = true
    setOperationBusy(true)
    setOperationError('')
    setNotice('正在查询原轮次…')
    const { controller, release } = makeController()
    try {
      let turn: ConversationTurn
      if (pendingFact.turnId) {
        turn = await api.getTurn(pendingFact.turnId, {
          signal: controller.signal,
          timeoutMs: QUERY_REQUEST_TIMEOUT_MS,
        })
        acceptTurn(turn)
        if (turn.status === 'outcome_unknown') {
          setNotice('已有结果仍未知，正在恢复同一轮次…')
          turn = await api.resumeTurn(turn.turnId, {}, {
            signal: controller.signal,
            timeoutMs: TURN_REQUEST_TIMEOUT_MS,
          })
          acceptTurn(turn)
        }
      } else if (pendingFact.content) {
        turn = await api.createTurn(pendingFact.content, pendingFact.idempotencyKey, {
          signal: controller.signal,
          timeoutMs: TURN_REQUEST_TIMEOUT_MS,
        })
        acceptTurn(turn, pendingFact.idempotencyKey)
      } else {
        throw new TypeError('Pending turn fact has no recoverable identity.')
      }
      if (mountedRef.current) setNotice('')
    } catch (error) {
      if (!mountedRef.current) return
      setOperationUncertain(isUncertainMutationError(error))
      setOperationError(describeError(error))
      setNotice('')
    } finally {
      release()
      operationLockRef.current = false
      if (mountedRef.current) setOperationBusy(false)
    }
  }, [acceptTurn, api, makeController, pendingFact])

  const composerDisabled = operationBusy
    || historyLoading
    || Boolean(pendingFact)
    || Boolean(activeTurn && !terminalStatuses.has(activeTurn.status))

  const hasPendingWithoutTurn = Boolean(pendingFact && !activeTurn && !operationBusy)
  const statusNotice = useMemo(() => notice, [notice])

  return (
    <div className="conversation-page">
      <ConversationHeader agentName="Vio" agentAvatar="V" sessionName="连续性本地试聊" />
      <ToolControls />
      <SessionContextBar />
      <ConversationStatus
        turn={activeTurn}
        hasPendingWithoutTurn={hasPendingWithoutTurn}
        uncertain={operationUncertain}
        busy={operationBusy}
        historyError={historyError}
        operationError={operationError}
        notice={statusNotice}
        pollingStopped={pollingStopped}
        onRetryHistory={() => void loadHistory()}
        onRefresh={() => activeTurn && void queryTurn(activeTurn.turnId)}
        onResume={() => void resume()}
        onRecover={() => void recover()}
      />
      <MessageList messages={messages} agentAvatar="V" loading={historyLoading} />
      <ConversationComposer
        value={input}
        disabled={composerDisabled}
        busy={operationBusy}
        onChange={(value) => {
          setInput(value)
          setOperationError('')
        }}
        onSend={() => void send()}
      />
    </div>
  )
}

export default ConversationPage
