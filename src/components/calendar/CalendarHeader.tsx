import CalendarIcon from './CalendarIcon'

function CalendarHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="calendar-header">
      <button type="button" onClick={onBack} aria-label="返回工作台"><CalendarIcon name="back" /></button>
      <div><span>VIO LIVE · LIFE</span><h1>生活月历</h1><p>纪念、周期与亲密记录 · 本地演示</p></div>
      <span className="calendar-header-badge">仅模拟</span>
    </header>
  )
}

export default CalendarHeader
