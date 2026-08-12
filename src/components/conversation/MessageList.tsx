import { useEffect, useRef } from 'react'
import type { ConversationMessage } from '../../api'
import MessageBubble from './MessageBubble'

type MessageListProps = {
  messages: ConversationMessage[]
  agentAvatar: string
  loading: boolean
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
}

function MessageList({ messages, agentAvatar, loading }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  return (
    <section className="message-list" aria-label="消息记录" aria-busy={loading}>
      {loading ? (
        <div className="conversation-empty" role="status">正在读取会话记录…</div>
      ) : messages.length === 0 ? (
        <div className="conversation-empty">
          <strong>开始一段新对话</strong>
          <span>消息将通过 Vio 后端进入连续性链路。</span>
        </div>
      ) : (
        messages.map((message, index) => {
          const previous = messages[index - 1]
          const currentDate = formatDate(message.createdAt)
          const showDate = !previous || formatDate(previous.createdAt) !== currentDate

          return (
            <div key={message.messageId}>
              {showDate && (
                <div className="message-date" role="separator">
                  <span>{currentDate}</span>
                </div>
              )}
              <MessageBubble message={message} agentAvatar={agentAvatar} />
            </div>
          )
        })
      )}
      <div ref={endRef} />
    </section>
  )
}

export default MessageList
