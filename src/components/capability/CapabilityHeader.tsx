import CapabilityIcon from './CapabilityIcon'

function CapabilityHeader() {
  return (
    <header className="capability-header">
      <span className="capability-header-icon">
        <CapabilityIcon name="spark" />
      </span>
      <div>
        <span>CAPABILITY CENTER · 服务端配置</span>
        <h1>能力中心</h1>
        <p>模型 / API 已接线；其他能力分组仍为原型</p>
      </div>
      <span className="capability-header-badge">混合状态</span>
    </header>
  )
}

export default CapabilityHeader
