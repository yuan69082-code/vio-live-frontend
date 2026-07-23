type ContinuityHeaderProps = {
  agentName: string
  agentAvatar: string
}

function ContinuityHeader({ agentName, agentAvatar }: ContinuityHeaderProps) {
  return (
    <header className="continuity-header">
      <span className="continuity-avatar" aria-hidden="true">
        {agentAvatar}
      </span>
      <div className="continuity-heading">
        <span>CONTINUITY · 模拟快照</span>
        <h1>{agentName} 的连续性</h1>
        <p>看见身份、关系与正在发生的变化。</p>
      </div>
      <span className="continuity-local-badge">本地模拟</span>
    </header>
  )
}

export default ContinuityHeader
