import { profileMock } from '../../data/profileMock'
import ProfileIcon from './ProfileIcon'
import ProfileSection from './ProfileSection'

function AccountSettings({ onAction }: { onAction: (message: string) => void }) {
  const { account } = profileMock
  return (
    <ProfileSection index="01" eyebrow="ACCOUNT" title="账号设置" summary="用户信息与登录绑定" icon="account">
      <div className="profile-account-card">
        <span>U</span>
        <div><strong>{account.displayName}</strong><p>@{account.userId}</p><small>{account.plan}</small></div>
        <button type="button" onClick={() => onAction('编辑用户信息入口 · 本地模拟')}>编辑</button>
      </div>
      <div className="profile-setting-list">
        <button type="button" onClick={() => onAction('登录方式详情 · 本地模拟')}>
          <span><ProfileIcon name="login" /></span><div><strong>登录方式</strong><small>{account.loginMethod}</small></div><em>{account.email}</em><ProfileIcon name="chevron" />
        </button>
        <button type="button" onClick={() => onAction('账号绑定入口 · 本地模拟')}>
          <span><ProfileIcon name="link" /></span><div><strong>账号绑定</strong><small>{account.bindings}</small></div><ProfileIcon name="chevron" />
        </button>
      </div>
    </ProfileSection>
  )
}

export default AccountSettings
