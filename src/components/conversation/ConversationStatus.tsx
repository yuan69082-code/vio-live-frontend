import type { ConversationTurn } from '../../api'

type ConversationStatusProps = {
  turn: ConversationTurn | null
  hasPendingWithoutTurn: boolean
  uncertain: boolean
  busy: boolean
  historyError: string
  operationError: string
  notice: string
  pollingStopped: boolean
  onRetryHistory: () => void
  onRefresh: () => void
  onResume: () => void
  onRecover: () => void
}

function ConversationStatus({
  turn,
  hasPendingWithoutTurn,
  uncertain,
  busy,
  historyError,
  operationError,
  notice,
  pollingStopped,
  onRetryHistory,
  onRefresh,
  onResume,
  onRecover,
}: ConversationStatusProps) {
  let title = ''
  let detail = ''
  let action = ''
  let onAction: (() => void) | null = null
  let tone = 'is-neutral'

  if (hasPendingWithoutTurn || uncertain) {
    title = '发送结果尚未确认'
    detail = '保留了原发送事实；恢复时不会创建新的幂等键或第二条用户消息。'
    action = '查询并恢复'
    onAction = onRecover
    tone = 'is-warning'
  } else if (turn?.status === 'processing') {
    title = pollingStopped ? '仍在处理中' : 'Vio 正在处理'
    detail = pollingStopped
      ? '自动查询已停止，避免无限轮询。可手动读取一次当前状态。'
      : '正在有限次数查询轮次状态，不会创建等待中的助手消息。'
    action = '刷新状态'
    onAction = onRefresh
  } else if (turn?.status === 'confirmation_required') {
    title = '需要你的确认'
    detail = '确认后才会继续当前轮次。'
    action = '确认并继续'
    onAction = onResume
    tone = 'is-warning'
  } else if (turn?.status === 'budget_confirmation_required') {
    title = '需要预算确认'
    detail = '确认预算后才会继续当前轮次。'
    action = '确认预算并继续'
    onAction = onResume
    tone = 'is-warning'
  } else if (turn?.status === 'waiting_budget') {
    title = '预算暂不可用'
    detail = '不会自动重试；你可以明确要求重新检查预算。'
    action = '重新检查预算'
    onAction = onResume
    tone = 'is-warning'
  } else if (turn?.status === 'waiting_retry') {
    title = '等待重试批准'
    detail = '继续可能再次调用模型服务。只有你明确批准后才会重试一次。'
    action = '批准重试一次'
    onAction = onResume
    tone = 'is-danger'
  } else if (turn?.status === 'outcome_unknown') {
    title = '轮次结果未知'
    detail = '这既不是成功也不是失败。将先查询已有结果，再恢复同一轮次。'
    action = '查询并恢复'
    onAction = onRecover
    tone = 'is-warning'
  } else if (turn?.status === 'failed' || turn?.status === 'quarantined') {
    title = turn.status === 'failed' ? '本轮处理失败' : '本轮已隔离'
    detail = turn.failure?.code
      ? `后端状态：${turn.failure.code}`
      : '没有创建助手消息，也不会自动重试。'
    tone = 'is-danger'
  }

  const visible = title || historyError || operationError || notice
  if (!visible) return null

  return (
    <section className={`conversation-status ${tone}`} aria-live="polite" aria-busy={busy}>
      <div>
        {title && <strong>{title}</strong>}
        {detail && <span>{detail}</span>}
        {historyError && <span>{historyError}</span>}
        {operationError && <span>{operationError}</span>}
        {notice && <span>{notice}</span>}
      </div>
      <div className="conversation-status-actions">
        {historyError && (
          <button type="button" onClick={onRetryHistory} disabled={busy}>
            重试记录
          </button>
        )}
        {onAction && (
          <button type="button" onClick={onAction} disabled={busy}>
            {action}
          </button>
        )}
      </div>
    </section>
  )
}

export default ConversationStatus
