import { useState } from 'react'
import { capabilityMock } from '../../data/capabilityMock'
import CapabilityIcon from './CapabilityIcon'
import CapabilitySection from './CapabilitySection'
import CapabilitySwitch from './CapabilitySwitch'

function SkillSection() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      capabilityMock.skills.map((item) => [item.id, item.enabled]),
    ),
  )

  return (
    <CapabilitySection
      id="skill"
      index="03"
      eyebrow="SPECIALIZED SKILLS"
      title="Skill"
      summary="技能列表与适用范围"
      icon="skill"
      tone="rose"
    >
      <div className="capability-list capability-skill-list">
        {capabilityMock.skills.map((item) => (
          <article key={item.id} className="capability-list-item">
            <div className="capability-item-main">
              <span className="capability-item-icon">
                <CapabilityIcon name="skill" />
              </span>
              <div>
                <strong>{item.name}</strong>
                <p>{item.description}</p>
              </div>
              <CapabilitySwitch
                checked={enabled[item.id]}
                label={`${enabled[item.id] ? '停用' : '启用'}技能 ${item.name}`}
                onChange={() =>
                  setEnabled((current) => ({
                    ...current,
                    [item.id]: !current[item.id],
                  }))
                }
              />
            </div>
            <div className="capability-scope">
              <CapabilityIcon name="link" />
              适用范围：{item.scope}
            </div>
          </article>
        ))}
      </div>
    </CapabilitySection>
  )
}

export default SkillSection
