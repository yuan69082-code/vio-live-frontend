import ContinuityCard from '../components/continuity/ContinuityCard'
import ContinuityHeader from '../components/continuity/ContinuityHeader'
import CurrentStateCard from '../components/continuity/CurrentStateCard'
import { continuityMock } from '../data/continuityMock'

function ContinuityPage() {
  return (
    <div className="continuity-page">
      <ContinuityHeader
        agentName={continuityMock.agent.name}
        agentAvatar={continuityMock.agent.avatar}
      />

      <section className="continuity-body" aria-label="连续性信息">
        <div className="continuity-intro">
          <div>
            <span aria-hidden="true" />
            <strong>连续性快照</strong>
          </div>
          <small>所有内容均为模拟数据</small>
        </div>

        {continuityMock.sections.map((section) => (
          <ContinuityCard key={section.id} section={section} />
        ))}

        <CurrentStateCard {...continuityMock.state} />
      </section>
    </div>
  )
}

export default ContinuityPage
