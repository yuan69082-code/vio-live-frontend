type ToolControlsProps = {
  models: string[]
  contextModes: string[]
}

function ToolControls({ models, contextModes }: ToolControlsProps) {
  return (
    <section className="conversation-controls" aria-label="对话工具控制">
      <label className="model-control">
        <span>当前模型</span>
        <select defaultValue={models[0]} aria-label="选择当前模型">
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="context-control">
        <legend>上下文模式</legend>
        <div className="context-options">
          {contextModes.map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="conversation-context"
                value={mode}
                defaultChecked={mode === '标准'}
              />
              <span>{mode}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  )
}

export default ToolControls
