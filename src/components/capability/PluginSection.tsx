import { useState } from 'react'
import { capabilityMock } from '../../data/capabilityMock'
import CapabilityIcon from './CapabilityIcon'
import CapabilitySection from './CapabilitySection'

function PluginSection() {
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <CapabilitySection
      id="plugin"
      index="04"
      eyebrow="EXTENSIONS"
      title="插件"
      summary="版本、更新与卸载入口"
      icon="plugin"
      tone="aqua"
    >
      <div className="capability-list">
        {capabilityMock.plugins.map((item) => (
          <article key={item.id} className="capability-plugin-item">
            <div>
              <span className="capability-item-icon">
                <CapabilityIcon name="plugin" />
              </span>
              <div>
                <strong>{item.name}</strong>
                <p>{item.description}</p>
              </div>
              <span className="capability-version">{item.version}</span>
            </div>
            <div className="capability-plugin-actions">
              <button
                type="button"
                disabled={!item.updateAvailable}
                onClick={() => setNotice(`${item.name} 更新入口 · 模拟`)}
              >
                <CapabilityIcon name="update" />
                {item.updateAvailable ? '更新' : '已是最新'}
              </button>
              <button
                type="button"
                onClick={() => setNotice(`${item.name} 卸载入口 · 模拟`)}
              >
                <CapabilityIcon name="trash" />
                卸载
              </button>
            </div>
          </article>
        ))}
      </div>
      {notice && <p className="capability-inline-notice">{notice}</p>}
    </CapabilitySection>
  )
}

export default PluginSection
