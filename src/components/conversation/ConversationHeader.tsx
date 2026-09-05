import ConversationIcon from './ConversationIcon'

type ConversationHeaderProps = {
  agentName: string
  agentAvatar: string
  avatarImage?: string | null
  sessionName: string
  sessionLabel?: string
  sessionTitle?: string
}

function ConversationHeader({
  agentName,
  agentAvatar,
  avatarImage,
  sessionName,
  sessionLabel = '本地试聊',
  sessionTitle = '当前仅开放固定本地试聊会话',
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      <span className="conversation-avatar" aria-hidden="true">
        {avatarImage ? <img src={avatarImage} alt="" /> : agentAvatar}
      </span>
      <div className="conversation-heading">
        <span>{agentName}</span>
        <h1>{sessionName}</h1>
      </div>
      <button
        className="session-switch"
        type="button"
        disabled
        title={sessionTitle}
      >
        {sessionLabel}
        <ConversationIcon name="chevron" />
      </button>
    </header>
  )
}

export default ConversationHeader
