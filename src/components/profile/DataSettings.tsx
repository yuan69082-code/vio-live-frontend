import ProfileIcon from './ProfileIcon'
import ProfileSection from './ProfileSection'

const actions = [
  { id: 'export', title: '数据导出', description: '生成导出任务入口', icon: 'export' as const },
  { id: 'backup', title: '备份', description: '最近备份：尚无记录', icon: 'backup' as const },
  { id: 'delete', title: '数据删除', description: '删除前需要再次确认', icon: 'trash' as const },
]

function DataSettings({ onAction }: { onAction: (message: string) => void }) {
  return (
    <ProfileSection index="04" eyebrow="DATA" title="数据管理" summary="导出、备份与删除入口" icon="data" tone="aqua">
      <div className="profile-data-grid">
        {actions.map((action) => (
          <button className={action.id === 'delete' ? 'is-danger' : ''} type="button" key={action.id} onClick={() => onAction(`${action.title}入口 · 未执行真实操作`)}>
            <span><ProfileIcon name={action.icon} /></span><strong>{action.title}</strong><small>{action.description}</small>
          </button>
        ))}
      </div>
      <p className="profile-data-note"><ProfileIcon name="shield" />当前页面不会导出、备份或删除真实数据。</p>
    </ProfileSection>
  )
}

export default DataSettings
