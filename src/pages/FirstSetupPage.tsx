import { FormEvent, useMemo, useState } from 'react'

type RoleKey = 'work' | 'life' | 'companion' | 'custom'
type MemoryKey = 'cloud' | 'local' | 'hybrid'
type ContextKey = 'concise' | 'standard' | 'complete' | 'custom'

type Option<T extends string> = {
  value: T
  label: string
  description: string
}

const avatars = [
  { value: 'spark', symbol: '✦', label: '星光', tone: 'violet' },
  { value: 'moon', symbol: '☾', label: '月亮', tone: 'blue' },
  { value: 'wave', symbol: '≈', label: '波纹', tone: 'aqua' },
  { value: 'bloom', symbol: '✿', label: '花朵', tone: 'rose' },
]

const roleOptions: Array<Option<RoleKey>> = [
  { value: 'work', label: '工作伙伴', description: '协作、规划与执行' },
  { value: 'life', label: '生活管家', description: '日程、提醒与生活整理' },
  { value: 'companion', label: '陪伴', description: '交流、倾听与长期陪伴' },
  { value: 'custom', label: '自定义', description: '由你定义相处方式' },
]

const memoryOptions: Array<Option<MemoryKey>> = [
  { value: 'cloud', label: '云端', description: '多设备使用' },
  { value: 'local', label: '本地', description: '仅此设备' },
  { value: 'hybrid', label: '混合', description: '灵活组合' },
]

const contextOptions: Array<Option<ContextKey>> = [
  { value: 'concise', label: '精简', description: '更轻、更快速' },
  { value: 'standard', label: '标准', description: '平衡信息与速度' },
  { value: 'complete', label: '完整', description: '保留更多上下文' },
  { value: 'custom', label: '自定义', description: '之后自行调整' },
]

function ChoiceGrid<T extends string>({
  name,
  value,
  options,
  columns,
  onChange,
}: {
  name: string
  value: T | ''
  options: Array<Option<T>>
  columns: 'two' | 'three'
  onChange: (value: T) => void
}) {
  return (
    <div className={`choice-grid choice-grid-${columns}`}>
      {options.map((option) => (
        <label className="choice-card" key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className="choice-card-content">
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
        </label>
      ))}
    </div>
  )
}

function FirstSetupPage() {
  const [agentName, setAgentName] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [role, setRole] = useState<RoleKey | ''>('')
  const [customRole, setCustomRole] = useState('')
  const [memory, setMemory] = useState<MemoryKey | ''>('')
  const [context, setContext] = useState<ContextKey | ''>('')
  const [message, setMessage] = useState('')

  const basicReady = agentName.trim().length > 0 && role !== ''
  const customReady = role !== 'custom' || customRole.trim().length > 0
  const formReady = useMemo(
    () => basicReady && customReady && memory !== '' && context !== '',
    [basicReady, context, customReady, memory],
  )

  const clearMessage = () => setMessage('')

  const skipAdvanced = () => {
    if (!agentName.trim()) {
      setMessage('请先为智能体取一个名字。')
      return
    }

    if (!role || !customReady) {
      setMessage('请先完成基础定位选择。')
      return
    }

    setMessage('已跳过高级设置。当前是纯前端原型，设置不会被保存。')
  }

  const completeSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formReady) return
    setMessage(`“${agentName.trim()}”的首次设置已完成。当前未连接任何后端服务。`)
  }

  return (
    <main className="setup-shell">
      <div aria-hidden="true" className="ambient ambient-one" />
      <div aria-hidden="true" className="ambient ambient-two" />

      <section className="setup-card" aria-labelledby="setup-title">
        <header className="setup-header">
          <a className="wordmark setup-wordmark" href="#top" aria-label="Vio Live 首页">
            Vio Live
          </a>
          <span className="setup-step">首次设置</span>
          <h1 id="setup-title">认识你的智能体</h1>
          <p>先从简单的选择开始，之后都可以随时修改。</p>
        </header>

        <form onSubmit={completeSetup} noValidate>
          <section className="setup-section" aria-labelledby="identity-title">
            <div className="section-heading">
              <div>
                <span>01</span>
                <h2 id="identity-title">创建智能体</h2>
              </div>
              <small>基础信息</small>
            </div>

            <div className="setup-field">
              <label htmlFor="agent-name">智能体名称</label>
              <input
                id="agent-name"
                name="agent-name"
                type="text"
                autoComplete="off"
                maxLength={24}
                placeholder="例如：Vio、小满、Nova"
                value={agentName}
                onChange={(event) => {
                  setAgentName(event.target.value)
                  clearMessage()
                }}
              />
              <span className="field-hint">这是之后与你一起生活和工作的名字。</span>
            </div>

            <fieldset
              className="setup-field avatar-fieldset"
              aria-labelledby="avatar-field-label"
            >
              <div className="field-legend-row">
                <span id="avatar-field-label">选择头像</span>
                <button
                  className="avatar-skip"
                  type="button"
                  aria-pressed={avatar === null}
                  onClick={() => {
                    setAvatar(null)
                    clearMessage()
                  }}
                >
                  暂不设置
                </button>
              </div>
              <div className="avatar-options">
                {avatars.map((item) => (
                  <label className="avatar-option" key={item.value} title={item.label}>
                    <input
                      type="radio"
                      name="avatar"
                      value={item.value}
                      checked={avatar === item.value}
                      onChange={() => {
                        setAvatar(item.value)
                        clearMessage()
                      }}
                    />
                    <span className={`avatar-circle avatar-${item.tone}`} aria-hidden="true">
                      {item.symbol}
                    </span>
                    <small>{item.label}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="setup-field option-fieldset">
              <legend>基础定位</legend>
              <ChoiceGrid
                name="role"
                value={role}
                options={roleOptions}
                columns="two"
                onChange={(value) => {
                  setRole(value)
                  clearMessage()
                }}
              />
              {role === 'custom' && (
                <input
                  className="custom-role-input"
                  type="text"
                  aria-label="自定义基础定位"
                  maxLength={36}
                  placeholder="用一句话描述你期待的定位"
                  value={customRole}
                  onChange={(event) => {
                    setCustomRole(event.target.value)
                    clearMessage()
                  }}
                />
              )}
            </fieldset>
          </section>

          <section className="setup-section" aria-labelledby="preference-title">
            <div className="section-heading">
              <div>
                <span>02</span>
                <h2 id="preference-title">记忆与上下文</h2>
              </div>
              <small>可跳过</small>
            </div>

            <fieldset className="setup-field option-fieldset">
              <legend>记忆保存方式</legend>
              <ChoiceGrid
                name="memory"
                value={memory}
                options={memoryOptions}
                columns="three"
                onChange={(value) => {
                  setMemory(value)
                  clearMessage()
                }}
              />
            </fieldset>

            <fieldset className="setup-field option-fieldset">
              <legend>默认上下文模式</legend>
              <ChoiceGrid
                name="context"
                value={context}
                options={contextOptions}
                columns="two"
                onChange={(value) => {
                  setContext(value)
                  clearMessage()
                }}
              />
            </fieldset>
          </section>

          <div className="setup-actions">
            <button
              className="skip-button"
              type="button"
              disabled={!basicReady || !customReady}
              onClick={skipAdvanced}
            >
              跳过高级设置
            </button>
            <button className="submit-button" type="submit" disabled={!formReady}>
              完成设置
              <span aria-hidden="true">→</span>
            </button>
          </div>

          <p className="setup-status" aria-live="polite">
            {message || '\u00a0'}
          </p>
        </form>

        <footer>当前设置仅保存在页面状态中，不会上传或写入数据库。</footer>
      </section>
    </main>
  )
}

export default FirstSetupPage
