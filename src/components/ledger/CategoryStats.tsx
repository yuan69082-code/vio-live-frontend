import { formatLedgerAmount, ledgerMock } from '../../data/ledgerMock'
import LedgerIcon from './LedgerIcon'

function CategoryStats() {
  return (
    <section className="ledger-section ledger-categories" aria-labelledby="ledger-categories-title">
      <div className="ledger-section-heading"><span><LedgerIcon name="analysis" /></span><div><small>CATEGORY STATS</small><h2 id="ledger-categories-title">分类统计</h2><p>六类支出占比</p></div><span>{formatLedgerAmount(ledgerMock.overview.expense)}</span></div>
      <div className="ledger-category-list">
        {ledgerMock.categories.map((item) => (
          <article className={`ledger-category-${item.tone}`} key={item.name}>
            <span><LedgerIcon name={item.icon} /></span>
            <div><div><strong>{item.name}</strong><small>{item.percent}%</small></div><span><i style={{ width: `${item.percent}%` }} /></span></div>
            <strong>{formatLedgerAmount(item.amount)}</strong>
          </article>
        ))}
      </div>
    </section>
  )
}

export default CategoryStats
