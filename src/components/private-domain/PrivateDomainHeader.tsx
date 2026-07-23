import PrivateDomainIcon from './PrivateDomainIcon'

function PrivateDomainHeader() {
  return (
    <header className="private-domain-header">
      <span className="private-domain-header-icon">
        <PrivateDomainIcon name="shield" />
      </span>
      <div>
        <span>VIO PRIVATE SPACE · 本地模拟</span>
        <h1>AI 私域</h1>
        <p>Vio 独立保留的内部空间</p>
      </div>
      <span className="private-domain-header-badge">仅限申请</span>
    </header>
  )
}

export default PrivateDomainHeader
