import { useState } from 'react'
import { emptyAssistantSettings, finishOperation, operationKey } from '../api/personal-api'
import type { PersonalPreferences } from '../api/personal-api'
import { usePersonal } from '../state/PersonalContext'
import { AvatarField, Panel, Status } from '../components/personal/PersonalFields'
import { AssistantSettingsFields, PreferenceFields, StorageFacts } from '../components/personal/PreferenceFields'
import { useScopedAction } from '../components/personal/useScopedAction'
import styles from '../components/personal/personal.module.css'

export default function FirstSetupPage() {
  const { api, state, scope, guarded, acceptSession, restore } = usePersonal()
  const task = useScopedAction(scope)
  const session = state.kind === 'ready' ? state.session : null
  const [displayName, setDisplayName] = useState(session?.user.displayName ?? '')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [assistantAvatar, setAssistantAvatar] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [settings, setSettings] = useState({ ...emptyAssistantSettings })
  const [preferences, setPreferences] = useState<PersonalPreferences>({ storagePreference: 'local', contextMode: 'balanced' })
  const [key] = useState(() => operationKey(session?.user.userId ?? scope, 'onboarding'))
  if (!session) return null
  function save(skip: boolean) {
    if (!session || task.busy) return
    if (!displayName.trim() || !name.trim() || name.trim().length > 80) { task.setError('请填写个人显示名与 1–80 字的助手名称。'); return }
    const input = {
      displayName: displayName.trim(), avatar,
      assistant: { name: name.trim(), avatar: assistantAvatar, settings: skip ? { ...emptyAssistantSettings } : settings },
      preferences: skip ? { storagePreference: 'local' as const, contextMode: 'balanced' } : preferences,
    }
    void task.run((signal) => guarded((owned) => api.onboarding(input, { signal: owned, idempotencyKey: key }), signal), (saved) => {
      acceptSession(saved)
      finishOperation(session.user.userId, 'onboarding')
    })
  }
  return <main className="setup-shell"><section className={`setup-card ${styles.page}`}>
    <header className="setup-header"><span className="wordmark">Vio Live</span><h1>首次设置</h1><p>资料与首个助手将一起保存到当前服务端。</p></header>
    <form noValidate onSubmit={(e) => { e.preventDefault(); save(false) }}>
      <Panel title="认识你与第一个助手">
        <label className={styles.field}>个人显示名<input value={displayName} maxLength={80} disabled={task.busy} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <AvatarField label="个人头像" value={avatar} onChange={setAvatar} disabled={task.busy} />
        <label className={styles.field}>首个助手名称<input value={name} maxLength={80} disabled={task.busy} onChange={(e) => setName(e.target.value)} /></label>
        <AvatarField label="助手头像" value={assistantAvatar} onChange={setAssistantAvatar} disabled={task.busy} />
        <AssistantSettingsFields value={settings} onChange={setSettings} disabled={task.busy} />
        <PreferenceFields value={preferences} onChange={setPreferences} disabled={task.busy} />
        <StorageFacts storage={session.storage} />
        <p className={styles.hint}>跳过高级设置：仍保存显示名、头像和首个助手；定位、性格、人设、要求为空，保存偏好为本地，上下文为标准。</p>
        <div className={styles.actions}><button type="button" disabled={task.busy} onClick={() => save(true)}>跳过高级设置并保存</button>
          <button className={styles.primary} type="submit" disabled={task.busy}>完成设置</button>
          <button type="button" disabled={task.busy} onClick={() => void restore()}>重新读取保存结果</button></div>
        <Status {...task} />
      </Panel>
    </form>
  </section></main>
}
