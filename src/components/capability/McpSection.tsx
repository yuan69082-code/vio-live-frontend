import { useState } from 'react'
import { capabilityMock } from '../../data/capabilityMock'
import CapabilityIcon from './CapabilityIcon'
import CapabilitySection from './CapabilitySection'
import CapabilitySwitch from './CapabilitySwitch'

function McpSection() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(capabilityMock.mcp.map((item) => [item.id, item.enabled])),
  )

  return (
    <CapabilitySection
      id="mcp"
      index="02"
      eyebrow="MODEL CONTEXT PROTOCOL"
      title="MCP"
      summary="服务、权限与最近调用"
      icon="mcp"
      tone="blue"
    >
      <div className="capability-list">
        {capabilityMock.mcp.map((item) => (
          <article key={item.id} className="capability-list-item">
            <div className="capability-item-main">
              <span className="capability-item-icon">
                <CapabilityIcon name="mcp" />
              </span>
              <div>
                <strong>{item.name}</strong>
                <p>{item.description}</p>
              </div>
              <CapabilitySwitch
                checked={enabled[item.id]}
                label={`${enabled[item.id] ? '关闭' : '开启'} ${item.name}`}
                onChange={() =>
                  setEnabled((current) => ({
                    ...current,
                    [item.id]: !current[item.id],
                  }))
                }
              />
            </div>
            <div className="capability-item-meta">
              <span>
                <CapabilityIcon name="shield" />
                权限：{item.permission}
              </span>
              <span>
                <CapabilityIcon name="clock" />
                {item.recentCall}
              </span>
            </div>
          </article>
        ))}
      </div>
    </CapabilitySection>
  )
}

export default McpSection
