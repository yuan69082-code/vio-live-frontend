import { useEffect, useState } from 'react'
import type { DeletionAccess, DeletionStatus } from '../api/personal-deletion'
import { usePersonal } from '../state/PersonalContext'
import DeletionPolicy from '../components/personal/DeletionPolicy'
import { Status } from '../components/personal/PersonalFields'
import { useScopedAction } from '../components/personal/useScopedAction'
import styles from '../components/personal/personal.module.css'

const statusLabels: Record<DeletionStatus['status'], string> = {
  waiting: '等待服务端执行，尚未删除', processing: '服务端正在执行删除', cleanup_pending: '在线删除后仍待清理',
  failed: '删除或清理未完成', completed: 'Vio 受管范围整体删除完成', cancelled: '删除申请已撤销',
}

function ServerTime({ value }: { value: string | null }) {
  return value ? <time dateTime={value}>{new Date(value).toLocaleString('zh-CN', { hour12: false })}</time> : <>尚未发生</>
}

export function DeletionStatusDetails({ deletion }: { deletion: DeletionStatus }) {
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(deletion.cancellableUntil) - Date.parse(deletion.serverTime)) / 1000))
  const days = Math.floor(remainingSeconds / 86400)
  const hours = Math.floor(remainingSeconds % 86400 / 3600)
  const minutes = Math.floor(remainingSeconds % 3600 / 60)
  return <section className={styles.item} aria-label="服务端删除记录">
    <h2>{statusLabels[deletion.status]}</h2>
    <dl>
      <dt>服务端核对时间</dt><dd><ServerTime value={deletion.serverTime} /></dd>
      <dt>申请时间</dt><dd><ServerTime value={deletion.requestedAt} /></dd>
      <dt>可撤销截止时间</dt><dd><ServerTime value={deletion.cancellableUntil} /></dd>
      <dt>按本次服务端核对剩余</dt><dd>{remainingSeconds > 0 ? `${days} 天 ${hours} 小时 ${minutes} 分钟` : '期限已到；不代表执行成功'}</dd>
      <dt>本人范围</dt><dd>{deletion.scope.tableCount} 类数据 · {deletion.scope.rowCount} 条记录 · {deletion.scope.managedFileCount} 个受管文件 · {deletion.scope.managedBackupCount} 份受管备份</dd>
      <dt>在线数据</dt><dd>{deletion.onlineData === 'deleted' ? '在线数据已删除' : '在线数据尚未删除'}</dd>
      <dt>受管文件清理</dt><dd>{deletion.managedFiles.status === 'completed' ? '清理完成' : `等待清理 ${deletion.managedFiles.remaining} 项`}</dd>
      <dt>受管备份清理</dt><dd>{deletion.managedBackups.status === 'completed' ? '清理完成' : `等待清理 ${deletion.managedBackups.remaining} 份；整体尚未完成`}</dd>
      <dt>在线删除时间</dt><dd><ServerTime value={deletion.onlineDeletedAt} /></dd>
      <dt>受管备份最迟清理时间</dt><dd><ServerTime value={deletion.backupDeadlineAt} /></dd>
      <dt>最小删除凭据查询截止</dt><dd><ServerTime value={deletion.receiptExpiresAt} /></dd>
      <dt>数据库清理</dt><dd>{deletion.storage.sqlite === 'logical_rows_deleted' ? '逻辑记录已删除' : '待处理'}；{deletion.storage.wal === 'checkpoint_completed' ? '日志检查点已完成' : '日志清理仍待确认'}</dd>
    </dl>
    {deletion.reason && <p role="status">服务端原因码：<code>{deletion.reason}</code>。请按当前状态重新核对或执行允许的重试；这不是成功提示。</p>}
    <p className={styles.hint}>页面不自行倒计时触发删除。设备时钟变化不会决定结果；请重新读取服务端状态。不承诺存储介质物理擦除，不处理用户自行保存的副本。</p>
  </section>
}

export function DeletionAccessPage() {
  const { api, scope, acceptDeletion, restore } = usePersonal()
  const task = useScopedAction(`${scope}:deletion-access`)
  const [passphrase, setPassphrase] = useState('')
  useEffect(() => { document.title = '删除访问验证 | Vio Live' }, [])
  return <main className="login-shell"><section className={`login-card ${styles.page}`}>
    <span className="wordmark">Vio Live</span><h1>验证删除专用访问</h1>
    <p>此验证只用于查看删除状态和期限内撤销，不授予业务权限、不解锁供应商凭据。</p>
    <form onSubmit={(event) => {
      event.preventDefault(); if (task.busy || !passphrase) return
      let secret = passphrase; setPassphrase('')
      void task.run(async (signal) => { try { return await api.deletionAccess({ passphrase: secret }, { signal }) } finally { secret = '' } }, acceptDeletion)
    }}>
      <label className={styles.field}>删除状态验证口令<input type="password" autoComplete="off" value={passphrase} disabled={task.busy} onChange={(event) => setPassphrase(event.target.value)} /></label>
      <div className={styles.actions}><button type="submit" disabled={task.busy || !passphrase}>验证并查看删除状态</button>
        <button type="button" onClick={() => { task.cancel(); setPassphrase('') }}>取消验证等待</button>
        <button type="button" disabled={task.busy} onClick={() => void restore()}>重新读取访问状态</button></div>
      <Status {...task} />
    </form>
    <DeletionPolicy />
  </section></main>
}

export default function PersonalDeletionPage() {
  const { api, state, scope, guardedDeletion, acceptDeletion, requireAccessAfterCancellation, restore } = usePersonal()
  const task = useScopedAction(`${scope}:deletion-status`)
  const [uncertain, setUncertain] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [deviceName, setDeviceName] = useState('')
  useEffect(() => { document.title = '删除状态 | Vio Live' }, [])
  if (state.kind !== 'deletion') return null
  const deletion = state.access.deletion
  const canCancel = deletion.status === 'waiting' && Date.parse(deletion.serverTime) < Date.parse(deletion.cancellableUntil)
  const canRetry = ['waiting', 'cleanup_pending', 'failed'].includes(deletion.status) && Date.parse(deletion.serverTime) >= Date.parse(deletion.cancellableUntil)
  function read(work: (signal: AbortSignal) => Promise<DeletionAccess>) {
    if (task.busy) return
    setUncertain(true); setPassphrase('')
    void task.run((signal) => guardedDeletion(work, signal), (value) => { acceptDeletion(value); setUncertain(false) })
  }
  return <main className="setup-shell"><section className={`setup-card ${styles.page}`} aria-label="删除专用状态页">
    <header><span className="wordmark">Vio Live</span><h1>个人空间删除状态</h1><p>旧业务会话已撤销。当前仅限删除状态与受控撤销，不可继续使用原业务页面。</p></header>
    {uncertain ? <section className={styles.item}><h2>当前删除状态无法确认</h2><p>正在核对或服务不可达；不能把上次记录当作当前删除结果，也不能显示整体删除完成。</p></section> : <DeletionStatusDetails deletion={deletion} />}
    <div className={styles.actions}>
      <button type="button" disabled={task.busy} onClick={() => read((signal) => api.deletionCurrent({ signal }))}>重新核对删除状态</button>
      {canRetry && !uncertain && <button type="button" disabled={task.busy} onClick={() => read((signal) => api.retryDeletion({ signal }))}>重试到期执行或清理</button>}
      <button type="button" disabled={task.busy} onClick={() => void restore()}>恢复删除专用访问</button>
    </div>
    {canCancel && !uncertain && <form className={styles.item} onSubmit={(event) => {
      event.preventDefault(); if (task.busy) return
      if (!passphrase || !deviceName.trim()) { task.setError('请填写本人验证口令和设备名称。'); return }
      let secret = passphrase; setPassphrase('')
      void task.run((signal) => guardedDeletion(async (owned) => { try { return await api.cancelDeletion({ passphrase: secret, deviceName: deviceName.trim() }, { signal: owned }) } finally { secret = '' } }, signal), requireAccessAfterCancellation)
    }}>
      <h2>7 天内撤销删除</h2><p>须重新验证本人。撤销成功后仍需正常登录；不会恢复旧会话或已撤销的凭据与权限。</p>
      <label className={styles.field}>撤销删除验证口令<input type="password" autoComplete="off" value={passphrase} disabled={task.busy} onChange={(event) => setPassphrase(event.target.value)} /></label>
      <label className={styles.field}>本次验证设备名称<input value={deviceName} maxLength={80} disabled={task.busy} onChange={(event) => setDeviceName(event.target.value)} /></label>
      <div className={styles.actions}><button type="submit" disabled={task.busy}>验证本人并撤销删除</button><button type="button" onClick={() => { task.cancel(); setPassphrase(''); task.setNotice('已取消等待，撤销结果尚未确认。请重新核对服务端状态。') }}>取消撤销等待</button></div>
    </form>}
    {deletion.status === 'cancelled' && !uncertain && <button type="button" onClick={requireAccessAfterCancellation}>重新验证个人访问</button>}
    <Status {...task} />
    <DeletionPolicy />
  </section></main>
}
