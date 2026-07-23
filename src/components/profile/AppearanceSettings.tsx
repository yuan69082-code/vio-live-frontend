import { useState } from 'react'
import { profileMock } from '../../data/profileMock'
import ProfileIcon from './ProfileIcon'
import ProfileSection from './ProfileSection'
import ProfileSwitch from './ProfileSwitch'

function OptionRow({ label, icon, options, value, onChange }: { label: string; icon: 'theme' | 'background' | 'bubble'; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="profile-option-row">
      <div><span><ProfileIcon name={icon} /></span><strong>{label}</strong></div>
      <div>{options.map((option) => <button className={value === option ? 'is-active' : ''} type="button" key={option} onClick={() => onChange(option)} aria-pressed={value === option}>{option}</button>)}</div>
    </div>
  )
}

function AppearanceSettings({ onAction }: { onAction: (message: string) => void }) {
  const [theme, setTheme] = useState(profileMock.appearance.themes[0])
  const [background, setBackground] = useState(profileMock.appearance.backgrounds[0])
  const [bubble, setBubble] = useState(profileMock.appearance.bubbles[0])
  const [decoration, setDecoration] = useState(true)

  const choose = (label: string, value: string, update: (value: string) => void) => { update(value); onAction(`${label}已切换为“${value}” · 本地模拟`) }

  return (
    <ProfileSection index="03" eyebrow="APPEARANCE" title="外观设置" summary="主题、背景与页面细节" icon="appearance" tone="rose">
      <div className="profile-appearance-card">
        <OptionRow label="主题" icon="theme" options={profileMock.appearance.themes} value={theme} onChange={(value) => choose('主题', value, setTheme)} />
        <OptionRow label="背景" icon="background" options={profileMock.appearance.backgrounds} value={background} onChange={(value) => choose('背景', value, setBackground)} />
        <OptionRow label="气泡样式" icon="bubble" options={profileMock.appearance.bubbles} value={bubble} onChange={(value) => choose('气泡样式', value, setBubble)} />
        <div className="profile-decoration-row"><span><ProfileIcon name="decoration" /></span><div><strong>页面装饰</strong><small>显示柔光与轨道装饰</small></div><ProfileSwitch checked={decoration} label={`${decoration ? '关闭' : '开启'}页面装饰`} onChange={() => { setDecoration((value) => !value); onAction(`页面装饰已${decoration ? '关闭' : '开启'} · 本地模拟`) }} /></div>
      </div>
    </ProfileSection>
  )
}

export default AppearanceSettings
