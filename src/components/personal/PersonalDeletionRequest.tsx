import { useState } from 'react'
import { ApiClientError } from '../../api/client'
import { finishOperation, operationKey } from '../../api/personal-api'
import { parseDeletionAccess } from '../../api/personal-deletion'
import { usePersonal } from '../../state/PersonalContext'
import { useConfirmedAction } from './ConfirmedAction'
import DeletionPolicy from './DeletionPolicy'
import { Panel } from './PersonalFields'
import styles from './personal.module.css'

export default function PersonalDeletionRequest() {
  const { api, state, scope, acceptDeletion, restore, recoverDeletion } = usePersonal()
  const action = useConfirmedAction(`${scope}:delete-personal-space`)
  const [acknowledged, setAcknowledged] = useState(false)
  const userId = state.kind === 'ready' ? state.session.user.userId : null
  const busy = action.busy || Boolean(action.confirmation)
  return <Panel id="personal-deletion" title="删除个人空间">
    <DeletionPolicy />
    <form noValidate onSubmit={(event) => {
      event.preventDefault()
      if (!userId || busy) return
      if (!acknowledged) { action.setError('请先阅读并确认删除范围、7 天撤销期及保留规则。'); return }
      const operation = 'delete-personal-space'
      const key = operationKey(userId, operation)
      void action.execute({
        label: '申请删除本人 Vio 个人空间（7 天可撤销）',
        work: async (signal, confirmationId) => {
          try {
            const value = await api.request('/deletions', 'POST', confirmationId ? { confirmationId } : {}, { signal, idempotencyKey: key })
            if (!value || typeof value !== 'object' || !('operationStatus' in value) || !['completed', 'cancelled', 'confirmation_required'].includes(String(value.operationStatus))) {
              throw new ApiClientError('Invalid deletion operation', { code: 'invalid_response', status: null })
            }
            if (value.operationStatus === 'completed') parseDeletionAccess(value)
            if (value.operationStatus === 'confirmation_required') {
              const prompt = value as { security?: { confirmation?: { confirmationId?: unknown } } }
              if (typeof prompt.security?.confirmation?.confirmationId !== 'string' || !prompt.security.confirmation.confirmationId) throw new ApiClientError('Invalid deletion confirmation', { code: 'invalid_response', status: null })
            }
            return value
          } catch (error) {
            const uncertain = !(error instanceof ApiClientError) || error.code === 'invalid_response' || error.status === null || error.status >= 500
            if (!signal.aborted && confirmationId && uncertain) void recoverDeletion()
            throw error
          }
        },
        cancel: (signal) => api.cancelOperation({ operation, key }, { signal }),
        onCancelled: () => { finishOperation(userId, operation, key); setAcknowledged(false) },
        accept: (value) => {
          const access = parseDeletionAccess(value)
          finishOperation(userId, operation, key)
          acceptDeletion(access)
        },
      })
    }}>
      <label className={styles.checks}><span><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} /> 我已理解删除范围、后果与期限</span></label>
      <div className={styles.actions}>
        <button type="submit" className={styles.danger} disabled={busy}>提交删除申请</button>
        <button type="button" disabled={busy} onClick={() => { setAcknowledged(false); action.cancel() }}>取消申请填写</button>
        <button type="button" disabled={action.busy} onClick={() => void restore()}>重新读取申请结果</button>
      </div>
      <p className={styles.hint}>提交后还须完成服务端高风险确认。批准后若结果未知，将离开业务页面并核对删除状态；不得将网络失败当作未申请而换键重发。</p>
      {action.controls}
    </form>
  </Panel>
}
