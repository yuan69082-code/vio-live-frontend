import BodyMetricsIcon from './BodyMetricsIcon'

function BodyAiActions({ onAction }: { onAction: (message: string) => void }) {
  return (
    <section className="body-ai-card" aria-labelledby="body-ai-title">
      <div className="body-ai-heading"><span>AI</span><div><small>LOCAL PREVIEW</small><h2 id="body-ai-title">变化陪伴</h2><p>仅展示入口，不提供医疗诊断。</p></div></div>
      <div className="body-ai-actions">
        <button type="button" onClick={() => onAction('分析最近变化 · 仅 UI 模拟')}><span><BodyMetricsIcon name="sparkle" /></span><div><strong>分析最近变化</strong><small>查看模拟趋势摘要</small></div></button>
        <button type="button" onClick={() => onAction('查看调整建议 · 仅 UI 模拟')}><span><BodyMetricsIcon name="advice" /></span><div><strong>查看调整建议</strong><small>打开建议入口</small></div></button>
      </div>
    </section>
  )
}

export default BodyAiActions
