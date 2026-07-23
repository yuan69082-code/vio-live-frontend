import { useState } from 'react'
import { profileMock } from '../../data/profileMock'
import ProfileIcon from './ProfileIcon'
import ProfileSection from './ProfileSection'

function SafetySettings({ onAction }: { onAction: (message: string) => void }) {
  const [askMode, setAskMode] = useState(profileMock.safety.askModes[1])
  return (
    <ProfileSection index="05" eyebrow="SAFETY" title="安全栏" summary="询问规则与工具权限" icon="shield" tone="gold">
      <div className="profile-setting-list profile-safety-list">
        <button type="button" onClick={() => onAction('权限规则入口 · 本地模拟')}><span><ProfileIcon name="permission" /></span><div><strong>权限规则</strong><small>{profileMock.safety.permissionRule}</small></div><ProfileIcon name="chevron" /></button>
        <div className="profile-ask-mode"><div><span><ProfileIcon name="question" /></span><strong>默认询问方式</strong></div><div>{profileMock.safety.askModes.map((mode) => <button className={askMode === mode ? 'is-active' : ''} type="button" key={mode} aria-pressed={askMode === mode} onClick={() => { setAskMode(mode); onAction(`默认询问方式：${mode} · 本地模拟`) }}>{mode}</button>)}</div></div>
        <button type="button" onClick={() => onAction('工具权限管理入口 · 本地模拟')}><span><ProfileIcon name="tool" /></span><div><strong>工具权限管理</strong><small>{profileMock.safety.toolPermission}</small></div><ProfileIcon name="chevron" /></button>
      </div>
    </ProfileSection>
  )
}

export default SafetySettings
