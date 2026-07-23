import { useState } from 'react'
import FocusCard from '../components/workspace/FocusCard'
import QuickActions from '../components/workspace/QuickActions'
import RecentChanges from '../components/workspace/RecentChanges'
import TodayOverview from '../components/workspace/TodayOverview'
import UniversalComposer from '../components/workspace/UniversalComposer'
import WorkspaceIcon from '../components/workspace/WorkspaceIcon'
import { workspaceMock } from '../data/workspaceMock'
import LifeBodyMetricsPage from './LifeBodyMetricsPage'
import LifeCalendarPage from './LifeCalendarPage'
import LifeLedgerPage from './LifeLedgerPage'

type LifeView = 'workspace' | 'calendar' | 'ledger' | 'body-metrics'

function WorkspacePage() {
  const [lifeView, setLifeView] = useState<LifeView>('workspace')

  if (lifeView === 'calendar') {
    return <LifeCalendarPage onBack={() => setLifeView('workspace')} />
  }

  if (lifeView === 'ledger') {
    return <LifeLedgerPage onBack={() => setLifeView('workspace')} />
  }

  if (lifeView === 'body-metrics') {
    return <LifeBodyMetricsPage onBack={() => setLifeView('workspace')} />
  }

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <span className="workspace-avatar" aria-hidden="true">
          {workspaceMock.agent.avatar}
        </span>
        <h1>{workspaceMock.agent.name}</h1>
        <div className="workspace-life-entries" aria-label="生活管理入口">
          <button className="workspace-calendar-entry" type="button" onClick={() => setLifeView('calendar')}>
            <WorkspaceIcon name="calendar" />月历
          </button>
          <button className="workspace-calendar-entry" type="button" onClick={() => setLifeView('ledger')}>
            <WorkspaceIcon name="ledger" />管账
          </button>
          <button className="workspace-calendar-entry" type="button" onClick={() => setLifeView('body-metrics')}>
            <WorkspaceIcon name="body" />体重
          </button>
        </div>
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
