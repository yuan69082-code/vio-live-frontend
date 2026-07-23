import type { BodyMeasurementRecord } from '../../data/bodyMetricsMock'
import BodyMetricsIcon from './BodyMetricsIcon'

function WeightTrend({ records }: { records: BodyMeasurementRecord[] }) {
  const visible = records.slice(-7)
  const weights = visible.map((record) => record.weight)
  const minimum = Math.min(...weights) - 0.45
  const maximum = Math.max(...weights) + 0.45
  const width = 300
  const height = 112
  const padX = 13
  const padY = 14
  const range = maximum - minimum || 1
  const points = visible.map((record, index) => {
    const x = padX + (index * (width - padX * 2)) / Math.max(visible.length - 1, 1)
    const y = padY + ((maximum - record.weight) / range) * (height - padY * 2)
    return { ...record, x, y }
  })
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ')
  const areaPoints = `${padX},${height - padY} ${linePoints} ${width - padX},${height - padY}`

  return (
    <section className="body-trend-card" aria-labelledby="body-trend-title">
      <div className="body-section-heading"><span><BodyMetricsIcon name="trend" /></span><div><small>WEIGHT TREND</small><h2 id="body-trend-title">体重变化</h2><p>最近 {visible.length} 次模拟记录</p></div><em>kg</em></div>
      <div className="body-trend-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`体重由 ${visible[0].weight} 千克变化至 ${visible.at(-1)?.weight} 千克`}>
          <defs><linearGradient id="body-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9c7ad5" stopOpacity=".28" /><stop offset="1" stopColor="#9c7ad5" stopOpacity=".02" /></linearGradient></defs>
          <path className="body-trend-grid" d="M13 25H287M13 56H287M13 87H287" />
          <polygon points={areaPoints} fill="url(#body-trend-fill)" />
          <polyline className="body-trend-line" points={linePoints} />
          {points.map((point, index) => <g key={point.id}><circle className="body-trend-dot-halo" cx={point.x} cy={point.y} r="6" /><circle className="body-trend-dot" cx={point.x} cy={point.y} r="2.7" />{index === points.length - 1 ? <text x={point.x - 4} y={Math.max(point.y - 10, 10)} textAnchor="end">{point.weight}</text> : null}</g>)}
        </svg>
        <div className="body-trend-dates" aria-hidden="true">{visible.map((record) => <span key={record.id}>{record.date.slice(5).replace('-', '/')}</span>)}</div>
      </div>
      <div className="body-record-list" aria-label="日期记录">
        {records.slice(-4).reverse().map((record) => (
          <article key={record.id}>
            <span><BodyMetricsIcon name="calendar" /></span>
            <div><strong>{record.dateLabel}</strong><p>{record.note}</p></div>
            <div><strong>{record.weight} kg</strong><small>胸 {record.chest} · 腰 {record.waist} · 臀 {record.hips} cm</small></div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default WeightTrend
