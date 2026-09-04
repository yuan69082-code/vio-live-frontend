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
import { useOptionalPersonal } from '../state/PersonalContext'
import ConnectedAssistants from '../components/personal/ConnectedAssistants'
import PersonalProfileSettings from '../components/personal/PersonalProfileSettings'
import PersonalSecurity from '../components/personal/PersonalSecurity'
import PersonalDeletionRequest from '../components/personal/PersonalDeletionRequest'
import personalStyles from '../components/personal/personal.module.css'

function ProfilePage({ runtimeApi }: { runtimeApi?: SubjectRuntimeApi }) {
  const [notice, setNotice] = useState('')
  const personal = useOptionalPersonal()

  return (
    <div className="profile-page">
      <ProfileHeader />
      <section className="profile-body" aria-label="我的设置内容">
        <div className="profile-local-note"><span>{personal ? 'PERSONAL' : 'LOCAL UI'}</span><p>{personal ? '个人资料、助手与访问安全连接当前服务端。外观、通用权限及备份等后续阶段入口仍为原型，未计入 R2 完成。' : '本页设置仍保留在本地；主体运行时状态来自当前 Vio 本地后端，只读展示，不会连接或操作外部运行时。'}</p></div>
        <SubjectRuntimeSettings api={runtimeApi} />
        {personal ? <div className={`${personalStyles.page} ${personalStyles.body}`}><PersonalProfileSettings /><ConnectedAssistants /><PersonalSecurity /></div> : <><AccountSettings onAction={setNotice} /><AgentSettings onAction={setNotice} /></>}
        <AppearanceSettings onAction={setNotice} />
        {!personal && <DataSettings onAction={setNotice} />}
        {personal && <PersonalDeletionRequest />}
        <SafetySettings onAction={setNotice} />
        <PrivacySettings onAction={setNotice} />
        <p className="profile-notice" aria-live="polite">{notice || '\u00a0'}</p>
      </section>
    </div>
  )
}

export default ProfilePage
