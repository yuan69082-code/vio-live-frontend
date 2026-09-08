import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiClientError } from '../../api/client'
import {
  createPersonalCapabilityApi,
  parseExecutionInput,
  type CapabilityCategory,
  type CapabilityExecution,
  type CapabilityExecutionStatus,
  type CapabilityItem,
  type CapabilityOperationResult,
  type ExecutableCapabilityCategory,
  type JsonValue,
  type SkillStepInput,
} from '../../api/personal-capability-api'
import {
  clearCapabilityDiscoveryRecovery,
  clearCapabilityRecovery,
  readCapabilityDiscoveryRecovery,
  readCapabilityRecovery,
  writeCapabilityDiscoveryRecovery,
  writeCapabilityRecovery,
} from '../../api/personal-capability-recovery'
import { finishOperation, operationKey } from '../../api/personal-api'
import { usePersonal } from '../../state/PersonalContext'
import { personalError, useScopedAction } from '../personal/useScopedAction'
import CapabilitySection from './CapabilitySection'
import styles from './UnifiedCapabilityManager.module.css'

type ConfigPending = {
  operation: string
  key: string
  label: string
  run: (confirmationId: string | null, key: string, signal: AbortSignal) => Promise<CapabilityOperationResult>
  clear?: () => void
  discoveryCapabilityId?: string
}
type ConfigQuery = { capabilityId: string; key: string; label: string }
type ExecutionPending = {
  key: string
  category: ExecutableCapabilityCategory
  capabilityId: string
  operationName: string
  input: { [key: string]: JsonValue }
}
type RecoveryPending = { key: string; executionId: string; action: 'resume' | 'retry' | 'cancel'; confirmationId: string | null }

const categoryLabels: Record<CapabilityCategory, string> = { model_api: '模型调用投影', local_tool: '本地 Tool', mcp_tool: 'MCP Tool', skill: 'Skill', plugin_action: '插件动作' }
const statusLabels: Record<CapabilityExecutionStatus, string> = {
  waiting_confirmation: '等待安全确认', prepared: '已准备', in_flight: '执行中', retryable: '可安全重试', outcome_unknown: '结果未知', succeeded: '已成功', failed_terminal: '终止失败', cancelled: '已取消',
}
const terminalStatuses: CapabilityExecutionStatus[] = ['succeeded', 'failed_terminal', 'cancelled']

function sessionStorageOrNull() { try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null } }
function operationKeyValue(prefix: string) { return `${prefix}-${crypto.randomUUID()}` }
function knownTerminal(error: unknown) { return error instanceof ApiClientError && error.status !== null && error.status < 500 && !['request_timeout', 'network_error', 'invalid_response'].includes(error.code) }
function safeJson(value: unknown) { try { return JSON.stringify(value, null, 2) } catch { return '{"status":"unavailable"}' } }
function isAllowedMcpFormUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return false
    if (url.protocol === 'https:') return true
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
    return import.meta.env.DEV && url.protocol === 'http:' && loopbackHosts.has(url.hostname)
      && typeof window !== 'undefined' && loopbackHosts.has(window.location.hostname)
  } catch { return false }
}

export default function UnifiedCapabilityManager() {
  const personal = usePersonal()
  const session = personal.state.kind === 'ready' ? personal.state.session : null
  const ownerId = session?.user.userId ?? ''
  const assistantId = session?.currentAssistantId ?? ''
  const assistantName = personal.assistants?.items.find((item) => item.assistantId === assistantId)?.name ?? '当前助手'
  const scope = `${personal.scope}:${ownerId}:${assistantId}:r6`
  const operationScope = `${ownerId}:${assistantId}`
  const api = useMemo(() => createPersonalCapabilityApi(personal.api), [personal.api])
  const storage = sessionStorageOrNull()
  const catalogTask = useScopedAction(`${scope}:catalog`)
  const historyTask = useScopedAction(`${scope}:history`)
  const [catalog, setCatalog] = useState<CapabilityItem[] | null>(null)
  const [history, setHistory] = useState<CapabilityExecution[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [historyCategory, setHistoryCategory] = useState<CapabilityCategory | ''>('')
  const [historyStatus, setHistoryStatus] = useState<CapabilityExecutionStatus | ''>('')

  const loadCatalog = useCallback(() => catalogTask.run(
    (signal) => personal.guarded((owned) => api.catalog({ signal: owned }), signal),
    (value) => setCatalog(value.items),
  ), [api, catalogTask.run, personal.guarded])
  const loadHistory = useCallback((cursor?: string, append = false) => historyTask.run(
    (signal) => personal.guarded((owned) => api.executions({ category: historyCategory, status: historyStatus, cursor, limit: 25 }, { signal: owned }), signal),
    (value) => { setHistory((previous) => append && previous ? [...previous, ...value.items] : value.items); setNextCursor(value.nextCursor) },
  ), [api, historyCategory, historyStatus, historyTask.run, personal.guarded])

  useEffect(() => {
    if (!assistantId) { setCatalog(null); setHistory(null); return }
    let active = true
    queueMicrotask(() => { if (active) { void loadCatalog(); void loadHistory() } })
    return () => { active = false }
  // Reads are recreated for explicit filter submission; assistant changes remount their scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId])

  const [configBusy, setConfigBusy] = useState(false)
  const [configError, setConfigError] = useState('')
  const [configNotice, setConfigNotice] = useState('')
  const [configUnknown, setConfigUnknown] = useState(false)
  const [configConfirmation, setConfigConfirmation] = useState<{ id: string; label: string } | null>(null)
  const [configQuery, setConfigQuery] = useState<ConfigQuery | null>(null)
  const [configDecisionUnknown, setConfigDecisionUnknown] = useState<{ approve: boolean } | null>(null)
  const configController = useRef<AbortController | null>(null)
  const configPending = useRef<ConfigPending | null>(null)

  const receiveConfig = useCallback((pending: ConfigPending, result: CapabilityOperationResult) => {
    if (result.operationStatus === 'confirmation_required' && result.security.confirmationId) {
      setConfigUnknown(false); setConfigQuery(null); setConfigDecisionUnknown(null)
      setConfigConfirmation({ id: result.security.confirmationId, label: pending.label })
      setConfigNotice('服务端要求安全确认；配置尚未生效。')
      return
    }
    if (result.operationStatus === 'failed' || result.operationStatus === 'outcome_unknown') {
      finishOperation(operationScope, pending.operation, pending.key)
      pending.clear?.()
      setConfigConfirmation(null); setConfigDecisionUnknown(null)
      setConfigError(personalError(new ApiClientError('R6 configuration operation failed', { code: result.error?.code ?? 'invalid_response', status: null })))
      if (result.operationStatus === 'outcome_unknown' && pending.discoveryCapabilityId) {
        setConfigUnknown(true)
        setConfigQuery({ capabilityId: pending.discoveryCapabilityId, key: pending.key, label: pending.label })
        setConfigNotice('MCP 发现可能已越过外部边界；只能按原键查询冻结事实，不能自动重发。')
      } else {
        if (pending.discoveryCapabilityId) clearCapabilityDiscoveryRecovery(storage, ownerId, assistantId, pending.key)
        configPending.current = null
        setConfigUnknown(false); setConfigQuery(null)
        setConfigNotice('服务端记录本次配置未完成；请求正文已从页面清除，可以重新发起显式操作。')
      }
      return
    }
    finishOperation(operationScope, pending.operation, pending.key)
    if (pending.discoveryCapabilityId) clearCapabilityDiscoveryRecovery(storage, ownerId, assistantId, pending.key)
    configPending.current = null
    setConfigUnknown(false); setConfigConfirmation(null); setConfigQuery(null); setConfigDecisionUnknown(null)
    pending.clear?.()
    if (result.operationStatus === 'denied') { setConfigError('服务端拒绝本次配置；未安装、发现或更改能力。请求正文已从页面清除。'); return }
    setConfigNotice(result.discovery ? `MCP 发现完成：${result.discovery.toolCount} 个严格校验工具。` : `${pending.label}已由服务端确认完成。`)
    void loadCatalog(); void loadHistory()
  }, [assistantId, loadCatalog, loadHistory, operationScope, ownerId, storage])

  async function runConfig(pending: ConfigPending, confirmationId: string | null = null) {
    if (configController.current) return
    const controller = new AbortController(); configController.current = controller
    setConfigBusy(true); setConfigError(''); setConfigNotice(''); setConfigUnknown(false); setConfigDecisionUnknown(null)
    try {
      const result = await personal.guarded((signal) => pending.run(confirmationId, pending.key, signal), controller.signal)
      if (!controller.signal.aborted) receiveConfig(pending, result)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setConfigError(personalError(failure))
        if (knownTerminal(failure)) {
          finishOperation(operationScope, pending.operation, pending.key)
          if (pending.discoveryCapabilityId) clearCapabilityDiscoveryRecovery(storage, ownerId, assistantId, pending.key)
          configPending.current = null
          pending.clear?.()
        }
        else if (pending.discoveryCapabilityId) {
          pending.clear?.()
          setConfigUnknown(true)
          setConfigQuery({ capabilityId: pending.discoveryCapabilityId, key: pending.key, label: pending.label })
          setConfigNotice('没有收到 MCP 发现结果；只能按原键查询，不能自动重发。')
        } else setConfigUnknown(true)
      }
    } finally { if (configController.current === controller) { configController.current = null; setConfigBusy(false) } }
  }

  const beginConfig = useCallback((input: Omit<ConfigPending, 'key'>) => {
    if (configController.current || configConfirmation || configUnknown) return
    const pending = { ...input, key: operationKey(operationScope, input.operation) }
    configPending.current = pending
    if (pending.discoveryCapabilityId) writeCapabilityDiscoveryRecovery(storage, ownerId, assistantId, {
      version: 1,
      idempotencyKey: pending.key,
      capabilityId: pending.discoveryCapabilityId,
    })
    void runConfig(pending)
  // runConfig is a component-scoped stable operation dispatcher.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId, configConfirmation, configUnknown, operationScope, ownerId, storage])

  async function decideConfig(approve: boolean) {
    const pending = configPending.current; const prompt = configConfirmation
    if (!pending || !prompt || configController.current) return
    const controller = new AbortController(); configController.current = controller; setConfigBusy(true); setConfigError(''); setConfigUnknown(false); setConfigDecisionUnknown(null)
    try {
      await personal.guarded((signal) => api.decide(prompt.id, approve ? 'approve' : 'reject', { signal }), controller.signal)
      if (approve) { configController.current = null; setConfigBusy(false); await runConfig(pending, prompt.id) }
      else {
        finishOperation(operationScope, pending.operation, pending.key); configPending.current = null; pending.clear?.()
        if (pending.discoveryCapabilityId) clearCapabilityDiscoveryRecovery(storage, ownerId, assistantId, pending.key)
        setConfigConfirmation(null); setConfigUnknown(false); setConfigQuery(null); setConfigDecisionUnknown(null); setConfigNotice('已明确拒绝本次配置；可以重新发起新的操作。')
      }
    } catch (failure) { if (!controller.signal.aborted) {
      setConfigError(personalError(failure))
      if (knownTerminal(failure)) {
        finishOperation(operationScope, pending.operation, pending.key); configPending.current = null; pending.clear?.()
        if (pending.discoveryCapabilityId) clearCapabilityDiscoveryRecovery(storage, ownerId, assistantId, pending.key)
        setConfigUnknown(false); setConfigConfirmation(null); setConfigQuery(null); setConfigDecisionUnknown(null)
        setConfigNotice('服务端明确拒绝或结束了原确认；请求正文已清除，请重新读取后发起新操作。')
      } else { setConfigUnknown(true); setConfigDecisionUnknown({ approve }) }
    } }
    finally { if (configController.current === controller) { configController.current = null; setConfigBusy(false) } }
  }

  async function queryConfigDiscovery() {
    const query = configQuery
    if (!query || configController.current) return
    const controller = new AbortController(); configController.current = controller
    setConfigBusy(true); setConfigError(''); setConfigNotice('')
    try {
      const result = await personal.guarded((signal) => api.discoveryByKey(query.capabilityId, query.key, { signal }), controller.signal)
      if (controller.signal.aborted) return
      if (result.status === 'not_found' || !result.operation) {
        setConfigUnknown(true)
        setConfigNotice('服务端没有找到原发现事实；不会自动重发。可结束核对后，再由你显式发起一次新发现。')
        return
      }
      const pending = configPending.current
      if (!pending || pending.key !== query.key) {
        setConfigError('当前页面已没有原发现上下文；不能恢复或重发。请结束核对后显式创建新操作。')
        return
      }
      receiveConfig(pending, result.operation)
    } catch (failure) {
      if (!controller.signal.aborted) { setConfigError(personalError(failure)); setConfigUnknown(true); setConfigNotice('原发现事实仍未确认；不会自动重发。') }
    } finally { if (configController.current === controller) { configController.current = null; setConfigBusy(false) } }
  }

  function finishConfigQuery() {
    const pending = configPending.current
    if (pending) finishOperation(operationScope, pending.operation, pending.key)
    if (configQuery) clearCapabilityDiscoveryRecovery(storage, ownerId, assistantId, configQuery.key)
    configPending.current = null
    setConfigUnknown(false); setConfigQuery(null); setConfigDecisionUnknown(null); setConfigConfirmation(null); setConfigError('')
    setConfigNotice('已结束原发现核对。下一次发现将由你显式发起并使用新操作键。')
  }

  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpDescription, setMcpDescription] = useState('')
  const [mcpTrusted, setMcpTrusted] = useState(false)
  const [skillName, setSkillName] = useState('')
  const [skillVersion, setSkillVersion] = useState('1')
  const [skillDescription, setSkillDescription] = useState('')
  const [skillSteps, setSkillSteps] = useState<SkillStepInput[]>([{ stepId: 'step-1', category: 'local_tool', capabilityId: '', operationName: 'execute' }])
  const [pluginName, setPluginName] = useState('')
  const [pluginVersion, setPluginVersion] = useState('1')
  const [pluginDescription, setPluginDescription] = useState('')
  const [pluginActions, setPluginActions] = useState([{ actionId: 'run', skillId: '' }])

  const [execution, setExecution] = useState<CapabilityExecution | null>(null)
  const [executionBusy, setExecutionBusy] = useState(false)
  const [executionError, setExecutionError] = useState('')
  const [executionNotice, setExecutionNotice] = useState('')
  const [executionMissing, setExecutionMissing] = useState(false)
  const [executionDecisionUnknown, setExecutionDecisionUnknown] = useState<{ approve: boolean } | null>(null)
  const [executionStale, setExecutionStale] = useState(false)
  const [selectedCapabilityId, setSelectedCapabilityId] = useState('')
  const [operationName, setOperationName] = useState('')
  const [inputText, setInputText] = useState('{\n  "text": ""\n}')
  const executionController = useRef<AbortController | null>(null)
  const executionPending = useRef<ExecutionPending | null>(null)
  const recoveryPending = useRef<RecoveryPending | null>(null)

  const executable = useMemo(() => (catalog ?? []).filter((item): item is CapabilityItem & { category: ExecutableCapabilityCategory } => item.category !== 'model_api' && item.status === 'enabled' && item.lifecycleStatus !== 'uninstalled'), [catalog])
  const selectedCapability = executable.find((item) => item.capabilityId === selectedCapabilityId) ?? null

  const acceptExecution = useCallback((value: CapabilityExecution, originalKey?: string) => {
    recoveryPending.current = null
    setExecution(value); setExecutionMissing(false); setExecutionDecisionUnknown(null); setExecutionStale(false); setInputText('{\n  "text": ""\n}')
    const key = originalKey ?? readCapabilityRecovery(storage, ownerId, assistantId)?.idempotencyKey
    if (terminalStatuses.includes(value.status)) {
      if (key) clearCapabilityRecovery(storage, ownerId, assistantId, key)
      executionPending.current = null; recoveryPending.current = null
    } else if (key) writeCapabilityRecovery(storage, ownerId, assistantId, { version: 1, idempotencyKey: key, executionId: value.executionId })
    setExecutionNotice(value.status === 'waiting_confirmation' ? '执行尚未开始，服务端要求当前助手的安全确认。'
      : value.status === 'outcome_unknown' ? '外部边界可能已经越过；只能查询，不能盲目重试。'
        : value.status === 'retryable' ? '服务端证明上次请求未发送，可以显式安全重试。'
          : value.status === 'succeeded' ? '能力结果已由服务端持久化。' : `服务端状态：${statusLabels[value.status]}。`)
    void loadHistory()
  }, [assistantId, loadHistory, ownerId, storage])

  async function runExecution(pending: ExecutionPending) {
    if (executionController.current) return
    const controller = new AbortController(); executionController.current = controller
    setExecutionBusy(true); setExecutionError(''); setExecutionNotice(''); setExecutionMissing(false)
    try {
      const value = await personal.guarded((signal) => api.execute({ category: pending.category, capabilityId: pending.capabilityId, operationName: pending.operationName, input: pending.input }, pending.key, { signal }), controller.signal)
      if (!controller.signal.aborted) acceptExecution(value, pending.key)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setExecutionError(personalError(failure))
        if (knownTerminal(failure)) { clearCapabilityRecovery(storage, ownerId, assistantId, pending.key); executionPending.current = null }
        else setExecutionNotice('执行结果尚未确认；只能按原操作键查询。')
      }
    } finally { if (executionController.current === controller) { executionController.current = null; setExecutionBusy(false) } }
  }

  function submitExecution() {
    if (!selectedCapability || !operationName || executionController.current) return
    let input: { [key: string]: JsonValue }
    try { input = parseExecutionInput(inputText) } catch (failure) { setExecutionError(failure instanceof Error ? failure.message : '输入无效。'); return }
    const pending = { key: operationKeyValue('vio-capability'), category: selectedCapability.category, capabilityId: selectedCapability.capabilityId, operationName, input }
    executionPending.current = pending
    writeCapabilityRecovery(storage, ownerId, assistantId, { version: 1, idempotencyKey: pending.key, executionId: null })
    void runExecution(pending)
  }

  async function queryOriginal() {
    const fact = readCapabilityRecovery(storage, ownerId, assistantId)
    if (!fact || executionController.current) { setExecutionError('没有可查询的原操作标识。'); return }
    const controller = new AbortController(); executionController.current = controller; setExecutionBusy(true); setExecutionError(''); setExecutionNotice('')
    try {
      const result = await personal.guarded((signal) => api.executionByKey(fact.idempotencyKey, { signal }), controller.signal)
      if (result.status === 'found' && result.execution) acceptExecution(result.execution, fact.idempotencyKey)
      else {
        setExecutionMissing(true)
        setExecutionNotice(executionPending.current?.key === fact.idempotencyKey ? '服务端确认未找到原执行；可用原键安全重发同一内存输入。' : '服务端未找到原执行，且刷新后已没有原输入；请清除恢复索引并重新填写。')
      }
    } catch (failure) { if (!controller.signal.aborted) setExecutionError(personalError(failure)) }
    finally { if (executionController.current === controller) { executionController.current = null; setExecutionBusy(false) } }
  }

  async function recoverExecution(action: RecoveryPending['action'], confirmationId: string | null = null) {
    if (!execution || executionController.current) return
    const existing = recoveryPending.current
    const pending = existing && existing.executionId === execution.executionId && existing.action === action
      ? existing : { key: operationKeyValue('vio-capability-recovery'), executionId: execution.executionId, action, confirmationId }
    recoveryPending.current = pending
    const controller = new AbortController(); executionController.current = controller; setExecutionBusy(true); setExecutionError(''); setExecutionNotice('')
    try {
      const value = await personal.guarded((signal) => api.recover(pending.executionId, pending.action, pending.confirmationId ?? confirmationId, pending.key, { signal }), controller.signal)
      if (!controller.signal.aborted) { recoveryPending.current = null; acceptExecution(value) }
    } catch (failure) { if (!controller.signal.aborted) {
      setExecutionError(personalError(failure))
      if (knownTerminal(failure)) { recoveryPending.current = null; setExecutionStale(true); setExecutionNotice('服务端明确拒绝了恢复操作；当前卡片可能已过期，请先重新读取。') }
      else setExecutionNotice('恢复操作结果尚未确认；请重新读取原执行，恢复键不会更换。')
    } }
    finally { if (executionController.current === controller) { executionController.current = null; setExecutionBusy(false) } }
  }

  async function decideExecution(approve: boolean) {
    const confirmationId = execution?.confirmation?.confirmationId
    if (!confirmationId || executionController.current) return
    const controller = new AbortController(); executionController.current = controller; setExecutionBusy(true); setExecutionError(''); setExecutionDecisionUnknown(null)
    try {
      await personal.guarded((signal) => api.decide(confirmationId, approve ? 'approve' : 'reject', { signal }), controller.signal)
      executionController.current = null; setExecutionBusy(false)
      await recoverExecution(approve ? 'resume' : 'cancel', approve ? confirmationId : null)
    } catch (failure) { if (!controller.signal.aborted) {
      setExecutionError(personalError(failure))
      if (knownTerminal(failure)) { setExecutionDecisionUnknown(null); setExecutionStale(true); setExecutionNotice('服务端明确拒绝或结束了原确认；请先重新读取执行状态。') }
      else setExecutionDecisionUnknown({ approve })
    } }
    finally { if (executionController.current === controller) { executionController.current = null; setExecutionBusy(false) } }
  }

  useEffect(() => {
    configController.current?.abort(); executionController.current?.abort()
    configController.current = null; executionController.current = null; configPending.current = null; executionPending.current = null; recoveryPending.current = null
    setCatalog(null); setHistory(null); setNextCursor(null)
    const discoveryFact = ownerId && assistantId ? readCapabilityDiscoveryRecovery(storage, ownerId, assistantId) : null
    if (discoveryFact) {
      const pending: ConfigPending = {
        operation: `r6-mcp-discovery/${discoveryFact.capabilityId}`,
        key: discoveryFact.idempotencyKey,
        label: '恢复 MCP 工具发现',
        discoveryCapabilityId: discoveryFact.capabilityId,
        run: (confirmationId, key, signal) => api.discoverMcp(discoveryFact.capabilityId, confirmationId, key, { signal }),
      }
      configPending.current = pending
    }
    setConfigBusy(false); setConfigError(''); setConfigNotice(discoveryFact ? '检测到当前助手存在未核对的 MCP 发现；只能按原键查询，不能自动重发。' : ''); setConfigUnknown(Boolean(discoveryFact)); setConfigConfirmation(null); setConfigQuery(discoveryFact ? { capabilityId: discoveryFact.capabilityId, key: discoveryFact.idempotencyKey, label: '恢复 MCP 工具发现' } : null); setConfigDecisionUnknown(null)
    setExecution(null); setExecutionBusy(false); setExecutionError(''); setExecutionMissing(false); setExecutionDecisionUnknown(null); setExecutionStale(false)
    const fact = ownerId && assistantId ? readCapabilityRecovery(storage, ownerId, assistantId) : null
    setExecutionNotice(fact ? '检测到当前助手存在未核对的能力执行，请按原操作键查询。' : '')
    setMcpName(''); setMcpUrl(''); setMcpDescription(''); setMcpTrusted(false)
    setSkillName(''); setSkillVersion('1'); setSkillDescription(''); setSkillSteps([{ stepId: 'step-1', category: 'local_tool', capabilityId: '', operationName: 'execute' }])
    setPluginName(''); setPluginVersion('1'); setPluginDescription(''); setPluginActions([{ actionId: 'run', skillId: '' }])
    setSelectedCapabilityId(''); setOperationName(''); setInputText('{\n  "text": ""\n}')
    return () => { configController.current?.abort(); executionController.current?.abort(); configPending.current = null; executionPending.current = null; recoveryPending.current = null }
  }, [api, scope, assistantId, ownerId, storage])

  if (!session || !assistantId) return <section className={styles.empty} aria-label="统一能力执行"><h2>尚未选择助手</h2><p>R6 能力目录和执行事实必须绑定服务端当前助手。请选择助手后继续。</p></section>

  const localTools = (catalog ?? []).filter((item) => item.category === 'local_tool')
  const mcpTools = (catalog ?? []).filter((item) => item.category === 'mcp_tool')
  const skills = (catalog ?? []).filter((item) => item.category === 'skill')
  const plugins = (catalog ?? []).filter((item) => item.category === 'plugin_action')
  const stepTargets = (catalog ?? []).filter((item) => ['local_tool', 'mcp_tool'].includes(item.category) && item.status === 'enabled' && item.lifecycleStatus !== 'uninstalled')

  return <div className={styles.manager} aria-label="统一能力管理">
    <section className={styles.summary}><div><strong>{assistantName}</strong><span>当前助手</span></div><div><strong>{catalog?.length ?? 0}</strong><span>服务端能力</span></div><div><strong>{history?.length ?? 0}</strong><span>已读执行事实</span></div><button type="button" disabled={catalogTask.busy || historyTask.busy} onClick={() => { void loadCatalog(); void loadHistory() }}>刷新真实状态</button></section>
    {(catalogTask.error || historyTask.error) && <p className={styles.error} role="alert">{catalogTask.error || historyTask.error}</p>}
    {(configError || executionError) && <p className={styles.error} role="alert">{configError || executionError}</p>}
    {configNotice && <p className={styles.notice} role="status">{configNotice}</p>}
    {executionNotice && <p className={styles.notice} role="status">{executionNotice}</p>}
    {configUnknown && <section className={styles.warning}>
      <strong>配置结果未知</strong>
      <p>{configQuery ? 'MCP 发现不会自动重发；只能查询原键的冻结事实，或明确结束核对后再发起新操作。' : configDecisionUnknown ? '安全确认结果未知；只允许重试同一个确认决定。' : '不会创建新操作键。当前页面仍保留原请求，可沿用原键核对同一幂等结果。'}</p>
      <div className={styles.actions}>
        {configQuery ? <><button type="button" disabled={configBusy} onClick={() => void queryConfigDiscovery()}>按原键查询发现事实</button><button type="button" disabled={configBusy} onClick={finishConfigQuery}>结束核对并允许新操作</button></>
          : configDecisionUnknown ? <button type="button" disabled={configBusy} onClick={() => void decideConfig(configDecisionUnknown.approve)}>重试同一个确认决定</button>
            : <button type="button" disabled={configBusy} onClick={() => { const pending = configPending.current; if (pending) void runConfig(pending) }}>沿用原键重试同一配置</button>}
      </div>
    </section>}
    {configConfirmation && <section className={styles.confirmation} role="group" aria-label="R6 配置安全确认"><strong>确认：{configConfirmation.label}</strong><p>批准只恢复同一配置请求；拒绝后不会安装或更改能力。</p><div><button type="button" disabled={configBusy || configUnknown} onClick={() => void decideConfig(true)}>批准本次配置</button><button type="button" disabled={configBusy || configUnknown} onClick={() => void decideConfig(false)}>拒绝配置</button></div></section>}

    <CapabilitySection id="mcp" index="02" eyebrow="MCP 2026-07-28" title="MCP" summary="受信端点、发现快照与严格工具" icon="mcp" tone="blue">
      <form className={styles.form} onSubmit={(event) => {
        event.preventDefault(); if (!mcpName.trim() || !mcpDescription.trim() || !mcpTrusted) { setConfigError('请填写名称和说明，并明确确认这是受信 HTTPS 端点。'); return }
        if (!isAllowedMcpFormUrl(mcpUrl)) { setConfigError('MCP 地址必须是无凭据、查询或片段的 HTTPS URL；仅本机开发页可提交 loopback HTTP 测试地址。'); return }
        const input = { name: mcpName.trim(), serviceUrl: mcpUrl.trim(), description: mcpDescription.trim(), acknowledgeTrustedEndpoint: true as const }
        beginConfig({ operation: 'r6-mcp-install', label: '安装 MCP 服务', run: (id, key, signal) => api.installMcp(input, id, key, { signal }), clear: () => { setMcpName(''); setMcpUrl(''); setMcpDescription(''); setMcpTrusted(false) } })
      }}><h3>添加受信 MCP 服务</h3><label>服务地址名称<input value={mcpName} maxLength={120} onChange={(event) => setMcpName(event.target.value)} /></label><label>MCP 服务地址<input type="url" value={mcpUrl} maxLength={2048} autoComplete="off" onChange={(event) => setMcpUrl(event.target.value)} /></label><small>生产环境仅接受 HTTPS；本机开发页只为受控测试开放 loopback HTTP，后端仍会按注入白名单拒绝其他地址。</small><label>用途说明<input value={mcpDescription} maxLength={4000} onChange={(event) => setMcpDescription(event.target.value)} /></label><label className={styles.check}><input type="checkbox" checked={mcpTrusted} onChange={(event) => setMcpTrusted(event.target.checked)} />我确认这是本人明确信任的无凭据端点</label><button type="submit" disabled={configBusy || configUnknown || Boolean(configConfirmation)}>提交服务端安装</button></form>
      <CapabilityList items={mcpTools}>{(item) => <button type="button" disabled={configBusy || item.lifecycleStatus === 'uninstalled'} onClick={() => beginConfig({ operation: `r6-mcp-discovery/${item.capabilityId}`, label: `发现 ${item.name} 工具`, discoveryCapabilityId: item.capabilityId, run: (id, key, signal) => api.discoverMcp(item.capabilityId, id, key, { signal }) })}>重新发现工具</button>}</CapabilityList>
    </CapabilitySection>

    <CapabilitySection id="skill" index="03" eyebrow="FROZEN ORCHESTRATION" title="Skill" summary="只编排已注册 Tool，不执行脚本" icon="skill" tone="rose">
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!skillName.trim() || !skillVersion.trim() || !skillDescription.trim() || skillSteps.some((step) => !step.capabilityId || !step.operationName)) { setConfigError('请完整填写 Skill 和每个受控步骤。'); return }; const input = { name: skillName.trim(), version: skillVersion.trim(), description: skillDescription.trim(), steps: skillSteps }; beginConfig({ operation: 'r6-skill-install', label: '安装 Skill', run: (id, key, signal) => api.installSkill(input, id, key, { signal }), clear: () => { setSkillName(''); setSkillDescription(''); setSkillSteps([{ stepId: 'step-1', category: 'local_tool', capabilityId: '', operationName: 'execute' }]) } }) }}><h3>安装冻结 Skill</h3><label>名称<input value={skillName} maxLength={120} onChange={(event) => setSkillName(event.target.value)} /></label><label>版本<input value={skillVersion} maxLength={80} onChange={(event) => setSkillVersion(event.target.value)} /></label><label>说明<input value={skillDescription} maxLength={2000} onChange={(event) => setSkillDescription(event.target.value)} /></label>{skillSteps.map((step, index) => <fieldset key={step.stepId}><legend>步骤 {index + 1}</legend><label>能力<select value={step.capabilityId} onChange={(event) => { const target = stepTargets.find((item) => item.capabilityId === event.target.value); setSkillSteps((items) => items.map((value, itemIndex) => itemIndex === index ? { ...value, capabilityId: event.target.value, category: target?.category === 'mcp_tool' ? 'mcp_tool' : 'local_tool', operationName: target?.operations[0] ?? '' } : value)) }}><option value="">请选择</option>{stepTargets.map((target) => <option key={target.capabilityId} value={target.capabilityId}>{target.name}</option>)}</select></label><label>操作<select value={step.operationName} onChange={(event) => setSkillSteps((items) => items.map((value, itemIndex) => itemIndex === index ? { ...value, operationName: event.target.value } : value))}><option value="">请选择</option>{stepTargets.find((target) => target.capabilityId === step.capabilityId)?.operations.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>{skillSteps.length > 1 && <button type="button" onClick={() => setSkillSteps((items) => items.filter((_, itemIndex) => itemIndex !== index).map((value, itemIndex) => ({ ...value, stepId: `step-${itemIndex + 1}` })))}>移除步骤</button>}</fieldset>)}<button type="button" disabled={skillSteps.length >= 8} onClick={() => setSkillSteps((items) => [...items, { stepId: `step-${items.length + 1}`, category: 'local_tool', capabilityId: '', operationName: '' }])}>添加步骤</button><button type="submit" disabled={configBusy || configUnknown || Boolean(configConfirmation)}>提交 Skill</button></form>
      <CapabilityList items={skills} />
    </CapabilitySection>

    <CapabilitySection id="plugin" index="04" eyebrow="LOCAL MANIFESTS" title="插件" summary="本地清单、生命周期与受控 Skill 动作" icon="plugin" tone="aqua">
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!pluginName.trim() || !pluginVersion.trim() || !pluginDescription.trim() || pluginActions.some((action) => !action.actionId || !action.skillId)) { setConfigError('请完整填写插件与每个 Skill 动作映射。'); return }; const input = { name: pluginName.trim(), version: pluginVersion.trim(), description: pluginDescription.trim(), actions: pluginActions }; beginConfig({ operation: 'r6-plugin-install', label: '安装插件清单', run: (id, key, signal) => api.installPlugin(input, id, key, { signal }), clear: () => { setPluginName(''); setPluginDescription(''); setPluginActions([{ actionId: 'run', skillId: '' }]) } }) }}><h3>安装本地插件清单</h3><label>名称<input value={pluginName} maxLength={120} onChange={(event) => setPluginName(event.target.value)} /></label><label>版本<input value={pluginVersion} maxLength={80} onChange={(event) => setPluginVersion(event.target.value)} /></label><label>说明<input value={pluginDescription} maxLength={2000} onChange={(event) => setPluginDescription(event.target.value)} /></label>{pluginActions.map((action, index) => <fieldset key={`${index}-${action.actionId}`}><legend>动作 {index + 1}</legend><label>动作 ID<input value={action.actionId} maxLength={80} onChange={(event) => setPluginActions((items) => items.map((value, itemIndex) => itemIndex === index ? { ...value, actionId: event.target.value } : value))} /></label><label>Skill<select value={action.skillId} onChange={(event) => setPluginActions((items) => items.map((value, itemIndex) => itemIndex === index ? { ...value, skillId: event.target.value } : value))}><option value="">请选择</option>{skills.filter((skill) => skill.status === 'enabled' && skill.lifecycleStatus !== 'uninstalled').map((skill) => <option key={skill.capabilityId} value={skill.capabilityId}>{skill.name}</option>)}</select></label></fieldset>)}<button type="button" disabled={pluginActions.length >= 16} onClick={() => setPluginActions((items) => [...items, { actionId: `action-${items.length + 1}`, skillId: '' }])}>添加动作</button><button type="submit" disabled={configBusy || configUnknown || Boolean(configConfirmation)}>提交插件清单</button></form>
      <CapabilityList items={plugins}>{(item) => <div className={styles.actions}>{item.lifecycleStatus !== 'uninstalled' && (item.status === 'disabled' ? <button type="button" disabled={configBusy} onClick={() => lifecycle(item, 'enable')}>启用</button> : <button type="button" disabled={configBusy} onClick={() => lifecycle(item, 'disable')}>停用</button>)}<button type="button" disabled={configBusy || item.lifecycleStatus === 'uninstalled'} onClick={() => lifecycle(item, 'uninstall')}>卸载</button></div>}</CapabilityList>
    </CapabilitySection>

    <CapabilitySection id="tool" index="05" eyebrow="UNIFIED EXECUTION" title="Tool 与执行" summary="显式输入、恢复、用量与不可变历史" icon="tool" tone="gold">
      <div className={styles.actions}><button type="button" disabled={configBusy || localTools.some((item) => item.lifecycleStatus !== 'uninstalled')} onClick={() => beginConfig({ operation: 'r6-local-tool-install', label: '安装内置文本检查工具', run: (id, key, signal) => api.installLocalTool('builtin.text.inspect/v1', id, key, { signal }) })}>安装 builtin.text.inspect/v1</button></div>
      <CapabilityList items={localTools} />
      <section className={styles.execution} aria-label="显式能力执行"><h3>显式执行</h3><p>不会自动推荐或主动执行。输入只保留在当前页面内存，不写入浏览器存储。</p><label>能力<select aria-label="执行能力" value={selectedCapabilityId} onChange={(event) => { const next = executable.find((item) => item.capabilityId === event.target.value); setSelectedCapabilityId(event.target.value); setOperationName(next?.operations[0] ?? '') }}><option value="">请选择已启用能力</option>{executable.map((item) => <option key={item.capabilityId} value={item.capabilityId}>{categoryLabels[item.category]} · {item.name}</option>)}</select></label><label>操作<select aria-label="执行操作" value={operationName} disabled={!selectedCapability} onChange={(event) => setOperationName(event.target.value)}><option value="">请选择</option>{selectedCapability?.operations.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>严格 JSON 输入<textarea aria-label="能力执行输入" rows={6} value={inputText} onChange={(event) => setInputText(event.target.value)} /></label><div className={styles.actions}><button type="button" disabled={executionBusy || !selectedCapability || !operationName} onClick={submitExecution}>执行一次</button><button type="button" disabled={executionBusy || !readCapabilityRecovery(storage, ownerId, assistantId)} onClick={() => void queryOriginal()}>按原操作键查询</button>{executionBusy && <button type="button" onClick={() => { executionController.current?.abort(); executionController.current = null; setExecutionBusy(false); setExecutionNotice('已停止页面等待；服务端结果未知，请按原操作键查询。') }}>停止等待</button>}</div>{executionMissing && executionPending.current && <button type="button" disabled={executionBusy} onClick={() => void runExecution(executionPending.current!)}>服务端未找到，按原键安全重发</button>}</section>
      {execution && <ExecutionCard execution={execution} busy={executionBusy} actionsBlocked={executionStale} decisionUnknown={Boolean(executionDecisionUnknown)} recoveryUnknown={Boolean(recoveryPending.current)} onRefresh={() => void refreshExecution(execution.executionId)} onApprove={() => void decideExecution(true)} onReject={() => void decideExecution(false)} onRetryDecision={() => { if (executionDecisionUnknown) void decideExecution(executionDecisionUnknown.approve) }} onRetryRecovery={() => { const pending = recoveryPending.current; if (pending) void recoverExecution(pending.action, pending.confirmationId) }} onRetry={() => void recoverExecution('retry')} onCancel={() => void recoverExecution('cancel')} />}
      <form className={styles.historyFilters} onSubmit={(event) => { event.preventDefault(); void loadHistory() }}><h3>统一执行历史</h3><label>类型<select value={historyCategory} onChange={(event) => setHistoryCategory(event.target.value as CapabilityCategory | '')}><option value="">全部</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>状态<select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value as CapabilityExecutionStatus | '')}><option value="">全部</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="submit" disabled={historyTask.busy}>查询历史</button></form>
      <div className={styles.history}>{history?.length === 0 && <p>当前助手尚无统一执行事实。</p>}{history?.map((item) => <button type="button" key={item.executionId} onClick={() => setExecution(item)}><strong>{categoryLabels[item.category]} · {item.operationName}</strong><span>{statusLabels[item.status]} · 尝试 {item.attemptCount} 次</span><small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small></button>)}</div>{nextCursor && <button type="button" disabled={historyTask.busy} onClick={() => void loadHistory(nextCursor, true)}>加载更多执行历史</button>}
    </CapabilitySection>
  </div>

  function lifecycle(item: CapabilityItem, action: 'enable' | 'disable' | 'uninstall') {
    const operation = `r6-plugin-${action}/${item.capabilityId}`
    beginConfig({ operation, label: `${action === 'enable' ? '启用' : action === 'disable' ? '停用' : '卸载'}插件 ${item.name}`, run: (id, key, signal) => api.pluginLifecycle(item.capabilityId, action, id, key, { signal }) })
  }

  async function refreshExecution(executionId: string) {
    if (executionController.current) return
    const controller = new AbortController(); executionController.current = controller; setExecutionBusy(true); setExecutionError('')
    try { const value = await personal.guarded((signal) => api.execution(executionId, { signal }), controller.signal); if (!controller.signal.aborted) acceptExecution(value) }
    catch (failure) { if (!controller.signal.aborted) setExecutionError(personalError(failure)) }
    finally { if (executionController.current === controller) { executionController.current = null; setExecutionBusy(false) } }
  }
}

function CapabilityList({ items, children }: { items: CapabilityItem[]; children?: (item: CapabilityItem) => ReactNode }) {
  return <div className={styles.list}>{items.length === 0 && <p>当前助手尚无此类已安装能力。</p>}{items.map((item) => <article key={item.capabilityId}><div><strong>{item.name}</strong><span>{item.status} · {item.lifecycleStatus} · v{item.version}</span><small>{item.operations.length ? `操作：${item.operations.join('、')}` : '尚无可执行操作'}</small></div>{children?.(item)}</article>)}</div>
}

function ExecutionCard({ execution, busy, actionsBlocked, decisionUnknown, recoveryUnknown, onRefresh, onApprove, onReject, onRetryDecision, onRetryRecovery, onRetry, onCancel }: { execution: CapabilityExecution; busy: boolean; actionsBlocked: boolean; decisionUnknown: boolean; recoveryUnknown: boolean; onRefresh: () => void; onApprove: () => void; onReject: () => void; onRetryDecision: () => void; onRetryRecovery: () => void; onRetry: () => void; onCancel: () => void }) {
  return <article className={styles.result} aria-label="当前能力执行结果"><header><div><strong>{categoryLabels[execution.category]} · {execution.operationName}</strong><span>{statusLabels[execution.status]}</span></div><button type="button" disabled={busy} onClick={onRefresh}>重新读取</button></header><dl><div><dt>尝试次数</dt><dd>{execution.attemptCount}</dd></div><div><dt>外部调用</dt><dd>{execution.externalCall}</dd></div><div><dt>输入哈希</dt><dd>{execution.inputHash}</dd></div>{execution.result && <><div><dt>Token</dt><dd>{execution.result.usage.status} · {execution.result.usage.totalTokens}</dd></div><div><dt>费用</dt><dd>{execution.result.cost.status}{execution.result.cost.amountMicros === null ? '' : ` · ${execution.result.cost.amountMicros} μ${execution.result.cost.currency ?? ''}`}</dd></div></>}</dl>{execution.result && <pre>{safeJson(execution.result.output)}</pre>}{execution.error && <p role="alert">服务端终止代码：{execution.error.code}</p>}<div className={styles.actions}>{actionsBlocked ? <span>当前卡片状态待重新读取。</span> : decisionUnknown ? <button type="button" disabled={busy} onClick={onRetryDecision}>重试同一个执行确认决定</button> : recoveryUnknown ? <button type="button" disabled={busy} onClick={onRetryRecovery}>重试同一个恢复操作</button> : <>{execution.status === 'waiting_confirmation' && <><button type="button" disabled={busy} onClick={onApprove}>批准并恢复同一执行</button><button type="button" disabled={busy} onClick={onReject}>拒绝并取消</button></>}{execution.status === 'retryable' && <button type="button" disabled={busy} onClick={onRetry}>安全重试</button>}{['prepared', 'waiting_confirmation'].includes(execution.status) && <button type="button" disabled={busy} onClick={onCancel}>取消未越界执行</button>}</>}</div></article>
}
