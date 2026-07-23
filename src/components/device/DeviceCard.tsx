import type { ConnectedDevice } from '../../data/deviceMock'
import DeviceIcon from './DeviceIcon'

type DeviceCardProps = {
  device: ConnectedDevice
  stopped: boolean
  revoked: boolean
  onAction: (action: string) => void
  onOpen: () => void
  onStop: () => void
  onRevoke: () => void
}

function DeviceCard({ device, stopped, revoked, onAction, onOpen, onStop, onRevoke }: DeviceCardProps) {
  const status = stopped ? '已停止 · 模拟' : revoked ? '权限已撤销 · 模拟' : device.status

  return (
    <article className={`device-card${device.dangerous ? ' is-dangerous' : ''}`}>
      <div className="device-card-heading">
        <span className="device-card-icon"><DeviceIcon name={device.icon} /></span>
        <div>
          <small>{device.category}</small>
          <h2>{device.name}</h2>
          <p><DeviceIcon name="location" />{device.room}</p>
        </div>
        <span className={`device-status device-status-${device.statusTone}`}>
          <i aria-hidden="true" />{status}
        </span>
      </div>

      <dl className="device-parameters">
        {device.parameters.map((parameter) => (
          <div key={parameter.label}>
            <dt>{parameter.label}</dt>
            <dd>{parameter.value}</dd>
          </div>
        ))}
      </dl>

      <div className="device-card-actions">
        {device.actions.map((action) => (
          <button type="button" key={action.id} onClick={() => onAction(action.label)}>
            <DeviceIcon name={action.id === 'toggle' || action.id === 'pause' ? 'power' : 'activity'} />
            {action.label}
          </button>
        ))}
        <button className="device-detail-button" type="button" onClick={onOpen}>
          查看详情<DeviceIcon name="chevron" />
        </button>
      </div>

      {device.dangerous ? (
        <div className="device-danger-actions" aria-label="危险设备操作">
          <div>
            <DeviceIcon name="shield" />
            <span><strong>高风险设备</strong><small>操作只改变当前演示状态</small></span>
          </div>
          <button type="button" onClick={onStop} disabled={stopped}>
            <DeviceIcon name="stop" />{stopped ? '已停止' : '立即停止'}
          </button>
          <button type="button" onClick={onRevoke} disabled={revoked}>
            <DeviceIcon name="revoke" />{revoked ? '已撤销' : '撤销权限'}
          </button>
        </div>
      ) : null}
    </article>
  )
}

export default DeviceCard
