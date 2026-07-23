import type { CalendarEvent } from '../../data/calendarMock'
import { calendarEventLabels, calendarMockNotes } from '../../data/calendarMock'
import CalendarIcon from './CalendarIcon'

function formatSelectedDate(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()]
  return `${year}年${month}月${day}日 · ${weekday}`
}

function DateDetails({ dateKey, events, onAdd }: { dateKey: string; events: CalendarEvent[]; onAdd: () => void }) {
  return (
    <section className="calendar-date-details" aria-labelledby="calendar-detail-title">
      <div className="calendar-detail-heading"><div><small>SELECTED DATE</small><h2 id="calendar-detail-title">{formatSelectedDate(dateKey)}</h2></div><span>{events.length} 条记录</span></div>
      <div className="calendar-event-list">
        {events.length ? events.map((event) => (
          <article className={`calendar-event calendar-event-${event.type}`} key={event.id}>
            <span><CalendarIcon name={event.type} /></span>
            <div><small>{calendarEventLabels[event.type]}</small><strong>{event.title}</strong><p>{event.detail}</p></div>
          </article>
        )) : <div className="calendar-empty-day"><CalendarIcon name="calendar" /><strong>这一天还没有记录</strong><p>可以添加一条只存在于当前页面的模拟记录。</p></div>}
      </div>
      <div className="calendar-note"><span><CalendarIcon name="note" /></span><div><small>备注</small><p>{calendarMockNotes[dateKey] ?? '暂无备注，今天适合留下一点简单感受。'}</p></div></div>
      <button className="calendar-add-button" type="button" onClick={onAdd}><CalendarIcon name="plus" />添加记录</button>
    </section>
  )
}

export default DateDetails
