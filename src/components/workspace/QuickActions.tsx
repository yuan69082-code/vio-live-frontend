import WorkspaceIcon, { WorkspaceIconName } from './WorkspaceIcon'

export type QuickAction = {
  id: string
  label: string
  icon: WorkspaceIconName
}

function QuickActions({ items }: { items: QuickAction[] }) {
  return (
    <section className="workspace-section" aria-labelledby="quick-actions-title">
      <div className="workspace-section-heading">
        <h2 id="quick-actions-title">快捷入口</h2>
      </div>
      <div className="quick-action-grid">
        {items.map((item) => (
          <button className="quick-action" type="button" key={item.id}>
            <span>
              <WorkspaceIcon name={item.icon} />
            </span>
            {item.label}
          </button>
        ))}
      </div>
    </section>
  )
}

export default QuickActions
