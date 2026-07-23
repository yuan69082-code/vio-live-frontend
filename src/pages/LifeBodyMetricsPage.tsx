import { useEffect, useState } from 'react'
import BodyAiActions from '../components/body-metrics/BodyAiActions'
import BodyMetricsHeader from '../components/body-metrics/BodyMetricsHeader'
import BodyMetricsIcon from '../components/body-metrics/BodyMetricsIcon'
import BodyRecordForm from '../components/body-metrics/BodyRecordForm'
import CurrentBodyStatus from '../components/body-metrics/CurrentBodyStatus'
import WeightTrend from '../components/body-metrics/WeightTrend'
import { bodyMetricsMockRecords, type BodyMeasurementRecord } from '../data/bodyMetricsMock'

function LifeBodyMetricsPage({ onBack }: { onBack: () => void }) {
  const [records, setRecords] = useState<BodyMeasurementRecord[]>(() => bodyMetricsMockRecords.map((record) => ({ ...record })))
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')
  const current = records.at(-1) ?? bodyMetricsMockRecords[0]

  useEffect(() => {
    document.title = '体重与三围 | Vio Live'
    return () => { document.title = '工作台 | Vio Live' }
  }, [])

  const saveRecord = (draft: Pick<BodyMeasurementRecord, 'weight' | 'waist' | 'chest' | 'hips' | 'note'>) => {
    setRecords((items) => [...items, { ...draft, id: `local-body-${Date.now()}`, date: '2026-07-24', dateLabel: '7月24日' }])
    setAdding(false)
    setNotice('今日记录已添加 · 本地模拟')
  }

  return (
    <div className="life-body-metrics-page">
      <BodyMetricsHeader onBack={onBack} />
      <section className="life-body-metrics-body" aria-label="体重与三围记录内容">
        <div className="body-metrics-safety"><BodyMetricsIcon name="shield" /><p><strong>个人记录模式</strong>数据均为模拟，仅用于界面演示，不提供医疗诊断或健康结论。</p></div>
        <CurrentBodyStatus current={current} />
        <WeightTrend records={records} />
        {adding ? <BodyRecordForm current={current} onClose={() => setAdding(false)} onSave={saveRecord} /> : <button className="body-add-record" type="button" onClick={() => { setAdding(true); setNotice('') }}><span><BodyMetricsIcon name="plus" /></span><div><small>TODAY · 7月24日</small><strong>添加今日记录</strong><p>体重、腰围、胸围、臀围与备注</p></div></button>}
        <BodyAiActions onAction={setNotice} />
        <p className="life-body-metrics-notice" aria-live="polite">{notice || '\u00a0'}</p>
      </section>
    </div>
  )
}

export default LifeBodyMetricsPage
