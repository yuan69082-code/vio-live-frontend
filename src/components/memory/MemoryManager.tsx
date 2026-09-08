import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError } from '../../api/client'
import {
  MEMORY_EXPORT_VERSION,
  MEMORY_IMPORT_VERSION,
  createPersonalMemoryApi,
  type Memory,
  type MemoryDeletion,
  type MemoryEditableInput,
  type MemoryExportResult,
  type MemoryImportItemInput,
  type MemoryImportResult,
  type MemoryKind,
  type MemoryList,
  type MemoryListFilters,
  type MemoryOperationType,
  type MemoryReadChallenge,
  type MemoryReference,
  type MemoryVersion,
  type MemoryWriteResult,
} from '../../api/personal-memory-api'
import {
  clearMemoryRecovery,
  createMemoryOperationKey,
  readMemoryRecovery,
  writeMemoryRecovery,
  type MemoryRecoveryFact,
} from '../../api/personal-memory-recovery'
import type { PersonalAssistant } from '../../api/personal-api'
import { usePersonal } from '../../state/PersonalContext'
import { personalError } from '../personal/useScopedAction'
import styles from './MemoryManager.module.css'

const kindLabels: Record<MemoryKind, string> = {
  preference: '偏好', profile_fact: '个人事实', relationship: '关系', decision: '决定', project: '项目', routine: '习惯', other: '其他',
}
const statusLabels = { active: '使用中', archived: '已归档', deletion_pending: '等待最终删除' } as const
const operationLabels: Record<MemoryOperationType, string> = {
  'memory.create': '创建记忆', 'memory.edit': '保存新版本', 'memory.context_inclusion': '更改上下文使用', 'memory.archive': '归档记忆',
  'memory.restore': '恢复记忆', 'memory.reference.create': '添加来源引用', 'memory.reference.delete': '移除来源引用',
  'memory.deletion.request': '申请删除记忆', 'memory.deletion.cancel': '撤销删除申请', 'memory.deletion.finalize': '最终删除记忆',
  'memory.import': '导入记忆', 'memory.export': '导出记忆',
}

type EditableDraft = { kind: MemoryKind; body: string; summary: string; occurredAt: string; includeInContext: boolean; sensitivity: 'normal' | 'sensitive' }
type WriteResult = MemoryWriteResult | MemoryImportResult | MemoryExportResult
type PendingWrite = {
  key: string
  fact: MemoryRecoveryFact
  label: string
  run: (confirmationId: string | null, signal: AbortSignal) => Promise<WriteResult>
  accept: (result: WriteResult) => void
}
type ConfirmationPrompt = {
  id: string
  label: string
  kind: 'read' | 'write'
  resume: (confirmationId: string) => Promise<void>
}

const emptyDraft: EditableDraft = { kind: 'other', body: '', summary: '', occurredAt: '', includeInContext: true, sensitivity: 'normal' }

function isChallenge(value: unknown): value is MemoryReadChallenge {
  return Boolean(value && typeof value === 'object' && 'operationStatus' in value && value.operationStatus === 'confirmation_required')
}

function sessionStorageOrNull() {
  try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
}

function toInputTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function editable(memory: Memory): EditableDraft {
  return { kind: memory.kind, body: memory.body, summary: memory.summary ?? '', occurredAt: toInputTime(memory.occurredAt), includeInContext: memory.includeInContext, sensitivity: memory.sensitivity }
}

function draftError(value: EditableDraft) {
  if (!value.body.trim()) return '记忆正文不能为空。'
  if (Array.from(value.body).length > 8192 || new TextEncoder().encode(value.body).length > 32768) return '记忆正文超过 8192 字符或 32768 字节。'
  if (value.summary && (Array.from(value.summary).length > 512 || !value.summary.trim())) return '摘要需为 1–512 个字符，或留空。'
  if (value.occurredAt && !Number.isFinite(Date.parse(value.occurredAt))) return '发生时间无效。'
  return ''
}

function bodyInput(value: EditableDraft, confirmationId: string | null): MemoryEditableInput {
  return {
    kind: value.kind, body: value.body, summary: value.summary ? value.summary : null,
    occurredAt: value.occurredAt ? new Date(value.occurredAt).toISOString() : null,
    includeInContext: value.includeInContext, sensitivity: value.sensitivity,
    source: { sourceType: 'manual', sourceRef: null }, confirmationId, securitySessionId: null,
  }
}

function knownTerminalError(error: unknown) {
  return error instanceof ApiClientError && error.status !== null && error.status < 500 && !['request_timeout', 'network_error', 'invalid_response'].includes(error.code)
}

function bodyMustClose(error: unknown) {
  return error instanceof ApiClientError && ['MEMORY_SOURCE_NOT_FOUND', 'MEMORY_BODY_UNAVAILABLE', 'MEMORY_NOT_FOUND', 'MEMORY_PERMISSION_DENIED'].includes(error.code)
}

function createDownloadArtifact(result: MemoryExportResult) {
  if (!result.export) return null
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  return { url, filename: `vio-memory-${result.export.exportId}.json` }
}

function validateImport(text: string, mode: 'atomic' | 'best_effort'): MemoryImportItemInput[] {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('请选择或粘贴有效 JSON。') }
  const source = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'items' in raw ? (raw as { items: unknown }).items : null
  if (!Array.isArray(source) || source.length < 1 || source.length > 100) throw new Error('导入需要 1–100 条 items。')
  const ids = new Set<string>()
  return source.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('导入条目必须是对象。')
    const item = value as Record<string, unknown>
    const allowed = ['clientItemId', 'kind', 'body', 'summary', 'occurredAt', 'includeInContext', 'sensitivity']
    if (Object.keys(item).length !== allowed.length || Object.keys(item).some((key) => !allowed.includes(key))) throw new Error('导入条目字段不符合 R5 严格格式。')
    const clientItemId = typeof item.clientItemId === 'string' ? item.clientItemId : ''
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(clientItemId) || ids.has(clientItemId)) throw new Error('clientItemId 需为 8–128 位安全字符且不可重复。')
    ids.add(clientItemId)
    if (mode === 'best_effort') return {
      clientItemId, kind: item.kind, body: item.body, summary: item.summary, occurredAt: item.occurredAt,
      includeInContext: item.includeInContext, sensitivity: item.sensitivity,
    }
    const draft: EditableDraft = {
      kind: item.kind as MemoryKind, body: typeof item.body === 'string' ? item.body : '', summary: typeof item.summary === 'string' ? item.summary : '',
      occurredAt: typeof item.occurredAt === 'string' ? item.occurredAt : '', includeInContext: item.includeInContext === true,
      sensitivity: item.sensitivity as 'normal' | 'sensitive',
    }
    if (!Object.hasOwn(kindLabels, draft.kind) || !['normal', 'sensitive'].includes(draft.sensitivity)
      || typeof item.includeInContext !== 'boolean' || (item.summary !== null && typeof item.summary !== 'string')
      || (item.occurredAt !== null && (typeof item.occurredAt !== 'string' || !/Z$/.test(item.occurredAt)))) throw new Error('导入条目类型不符合 R5 格式。')
    const error = draftError(draft)
    if (error) throw new Error(error)
    return { clientItemId, kind: draft.kind, body: draft.body, summary: item.summary as string | null, occurredAt: item.occurredAt ? new Date(String(item.occurredAt)).toISOString() : null, includeInContext: draft.includeInContext, sensitivity: draft.sensitivity }
  })
}

function MemoryForm({ title, value, busy, onChange, onCancel, onSubmit }: {
  title: string; value: EditableDraft; busy: boolean; onChange: (value: EditableDraft) => void; onCancel: () => void; onSubmit: () => void
}) {
  return <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
    <header><div><small>只保存到当前助手</small><h2>{title}</h2></div><button type="button" onClick={onCancel} disabled={busy}>关闭</button></header>
    <label>类型<select value={value.kind} onChange={(event) => onChange({ ...value, kind: event.target.value as MemoryKind })}>{Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
    <label>记忆正文<textarea aria-label="记忆正文" rows={6} value={value.body} onChange={(event) => onChange({ ...value, body: event.target.value })} /></label>
    <label>用户可见摘要（可选）<input aria-label="记忆摘要" value={value.summary} onChange={(event) => onChange({ ...value, summary: event.target.value })} /></label>
    <label>发生时间（可选）<input aria-label="记忆发生时间" type="datetime-local" value={value.occurredAt} onChange={(event) => onChange({ ...value, occurredAt: event.target.value })} /></label>
    <div className={styles.inlineFields}><label><input type="checkbox" checked={value.includeInContext} onChange={(event) => onChange({ ...value, includeInContext: event.target.checked })} />允许进入新上下文</label><label>敏感级别<select value={value.sensitivity} onChange={(event) => onChange({ ...value, sensitivity: event.target.value as EditableDraft['sensitivity'] })}><option value="normal">普通</option><option value="sensitive">敏感</option></select></label></div>
    <p>编辑会创建不可变新版本，不覆盖旧版本；只有服务端成功后页面才会显示已保存。</p>
    <button className={styles.primary} type="button" disabled={busy} onClick={onSubmit}>{busy ? '正在提交…' : '提交到服务端'}</button>
  </section>
}

export default function MemoryManager({ assistant }: { assistant: PersonalAssistant | null }) {
  const personal = usePersonal()
  const api = useMemo(() => createPersonalMemoryApi(personal.api), [personal.api])
  const session = personal.state.kind === 'ready' ? personal.state.session : null
  const ownerId = session?.user.userId ?? ''
  const assistantId = assistant?.assistantId ?? ''
  const storage = sessionStorageOrNull()
  const scope = `${personal.scope}:${ownerId}:${assistantId}`
  const mounted = useRef(true)
  const readController = useRef<AbortController | null>(null)
  const writeController = useRef<AbortController | null>(null)
  const pendingWrite = useRef<PendingWrite | null>(null)
  const [filters, setFilters] = useState<MemoryListFilters>({ query: '', kind: '', status: '', includeInContext: '', limit: 25 })
  const [list, setList] = useState<MemoryList | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [unknown, setUnknown] = useState<MemoryRecoveryFact | null>(() => ownerId && assistantId ? readMemoryRecovery(storage, ownerId, assistantId) : null)
  const [confirmation, setConfirmation] = useState<ConfirmationPrompt | null>(null)
  const [selected, setSelected] = useState<Memory | null>(null)
  const [versions, setVersions] = useState<MemoryVersion[] | null>(null)
  const [references, setReferences] = useState<MemoryReference[] | null>(null)
  const [deletion, setDeletion] = useState<MemoryDeletion | null>(null)
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [draft, setDraft] = useState<EditableDraft>(emptyDraft)
  const [referenceType, setReferenceType] = useState<'message_version' | 'event'>('message_version')
  const [referenceFields, setReferenceFields] = useState({ conversationId: '', messageId: '', messageVersionId: '', eventId: '' })
  const [importText, setImportText] = useState('')
  const [importMode, setImportMode] = useState<'atomic' | 'best_effort'>('atomic')
  const [importReport, setImportReport] = useState<MemoryImportResult['import']>(null)
  const [selectedForExport, setSelectedForExport] = useState<string[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null)
  const downloadRef = useRef<{ url: string; filename: string } | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false; readController.current?.abort(); writeController.current?.abort(); pendingWrite.current = null
      if (downloadRef.current) { URL.revokeObjectURL(downloadRef.current.url); downloadRef.current = null }
    }
  }, [scope])

  const fail = useCallback((value: unknown) => { if (mounted.current) setError(personalError(value)) }, [])

  const read = useCallback(async <T extends MemoryList | Memory | { items: MemoryVersion[] } | { items: MemoryReference[] }>(
    label: string,
    work: (signal: AbortSignal, confirmationId: string | null) => Promise<T | MemoryReadChallenge>,
    accept: (value: T) => void,
    confirmationId: string | null = null,
    onFailure?: (error: unknown) => void,
  ) => {
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    setLoading(true); setError(''); setNotice('')
    try {
      const value = await personal.guarded((signal) => work(signal, confirmationId), controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      if (isChallenge(value)) {
        setConfirmation({ id: value.confirmation.confirmationId, label, kind: 'read', resume: async (id) => read(label, work, accept, id) })
        setNotice('服务端要求确认后才能读取敏感记忆；本页尚未收到正文。')
        return
      }
      setConfirmation(null)
      accept(value as T)
    } catch (failure) { if (!controller.signal.aborted) { onFailure?.(failure); fail(failure) } }
    finally { if (readController.current === controller) { readController.current = null; if (mounted.current) setLoading(false) } }
  }, [personal, fail])

  const loadList = useCallback(async (cursor?: string, append = false, confirmationId: string | null = null, selectMemoryId: string | null = null, fallbackSelected: Memory | null = null) => {
    const requestFilters = { ...filters, cursor }
    if (!append) { setList(null); setSelected(fallbackSelected); setVersions(null); setReferences(null) }
    await read('读取敏感记忆列表', (signal, approved) => api.list(requestFilters, { signal, confirmationId: approved ?? undefined }), (value) => {
      const next = value as MemoryList
      setList((previous) => append && previous ? { ...next, items: [...previous.items, ...next.items] } : next)
      if (!append && selectMemoryId) setSelected(next.items.find((item) => item.memoryId === selectMemoryId) ?? fallbackSelected)
    }, confirmationId)
  }, [api, filters, read])

  useEffect(() => {
    if (!assistantId) { setList(null); return }
    const controller = new AbortController()
    queueMicrotask(() => { if (!controller.signal.aborted) void loadList() })
    return () => controller.abort()
  // The first read is scoped to this mounted assistant. Filter edits are submitted explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId])

  const loadDetail = useCallback(async (memoryId: string, confirmationId: string | null = null) => {
    setSelected(null); setVersions(null); setReferences(null); setDeletion(null)
    await read('读取敏感记忆详情', (signal, approved) => api.detail(memoryId, { signal, confirmationId: approved ?? undefined }), (value) => { setSelected(value as Memory); setVersions(null); setReferences(null); setDeletion(null) }, confirmationId)
  }, [api, read])

  const loadVersions = useCallback(async (confirmationId: string | null = null) => {
    if (!selected) return
    setVersions(null)
    await read('读取敏感记忆版本', (signal, approved) => api.versions(selected.memoryId, { signal, confirmationId: approved ?? undefined }), (value) => setVersions((value as { items: MemoryVersion[] }).items), confirmationId, (failure) => { if (bodyMustClose(failure)) setSelected(null) })
  }, [api, read, selected])

  const loadReferences = useCallback(async (confirmationId: string | null = null) => {
    if (!selected) return
    setReferences(null)
    await read('读取敏感记忆来源', (signal, approved) => api.references(selected.memoryId, { signal, confirmationId: approved ?? undefined }), (value) => setReferences((value as { items: MemoryReference[] }).items), confirmationId, (failure) => { if (bodyMustClose(failure)) setSelected(null) })
  }, [api, read, selected])

  const refreshAfterWrite = useCallback((result: WriteResult) => {
    let localError = ''
    const refreshedMemoryId =
      (result.operation.operationType === 'memory.deletion.request' || result.operation.operationType === 'memory.deletion.cancel') && 'memory' in result
        ? result.memory?.memoryId ?? null
        : null
    if ('memory' in result && result.memory) { setSelected(result.memory); setDeletion(result.deletion); setVersions(null); setReferences(null) }
    if ('import' in result) setImportReport(result.import)
    if ('export' in result) {
      if (downloadRef.current) { URL.revokeObjectURL(downloadRef.current.url); downloadRef.current = null; setDownload(null) }
      try {
        const artifact = createDownloadArtifact(result)
        downloadRef.current = artifact
        setDownload(artifact)
      } catch { localError = '服务端已完成导出，但浏览器未能生成下载；不会自动重新执行导出。' }
    }
    if ('deletion' in result && result.operation.operationType === 'memory.deletion.finalize') { setSelected(null); setDeletion(result.deletion); setVersions(null); setReferences(null) }
    const completionNotice = 'export' in result && !localError
      ? '服务端导出已完成，请点击“下载导出文件”保存到设备。'
      : `${operationLabels[result.operation.operationType]}已由服务端确认完成。`
    setFormMode(null); setDraft(emptyDraft); setImportText(''); setReferenceFields({ conversationId: '', messageId: '', messageVersionId: '', eventId: '' })
    const fallbackSelected = refreshedMemoryId && 'memory' in result ? result.memory : null
    void loadList(undefined, false, null, refreshedMemoryId, fallbackSelected).finally(() => { if (mounted.current) { setNotice(completionNotice); if (localError) setError(localError) } })
  }, [loadList])

  const receiveWrite = useCallback((pending: PendingWrite, result: WriteResult) => {
    if (result.operationStatus === 'confirmation_required' && result.confirmation) {
      setConfirmation({ id: result.confirmation.confirmationId, label: pending.label, kind: 'write', resume: async (id) => executeWrite(pending, id) })
      setFormMode(null); setDraft(emptyDraft); setImportText('')
      setNotice('操作尚未执行；服务端要求本次高风险确认。')
      return
    }
    if (result.operationStatus !== 'completed') {
      clearMemoryRecovery(storage, ownerId, assistantId, pending.key)
      setUnknown(null); pendingWrite.current = null
      setError(`服务端记录操作失败：${result.operation.errorCode ?? '未知错误'}。`)
      return
    }
    clearMemoryRecovery(storage, ownerId, assistantId, pending.key)
    setUnknown(null); pendingWrite.current = null; setConfirmation(null)
    pending.accept(result)
  // executeWrite is a stable declaration below; the closure is evaluated only after render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId, ownerId, storage])

  async function executeWrite(pending: PendingWrite, confirmationId: string | null = null) {
    if (writeController.current) return
    const controller = new AbortController()
    writeController.current = controller
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await personal.guarded((signal) => pending.run(confirmationId, signal), controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      receiveWrite(pending, result)
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted) return
      if (knownTerminalError(failure)) {
        clearMemoryRecovery(storage, ownerId, assistantId, pending.key); setUnknown(null); pendingWrite.current = null
      } else { setUnknown(pending.fact); setFormMode(null); setDraft(emptyDraft); setImportText('') }
      fail(failure)
    } finally {
      if (writeController.current === controller) { writeController.current = null; if (mounted.current) setBusy(false) }
    }
  }

  const beginWrite = useCallback((operationType: MemoryOperationType, ids: Omit<MemoryRecoveryFact, 'version' | 'idempotencyKey' | 'operationType'>,
    run: PendingWrite['run'], accept: PendingWrite['accept'] = refreshAfterWrite) => {
    if (writeController.current || confirmation || unknown) return
    const key = createMemoryOperationKey()
    const fact = { version: 1 as const, idempotencyKey: key, operationType, ...ids }
    const pending = { key, fact, label: operationLabels[operationType], run, accept }
    pendingWrite.current = pending
    writeMemoryRecovery(storage, ownerId, assistantId, fact)
    setUnknown(fact)
    void executeWrite(pending)
  }, [assistantId, confirmation, ownerId, refreshAfterWrite, storage, unknown])

  const recover = useCallback(async () => {
    const fact = unknown ?? readMemoryRecovery(storage, ownerId, assistantId)
    if (!fact || writeController.current) return
    const controller = new AbortController(); writeController.current = controller; setBusy(true); setError(''); setNotice('')
    try {
      const result = await personal.guarded((signal) => api.recover(fact.idempotencyKey, { signal }), controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      if (result.operationStatus === 'confirmation_required' && result.confirmation) {
        const inMemory = pendingWrite.current
        setConfirmation({ id: result.confirmation.confirmationId, label: operationLabels[fact.operationType], kind: 'write', resume: async (id) => {
          if (!inMemory) { setError('原请求正文未保存在浏览器中，刷新后不能自动重放；请拒绝该确认并重新发起。'); return }
          await executeWrite(inMemory, id)
        } })
        setNotice('原操作仍在等待安全确认，未被重新执行。')
      } else if (result.operationStatus === 'completed') {
        clearMemoryRecovery(storage, ownerId, assistantId, fact.idempotencyKey); setUnknown(null); pendingWrite.current = null
        refreshAfterWrite(result)
      } else {
        clearMemoryRecovery(storage, ownerId, assistantId, fact.idempotencyKey); setUnknown(null); pendingWrite.current = null
        setError(`原操作已失败：${result.operation.errorCode ?? '服务端未提供原因'}。`)
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (knownTerminalError(failure)) { clearMemoryRecovery(storage, ownerId, assistantId, fact.idempotencyKey); setUnknown(null); pendingWrite.current = null }
        fail(failure)
      }
    }
    finally { if (writeController.current === controller) { writeController.current = null; if (mounted.current) setBusy(false) } }
  }, [api, assistantId, fail, ownerId, personal, refreshAfterWrite, storage, unknown])

  const decide = useCallback(async (approve: boolean) => {
    if (!confirmation || writeController.current) return
    const prompt = confirmation
    const controller = new AbortController(); writeController.current = controller; setBusy(true); setError(''); setNotice('')
    try {
      await personal.guarded((signal) => api.decide(prompt.id, approve ? 'approve' : 'reject', { signal }), controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setConfirmation(null)
      if (approve) {
        if (writeController.current === controller) writeController.current = null
        setBusy(false)
        await prompt.resume(prompt.id)
      } else {
        if (prompt.kind === 'read') {
          setNotice('已拒绝读取敏感记忆，未返回正文。')
        } else {
          const rejected = pendingWrite.current?.fact ?? unknown
          if (rejected) clearMemoryRecovery(storage, ownerId, assistantId, rejected.idempotencyKey)
          pendingWrite.current = null
          setUnknown(null)
          setNotice('已拒绝本次写入确认；该操作已结束，可重新发起新的用户操作。')
        }
      }
    } catch (failure) { if (!controller.signal.aborted) fail(failure) }
    finally { if (writeController.current === controller) { writeController.current = null; if (mounted.current) setBusy(false) } }
  }, [api, assistantId, confirmation, fail, ownerId, personal, storage, unknown])

  const submitDraft = useCallback(() => {
    const validation = draftError(draft)
    if (validation) { setError(validation); return }
    if (formMode === 'edit' && selected) {
      beginWrite('memory.edit', { memoryId: selected.memoryId }, (confirmationId, signal) => api.edit(selected.memoryId, { ...bodyInput(draft, confirmationId), expectedVersion: selected.version }, pendingWrite.current!.key, { signal }))
    } else {
      beginWrite('memory.create', {}, (confirmationId, signal) => api.create(bodyInput(draft, confirmationId), pendingWrite.current!.key, { signal }))
    }
  }, [api, beginWrite, draft, formMode, selected])

  const simpleMemoryWrite = useCallback((operationType: 'memory.context_inclusion' | 'memory.archive' | 'memory.restore' | 'memory.deletion.request') => {
    if (!selected) return
    const memoryId = selected.memoryId
    beginWrite(operationType, { memoryId }, (confirmationId, signal) => {
      const key = pendingWrite.current!.key
      const base = { expectedVersion: selected.version, confirmationId, securitySessionId: null }
      if (operationType === 'memory.context_inclusion') return api.inclusion(memoryId, { ...base, includeInContext: !selected.includeInContext }, key, { signal })
      if (operationType === 'memory.archive') return api.archive(memoryId, base, key, { signal })
      if (operationType === 'memory.restore') return api.restore(memoryId, base, key, { signal })
      return api.requestDeletion(memoryId, base, key, { signal })
    })
  }, [api, beginWrite, selected])

  const submitReference = useCallback(() => {
    if (!selected) return
    const fields = referenceFields
    if (referenceType === 'message_version' && (!fields.conversationId || !fields.messageId || !fields.messageVersionId)) { setError('消息版本来源需要会话、消息和消息版本 ID。'); return }
    if (referenceType === 'event' && !fields.eventId) { setError('事件来源需要事件 ID。'); return }
    beginWrite('memory.reference.create', { memoryId: selected.memoryId }, (confirmationId, signal) => api.createReference(selected.memoryId, referenceType === 'event'
      ? { sourceType: 'event', conversationId: null, messageId: null, messageVersionId: null, eventId: fields.eventId, expectedVersion: selected.version, confirmationId, securitySessionId: null }
      : { sourceType: 'message_version', conversationId: fields.conversationId, messageId: fields.messageId, messageVersionId: fields.messageVersionId, eventId: null, expectedVersion: selected.version, confirmationId, securitySessionId: null }, pendingWrite.current!.key, { signal }))
  }, [api, beginWrite, referenceFields, referenceType, selected])

  const submitImport = useCallback(() => {
    let items: MemoryImportItemInput[]
    try { items = validateImport(importText, importMode) } catch (failure) { setError(failure instanceof Error ? failure.message : '导入内容无效。'); return }
    beginWrite('memory.import', {}, (confirmationId, signal) => api.importMemories({ contractVersion: MEMORY_IMPORT_VERSION, mode: importMode, items, confirmationId, securitySessionId: null }, pendingWrite.current!.key, { signal }))
  }, [api, beginWrite, importMode, importText])

  const submitExport = useCallback(() => beginWrite('memory.export', {}, (confirmationId, signal) => api.exportMemories({ contractVersion: MEMORY_EXPORT_VERSION, memoryIds: selectedForExport, includeArchived, confirmationId, securitySessionId: null }, pendingWrite.current!.key, { signal })), [api, beginWrite, includeArchived, selectedForExport])

  if (!assistant || !session) return <section className={styles.empty} aria-label="长期记忆"><h2>本地长期记忆</h2><p>尚未选择助手。请选择助手后再管理其独立记忆。</p></section>

  return <section className={styles.manager} aria-label="本地长期记忆管理">
    <header className={styles.hero}><div><small>R5 · Vio 自有本地长期记忆</small><h1>{assistant.name} 的记忆中心</h1><p>仅显示当前已验证用户与当前助手的真实服务端数据；不调用模型或外部运行时。</p></div><button className={styles.primary} type="button" disabled={busy || Boolean(unknown)} onClick={() => { setDraft(emptyDraft); setFormMode('create'); setError('') }}>新建记忆</button></header>

    <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); void loadList() }}>
      <label>关键词<input aria-label="搜索记忆" value={String(filters.query ?? '')} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>
      <label>类型<select aria-label="记忆类型筛选" value={String(filters.kind ?? '')} onChange={(event) => setFilters({ ...filters, kind: event.target.value as MemoryListFilters['kind'] })}><option value="">全部类型</option>{Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <label>状态<select aria-label="记忆状态筛选" value={String(filters.status ?? '')} onChange={(event) => setFilters({ ...filters, status: event.target.value as MemoryListFilters['status'] })}><option value="">使用中与已归档</option><option value="active">使用中</option><option value="archived">已归档</option><option value="deletion_pending">等待删除</option></select></label>
      <label>上下文<select aria-label="上下文筛选" value={String(filters.includeInContext ?? '')} onChange={(event) => setFilters({ ...filters, includeInContext: event.target.value === '' ? '' : event.target.value === 'true' })}><option value="">全部</option><option value="true">允许</option><option value="false">不允许</option></select></label>
      <button type="submit" disabled={loading || busy}>搜索 / 刷新</button>
    </form>

    <div className={styles.status} aria-live="polite">
      {loading && <p>正在从服务端读取当前助手记忆…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {unknown && <div className={styles.unknown}><p>上次“{operationLabels[unknown.operationType]}”结果尚未确认。不会创建新键或盲目重发。</p><button type="button" disabled={busy} onClick={() => void recover()}>按原操作键查询</button></div>}
      {busy && <button type="button" onClick={() => { writeController.current?.abort(); writeController.current = null; setBusy(false); setFormMode(null); setDraft(emptyDraft); setImportText(''); setUnknown(pendingWrite.current?.fact ?? unknown); setNotice('已停止等待；服务端结果未知，请按原操作键查询。') }}>停止等待</button>}
    </div>

    {confirmation && <section className={styles.confirmation} role="group" aria-label="记忆安全确认"><h2>确认：{confirmation.label}</h2><p>服务端要求本次安全确认。批准只恢复同一读取或同一幂等写入；拒绝不会创建替代请求。</p><div><button className={styles.danger} type="button" disabled={busy} onClick={() => void decide(true)}>批准本次操作</button><button type="button" disabled={busy} onClick={() => void decide(false)}>拒绝</button></div></section>}

    <div className={styles.layout}>
      <section className={styles.list} aria-label="记忆列表">
        <header><h2>服务端记忆</h2><span>{list?.items.length ?? 0} 条</span></header>
        {!loading && list?.items.length === 0 && <div className={styles.empty}><p>当前筛选下没有记忆。</p><button type="button" onClick={() => { setDraft(emptyDraft); setFormMode('create') }}>创建第一条</button></div>}
        {list?.items.map((memory) => <article key={memory.memoryId} className={selected?.memoryId === memory.memoryId ? styles.selected : ''}>
          <label className={styles.pick}><input aria-label={`选择导出 ${memory.summary ?? memory.body}`} type="checkbox" checked={selectedForExport.includes(memory.memoryId)} onChange={(event) => setSelectedForExport(event.target.checked ? [...selectedForExport, memory.memoryId] : selectedForExport.filter((id) => id !== memory.memoryId))} /></label>
          <button type="button" onClick={() => void loadDetail(memory.memoryId)}><span><strong>{memory.summary ?? memory.body}</strong><small>{kindLabels[memory.kind]} · {statusLabels[memory.status]} · v{memory.version}</small></span><span>{memory.sensitivity === 'sensitive' ? '敏感' : memory.includeInContext ? '上下文开启' : '上下文关闭'}</span></button>
        </article>)}
        {list?.nextCursor && <button type="button" disabled={loading} onClick={() => void loadList(list.nextCursor ?? undefined, true)}>加载下一页</button>}
      </section>

      <section className={styles.detail} aria-label="记忆详情">
        {!selected ? <><div className={styles.empty}><h2>选择一条记忆</h2><p>正文、版本和来源只会在明确读取后显示。</p></div>{deletion?.status === 'completed' && <section className={styles.deletion} role="status"><h3>最近删除凭据</h3><p>服务端状态：completed · 结果：{deletion.result} · {deletion.bodyRetained ? '正文仍保留' : '记忆正文已由服务端移除'}</p><small>删除记录：{deletion.deletionId} · 完成时间：{deletion.finalizedAt ?? '未提供'}</small></section>}</> : <>
          <header><div><small>{kindLabels[selected.kind]} · {statusLabels[selected.status]}</small><h2>{selected.summary ?? '未填写摘要'}</h2></div><span>v{selected.version}</span></header>
          <p className={styles.body}>{selected.body}</p>
          <dl className={styles.facts}><div><dt>当前助手</dt><dd>{assistant.name}</dd></div><div><dt>上下文</dt><dd>{selected.includeInContext ? '允许新快照选择' : '不允许选择'}</dd></div><div><dt>敏感级别</dt><dd>{selected.sensitivity === 'sensitive' ? '敏感（读取需确认）' : '普通'}</dd></div><div><dt>记录时间</dt><dd>{new Date(selected.recordedAt).toLocaleString('zh-CN')}</dd></div><div><dt>来源</dt><dd>{selected.source.sourceType} · {selected.source.sourceRef}</dd></div></dl>
          <div className={styles.actions}>
            {selected.status !== 'deletion_pending' && <><button type="button" disabled={busy || Boolean(unknown)} onClick={() => { setDraft(editable(selected)); setFormMode('edit') }}>编辑并新增版本</button><button type="button" disabled={busy || Boolean(unknown)} onClick={() => simpleMemoryWrite('memory.context_inclusion')}>{selected.includeInContext ? '停止用于上下文' : '允许用于上下文'}</button>{selected.status === 'active' ? <button type="button" disabled={busy || Boolean(unknown)} onClick={() => simpleMemoryWrite('memory.archive')}>归档</button> : <button type="button" disabled={busy || Boolean(unknown)} onClick={() => simpleMemoryWrite('memory.restore')}>恢复</button>}<button className={styles.danger} type="button" disabled={busy || Boolean(unknown)} onClick={() => simpleMemoryWrite('memory.deletion.request')}>申请删除</button></>}
            <button type="button" disabled={loading} onClick={() => void loadVersions()}>读取版本</button><button type="button" disabled={loading} onClick={() => void loadReferences()}>读取来源引用</button>
          </div>
          {selected.status === 'deletion_pending' && selected.retention.deletionId && <section className={styles.deletion}><h3>删除尚未最终完成</h3><p>正文仍由服务端保留；最终删除需要另一项独立确认。浏览器不会自行宣布完成。</p><div><button type="button" disabled={busy || Boolean(unknown)} onClick={() => beginWrite('memory.deletion.cancel', { memoryId: selected.memoryId, deletionId: selected.retention.deletionId! }, (_confirmationId, signal) => api.cancelDeletion(selected.memoryId, { deletionId: selected.retention.deletionId! }, pendingWrite.current!.key, { signal }))}>撤销删除申请</button><button className={styles.danger} type="button" disabled={busy || Boolean(unknown)} onClick={() => beginWrite('memory.deletion.finalize', { memoryId: selected.memoryId, deletionId: selected.retention.deletionId! }, (confirmationId, signal) => api.finalizeDeletion(selected.memoryId, { deletionId: selected.retention.deletionId!, confirmationId, securitySessionId: null }, pendingWrite.current!.key, { signal }))}>最终删除正文与版本</button><button type="button" disabled={loading} onClick={() => void personal.guarded((signal) => api.deletion(selected.retention.deletionId!, { signal }), undefined, setDeletion).catch(fail)}>查询删除记录</button></div>{deletion && <p>服务端状态：{deletion.status} · {deletion.bodyRetained ? '正文仍保留' : '正文已移除'}</p>}</section>}
          {versions && <section className={styles.subsection}><header><h3>不可变版本</h3><span>{versions.length} 个</span></header>{versions.map((version) => <article key={version.memoryVersionId}><strong>v{version.version} · {kindLabels[version.kind]}</strong><p>{version.body}</p><small>{version.contentHash}</small></article>)}</section>}
          {references && <section className={styles.subsection}><header><h3>来源引用</h3><span>{references.length} 个</span></header>{references.map((reference) => <article key={reference.referenceId}><strong>{reference.sourceType} · {reference.status}</strong><small>{reference.sourceType === 'event' ? reference.eventId : `${reference.conversationId} / ${reference.messageVersionId}`}</small>{reference.status === 'active' && <button type="button" disabled={busy} onClick={() => beginWrite('memory.reference.delete', { memoryId: selected.memoryId, referenceId: reference.referenceId }, (confirmationId, signal) => api.deleteReference(selected.memoryId, reference.referenceId, { expectedVersion: selected.version, confirmationId, securitySessionId: null }, pendingWrite.current!.key, { signal }), () => { setNotice('来源引用已由服务端移除。'); void loadReferences() })}>移除引用</button>}</article>)}
            <div className={styles.referenceForm}><label>来源类型<select value={referenceType} onChange={(event) => setReferenceType(event.target.value as typeof referenceType)}><option value="message_version">消息版本</option><option value="event">事件</option></select></label>{referenceType === 'message_version' ? <><label>会话 ID<input value={referenceFields.conversationId} onChange={(event) => setReferenceFields({ ...referenceFields, conversationId: event.target.value })} /></label><label>消息 ID<input value={referenceFields.messageId} onChange={(event) => setReferenceFields({ ...referenceFields, messageId: event.target.value })} /></label><label>消息版本 ID<input value={referenceFields.messageVersionId} onChange={(event) => setReferenceFields({ ...referenceFields, messageVersionId: event.target.value })} /></label></> : <label>事件 ID<input value={referenceFields.eventId} onChange={(event) => setReferenceFields({ ...referenceFields, eventId: event.target.value })} /></label>}<button type="button" disabled={busy || Boolean(unknown)} onClick={submitReference}>添加受控引用</button></div>
          </section>}
        </>}
      </section>
    </div>

    <section className={styles.transfer} aria-label="记忆导入导出">
      <div><h2>严格 JSON 导入</h2><p>仅接受 1–100 条 R5 导入条目；文件内容只在当前页面内存中停留。</p><label>模式<select value={importMode} onChange={(event) => setImportMode(event.target.value as typeof importMode)}><option value="atomic">原子导入</option><option value="best_effort">逐条处理</option></select></label><label>JSON 文件<input aria-label="选择记忆 JSON 文件" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setImportText).catch(() => setError('无法读取所选文件。')); event.currentTarget.value = '' }} /></label><label>或粘贴 JSON<textarea aria-label="导入记忆 JSON" rows={5} value={importText} onChange={(event) => setImportText(event.target.value)} /></label><button type="button" disabled={busy || Boolean(unknown) || !importText} onClick={submitImport}>提交导入</button>{importReport && <p role="status">导入 {importReport.totalCount} 条：创建 {importReport.createdCount}、复用 {importReport.reusedCount}、无效 {importReport.invalidCount}、冲突 {importReport.conflictCount}。</p>}</div>
      <div><h2>受控导出</h2><p>{selectedForExport.length ? `导出已选择的 ${selectedForExport.length} 条` : '未勾选时导出当前助手全部可授权记忆'}；服务端不创建文件。</p><label><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />包含已归档记忆</label><button type="button" disabled={busy || Boolean(unknown)} onClick={submitExport}>请求导出并下载</button>{download && <a href={download.url} download={download.filename} onClick={() => { const current = download; window.setTimeout(() => { if (downloadRef.current?.url !== current.url) return; URL.revokeObjectURL(current.url); downloadRef.current = null; if (mounted.current) setDownload(null) }, 1_000) }}>下载导出文件</a>}<small>下载对象只由当前 HTTP 响应临时生成，不写入浏览器持久存储。</small></div>
    </section>

    {formMode && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setFormMode(null); setDraft(emptyDraft) } }}><MemoryForm title={formMode === 'create' ? '创建长期记忆' : '编辑长期记忆'} value={draft} busy={busy} onChange={setDraft} onCancel={() => { setFormMode(null); setDraft(emptyDraft) }} onSubmit={submitDraft} /></div>}
  </section>
}
