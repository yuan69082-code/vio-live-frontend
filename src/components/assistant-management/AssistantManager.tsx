import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { CreateSubjectInput, Subject } from '../../api/types'
import styles from './AssistantManager.module.css'

export type AssistantManagerData = {
  /** Opaque UI scope, not an authentication token or a user identifier. */
  contextKey: string
} & (
  | { status: 'loading' | 'error' }
  | {
      status: 'ready'
      assistants: readonly Pick<Subject, 'subjectId' | 'name'>[]
      currentAssistantId: Subject['subjectId'] | null
    }
)

export type AssistantOperationContext = {
  contextKey: string
  signal: AbortSignal
}

export type AssistantManagerProps = {
  /** Change on account/session/ownership-scope changes, including re-entry. */
  contextKey: string
  /** The caller supplies authorized data and tags it with its original scope. */
  data: AssistantManagerData
  onReload: (context: AssistantOperationContext) => Promise<void>
  onCreate: (input: CreateSubjectInput, context: AssistantOperationContext) => Promise<void>
  onSelect: (assistantId: Subject['subjectId'], context: AssistantOperationContext) => Promise<void>
}

type Operation =
  | { kind: 'reload' }
  | { kind: 'create' }
  | { kind: 'select'; assistantId: Subject['subjectId'] }

type PendingOperation = { operation: Operation; controller: AbortController }

// Matches the existing Subject name limit; this does not define a new wire schema.
const NAME_MAX_LENGTH = 80

/**
 * Controlled integration seam: no fetching, persistence or identity inference.
 * Callbacks must await the real operation and publish the resulting data props.
 * They must also guard their own stores against stale scopes; AbortSignal alone
 * cannot undo a server-side write. No optimistic assistant/selection is invented.
 */
export default function AssistantManager(props: AssistantManagerProps) {
  return <AssistantManagerView key={props.contextKey} {...props} />
}

function AssistantManagerView({ contextKey, data, onReload, onCreate, onSelect }: AssistantManagerProps) {
  const id = useId()
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [pending, setPending] = useState<Operation | null>(null)
  const [failed, setFailed] = useState<Operation | null>(null)
  const pendingRef = useRef<PendingOperation | null>(null)
  const selectedRef = useRef<Subject['subjectId'] | null | undefined>(undefined)
  const matchesContext = data.contextKey === contextKey
  const ready = matchesContext && data.status === 'ready' ? data : null
  const currentId = ready?.currentAssistantId
  const current = ready?.assistants.find((assistant) => assistant.subjectId === currentId)
  const selectionMissing = ready !== null && currentId !== null && !current
  const canManage = ready !== null && !selectionMissing
  const busy = pending !== null

  useLayoutEffect(() => () => {
    const request = pendingRef.current
    pendingRef.current = null
    request?.controller.abort()
  }, [])

  // A parent-driven assistant change is also a context boundary, even if the
  // account scope stayed the same. Keep loading transitions from erasing drafts.
  useLayoutEffect(() => {
    if (currentId === undefined) return
    if (selectedRef.current !== undefined && selectedRef.current !== currentId) {
      const request = pendingRef.current
      pendingRef.current = null
      request?.controller.abort()
      setPending(null)
      setFailed(null)
      setName('')
      setNameError('')
    }
    selectedRef.current = currentId
  }, [currentId])

  async function run(operation: Operation, input?: CreateSubjectInput) {
    // The ref closes the gap before React renders disabled controls.
    if (pendingRef.current) return
    if (operation.kind !== 'reload' && !canManage) return
    if (operation.kind === 'select' && (
      operation.assistantId === currentId
      || !ready?.assistants.some((assistant) => assistant.subjectId === operation.assistantId)
    )) return

    const request: PendingOperation = { operation, controller: new AbortController() }
    pendingRef.current = request
    setPending(operation)
    setFailed(null)
    const context = { contextKey, signal: request.controller.signal }
    const isCurrent = () => pendingRef.current === request && !context.signal.aborted

    try {
      if (operation.kind === 'reload') await onReload(context)
      else if (operation.kind === 'create' && input) await onCreate(input, context)
      else if (operation.kind === 'select') await onSelect(operation.assistantId, context)

      if (isCurrent() && operation.kind === 'create') {
        setName('')
        setNameError('')
      }
    } catch {
      // Do not render arbitrary callback errors (which can contain secrets).
      if (isCurrent()) setFailed(operation)
    } finally {
      if (isCurrent()) {
        pendingRef.current = null
        setPending(null)
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current || !canManage) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('请输入助手名称。')
      return
    }
    if (trimmed.length > NAME_MAX_LENGTH) {
      setNameError(`助手名称不能超过 ${NAME_MAX_LENGTH} 个字符。`)
      return
    }
    setNameError('')
    void run({ kind: 'create' }, { name: trimmed })
  }

  return (
    <section className={styles.root} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>VIO LIVE · ASSISTANTS</span>
          <h2 id={`${id}-title`} className={styles.title}>多助手管理</h2>
          <p className={styles.description}>选择与你一起处理当下事务的助手。</p>
        </div>
        <button className={styles.secondaryButton} type="button" disabled={busy}
          onClick={() => void run({ kind: 'reload' })}>
          {pending?.kind === 'reload' ? '重新加载中…' : '重新加载助手列表'}
        </button>
      </header>

      <div className={styles.content} aria-busy={busy || !matchesContext || data.status === 'loading'}>
        {!matchesContext || data.status === 'loading' ? (
          <p className={styles.message} role="status">正在加载助手列表…</p>
        ) : data.status === 'error' ? (
          <p className={styles.error} role="alert">助手列表加载失败，请重新加载。</p>
        ) : ready ? (
          <>
            <div className={styles.current} aria-label="当前助手">
              <span className={styles.avatar} aria-hidden="true">{current ? Array.from(current.name)[0] : '◇'}</span>
              <div className={styles.currentText}>
                <span className={styles.caption}>当前助手</span>
                <strong className={styles.name}>{current?.name ?? (selectionMissing ? '当前助手暂不可用' : '尚未选择助手')}</strong>
              </div>
            </div>
            {selectionMissing && <p className={styles.error} role="alert">当前助手不在此列表，请重新加载后再操作。</p>}
            {ready.assistants.length === 0 ? (
              <p className={styles.message}>还没有助手，可以在下方创建第一个助手。</p>
            ) : (
              <ul className={styles.list} aria-label="助手列表">
                {ready.assistants.map((assistant) => {
                  const isSelected = assistant.subjectId === currentId
                  const isSelecting = pending?.kind === 'select' && pending.assistantId === assistant.subjectId
                  const isRetry = failed?.kind === 'select' && failed.assistantId === assistant.subjectId
                  return (
                    <li className={styles.item} key={assistant.subjectId}>
                      <span className={styles.name}>{assistant.name}</span>
                      <button className={styles.selectButton} type="button" aria-pressed={isSelected}
                        aria-label={`${isSelected ? '当前助手' : isRetry ? '重试切换到' : '选择助手'}：${assistant.name}`}
                        disabled={busy || isSelected || !canManage}
                        onClick={() => void run({ kind: 'select', assistantId: assistant.subjectId })}>
                        {isSelected ? '当前使用' : isSelecting ? '切换中…' : isRetry ? '重试切换' : '选择'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : null}

        {pending && <p className={styles.message} role="status">{
          pending.kind === 'create' ? '正在保存新助手…'
            : pending.kind === 'select' ? '正在切换助手…' : '正在重新加载助手列表…'
        }</p>}
        {failed && <p className={styles.error} role="alert">{
          failed.kind === 'create' ? '创建结果未确认，名称已保留。请先重新加载列表核对，再重试创建。'
            : failed.kind === 'select' ? '切换未完成，请核对当前助手后重试。'
              : '重新加载失败，请重试。'
        }</p>}

        <form className={styles.form} onSubmit={submit} noValidate aria-label="创建助手">
          <label className={styles.label} htmlFor={`${id}-name`}>助手名称</label>
          <div className={styles.formRow}>
            <input className={styles.input} id={`${id}-name`} name="assistantName" type="text"
              autoComplete="off" required disabled={busy || !canManage} value={name}
              aria-invalid={Boolean(nameError)} aria-describedby={`${id}-hint${nameError ? ` ${id}-error` : ''}`}
              onChange={(event) => { setName(event.target.value); setNameError(''); if (failed?.kind === 'create') setFailed(null) }} />
            <button className={styles.primaryButton} type="submit" disabled={busy || !canManage}>
              {pending?.kind === 'create' ? '创建中…' : failed?.kind === 'create' ? '重试创建助手' : '创建助手'}
            </button>
          </div>
          <p id={`${id}-hint`} className={styles.hint}>名称去除首尾空格后为 1–{NAME_MAX_LENGTH} 个字符。列表和当前助手以保存后返回的数据为准。</p>
          {nameError && <p id={`${id}-error`} className={styles.error} role="alert">{nameError}</p>}
        </form>
      </div>
    </section>
  )
}
