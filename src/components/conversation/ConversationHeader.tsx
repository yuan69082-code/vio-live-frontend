import ConversationIcon from './ConversationIcon'

type ConversationHeaderProps = {
  agentName: string
  agentAvatar: string
  avatarImage?: string | null
  sessionName: string
  sessionLabel?: string
  sessionTitle?: string
  sessionDisabled?: boolean
  sessionExpanded?: boolean
  onSessionSwitch?: () => void
}

function ConversationHeader({
  agentName,
  agentAvatar,
  avatarImage,
  sessionName,
  sessionLabel = '本地试聊',
  sessionTitle = '当前仅开放固定本地试聊会话',
  sessionDisabled = true,
  sessionExpanded,
  onSessionSwitch,
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
        disabled={sessionDisabled}
        aria-expanded={sessionExpanded}
        aria-label={`切换会话，当前：${sessionName}`}
        title={sessionTitle}
        onClick={onSessionSwitch}
      >
        {sessionLabel}
        <ConversationIcon name="chevron" />
      </button>
    </header>
  )
}

export default ConversationHeader
