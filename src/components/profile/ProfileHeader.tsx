import ProfileIcon from './ProfileIcon'

function ProfileHeader() {
  return (
    <header className="profile-header">
      <span className="profile-header-icon"><ProfileIcon name="profile" /></span>
      <div>
        <span>VIO LIVE · SETTINGS</span>
        <h1>我的</h1>
        <p>账号、智能体与隐私偏好</p>
      </div>
      <span className="profile-header-badge">本地设置</span>
    </header>
  )
}

export default ProfileHeader
