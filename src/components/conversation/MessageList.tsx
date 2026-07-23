import { ConversationMessage } from '../../data/conversationMock'
import MessageBubble from './MessageBubble'

type MessageListProps = {
  messages: ConversationMessage[]
  agentAvatar: string
}

function MessageList({ messages, agentAvatar }: MessageListProps) {
  return (
    <section className="message-list" aria-label="消息记录">
      <div className="message-date" role="separator">
        <span>今天</span>
      </div>
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          agentAvatar={agentAvatar}
        />
      ))}
    </section>
  )
}

export default MessageList
