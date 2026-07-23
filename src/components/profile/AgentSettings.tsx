import { profileMock } from '../../data/profileMock'
import ProfileIcon from './ProfileIcon'
import ProfileSection from './ProfileSection'

function AgentSettings({ onAction }: { onAction: (message: string) => void }) {
  const { agent } = profileMock
  return (
    <ProfileSection index="02" eyebrow="AGENT" title="智能体设置" summary="身份、性格与相处规则" icon="agent" tone="blue">
      <div className="profile-agent-card">
        <span>{agent.avatar}</span>
        <div><small>当前智能体</small><strong>{agent.name}</strong><p>{agent.persona}</p></div>
        <button type="button" onClick={() => onAction('编辑名字与头像入口 · 本地模拟')}>编辑</button>
      </div>
      <div className="profile-agent-details">
        <div><span><ProfileIcon name="spark" /></span><section><small>性格</small><p>{agent.personality.map((item) => <em key={item}>{item}</em>)}</p></section></div>
        <button type="button" onClick={() => onAction('编辑人设入口 · 本地模拟')}><span><ProfileIcon name="persona" /></span><div><strong>人设</strong><small>{agent.persona}</small></div><ProfileIcon name="chevron" /></button>
        <button type="button" onClick={() => onAction('编辑强制要求入口 · 本地模拟')}><span><ProfileIcon name="rule" /></span><div><strong>强制要求</strong><small>{agent.requirements.join(' · ')}</small></div><ProfileIcon name="chevron" /></button>
      </div>
    </ProfileSection>
  )
}

export default AgentSettings
