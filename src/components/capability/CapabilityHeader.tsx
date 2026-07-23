import CapabilityIcon from './CapabilityIcon'

function CapabilityHeader() {
  return (
    <header className="capability-header">
      <span className="capability-header-icon">
        <CapabilityIcon name="spark" />
      </span>
      <div>
        <span>CAPABILITY CENTER · 本地模拟</span>
        <h1>能力中心</h1>
        <p>统一查看模型、服务、技能与设备</p>
      </div>
      <span className="capability-header-badge">仅 UI</span>
    </header>
  )
}

export default CapabilityHeader
