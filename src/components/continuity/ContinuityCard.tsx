import { ContinuitySection } from '../../data/continuityMock'
import ContinuityIcon from './ContinuityIcon'

function ContinuityCard({ section }: { section: ContinuitySection }) {
  const titleId = `continuity-${section.id}-title`

  return (
    <article
      className={`continuity-card continuity-card-${section.tone}`}
      aria-labelledby={titleId}
    >
      <header className="continuity-card-header">
        <span className="continuity-card-icon">
          <ContinuityIcon name={section.icon} />
        </span>
        <div>
          <span>{section.summary}</span>
          <h2 id={titleId}>{section.title}</h2>
        </div>
        <small>{section.index} / 06</small>
      </header>

      <dl className="continuity-detail-list">
        {section.items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

export default ContinuityCard
