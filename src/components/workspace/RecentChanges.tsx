import WorkspaceIcon, { WorkspaceIconName } from './WorkspaceIcon'

export type RecentChange = {
  id: string
  category: string
  detail: string
  time: string
  icon: WorkspaceIconName
}

function RecentChanges({ items }: { items: RecentChange[] }) {
  return (
    <section className="workspace-section" aria-labelledby="recent-title">
      <div className="workspace-section-heading">
        <h2 id="recent-title">最近变化</h2>
        <span>模拟数据</span>
      </div>
      <div className="recent-list">
        {items.map((item) => (
          <article className="recent-item" key={item.id}>
            <span className="recent-icon">
              <WorkspaceIcon name={item.icon} />
            </span>
            <div>
              <strong>{item.category}</strong>
              <p>{item.detail}</p>
            </div>
            <time>{item.time}</time>
          </article>
        ))}
      </div>
    </section>
  )
}

export default RecentChanges
