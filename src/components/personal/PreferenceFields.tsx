import type { AssistantSettings, PersonalPreferences, PersonalStorage } from '../../api/personal-api'
import styles from './personal.module.css'

export const contextModes = [
  ['concise', '精简'], ['balanced', '标准'], ['complete', '完整'], ['custom', '自定义'],
]

export function PreferenceFields({ value, onChange, disabled }: { value: PersonalPreferences; onChange: (value: PersonalPreferences) => void; disabled?: boolean }) {
  return <>
    <label className={styles.field}>数据保存偏好<select disabled={disabled} value={value.storagePreference} onChange={(e) => onChange({ ...value, storagePreference: e.target.value as PersonalPreferences['storagePreference'] })}>
      <option value="local">本地</option><option value="cloud">云端</option><option value="hybrid">混合</option>
    </select></label>
    <label className={styles.field}>默认上下文模式<select disabled={disabled} value={value.contextMode} onChange={(e) => onChange({ ...value, contextMode: e.target.value })}>
      {contextModes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>
  </>
}

export function StorageFacts({ storage }: { storage: PersonalStorage }) {
  return <p className={styles.hint}>实际保存位置：{storage.actualLocation === 'server_database' ? '当前服务端数据库' : '未知'}。
    云端同步：未启用。保存方式和上下文模式在本阶段仅保存偏好；不表示云部署、离线同步、备份或 R4 上下文机制已经生效。</p>
}

export function AssistantSettingsFields({ value, onChange, disabled }: { value: AssistantSettings; onChange: (value: AssistantSettings) => void; disabled?: boolean }) {
  return <>
    <label className={styles.field}>基础定位<input disabled={disabled} list="assistant-positioning-options" value={value.positioning} maxLength={4000} onChange={(e) => onChange({ ...value, positioning: e.target.value })} />
      <datalist id="assistant-positioning-options"><option value="工作伙伴" /><option value="生活管家" /><option value="陪伴" /></datalist></label>
    {(['personality', 'persona', 'requirements'] as const).map((key, index) => <label key={key} className={styles.field}>{['性格', '人设', '强制要求'][index]}
      <textarea disabled={disabled} maxLength={4000} value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} /></label>)}
    <label className={styles.field}>助手上下文偏好<select disabled={disabled} value={value.contextMode} onChange={(e) => onChange({ ...value, contextMode: e.target.value })}>
      {contextModes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>
  </>
}
