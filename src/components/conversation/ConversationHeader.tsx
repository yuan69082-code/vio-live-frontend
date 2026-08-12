import ConversationIcon from './ConversationIcon'

type ConversationHeaderProps = {
  agentName: string
  agentAvatar: string
  sessionName: string
}

function ConversationHeader({
  agentName,
  agentAvatar,
  sessionName,
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      <span className="conversation-avatar" aria-hidden="true">
        {agentAvatar}
      </span>
      <div className="conversation-heading">
        <span>{agentName}</span>
        <h1>{sessionName}</h1>
      </div>
      <button
        className="session-switch"
        type="button"
        disabled
        title="当前仅开放固定本地试聊会话"
      >
        本地试聊
        <ConversationIcon name="chevron" />
      </button>
    </header>
  )
}

export default ConversationHeader
