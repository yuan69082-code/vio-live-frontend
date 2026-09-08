type ContinuityHeaderProps = {
  agentName: string
  agentAvatar: string
  eyebrow?: string
  description?: string
  badge?: string
}

function ContinuityHeader({ agentName, agentAvatar, eyebrow = 'CONTINUITY · 模拟快照', description = '看见身份、关系与正在发生的变化。', badge = '本地模拟' }: ContinuityHeaderProps) {
  return (
    <header className="continuity-header">
      <span className="continuity-avatar" aria-hidden="true">
        {agentAvatar}
      </span>
      <div className="continuity-heading">
        <span>{eyebrow}</span>
        <h1>{agentName} 的连续性</h1>
        <p>{description}</p>
      </div>
      <span className="continuity-local-badge">{badge}</span>
    </header>
  )
}

export default ContinuityHeader
