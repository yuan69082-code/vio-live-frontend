import { useCallback, useEffect, useState } from 'react'
import type { AccessSession } from '../../api/personal-api'
import { usePersonal } from '../../state/PersonalContext'
import { Panel, Status } from './PersonalFields'
import { useScopedAction } from './useScopedAction'
import styles from './personal.module.css'

export default function PersonalSecurity() {
  const { api, scope, guarded, expire } = usePersonal()
  const task = useScopedAction(scope)
  const [sessions, setSessions] = useState<AccessSession[] | null>(null)
  const load = useCallback(() => task.run((signal) => guarded((owned) => api.sessions({ signal: owned }), signal), (value) => setSessions(value.items)), [api, guarded, task.run])
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load() }); return () => { active = false } }, [load])
  return <>
    <Panel title="个人访问与会话设备">
      <p className={styles.hint}>个人口令验证；邮箱、Google 与公开账号绑定暂缓。这里列出访问会话，不是 R9 远程设备控制。</p>
      <div className={styles.actions}><button type="button" disabled={task.busy} onClick={() => void load()}>刷新访问会话</button>
        <button type="button" disabled={task.busy} onClick={() => void task.run((signal) => guarded((owned) => api.logout({ signal: owned }), signal), expire)}>退出当前访问</button></div>
      {sessions?.length === 0 && <p>暂无访问会话。</p>}
      <div className={styles.grid}>{sessions?.map((session) => <article className={styles.item} key={session.sessionId}>
        <h3>{session.deviceName || '未命名设备'}{session.current ? '（当前访问）' : ''}</h3>
        <dl><dt>状态</dt><dd>{session.status}</dd><dt>创建时间</dt><dd>{session.createdAt}</dd><dt>最后访问</dt><dd>{session.lastSeenAt}</dd><dt>过期时间</dt><dd>{session.expiresAt}</dd></dl>
        <button type="button" disabled={task.busy || session.status !== 'active'} onClick={() => void task.run(async (signal) => {
          await guarded((owned) => api.revokeSession(session.sessionId, { signal: owned }), signal)
          if (session.current) return null
          return guarded((owned) => api.sessions({ signal: owned }), signal)
        }, (value) => { if (session.current) expire(); else if (value) setSessions(value.items) })}>撤销此访问会话</button>
      </article>)}</div>
      <Status {...task} />
    </Panel>
    <PersonalDiagnostics />
  </>
}

function PersonalDiagnostics() {
  const { api, scope, guarded } = usePersonal()
  const task = useScopedAction(scope)
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null)
  const [audit, setAudit] = useState<Array<{ eventId: string; type: string; occurredAt: string; anomaly: boolean }> | null>(null)
  const load = useCallback(() => task.run((signal) => guarded(async (owned) => {
    const diagnostics = await api.request<Record<string, unknown>>('/diagnostics', 'GET', undefined, { signal: owned })
    const audit = await api.request<{ items: Array<{ eventId: string; type: string; occurredAt: string; anomaly: boolean }> }>('/access-audit', 'GET', undefined, { signal: owned })
    return { diagnostics, audit }
  }, signal), (value) => { setDiagnostics(value.diagnostics); setAudit(value.audit.items) }), [api, guarded, task.run])
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load() }); return () => { active = false } }, [load])
  return <Panel title="最小诊断"><p className={styles.hint}>仅显示服务端允许的状态，不显示凭据、路径、环境、堆栈或任何用户正文。</p>
    <button type="button" disabled={task.busy} onClick={() => void load()}>读取最小诊断</button>
    {diagnostics && <dl>{(['identity', 'database', 'vault', 'authentication'] as const).map((key, index) => <div key={key}><dt>{['身份', '数据库', '密钥库', '认证方式'][index]}</dt><dd>{typeof diagnostics[key] === 'string' ? diagnostics[key] as string : '未提供'}</dd></div>)}</dl>}
    <h3>访问记录与异常提示</h3>
    {audit?.length === 0 && <p>暂无访问记录。</p>}
    {audit?.some((item) => item.anomaly) && <p role="alert">存在异常访问记录，请检查访问会话，必要时撤销。</p>}
    {audit && <ul>{audit.map((item) => <li key={item.eventId}>{item.occurredAt} · {item.type}{item.anomaly ? ' · 异常' : ''}</li>)}</ul>}
    <Status {...task} />
  </Panel>
}
