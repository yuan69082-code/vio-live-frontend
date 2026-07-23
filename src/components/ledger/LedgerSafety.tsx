import type { LedgerIconName } from '../../data/ledgerMock'
import LedgerIcon from './LedgerIcon'

const entries: Array<{ id: string; title: string; description: string; status: string; icon: LedgerIconName }> = [
  { id: 'wallet', title: '钱包连接', description: '预留连接入口，不读取账户', status: '未连接', icon: 'wallet' },
  { id: 'rule', title: '自动规则', description: '预留规则入口，不执行扣款', status: '未启用', icon: 'rule' },
  { id: 'safety', title: '安全设置', description: '资金相关操作始终关闭', status: '仅 UI', icon: 'shield' },
]

function LedgerSafety({ onAction }: { onAction: (message: string) => void }) {
  return (
    <section className="ledger-section ledger-safety" aria-labelledby="ledger-safety-title">
      <div className="ledger-section-heading"><span><LedgerIcon name="shield" /></span><div><small>SAFETY BOUNDARY</small><h2 id="ledger-safety-title">安全入口</h2><p>不连接银行、钱包或支付服务</p></div><span>只读原型</span></div>
      <div className="ledger-safety-list">
        {entries.map((entry) => <button type="button" key={entry.id} onClick={() => onAction(`${entry.title}入口 · 未执行真实连接`)}><span><LedgerIcon name={entry.icon} /></span><div><strong>{entry.title}</strong><small>{entry.description}</small></div><em>{entry.status}</em><LedgerIcon name="chevron" /></button>)}
      </div>
      <p><LedgerIcon name="lock" />本页面不提供充值、付款、转账或自动扣款操作。</p>
    </section>
  )
}

export default LedgerSafety
