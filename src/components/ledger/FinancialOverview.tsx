import { formatLedgerAmount, ledgerMock } from '../../data/ledgerMock'
import LedgerIcon from './LedgerIcon'

function FinancialOverview() {
  const { overview } = ledgerMock
  const budgetPercent = Math.round((overview.budgetRemaining / overview.budgetTotal) * 100)
  return (
    <section className="ledger-overview" aria-labelledby="ledger-overview-title">
      <div className="ledger-overview-heading"><div><small>MONTHLY OVERVIEW</small><h2 id="ledger-overview-title">{ledgerMock.month}</h2></div><span><LedgerIcon name="lock" />仅模拟</span></div>
      <div className="ledger-metrics">
        <div className="metric-income"><span><LedgerIcon name="income" /></span><section><small>本月收入</small><strong>{formatLedgerAmount(overview.income)}</strong></section></div>
        <div className="metric-expense"><span><LedgerIcon name="expense" /></span><section><small>本月支出</small><strong>{formatLedgerAmount(overview.expense)}</strong></section></div>
        <div className="metric-budget"><span><LedgerIcon name="budget" /></span><section><small>剩余预算</small><strong>{formatLedgerAmount(overview.budgetRemaining)}</strong></section></div>
      </div>
      <div className="ledger-budget-progress"><div><span>预算余量</span><strong>{budgetPercent}%</strong></div><span><i style={{ width: `${budgetPercent}%` }} /></span></div>
      <div className="ledger-trend">
        <div><span><LedgerIcon name="trend" /></span><section><small>消费趋势</small><strong>较上月下降 {Math.abs(overview.trendPercent)}%</strong></section></div>
        <div className="ledger-trend-chart" aria-label={`消费趋势较上月下降 ${Math.abs(overview.trendPercent)}%`}>
          {overview.trend.map((item) => <span key={item.label}><i style={{ height: `${item.value}%` }} /><small>{item.label}</small></span>)}
        </div>
      </div>
    </section>
  )
}

export default FinancialOverview
