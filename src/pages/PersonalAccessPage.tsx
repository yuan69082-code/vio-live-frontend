import { useEffect, useState } from 'react'
import { finishOperation, operationKey } from '../api/personal-api'
import type { PersonalAccess } from '../api/personal-api'
import { usePersonal } from '../state/PersonalContext'
import { useScopedAction } from '../components/personal/useScopedAction'
import { Status } from '../components/personal/PersonalFields'
import styles from '../components/personal/personal.module.css'

export default function PersonalAccessPage({ access, message }: { access: PersonalAccess; message?: string }) {
  const { api, scope, acceptSession, restore, openDeletionAccess } = usePersonal()
  const task = useScopedAction(scope)
  const initial = access.status === 'initialization_required'
  const [invitation, setInvitation] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [agreements, setAgreements] = useState([false, false, false])
  const [key] = useState(() => operationKey('initialization', 'initialize'))
  useEffect(() => { document.title = '个人访问 | Vio Live' }, [])
  return <main className="login-shell"><section className={`login-card ${styles.page}`} aria-labelledby="personal-access-title">
    <header className="brand-block"><span className="wordmark">Vio Live</span><h1 id="personal-access-title">{initial ? '初始化个人空间' : '验证个人访问'}</h1>
      <p>当前仅供个人使用，不开放注册。</p></header>
    <p className={styles.hint}>邮箱验证码、Google 登录与公开注册暂缓。此入口使用服务端个人会话，不使用演示身份。</p>
    {message && <p role="status">{message}</p>}
    {initial && <p className={styles.hint}>需要本机管理员生成的限时一次性邀请。第一个访问网页的人不会自动成为所有者。</p>}
    <form noValidate onSubmit={(event) => {
      event.preventDefault()
      if (task.busy) return
      if (!passphrase || (initial && !invitation.trim()) || (!initial && !deviceName.trim())) { task.setError('请填写所有必要字段。'); return }
      if (initial && (passphrase.length < 12 || passphrase.length > 256)) { task.setError('个人访问口令需要 12–256 个字符。'); return }
      if (initial && !agreements.every(Boolean)) { task.setError('请阅读并勾选三项说明后继续。'); return }
      const credentials = { invitation: invitation.trim(), passphrase }
      setPassphrase(''); setInvitation('')
      void task.run((signal) => initial
        ? api.initialize({ ...credentials, agreementVersion: 'personal-use/v1' }, { signal, idempotencyKey: key })
        : api.login({ passphrase: credentials.passphrase, deviceName: deviceName.trim() }, { signal }), (session) => {
        acceptSession(session)
        if (initial) finishOperation('initialization', 'initialize')
      })
    }}>
      {initial && <label className={styles.field}>初始化邀请<input type="password" autoComplete="off" value={invitation} disabled={task.busy} onChange={(e) => setInvitation(e.target.value)} /></label>}
      <label className={styles.field}>{initial ? '设置个人访问口令' : '个人访问口令'}<input type="password" autoComplete={initial ? 'new-password' : 'current-password'} value={passphrase} disabled={task.busy} onChange={(e) => setPassphrase(e.target.value)} /></label>
      {!initial && <label className={styles.field}>此访问设备名称<input value={deviceName} maxLength={80} autoComplete="off" disabled={task.busy} onChange={(e) => setDeviceName(e.target.value)} /></label>}
      {initial && <fieldset className={styles.checks}><legend>继续前请阅读并同意</legend>
        {['用户协议', '隐私政策', '风险与免责声明'].map((label, index) => <label key={label}><input type="checkbox" checked={agreements[index]} disabled={task.busy} onChange={(e) => setAgreements((items) => items.map((item, i) => i === index ? e.target.checked : item))} />我已阅读并同意{label}</label>)}
        <details><summary>查看个人使用说明（personal-use/v1）</summary><p>本软件当前个人使用，访问口令由本人保管，所有业务操作须经服务端授权。资料和偏好保存于当前服务器数据库；尚未部署云端、未实现离线同步或备份。供应商密钥仅在受保护入口输入，由后端加密保存，不应发到聊天窗口。AI 输出可能有误，外部服务费用和危险操作须按已有权限规则处理。</p></details>
      </fieldset>}
      <div className={styles.actions}><button className={styles.primary} disabled={task.busy} type="submit">{initial ? '创建个人空间' : '验证并进入'}</button>
        <button type="button" onClick={() => { task.cancel(); setInvitation(''); setPassphrase(''); task.setNotice('已取消等待并清空敏感输入；已到达服务端的操作不能视为撤销，可重新读取状态。') }}>取消</button>
        <button type="button" disabled={task.busy} onClick={() => void restore()}>重新读取访问状态</button>
        <button type="button" disabled={task.busy} onClick={openDeletionAccess}>恢复删除申请访问</button></div>
      <Status {...task} />
    </form>
  </section></main>
}
