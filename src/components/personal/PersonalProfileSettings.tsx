import { useCallback, useEffect, useState } from 'react'
import type { PersonalProfile } from '../../api/personal-api'
import { usePersonal } from '../../state/PersonalContext'
import { AvatarField, Panel, Status } from './PersonalFields'
import { PreferenceFields, StorageFacts } from './PreferenceFields'
import { useScopedAction } from './useScopedAction'
import styles from './personal.module.css'

export default function PersonalProfileSettings() {
  const { api, scope, guarded } = usePersonal()
  const task = useScopedAction(scope)
  const [profile, setProfile] = useState<PersonalProfile | null>(null)
  const load = useCallback(() => task.run((signal) => guarded((owned) => api.profile({ signal: owned }), signal), setProfile), [api, guarded, task.run])
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load() }); return () => { active = false } }, [load])
  return <Panel title="个人资料与偏好"><button type="button" disabled={task.busy} onClick={() => void load()}>重新读取个人资料</button><Status {...task} />
    {profile && <ProfileForm key={profile.version} profile={profile} onSaved={setProfile} />}
  </Panel>
}

function ProfileForm({ profile, onSaved }: { profile: PersonalProfile; onSaved: (value: PersonalProfile) => void }) {
  const { api, scope, guarded, state, acceptSession } = usePersonal()
  const task = useScopedAction(scope)
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [avatar, setAvatar] = useState(profile.avatar)
  const [preferences, setPreferences] = useState(profile.preferences)
  return <form noValidate onSubmit={(e) => {
    e.preventDefault()
    if (!displayName.trim()) { task.setError('请填写个人显示名。'); return }
    void task.run((signal) => guarded((owned) => api.updateProfile({ displayName: displayName.trim(), avatar, preferences, expectedVersion: profile.version }, { signal: owned }), signal), (saved) => {
      onSaved(saved)
      if (state.kind === 'ready') acceptSession({ ...state.session, user: { ...state.session.user, displayName: saved.displayName, avatar: saved.avatar }, preferences: saved.preferences })
    })
  }}>
    <label className={styles.field}>个人显示名<input disabled={task.busy} value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} /></label>
    <AvatarField label="个人头像" value={avatar} onChange={setAvatar} disabled={task.busy} />
    <PreferenceFields value={preferences} onChange={setPreferences} disabled={task.busy} />
    <StorageFacts storage={profile.storage} />
    <div className={styles.actions}><button type="submit" disabled={task.busy}>保存个人资料</button><button type="button" onClick={() => { task.cancel(); setDisplayName(profile.displayName ?? ''); setAvatar(profile.avatar); setPreferences(profile.preferences) }}>取消修改</button></div>
    <Status {...task} />
  </form>
}
