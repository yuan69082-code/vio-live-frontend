import { deviceMock } from '../../data/deviceMock'
import DeviceIcon from './DeviceIcon'

function UnconnectedDevices({ onAction }: { onAction: (message: string) => void }) {
  return (
    <section className="unconnected-section" aria-labelledby="unconnected-title">
      <div className="device-section-title">
        <span><DeviceIcon name="plus" /></span>
        <div>
          <small>NOT CONNECTED</small>
          <h2 id="unconnected-title">未连接设备</h2>
          <p>只展示通用类别，不代表已支持任何真实品牌。</p>
        </div>
      </div>

      <div className="unconnected-list">
        {deviceMock.unconnected.map((item) => (
          <article key={item.id}>
            <span><DeviceIcon name={item.icon} /></span>
            <div>
              <strong>{item.name}</strong>
              <p>{item.description}</p>
              <small>{item.requirement}</small>
            </div>
            <button type="button" onClick={() => onAction(`${item.action}入口 · 本地模拟`)}>
              {item.action}
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

export default UnconnectedDevices
