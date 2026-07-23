import ConversationIcon, { ConversationIconName } from './ConversationIcon'

const attachmentActions: Array<{
  label: string
  icon: ConversationIconName
}> = [
  { label: '添加图片', icon: 'image' },
  { label: '添加文件', icon: 'file' },
  { label: '语音输入', icon: 'voice' },
]

function ConversationComposer() {
  return (
    <form className="conversation-composer" onSubmit={(event) => event.preventDefault()}>
      <textarea
        aria-label="输入消息"
        placeholder="提问、聊天或下一个任务…"
        rows={1}
      />
      <div className="composer-toolbar">
        <div className="attachment-actions">
          {attachmentActions.map((action) => (
            <button key={action.label} type="button" aria-label={action.label}>
              <ConversationIcon name={action.icon} />
            </button>
          ))}
        </div>
        <button className="conversation-send" type="submit" aria-label="发送消息">
          <span>发送</span>
          <ConversationIcon name="send" />
        </button>
      </div>
    </form>
  )
}

export default ConversationComposer
