import {
  PrivateDomainReplyStatus,
  privateDomainStatusDetails,
} from '../../data/privateDomainMock'
import PrivateDomainIcon from './PrivateDomainIcon'

const statusOrder: PrivateDomainReplyStatus[] = [
  'full',
  'partial',
  'denied',
  'delayed',
]

function ReplyStatusPanel({
  status,
}: {
  status?: PrivateDomainReplyStatus
}) {
  const activeDetails = status ? privateDomainStatusDetails[status] : undefined

  return (
    <section className="private-reply-panel" aria-labelledby="private-reply-title">
      <div className="private-section-heading private-reply-heading">
        <div>
          <span className="private-section-icon">
            <PrivateDomainIcon name="shield" />
          </span>
          <div>
            <small>PRESET REPLY</small>
            <h2 id="private-reply-title">AI 回复状态模拟</h2>
          </div>
        </div>
        <span>非真实判断</span>
      </div>

      <div className="private-status-options" aria-label="支持的回复状态">
        {statusOrder.map((statusKey) => (
          <span
            key={statusKey}
            className={`private-status-chip private-status-chip-${statusKey}${status === statusKey ? ' is-active' : ''}`}
          >
            {privateDomainStatusDetails[statusKey].label}
          </span>
        ))}
      </div>

      {status && activeDetails ? (
        <div className={`private-reply-result private-reply-result-${status}`}>
          <span className="private-reply-result-mark" aria-hidden="true">
            {status === 'full' ? '✓' : status === 'partial' ? '◐' : status === 'denied' ? '—' : '…'}
          </span>
          <div>
            <small>本次模拟回复</small>
            <strong>{activeDetails.label}</strong>
            <p>{activeDetails.description}</p>
            <span>开放范围：{activeDetails.scope}</span>
          </div>
        </div>
      ) : (
        <div className="private-reply-placeholder">
          <PrivateDomainIcon name="clock" />
          <span>发送申请后展示预设模拟回复</span>
        </div>
      )}
    </section>
  )
}

export default ReplyStatusPanel
