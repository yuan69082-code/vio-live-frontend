import { useEffect, useState } from 'react'
import ConversationPage from './ConversationPage'
import ContinuityPage from './ContinuityPage'
import WorkspacePage from './WorkspacePage'

type NavigationKey =
  | 'workspace'
  | 'conversation'
  | 'continuity'
  | 'private'
  | 'capability'
  | 'profile'

type IconName = 'grid' | 'chat' | 'continuity' | 'lock' | 'spark' | 'profile'

type NavigationItem = {
  key: NavigationKey
  label: string
  icon: IconName
  index: string
}

const navigationItems: NavigationItem[] = [
  { key: 'workspace', label: '工作台', icon: 'grid', index: '01' },
  { key: 'conversation', label: '对话', icon: 'chat', index: '02' },
  { key: 'continuity', label: '连续性', icon: 'continuity', index: '03' },
  { key: 'private', label: 'AI 私域', icon: 'lock', index: '04' },
  { key: 'capability', label: '能力', icon: 'spark', index: '05' },
  { key: 'profile', label: '我的', icon: 'profile', index: '06' },
]

function NavigationIcon({ name }: { name: IconName }) {
  const sharedProps = {
    'aria-hidden': true,
    className: 'navigation-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'grid') {
    return (
      <svg {...sharedProps}>
        <rect x="4" y="4" width="6" height="6" rx="1.7" />
        <rect x="14" y="4" width="6" height="6" rx="1.7" />
        <rect x="4" y="14" width="6" height="6" rx="1.7" />
        <rect x="14" y="14" width="6" height="6" rx="1.7" />
      </svg>
    )
  }

  if (name === 'chat') {
    return (
      <svg {...sharedProps}>
        <path d="M5 17.5 3.8 20l3.4-1A8.5 8.5 0 1 0 4 12.3c0 1.9.6 3.7 1.7 5.1Z" />
        <path d="M8.2 11.8h7.6M8.2 15h4.8" />
      </svg>
    )
  }

  if (name === 'continuity') {
    return (
      <svg {...sharedProps}>
        <path d="M8.1 8.2C5.7 8.2 4 9.8 4 12s1.7 3.8 4.1 3.8c3.9 0 4.1-7.6 7.8-7.6 2.4 0 4.1 1.6 4.1 3.8s-1.7 3.8-4.1 3.8" />
      </svg>
    )
  }

  if (name === 'lock') {
    return (
      <svg {...sharedProps}>
        <rect x="5" y="10" width="14" height="10" rx="3" />
        <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2.5" />
      </svg>
    )
  }

  if (name === 'spark') {
    return (
      <svg {...sharedProps}>
        <path d="M12 3.5c.7 4.6 2.4 6.3 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.7 6.3-2.4 7-7Z" />
        <path d="M18.7 16.2c.2 1.5.8 2.1 2.3 2.3-1.5.2-2.1.8-2.3 2.3-.2-1.5-.8-2.1-2.3-2.3 1.5-.2 2.1-.8 2.3-2.3Z" />
      </svg>
    )
  }

  return (
    <svg {...sharedProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.8 20c.6-4 3.2-6.2 7.2-6.2s6.6 2.2 7.2 6.2" />
    </svg>
  )
}

function MainNavigation() {
  const [activeKey, setActiveKey] = useState<NavigationKey>('workspace')
  const activeItem =
    navigationItems.find((item) => item.key === activeKey) ?? navigationItems[0]

  useEffect(() => {
    document.title = `${activeItem.label} | Vio Live`
  }, [activeItem.label])

  return (
    <main className="main-shell">
      <div aria-hidden="true" className="main-ambient main-ambient-top" />
      <div aria-hidden="true" className="main-ambient main-ambient-bottom" />

      <section className="main-frame" aria-label="Vio Live 主导航框架">
        <div
          className={`main-content${activeKey === 'workspace' ? ' workspace-content' : ''}${activeKey === 'conversation' ? ' conversation-content' : ''}${activeKey === 'continuity' ? ' continuity-content' : ''}`}
          role="tabpanel"
          aria-labelledby={`navigation-${activeItem.key}`}
        >
          {activeKey === 'workspace' ? (
            <WorkspacePage />
          ) : activeKey === 'conversation' ? (
            <ConversationPage />
          ) : activeKey === 'continuity' ? (
            <ContinuityPage />
          ) : (
            <>
              <header className="main-header">
                <div>
                  <span className="main-wordmark">Vio Live</span>
                  <small>主导航框架</small>
                </div>
                <span className="main-avatar" aria-hidden="true">
                  V
                </span>
              </header>

              <section className="page-placeholder">
                <div className="placeholder-orbit" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <div>
                    <NavigationIcon name={activeItem.icon} />
                  </div>
                </div>
                <span className="placeholder-index">{activeItem.index} / 06</span>
                <h1>{activeItem.label}</h1>
                <p>页面框架已建立</p>
                <small>具体功能将在对应页面任务中实现。</small>
              </section>
            </>
          )}
        </div>

        <nav className="bottom-navigation" aria-label="主导航">
          {navigationItems.map((item) => {
            const isActive = item.key === activeKey

            return (
              <button
                key={item.key}
                id={`navigation-${item.key}`}
                className={`navigation-item${isActive ? ' is-active' : ''}`}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActiveKey(item.key)}
              >
                <span className="navigation-icon-wrap">
                  <NavigationIcon name={item.icon} />
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </section>
    </main>
  )
}

export default MainNavigation
