import LedgerIcon from './LedgerIcon'

function LedgerHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="ledger-header">
      <button type="button" onClick={onBack} aria-label="返回工作台"><LedgerIcon name="back" /></button>
      <div><span>VIO LIVE · LIFE</span><h1>生活管账</h1><p>收支、预算与消费结构 · 本地演示</p></div>
      <span className="ledger-header-badge">无资金操作</span>
    </header>
  )
}

export default LedgerHeader
