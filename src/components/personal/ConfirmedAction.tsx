import { useLayoutEffect, useRef, useState } from 'react'
import { usePersonal } from '../../state/PersonalContext'
import { useScopedAction } from './useScopedAction'
import { Status } from './PersonalFields'
import styles from './personal.module.css'
import { ApiClientError } from '../../api/client'

type Operation = {
  label: string
  work: (signal: AbortSignal, confirmationId?: string) => Promise<unknown>
  cancel: (signal: AbortSignal) => Promise<unknown>
  accept: (value: unknown) => void
  /** Terminal server cancellation only; never called for an aborted wait. */
  onCancelled?: () => void
}
function confirmationId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('operationStatus' in value) || value.operationStatus !== 'confirmation_required') return null
  const object = value as { security?: { confirmation?: { confirmationId?: unknown } } }
  return typeof object.security?.confirmation?.confirmationId === 'string' ? object.security.confirmation.confirmationId : null
}

/** Presents only confirmations requested by the existing backend safety gate. */
export function useConfirmedAction(scope: string) {
  const { api, guarded } = usePersonal()
  const task = useScopedAction(scope)
  const operation = useRef<Operation | null>(null)
  const requestLock = useRef<object | null>(null)
  const confirmationRef = useRef<{ id: string; label: string } | null>(null)
  const [confirmation, setConfirmation] = useState<{ id: string; label: string } | null>(null)
  useLayoutEffect(() => {
    operation.current = null
    requestLock.current = null
    confirmationRef.current = null
    setConfirmation(null)
    return () => { operation.current = null; requestLock.current = null; confirmationRef.current = null }
  }, [scope])
  function cancelled(pending: Operation) {
    operation.current = null
    confirmationRef.current = null
    setConfirmation(null)
    pending.onCancelled?.()
    task.setNotice('已拒绝并取消本次服务端操作。')
  }
  function receive(value: unknown, pending: Operation) {
    const id = confirmationId(value)
    if (id) { confirmationRef.current = { id, label: pending.label }; setConfirmation(confirmationRef.current) }
    else if (value && typeof value === 'object' && 'operationStatus' in value && value.operationStatus === 'cancelled') cancelled(pending)
    else {
      if (!value || typeof value !== 'object' || !('operationStatus' in value) || value.operationStatus !== 'completed') {
        throw new ApiClientError('Operation not completed', { code: 'operation_denied', status: 403 })
      }
      operation.current = null; confirmationRef.current = null; setConfirmation(null); pending.accept(value)
    }
  }
  async function execute(next: Operation) {
    if (requestLock.current || confirmationRef.current) return false
    const invocation = {}
    requestLock.current = invocation
    operation.current = next
    try {
      return await task.run((signal) => guarded((owned) => next.work(owned), signal), (value) => receive(value, next))
    } finally { if (requestLock.current === invocation) requestLock.current = null }
  }
  async function decide(approve: boolean) {
    const pending = operation.current
    const prompt = confirmationRef.current
    if (!pending || !prompt || requestLock.current) return
    const invocation = {}
    requestLock.current = invocation
    try { await task.run(async (signal) => guarded(async (owned) => {
      await api.request(`/confirmations/${encodeURIComponent(prompt.id)}/decision`, 'POST', { decision: approve ? 'approve' : 'reject' }, { signal: owned })
      if (!approve) return pending.cancel(owned)
      return pending.work(owned, prompt.id)
    }, signal), (value) => {
      if (approve) receive(value, pending)
      else {
        const recovery = value as { status?: unknown; result?: unknown }
        if (recovery?.status === 'completed' && recovery.result) {
          receive(recovery.result, pending)
          task.setNotice('拒绝时服务端操作已完成，页面已按服务端最终结果更新。')
        } else if (recovery?.status === 'cancelled') {
          cancelled(pending)
        } else {
          throw new ApiClientError('Cancellation not confirmed', { code: 'invalid_response', status: null })
        }
      }
    }) } finally { if (requestLock.current === invocation) requestLock.current = null }
  }
  /** Forget client closures and abort waits only; this does not cancel server work or release its key. */
  function clearPending() {
    task.cancel()
    requestLock.current = null
    operation.current = null
    confirmationRef.current = null
    setConfirmation(null)
  }
  function cancel() {
    clearPending()
    task.setNotice('已取消等待；已提交的操作结果请重新读取确认。')
  }
  const controls = <><Status {...task} />{confirmation && <section className={styles.item} role="group" aria-label="后端安全确认">
    <h3>确认：{confirmation.label}</h3><p>服务端原有权限规则要求确认。批准只用于这一次操作，不扩大其他权限。</p>
    <div className={styles.actions}><button type="button" disabled={task.busy} onClick={() => void decide(true)}>批准本次操作</button><button type="button" disabled={task.busy} onClick={() => void decide(false)}>拒绝并取消</button></div>
  </section>}</>
  return { ...task, execute, controls, cancel, clearPending, confirmation }
}
