import WorkspaceIcon, { WorkspaceIconName } from './WorkspaceIcon'

export type TodayItem = {
  id: string
  label: string
  value: string
  detail: string
  icon: WorkspaceIconName
  tone: string
}

function TodayOverview({ items }: { items: TodayItem[] }) {
  return (
    <section className="workspace-section" aria-labelledby="today-title">
      <div className="workspace-section-heading">
        <h2 id="today-title">今日</h2>
        <span>7 月 22 日</span>
      </div>
      <div className="today-grid">
        {items.map((item) => (
          <article className="today-card" key={item.id}>
            <span className={`today-icon today-icon-${item.tone}`}>
              <WorkspaceIcon name={item.icon} />
            </span>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default TodayOverview
