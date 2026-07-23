import { useState } from 'react'
import FocusCard from '../components/workspace/FocusCard'
import QuickActions from '../components/workspace/QuickActions'
import RecentChanges from '../components/workspace/RecentChanges'
import TodayOverview from '../components/workspace/TodayOverview'
import UniversalComposer from '../components/workspace/UniversalComposer'
import WorkspaceIcon from '../components/workspace/WorkspaceIcon'
import { workspaceMock } from '../data/workspaceMock'
import LifeCalendarPage from './LifeCalendarPage'

function WorkspacePage() {
  const [showCalendar, setShowCalendar] = useState(false)

  if (showCalendar) {
    return <LifeCalendarPage onBack={() => setShowCalendar(false)} />
  }

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <span className="workspace-avatar" aria-hidden="true">
          {workspaceMock.agent.avatar}
        </span>
        <h1>{workspaceMock.agent.name}</h1>
        <button className="workspace-calendar-entry" type="button" onClick={() => setShowCalendar(true)}>
          <WorkspaceIcon name="calendar" />
          生活月历
        </button>
      </header>

      <div className="workspace-body">
        <FocusCard {...workspaceMock.focus} />
        <TodayOverview items={workspaceMock.today} />
        <RecentChanges items={workspaceMock.changes} />
        <QuickActions items={workspaceMock.quickActions} />
      </div>

      <UniversalComposer />
    </div>
  )
}

export default WorkspacePage
