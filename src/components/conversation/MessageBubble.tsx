import type { ReactNode } from 'react'

export type ConversationMessageView = {
  messageId: string
  senderType: 'user' | 'subject'
  content: string
  createdAt: string
  versionKind?: 'original' | 'edited' | 'regenerated'
  attachmentNames?: string[]
}

type MessageBubbleProps = {
  message: ConversationMessageView
  agentAvatar: string
  agentAvatarImage?: string | null
  agentName?: string
  actions?: ReactNode
}

function MessageBubble({ message, agentAvatar, agentAvatarImage, agentName = 'Vio', actions }: MessageBubbleProps) {
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
        {message.attachmentNames && message.attachmentNames.length > 0 && (
          <ul className="message-attachments" aria-label="消息附件">
            {message.attachmentNames.map((name, index) => <li key={`${index}:${name}`}>{name}</li>)}
          </ul>
        )}
        {message.versionKind && message.versionKind !== 'original' && <small className="message-version-kind">{message.versionKind === 'edited' ? '已编辑' : '重新生成版本'}</small>}
        {actions}
      </div>
    </article>
  )
}

export default MessageBubble
