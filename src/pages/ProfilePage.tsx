import { useState } from 'react'
import AccountSettings from '../components/profile/AccountSettings'
import AgentSettings from '../components/profile/AgentSettings'
import AppearanceSettings from '../components/profile/AppearanceSettings'
import DataSettings from '../components/profile/DataSettings'
import PrivacySettings from '../components/profile/PrivacySettings'
import ProfileHeader from '../components/profile/ProfileHeader'
import SafetySettings from '../components/profile/SafetySettings'

function ProfilePage() {
  const [notice, setNotice] = useState('')

  return (
    <div className="profile-page">
      <ProfileHeader />
      <section className="profile-body" aria-label="我的设置内容">
        <div className="profile-local-note"><span>LOCAL UI</span><p>所有信息和操作都只存在于当前页面，不会上传或保存。</p></div>
        <AccountSettings onAction={setNotice} />
        <AgentSettings onAction={setNotice} />
        <AppearanceSettings onAction={setNotice} />
        <DataSettings onAction={setNotice} />
        <SafetySettings onAction={setNotice} />
        <PrivacySettings onAction={setNotice} />
        <p className="profile-notice" aria-live="polite">{notice || '\u00a0'}</p>
      </section>
    </div>
  )
}

export default ProfilePage
