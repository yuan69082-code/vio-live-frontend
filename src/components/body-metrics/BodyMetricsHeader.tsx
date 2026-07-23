import BodyMetricsIcon from './BodyMetricsIcon'

function BodyMetricsHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="body-metrics-header">
      <button type="button" onClick={onBack} aria-label="返回工作台"><BodyMetricsIcon name="back" /></button>
      <div><span>VIO LIVE · LIFE</span><h1>体重与三围</h1><p>轻量记录 · 只看自己的变化</p></div>
      <span className="body-metrics-header-badge">非医疗</span>
    </header>
  )
}

export default BodyMetricsHeader
