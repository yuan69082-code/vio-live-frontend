export type LedgerCategory = '餐饮' | '购物' | '娱乐' | '交通' | '住房' | '其他' | '收入'

export type LedgerIconName =
  | 'ledger'
  | 'back'
  | 'income'
  | 'expense'
  | 'budget'
  | 'trend'
  | 'food'
  | 'shopping'
  | 'entertainment'
  | 'transport'
  | 'housing'
  | 'other'
  | 'salary'
  | 'analysis'
  | 'advice'
  | 'wallet'
  | 'rule'
  | 'shield'
  | 'chevron'
  | 'lock'

export const ledgerMock = {
  month: '2026 年 7 月',
  overview: {
    income: 18600,
    expense: 8420,
    budgetRemaining: 3580,
    budgetTotal: 12000,
    trendPercent: -8.6,
    trend: [
      { label: '第1周', value: 42 },
      { label: '第2周', value: 68 },
      { label: '第3周', value: 53 },
      { label: '本周', value: 38 },
    ],
  },
  bills: [
    { id: 'bill-1', date: '7月22日', time: '20:18', name: '独立书店', amount: -126.5, category: '购物' as LedgerCategory, icon: 'shopping' as LedgerIconName },
    { id: 'bill-2', date: '7月21日', time: '18:42', name: '晚餐', amount: -168, category: '餐饮' as LedgerCategory, icon: 'food' as LedgerIconName },
    { id: 'bill-3', date: '7月21日', time: '08:26', name: '通勤交通', amount: -6, category: '交通' as LedgerCategory, icon: 'transport' as LedgerIconName },
    { id: 'bill-4', date: '7月20日', time: '09:00', name: '住房支出', amount: -3200, category: '住房' as LedgerCategory, icon: 'housing' as LedgerIconName },
    { id: 'bill-5', date: '7月19日', time: '21:15', name: '电影票', amount: -96, category: '娱乐' as LedgerCategory, icon: 'entertainment' as LedgerIconName },
    { id: 'bill-6', date: '7月18日', time: '10:00', name: '本月收入', amount: 18600, category: '收入' as LedgerCategory, icon: 'salary' as LedgerIconName },
    { id: 'bill-7', date: '7月18日', time: '08:55', name: '早餐与咖啡', amount: -32, category: '餐饮' as LedgerCategory, icon: 'food' as LedgerIconName },
    { id: 'bill-8', date: '7月17日', time: '19:34', name: '日用品', amount: -238, category: '其他' as LedgerCategory, icon: 'other' as LedgerIconName },
  ],
  categories: [
    { name: '餐饮' as LedgerCategory, amount: 1880, percent: 22.3, icon: 'food' as LedgerIconName, tone: 'rose' },
    { name: '购物' as LedgerCategory, amount: 1420, percent: 16.9, icon: 'shopping' as LedgerIconName, tone: 'purple' },
    { name: '娱乐' as LedgerCategory, amount: 760, percent: 9, icon: 'entertainment' as LedgerIconName, tone: 'blue' },
    { name: '交通' as LedgerCategory, amount: 680, percent: 8.1, icon: 'transport' as LedgerIconName, tone: 'aqua' },
    { name: '住房' as LedgerCategory, amount: 3200, percent: 38, icon: 'housing' as LedgerIconName, tone: 'gold' },
    { name: '其他' as LedgerCategory, amount: 480, percent: 5.7, icon: 'other' as LedgerIconName, tone: 'slate' },
  ],
}

export function formatLedgerAmount(amount: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
}
