import {
  ConversationMessage,
  MessageAction,
} from '../../data/conversationMock'
import ConversationIcon, { ConversationIconName } from './ConversationIcon'

const actionDetails: Record<
  MessageAction,
  { label: string; icon: ConversationIconName }
> = {
  edit: { label: '编辑消息', icon: 'edit' },
  regenerate: { label: '重新生成', icon: 'regenerate' },
  delete: { label: '删除', icon: 'delete' },
  branch: { label: '创建新分支', icon: 'branch' },
}

type MessageBubbleProps = {
  message: ConversationMessage
  agentAvatar: string
}

function MessageBubble({ message, agentAvatar }: MessageBubbleProps) {
  const isUser = message.sender === 'user'

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
          <time dateTime={`2026-07-23T${message.time}:00+08:00`}>
            {message.time}
          </time>
        </div>
        <p className="message-bubble">{message.content}</p>
        <div className="message-actions" aria-label="消息操作">
          {message.actions.map((action) => {
            const details = actionDetails[action]

            return (
              <button key={action} type="button" aria-label={details.label}>
                <ConversationIcon name={details.icon} />
                <span>{details.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </article>
  )
}

export default MessageBubble
