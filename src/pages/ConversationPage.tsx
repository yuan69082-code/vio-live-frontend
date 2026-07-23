import ConversationComposer from '../components/conversation/ConversationComposer'
import ConversationHeader from '../components/conversation/ConversationHeader'
import MessageList from '../components/conversation/MessageList'
import SessionContextBar from '../components/conversation/SessionContextBar'
import ToolControls from '../components/conversation/ToolControls'
import { conversationMock } from '../data/conversationMock'

function ConversationPage() {
  return (
    <div className="conversation-page">
      <ConversationHeader
        agentName={conversationMock.agent.name}
        agentAvatar={conversationMock.agent.avatar}
        sessionName={conversationMock.session.name}
      />
      <ToolControls
        models={conversationMock.models}
        contextModes={conversationMock.contextModes}
      />
      <SessionContextBar entries={conversationMock.contextEntries} />
      <MessageList
        messages={conversationMock.messages}
        agentAvatar={conversationMock.agent.avatar}
      />
      <ConversationComposer />
    </div>
  )
}

export default ConversationPage
