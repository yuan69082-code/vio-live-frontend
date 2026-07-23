import { profileMock } from '../../data/profileMock'
import ProfileIcon from './ProfileIcon'
import ProfileSection from './ProfileSection'

function PrivacySettings({ onAction }: { onAction: (message: string) => void }) {
  return (
    <ProfileSection index="06" eyebrow="PRIVACY" title="隐私设置" summary="政策、说明与私域偏好" icon="privacy" tone="slate">
      <div className="profile-setting-list profile-privacy-list">
        {profileMock.privacy.map((item) => (
          <button type="button" key={item.id} onClick={() => onAction(`${item.title}入口 · 本地模拟`)}>
            <span><ProfileIcon name={item.icon} /></span><div><strong>{item.title}</strong><small>{item.description}</small></div><ProfileIcon name="chevron" />
          </button>
        ))}
      </div>
    </ProfileSection>
  )
}

export default PrivacySettings
