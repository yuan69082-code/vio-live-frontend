import { useEffect, useMemo, useState } from 'react'
import DeviceCard from '../components/device/DeviceCard'
import DeviceDetail from '../components/device/DeviceDetail'
import DeviceHeader from '../components/device/DeviceHeader'
import DeviceIcon from '../components/device/DeviceIcon'
import UnconnectedDevices from '../components/device/UnconnectedDevices'
import { deviceMock } from '../data/deviceMock'

function DeviceCenterPage({ onBack }: { onBack: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [stoppedIds, setStoppedIds] = useState<string[]>([])
  const [revokedIds, setRevokedIds] = useState<string[]>([])
  const selectedDevice = useMemo(
    () => deviceMock.connected.find((device) => device.id === selectedId),
    [selectedId],
  )

  useEffect(() => {
    document.title = `${selectedDevice?.name ?? '设备中心'} | Vio Live`
    return () => { document.title = '能力 | Vio Live' }
  }, [selectedDevice?.name])

  const stopDevice = (id: string) => {
    setStoppedIds((current) => current.includes(id) ? current : [...current, id])
    setNotice('危险设备已立即停止 · 本地模拟')
  }

  const revokeDevice = (id: string) => {
    setRevokedIds((current) => current.includes(id) ? current : [...current, id])
    setNotice('危险设备权限已撤销 · 本地模拟')
  }

  if (selectedDevice) {
    return (
      <DeviceDetail
        device={selectedDevice}
        stopped={stoppedIds.includes(selectedDevice.id)}
        revoked={revokedIds.includes(selectedDevice.id)}
        onBack={() => setSelectedId(null)}
        onStop={() => stopDevice(selectedDevice.id)}
        onRevoke={() => revokeDevice(selectedDevice.id)}
      />
    )
  }

  return (
    <div className="device-page">
      <DeviceHeader title="设备中心" subtitle="设备、家电与权限 · 本地演示" onBack={onBack} />

      <section className="device-body" aria-label="设备中心内容">
        <div className="device-summary">
          <div><span>{deviceMock.summary.connected}</span><small>已连接</small></div>
          <div><span>{deviceMock.summary.active}</span><small>运行中</small></div>
          <div><span>{deviceMock.summary.needsAttention}</span><small>需注意</small></div>
          <p><DeviceIcon name="shield" />所有设备与操作均为模拟，不会连接或控制真实设备。</p>
        </div>

        <section className="connected-section" aria-labelledby="connected-title">
          <div className="device-section-title">
            <span><DeviceIcon name="devices" /></span>
            <div><small>CONNECTED DEVICES</small><h2 id="connected-title">已连接设备</h2><p>状态与参数来自本地模拟数据</p></div>
          </div>
          <div className="device-card-list">
            {deviceMock.connected.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                stopped={stoppedIds.includes(device.id)}
                revoked={revokedIds.includes(device.id)}
                onAction={(action) => setNotice(`${device.name} · ${action} · 本地模拟`)}
                onOpen={() => { setSelectedId(device.id); setNotice('') }}
                onStop={() => stopDevice(device.id)}
                onRevoke={() => revokeDevice(device.id)}
              />
            ))}
          </div>
        </section>

        <UnconnectedDevices onAction={setNotice} />
        <p className="device-notice" aria-live="polite">{notice || '\u00a0'}</p>
      </section>
    </div>
  )
}

export default DeviceCenterPage
