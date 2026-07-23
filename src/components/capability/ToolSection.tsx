import { useState } from 'react'
import { capabilityMock } from '../../data/capabilityMock'
import CapabilityIcon from './CapabilityIcon'
import CapabilitySection from './CapabilitySection'
import CapabilitySwitch from './CapabilitySwitch'

function ToolSection() {
  const [recommended, setRecommended] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      capabilityMock.tools.map((item) => [item.id, item.recommended]),
    ),
  )

  return (
    <CapabilitySection
      id="tool"
      index="05"
      eyebrow="AVAILABLE TOOLS"
      title="Tool"
      summary="权限、记录与主动推荐"
      icon="tool"
      tone="gold"
    >
      <div className="capability-list">
        {capabilityMock.tools.map((item) => (
          <article key={item.id} className="capability-tool-item">
            <div className="capability-item-main">
              <span className="capability-item-icon">
                <CapabilityIcon name="tool" />
              </span>
              <div>
                <strong>{item.name}</strong>
                <p>{item.usage}</p>
              </div>
              <span className="capability-permission">{item.permission}</span>
            </div>
            <div className="capability-recommend-row">
              <span>
                <CapabilityIcon name="spark" />
                是否主动推荐
              </span>
              <CapabilitySwitch
                checked={recommended[item.id]}
                label={`${recommended[item.id] ? '关闭' : '开启'} ${item.name} 主动推荐`}
                onChange={() =>
                  setRecommended((current) => ({
                    ...current,
                    [item.id]: !current[item.id],
                  }))
                }
              />
            </div>
          </article>
        ))}
      </div>
    </CapabilitySection>
  )
}

export default ToolSection
