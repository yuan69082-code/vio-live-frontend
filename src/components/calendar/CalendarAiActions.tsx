import CalendarIcon from './CalendarIcon'

const actions = [
  { id: 'discuss', label: '与 AI 讨论今天', detail: '聊聊今天的感受', icon: 'chat' as const },
  { id: 'analyze', label: '让 AI 分析记录', detail: '查看模拟分析入口', icon: 'analysis' as const },
  { id: 'reminder', label: '添加提醒', detail: '创建模拟提醒', icon: 'reminder' as const },
]

function CalendarAiActions({ onAction }: { onAction: (message: string) => void }) {
  return (
    <section className="calendar-ai-card" aria-labelledby="calendar-ai-title">
      <div><span>AI</span><div><small>LOCAL UI</small><h2 id="calendar-ai-title">和 Vio 一起回看</h2><p>不会发送内容或触发真实 AI。</p></div></div>
      <div>{actions.map((action) => <button type="button" key={action.id} onClick={() => onAction(`${action.label} · 仅 UI 模拟`)}><span><CalendarIcon name={action.icon} /></span><strong>{action.label}</strong><small>{action.detail}</small></button>)}</div>
    </section>
  )
}

export default CalendarAiActions
