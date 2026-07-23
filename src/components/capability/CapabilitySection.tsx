import { ReactNode } from 'react'
import { CapabilityIconName } from '../../data/capabilityMock'
import CapabilityIcon from './CapabilityIcon'

type CapabilitySectionProps = {
  id: string
  index: string
  eyebrow: string
  title: string
  summary: string
  icon: CapabilityIconName
  tone: 'violet' | 'blue' | 'rose' | 'aqua' | 'gold' | 'slate'
  children: ReactNode
}

function CapabilitySection({
  id,
  index,
  eyebrow,
  title,
  summary,
  icon,
  tone,
  children,
}: CapabilitySectionProps) {
  const titleId = `capability-${id}-title`

  return (
    <section
      className={`capability-section capability-section-${tone}`}
      aria-labelledby={titleId}
    >
      <header className="capability-section-heading">
        <span className="capability-section-icon">
          <CapabilityIcon name={icon} />
        </span>
        <div>
          <small>{eyebrow}</small>
          <h2 id={titleId}>{title}</h2>
          <p>{summary}</p>
        </div>
        <span>{index} / 06</span>
      </header>
      {children}
    </section>
  )
}

export default CapabilitySection
