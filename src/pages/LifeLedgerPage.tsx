import { useEffect, useState } from 'react'
import BillList from '../components/ledger/BillList'
import CategoryStats from '../components/ledger/CategoryStats'
import FinancialOverview from '../components/ledger/FinancialOverview'
import LedgerAiActions from '../components/ledger/LedgerAiActions'
import LedgerHeader from '../components/ledger/LedgerHeader'
import LedgerSafety from '../components/ledger/LedgerSafety'

function LifeLedgerPage({ onBack }: { onBack: () => void }) {
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = '生活管账 | Vio Live'
    return () => { document.title = '工作台 | Vio Live' }
  }, [])

  return (
    <div className="life-ledger-page">
      <LedgerHeader onBack={onBack} />
      <section className="life-ledger-body" aria-label="生活管账内容">
        <div className="ledger-safety-banner"><span>NO MONEY MOVEMENT</span><p>以下金额与账单均为模拟，不会连接或操作真实资金。</p></div>
        <FinancialOverview />
        <BillList />
        <CategoryStats />
        <LedgerAiActions onAction={setNotice} />
        <LedgerSafety onAction={setNotice} />
        <p className="life-ledger-notice" aria-live="polite">{notice || '\u00a0'}</p>
      </section>
    </div>
  )
}

export default LifeLedgerPage
