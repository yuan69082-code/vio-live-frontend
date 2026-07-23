import ConversationIcon, { ConversationIconName } from './ConversationIcon'

type SessionContextEntry = {
  id: string
  label: string
  value: string
}

const entryIcons: Record<string, ConversationIconName> = {
  memory: 'memory',
  state: 'state',
  tool: 'tool',
}

function SessionContextBar({ entries }: { entries: SessionContextEntry[] }) {
  return (
    <section className="session-context-bar" aria-label="记忆、状态与工具">
      {entries.map((entry) => (
        <button key={entry.id} type="button">
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
