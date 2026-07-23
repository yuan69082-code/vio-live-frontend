import { ContinuityIconName } from '../../data/continuityMock'
import ContinuityIcon from './ContinuityIcon'

type CurrentStateCardProps = {
  index: string
  title: string
  summary: string
  icon: ContinuityIconName
  emotion: string
  intensityLabel: string
  intensityValue: string
  intensityPercent: number
  reason: string
}

function CurrentStateCard({
  index,
  title,
  summary,
  icon,
  emotion,
  intensityLabel,
  intensityValue,
  intensityPercent,
  reason,
}: CurrentStateCardProps) {
  return (
    <article className="continuity-state-card" aria-labelledby="current-state-title">
      <header className="continuity-card-header continuity-state-header">
        <span className="continuity-card-icon">
          <ContinuityIcon name={icon} />
        </span>
        <div>
          <span>{summary}</span>
          <h2 id="current-state-title">{title}</h2>
        </div>
        <small>{index} / 06</small>
      </header>

      <div className="state-overview">
        <div>
          <span>情绪</span>
          <strong>{emotion}</strong>
        </div>
        <div>
          <span>强度</span>
          <strong>
            {intensityLabel} · {intensityValue}
          </strong>
        </div>
      </div>

      <div
        className="state-intensity-track"
        role="meter"
        aria-label="当前状态强度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={intensityPercent}
      >
        <span style={{ width: `${intensityPercent}%` }} />
      </div>

      <div className="state-reason">
        <span>变化原因</span>
        <p>{reason}</p>
      </div>
    </article>
  )
}

export default CurrentStateCard
