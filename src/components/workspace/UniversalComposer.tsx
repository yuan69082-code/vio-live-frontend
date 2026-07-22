import { FormEvent, useState } from 'react'
import WorkspaceIcon from './WorkspaceIcon'

function UniversalComposer() {
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!content.trim()) return
    setContent('')
    setMessage('内容仅停留在当前页面，尚未发送。')
  }

  return (
    <form className="universal-composer" onSubmit={submit}>
      <label htmlFor="universal-input" className="visually-hidden">
        通用输入框
      </label>
      <input
        id="universal-input"
        type="text"
        autoComplete="off"
        placeholder="提问、聊天、下任务或记录想法…"
        value={content}
        onChange={(event) => {
          setContent(event.target.value)
          setMessage('')
        }}
      />
      <button type="submit" disabled={!content.trim()} aria-label="发送">
        <WorkspaceIcon name="send" />
      </button>
      <span className="composer-message" aria-live="polite">
        {message}
      </span>
    </form>
  )
}

export default UniversalComposer
