import { useState } from 'react'
import AccountSettings from '../components/profile/AccountSettings'
import AgentSettings from '../components/profile/AgentSettings'
import AppearanceSettings from '../components/profile/AppearanceSettings'
import DataSettings from '../components/profile/DataSettings'
import PrivacySettings from '../components/profile/PrivacySettings'
import ProfileHeader from '../components/profile/ProfileHeader'
import SafetySettings from '../components/profile/SafetySettings'
import SubjectRuntimeSettings from '../components/profile/SubjectRuntimeSettings'
import type { SubjectRuntimeApi } from '../api'

function ProfilePage({ runtimeApi }: { runtimeApi?: SubjectRuntimeApi }) {
  const [notice, setNotice] = useState('')

  return (
    <div className="profile-page">
      <ProfileHeader />
      <section className="profile-body" aria-label="我的设置内容">
        <div className="profile-local-note"><span>LOCAL UI</span><p>本页设置仍保留在本地；主体运行时状态来自当前 Vio 本地后端，只读展示，不会连接或操作外部运行时。</p></div>
        <SubjectRuntimeSettings api={runtimeApi} />
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
