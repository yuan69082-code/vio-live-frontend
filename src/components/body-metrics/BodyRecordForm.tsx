import { useState, type FormEvent } from 'react'
import type { BodyMeasurementRecord } from '../../data/bodyMetricsMock'
import BodyMetricsIcon from './BodyMetricsIcon'

type RecordDraft = Pick<BodyMeasurementRecord, 'weight' | 'waist' | 'chest' | 'hips' | 'note'>

function BodyRecordForm({ current, onClose, onSave }: { current: BodyMeasurementRecord; onClose: () => void; onSave: (draft: RecordDraft) => void }) {
  const [weight, setWeight] = useState(String(current.weight))
  const [waist, setWaist] = useState(String(current.waist))
  const [chest, setChest] = useState(String(current.chest))
  const [hips, setHips] = useState(String(current.hips))
  const [note, setNote] = useState('')
  const values = [weight, waist, chest, hips].map(Number)
  const canSave = values.every((value) => Number.isFinite(value) && value > 0)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return
    onSave({ weight: values[0], waist: values[1], chest: values[2], hips: values[3], note: note.trim() || '今日模拟记录。' })
  }

  return (
    <form className="body-record-form" onSubmit={submit} aria-labelledby="body-record-form-title">
      <div className="body-record-form-heading"><div><small>ADD RECORD · 7月24日</small><h2 id="body-record-form-title">添加今日记录</h2></div><button type="button" onClick={onClose} aria-label="关闭添加记录"><BodyMetricsIcon name="close" /></button></div>
      <div className="body-record-fields">
        <label><span>今日体重<small>kg</small></span><input type="number" inputMode="decimal" min="1" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
        <label><span>腰围<small>cm</small></span><input type="number" inputMode="decimal" min="1" step="0.1" value={waist} onChange={(event) => setWaist(event.target.value)} /></label>
        <label><span>胸围<small>cm</small></span><input type="number" inputMode="decimal" min="1" step="0.1" value={chest} onChange={(event) => setChest(event.target.value)} /></label>
        <label><span>臀围<small>cm</small></span><input type="number" inputMode="decimal" min="1" step="0.1" value={hips} onChange={(event) => setHips(event.target.value)} /></label>
      </div>
      <label className="body-record-note"><span>备注（可选）</span><textarea value={note} maxLength={80} placeholder="记录今天的感受或测量条件…" onChange={(event) => setNote(event.target.value)} /><small>{note.length} / 80</small></label>
      <button className="body-save-record" type="submit" disabled={!canSave}><BodyMetricsIcon name="save" />保存模拟记录</button>
    </form>
  )
}

export default BodyRecordForm
