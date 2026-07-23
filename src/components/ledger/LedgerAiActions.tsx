import LedgerIcon from './LedgerIcon'

function LedgerAiActions({ onAction }: { onAction: (message: string) => void }) {
  return (
    <section className="ledger-ai-card" aria-labelledby="ledger-ai-title">
      <div><span>AI</span><div><small>LOCAL ANALYSIS</small><h2 id="ledger-ai-title">消费观察</h2><p>不会上传账单或调用真实 AI。</p></div></div>
      <div>
        <button type="button" onClick={() => onAction('分析消费习惯 · 仅 UI 模拟')}><span><LedgerIcon name="analysis" /></span><div><strong>分析消费习惯</strong><small>基于当前模拟账单</small></div></button>
        <button type="button" onClick={() => onAction('查看建议 · 仅 UI 模拟')}><span><LedgerIcon name="advice" /></span><div><strong>查看建议</strong><small>展示建议入口</small></div></button>
      </div>
    </section>
  )
}

export default LedgerAiActions
