import CapabilityIcon from './CapabilityIcon'

function CapabilityHeader() {
  return (
    <header className="capability-header">
      <span className="capability-header-icon">
        <CapabilityIcon name="spark" />
      </span>
      <div>
        <span>CAPABILITY CENTER · R6 UNIFIED EXECUTION</span>
        <h1>能力中心</h1>
        <p>真实配置、显式执行、恢复与统一历史</p>
      </div>
      <span className="capability-header-badge">服务端事实</span>
    </header>
  )
}

export default CapabilityHeader
