export type ConversationMessageView = {
  messageId: string
  senderType: 'user' | 'subject'
  content: string
  createdAt: string
}

type MessageBubbleProps = {
  message: ConversationMessageView
  agentAvatar: string
  agentAvatarImage?: string | null
  agentName?: string
}

function MessageBubble({ message, agentAvatar, agentAvatarImage, agentName = 'Vio' }: MessageBubbleProps) {
  const isUser = message.senderType === 'user'
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(message.createdAt))

  return (
    <article className={`message-row ${isUser ? 'is-user' : 'is-assistant'}`}>
      {!isUser && (
        <span className="message-avatar" aria-hidden="true">
          {agentAvatarImage ? <img src={agentAvatarImage} alt="" /> : agentAvatar}
        </span>
      )}

      <div className="message-content">
        <div className="message-meta">
          <span>{isUser ? '你' : agentName}</span>
          <time dateTime={message.createdAt}>{time}</time>
        </div>
        <p className="message-bubble">{message.content}</p>
      </div>
    </article>
  )
}

export default MessageBubble
