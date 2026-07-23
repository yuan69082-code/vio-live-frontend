import { useState } from 'react'
import type { CalendarEvent, CalendarEventType } from '../../data/calendarMock'
import { calendarEventLabels } from '../../data/calendarMock'
import CalendarIcon from './CalendarIcon'

const defaultTitles: Record<CalendarEventType, string> = {
  anniversary: '新的纪念日',
  period: '生理期记录',
  intimacy: '亲密记录',
}

function AddRecordPanel({ dateKey, onClose, onSave }: { dateKey: string; onClose: () => void; onSave: (event: CalendarEvent) => void }) {
  const [type, setType] = useState<CalendarEventType>('anniversary')
  const [note, setNote] = useState('')
  const dayLabel = `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`

  const save = () => {
    onSave({ id: `local-${dateKey}-${Date.now()}`, type, title: defaultTitles[type], detail: note.trim() || '本地新增的模拟记录。' })
  }

  return (
    <section className="calendar-record-panel" aria-labelledby="add-record-title">
      <div className="calendar-record-heading"><div><small>ADD RECORD · {dayLabel}</small><h2 id="add-record-title">添加记录</h2></div><button type="button" onClick={onClose} aria-label="关闭添加记录"><CalendarIcon name="close" /></button></div>
      <div className="calendar-record-types" role="group" aria-label="记录类型">
        {(Object.keys(calendarEventLabels) as CalendarEventType[]).map((item) => <button className={type === item ? `is-active type-${item}` : ''} type="button" key={item} aria-pressed={type === item} onClick={() => setType(item)}><CalendarIcon name={item} />{calendarEventLabels[item]}</button>)}
      </div>
      <label className="calendar-record-note"><span>备注（可选）</span><textarea value={note} maxLength={80} placeholder="写下一点想记住的内容…" onChange={(event) => setNote(event.target.value)} /><small>{note.length} / 80</small></label>
      <button className="calendar-save-record" type="button" onClick={save}><CalendarIcon name="check" />保存模拟记录</button>
    </section>
  )
}

export default AddRecordPanel
