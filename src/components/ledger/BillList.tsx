import { formatLedgerAmount, ledgerMock } from '../../data/ledgerMock'
import LedgerIcon from './LedgerIcon'

function BillList() {
  return (
    <section className="ledger-section ledger-bills" aria-labelledby="ledger-bills-title">
      <div className="ledger-section-heading"><span><LedgerIcon name="ledger" /></span><div><small>RECENT BILLS</small><h2 id="ledger-bills-title">账单列表</h2><p>最近 8 条模拟记录</p></div><span>本月</span></div>
      <div className="ledger-bill-list">
        {ledgerMock.bills.map((bill) => (
          <article key={bill.id}>
            <span className={`ledger-bill-icon ledger-bill-${bill.category === '收入' ? 'income' : 'expense'}`}><LedgerIcon name={bill.icon} /></span>
            <div><strong>{bill.name}</strong><p>{bill.date} · {bill.time}</p></div>
            <span className="ledger-bill-category">{bill.category}</span>
            <strong className={bill.amount > 0 ? 'is-income' : ''}>{bill.amount > 0 ? '+' : '-'}{formatLedgerAmount(bill.amount)}</strong>
          </article>
        ))}
      </div>
    </section>
  )
}

export default BillList
