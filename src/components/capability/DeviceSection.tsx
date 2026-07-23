import { useState } from 'react'
import { capabilityMock } from '../../data/capabilityMock'
import CapabilityIcon from './CapabilityIcon'
import CapabilitySection from './CapabilitySection'

function DeviceSection() {
  const [managedId, setManagedId] = useState<string | null>(null)

  return (
    <CapabilitySection
      id="device"
      index="06"
      eyebrow="PHONE / DEVICES"
      title="手机 / 设备入口"
      summary={`${capabilityMock.devices.length} 台已连接设备`}
      icon="device"
      tone="slate"
    >
      <div className="capability-list">
        {capabilityMock.devices.map((item) => (
          <article key={item.id} className="capability-device-item">
            <span className="capability-item-icon">
              <CapabilityIcon name={item.type} />
            </span>
            <div>
              <strong>{item.name}</strong>
              <p>{item.description}</p>
              <span>
                <CapabilityIcon name="shield" />
                权限：{item.permission}
              </span>
            </div>
            <div>
              <span className="capability-device-status">
                <i aria-hidden="true" />
                已连接
              </span>
              <button
                type="button"
                onClick={() => setManagedId(item.id)}
              >
                <CapabilityIcon name="settings" />
                {managedId === item.id ? '管理中' : '管理'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </CapabilitySection>
  )
}

export default DeviceSection
