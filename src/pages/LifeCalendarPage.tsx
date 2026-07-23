import { useEffect, useMemo, useState } from 'react'
import AddRecordPanel from '../components/calendar/AddRecordPanel'
import CalendarAiActions from '../components/calendar/CalendarAiActions'
import CalendarHeader from '../components/calendar/CalendarHeader'
import DateDetails from '../components/calendar/DateDetails'
import MonthCalendar from '../components/calendar/MonthCalendar'
import { calendarMockEvents, type CalendarEvent } from '../data/calendarMock'

function firstDayKey(month: Date) {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`
}

function LifeCalendarPage({ onBack }: { onBack: () => void }) {
  const [month, setMonth] = useState(() => new Date(2026, 6, 1))
  const [selectedKey, setSelectedKey] = useState('2026-07-23')
  const [events, setEvents] = useState<Record<string, CalendarEvent[]>>(() =>
    Object.fromEntries(Object.entries(calendarMockEvents).map(([key, items]) => [key, [...items]])),
  )
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')
  const selectedEvents = useMemo(() => events[selectedKey] ?? [], [events, selectedKey])

  useEffect(() => {
    document.title = '生活月历 | Vio Live'
    return () => { document.title = '工作台 | Vio Live' }
  }, [])

  const changeMonth = (offset: number) => {
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + offset, 1)
    setMonth(nextMonth)
    setSelectedKey(firstDayKey(nextMonth))
    setAdding(false)
    setNotice('')
  }

  const selectDate = (key: string) => {
    setSelectedKey(key)
    setAdding(false)
    setNotice('')
  }

  const addRecord = (event: CalendarEvent) => {
    setEvents((current) => ({ ...current, [selectedKey]: [...(current[selectedKey] ?? []), event] }))
    setAdding(false)
    setNotice(`${event.title}已添加 · 本地模拟`)
  }

  return (
    <div className="life-calendar-page">
      <CalendarHeader onBack={onBack} />
      <section className="life-calendar-body" aria-label="生活月历内容">
        <MonthCalendar month={month} selectedKey={selectedKey} events={events} onChangeMonth={changeMonth} onSelectDate={selectDate} />
        <DateDetails dateKey={selectedKey} events={selectedEvents} onAdd={() => setAdding(true)} />
        {adding ? <AddRecordPanel dateKey={selectedKey} onClose={() => setAdding(false)} onSave={addRecord} /> : null}
        <CalendarAiActions onAction={setNotice} />
        <p className="life-calendar-notice" aria-live="polite">{notice || '\u00a0'}</p>
      </section>
    </div>
  )
}

export default LifeCalendarPage
