import ConversationIcon, { ConversationIconName } from './ConversationIcon'

const entries = [
  { id: 'memory', label: '本次使用记忆', value: '由后端装配' },
  { id: 'state', label: '当前状态', value: '以 Engine 为准' },
  { id: 'tool', label: '使用工具', value: '前端不控制' },
]

const entryIcons: Record<string, ConversationIconName> = {
  memory: 'memory',
  state: 'state',
  tool: 'tool',
}

function SessionContextBar() {
  return (
    <section className="session-context-bar" aria-label="记忆、状态与工具">
      {entries.map((entry) => (
        <button key={entry.id} type="button" disabled title="本阶段仅展示真实系统边界">
          <span className="session-context-icon">
            <ConversationIcon name={entryIcons[entry.id] ?? 'tool'} />
          </span>
          <span>
            <small>{entry.label}</small>
            <strong>{entry.value}</strong>
          </span>
        </button>
      ))}
    </section>
  )
}

export default SessionContextBar
