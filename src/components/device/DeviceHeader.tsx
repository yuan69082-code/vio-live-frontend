import DeviceIcon from './DeviceIcon'

type DeviceHeaderProps = {
  title: string
  subtitle: string
  onBack: () => void
  detail?: boolean
}

function DeviceHeader({ title, subtitle, onBack, detail = false }: DeviceHeaderProps) {
  return (
    <header className="device-header">
      <button type="button" onClick={onBack} aria-label={detail ? '返回设备列表' : '返回能力中心'}>
        <DeviceIcon name="back" />
      </button>
      <div>
        <span>VIO LIVE · DEVICE</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <span className="device-header-badge">仅模拟</span>
    </header>
  )
}

export default DeviceHeader
