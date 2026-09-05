import type { FormEvent, KeyboardEvent } from 'react'
import ConversationIcon, { ConversationIconName } from './ConversationIcon'

const DEFAULT_MAX_LENGTH = 32_768

const attachmentActions: Array<{
  label: string
  icon: ConversationIconName
}> = [
  { label: '添加图片', icon: 'image' },
  { label: '添加文件', icon: 'file' },
  { label: '语音输入', icon: 'voice' },
]

type ConversationComposerProps = {
  value: string
  disabled: boolean
  busy: boolean
  maxLength?: number
  onChange: (value: string) => void
  onSend: () => void
}

function ConversationComposer({
  value,
  disabled,
  busy,
  maxLength = DEFAULT_MAX_LENGTH,
  onChange,
  onSend,
}: ConversationComposerProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!disabled && value.trim()) onSend()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!disabled && value.trim()) onSend()
    }
  }

  return (
    <form className="conversation-composer" onSubmit={submit}>
      <textarea
        aria-label="输入消息"
        placeholder="提问、聊天或下一个任务…"
        rows={1}
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="composer-toolbar">
        <div className="attachment-actions">
          {attachmentActions.map((action) => (
            <button
              key={action.label}
              type="button"
              aria-label={`${action.label}，暂未接入`}
              title="暂未接入"
              disabled
            >
              <ConversationIcon name={action.icon} />
            </button>
          ))}
        </div>
        <span className="composer-count" aria-label="消息字数">
          {value.length}/{maxLength}
        </span>
        <button
          className="conversation-send"
          type="submit"
          aria-label="发送消息"
          disabled={disabled || !value.trim()}
        >
          <span>{busy ? '处理中' : '发送'}</span>
          <ConversationIcon name="send" />
        </button>
      </div>
    </form>
  )
}

export default ConversationComposer
