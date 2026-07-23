import type { CalendarEvent, CalendarEventType } from '../../data/calendarMock'
import { calendarEventLabels } from '../../data/calendarMock'
import CalendarIcon from './CalendarIcon'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

function dateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

type MonthCalendarProps = {
  month: Date
  selectedKey: string
  events: Record<string, CalendarEvent[]>
  onChangeMonth: (offset: number) => void
  onSelectDate: (key: string) => void
}

function MonthCalendar({ month, selectedKey, events, onChangeMonth, onSelectDate }: MonthCalendarProps) {
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const mondayBasedStart = (new Date(year, monthIndex, 1).getDay() + 6) % 7
  const cells = [...Array(mondayBasedStart).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]

  return (
    <section className="month-calendar" aria-labelledby="month-calendar-title">
      <div className="calendar-month-toolbar">
        <button type="button" onClick={() => onChangeMonth(-1)} aria-label="上一个月"><CalendarIcon name="previous" /></button>
        <div><small>MONTHLY VIEW</small><h2 id="month-calendar-title">{year}年 {monthIndex + 1}月</h2></div>
        <button type="button" onClick={() => onChangeMonth(1)} aria-label="下一个月"><CalendarIcon name="next" /></button>
      </div>

      <div className="calendar-legend" aria-label="事件类型图例">
        {(Object.keys(calendarEventLabels) as CalendarEventType[]).map((type) => <span key={type} className={`calendar-legend-${type}`}><i />{calendarEventLabels[type]}</span>)}
      </div>

      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">
        {cells.map((day, index) => {
          if (day === null) return <span className="calendar-empty" key={`empty-${index}`} />
          const key = dateKey(year, monthIndex, day)
          const dateEvents = events[key] ?? []
          const eventTypes = [...new Set(dateEvents.map((event) => event.type))]
          const isSelected = selectedKey === key
          const isMockToday = key === '2026-07-23'
          return (
            <button className={`${isSelected ? 'is-selected ' : ''}${isMockToday ? 'is-today' : ''}`} type="button" key={key} onClick={() => onSelectDate(key)} aria-pressed={isSelected} aria-label={`${year}年${monthIndex + 1}月${day}日${dateEvents.length ? `，${dateEvents.map((event) => calendarEventLabels[event.type]).join('、')}` : ''}`}>
              <span>{day}</span>
              <span className="calendar-markers">{eventTypes.map((type) => <i className={`calendar-marker-${type}`} key={type} />)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default MonthCalendar
