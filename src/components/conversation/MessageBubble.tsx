import type { ConversationMessage } from '../../api'

type MessageBubbleProps = {
  message: ConversationMessage
  agentAvatar: string
}

function MessageBubble({ message, agentAvatar }: MessageBubbleProps) {
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
          {agentAvatar}
        </span>
      )}

      <div className="message-content">
        <div className="message-meta">
          <span>{isUser ? '你' : 'Vio'}</span>
          <time dateTime={message.createdAt}>{time}</time>
        </div>
        <p className="message-bubble">{message.content}</p>
      </div>
    </article>
  )
}

export default MessageBubble
