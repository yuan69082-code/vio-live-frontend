import { FormEvent } from 'react'
import {
  PrivateDirectoryItem,
  PrivateDomainReplyStatus,
} from '../../data/privateDomainMock'
import PrivateDomainIcon from './PrivateDomainIcon'
import ReplyStatusPanel from './ReplyStatusPanel'

type AccessRequestPanelProps = {
  item: PrivateDirectoryItem
  reason: string
  submitted: boolean
  onReasonChange: (value: string) => void
  onSubmit: () => void
  onBack: () => void
}

function getVisibleContent(
  item: PrivateDirectoryItem,
  status?: PrivateDomainReplyStatus,
) {
  if (status === 'full') {
    return item.fullContent
  }

  if (status === 'partial') {
    return item.partialContent
  }

  return undefined
}

function AccessRequestPanel({
  item,
  reason,
  submitted,
  onReasonChange,
  onSubmit,
  onBack,
}: AccessRequestPanelProps) {
  const visibleStatus = submitted ? item.replyStatus : undefined
  const visibleContent = getVisibleContent(item, visibleStatus)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <section className="private-request-view" aria-label={`申请查看 ${item.title}`}>
      <button className="private-back-button" type="button" onClick={onBack}>
        <PrivateDomainIcon name="back" />
        返回私域目录
      </button>

      <article className="private-content-card">
        <div className="private-content-card-heading">
          <span className={`private-directory-icon private-directory-card-${item.tone}`}>
            <PrivateDomainIcon name={item.icon} />
          </span>
          <div>
            <small>查看内容</small>
            <h2>{item.title}</h2>
          </div>
          <span className="private-content-lock-state">
            <PrivateDomainIcon name={visibleContent ? 'shield' : 'lock'} />
            {visibleContent ? '已开放' : '锁定'}
          </span>
        </div>

        <div className={`private-content-preview${visibleContent ? ' is-visible' : ''}`}>
          <PrivateDomainIcon name={visibleContent ? 'record' : 'lock'} />
          <div>
            <strong>{visibleContent ? '可查看内容' : '内容仍处于锁定状态'}</strong>
            <p>
              {visibleContent
                ? visibleContent
                : '请说明查看理由。发送后将展示该项目预设的模拟回复，不会调用真实 AI。'}
            </p>
          </div>
        </div>

        <form className="private-request-form" onSubmit={handleSubmit}>
          <label htmlFor="private-request-reason">申请理由</label>
          <textarea
            id="private-request-reason"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="例如：我想了解最近的合作变化…"
            rows={3}
            disabled={submitted}
          />
          <small>仅用于当前页面模拟，不会发送或保存。</small>
          <button type="submit" disabled={!reason.trim() || submitted}>
            <span>{submitted ? '申请已发送' : '发送申请'}</span>
            <PrivateDomainIcon name={submitted ? 'shield' : 'send'} />
          </button>
        </form>
      </article>

      <ReplyStatusPanel status={visibleStatus} />
    </section>
  )
}

export default AccessRequestPanel
