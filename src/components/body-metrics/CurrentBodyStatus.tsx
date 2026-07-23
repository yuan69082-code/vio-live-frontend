import { bodyMetricsProfile, type BodyMeasurementRecord } from '../../data/bodyMetricsMock'
import BodyMetricsIcon from './BodyMetricsIcon'

function CurrentBodyStatus({ current }: { current: BodyMeasurementRecord }) {
  const remaining = Math.max(current.weight - bodyMetricsProfile.targetWeight, 0).toFixed(1)
  const measurements = [
    { label: '胸围', value: current.chest },
    { label: '腰围', value: current.waist },
    { label: '臀围', value: current.hips },
  ]

  return (
    <section className="body-status-card" aria-labelledby="body-status-title">
      <div className="body-status-heading">
        <div><small>CURRENT SNAPSHOT</small><h2 id="body-status-title">当前状态</h2></div>
        <span><BodyMetricsIcon name="calendar" />{current.dateLabel}</span>
      </div>
      <div className="body-primary-metrics">
        <div className="body-current-weight"><span><BodyMetricsIcon name="scale" /></span><section><small>当前体重</small><strong>{current.weight}<em>kg</em></strong></section></div>
        <div><span><BodyMetricsIcon name="target" /></span><section><small>目标体重</small><strong>{bodyMetricsProfile.targetWeight}<em>kg</em></strong></section></div>
        <div><span><BodyMetricsIcon name="height" /></span><section><small>身高</small><strong>{bodyMetricsProfile.height}<em>cm</em></strong></section></div>
      </div>
      <div className="body-goal-row"><span>距离个人目标</span><strong>{remaining} kg</strong></div>
      <div className="body-measurements" aria-label="当前三围数据">
        {measurements.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}<small>cm</small></strong></div>)}
      </div>
    </section>
  )
}

export default CurrentBodyStatus
