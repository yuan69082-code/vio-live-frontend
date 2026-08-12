const contextModes = ['精简', '标准', '完整', '自定义']

function ToolControls() {
  return (
    <section className="conversation-controls" aria-label="对话工具控制">
      <label className="model-control">
        <span>当前模型</span>
        <select value="由后端路由" aria-label="当前模型由后端路由" disabled>
          <option value="由后端路由">由后端路由</option>
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
                disabled
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
