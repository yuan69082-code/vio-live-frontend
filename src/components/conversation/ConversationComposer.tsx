import { useRef } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
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
  onAttachment?: (kind: 'image' | 'file' | 'audio', file: File) => void
  attachmentsDisabled?: boolean
}

function ConversationComposer({
  value,
  disabled,
  busy,
  maxLength = DEFAULT_MAX_LENGTH,
  onChange,
  onSend,
  onAttachment,
  attachmentsDisabled = false,
}: ConversationComposerProps) {
  const inputs = useRef<Record<'image' | 'file' | 'audio', HTMLInputElement | null>>({ image: null, file: null, audio: null })
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

  const chooseAttachment = (kind: 'image' | 'file' | 'audio') => {
    if (!onAttachment || disabled || attachmentsDisabled) return
    inputs.current[kind]?.click()
  }

  const selected = (kind: 'image' | 'file' | 'audio', event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onAttachment?.(kind, file)
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
          {(['image', 'file', 'audio'] as const).map((kind) => <input key={kind} ref={(element) => { inputs.current[kind] = element }} className="visually-hidden" type="file" tabIndex={-1} aria-label={`${kind === 'image' ? '图片' : kind === 'audio' ? '语音' : '文件'}附件选择`} accept={kind === 'image' ? 'image/*' : kind === 'audio' ? 'audio/*' : undefined} onChange={(event) => selected(kind, event)} />)}
          {attachmentActions.map((action) => (
            <button
              key={action.label}
              type="button"
              aria-label={onAttachment ? (action.icon === 'voice' ? '添加音频' : action.label) : `${action.label}，暂未接入`}
              title={onAttachment ? (action.icon === 'voice' ? '添加音频' : action.label) : '暂未接入'}
              disabled={!onAttachment || disabled || attachmentsDisabled}
              onClick={() => chooseAttachment(action.icon === 'image' ? 'image' : action.icon === 'voice' ? 'audio' : 'file')}
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
