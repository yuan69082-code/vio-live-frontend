import type { LedgerIconName } from '../../data/ledgerMock'

function LedgerIcon({ name }: { name: LedgerIconName }) {
  const props = {
    'aria-hidden': true,
    className: 'ledger-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'back') return <svg {...props}><path d="m15 18-6-6 6-6" /></svg>
  if (name === 'ledger' || name === 'wallet') return <svg {...props}><path d="M4 6.5h14a2 2 0 0 1 2 2V19H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" /><path d="M15 11h5v4h-5a2 2 0 0 1 0-4Z" /></svg>
  if (name === 'income') return <svg {...props}><path d="M5 19h14M12 4v11M7.5 8.5 12 4l4.5 4.5" /></svg>
  if (name === 'expense') return <svg {...props}><path d="M5 5h14M12 20V9M7.5 15.5 12 20l4.5-4.5" /></svg>
  if (name === 'budget') return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M8 12h8M12 8v8" /></svg>
  if (name === 'trend' || name === 'analysis') return <svg {...props}><path d="M4 18V8M9 18V5M14 18v-7M19 18V7" /><path d="m4 6 5-3 5 5 6-5" /></svg>
  if (name === 'food') return <svg {...props}><path d="M7 3v8M4.5 3v5A2.5 2.5 0 0 0 7 10.5 2.5 2.5 0 0 0 9.5 8V3M7 10.5V21M16 21V4a4 4 0 0 1 4 4v5h-4" /></svg>
  if (name === 'shopping') return <svg {...props}><path d="M5 8h14l-1 12H6L5 8ZM9 8V6a3 3 0 0 1 6 0v2" /></svg>
  if (name === 'entertainment') return <svg {...props}><path d="M7 9h10a5 5 0 0 1 4 8l-1.5 2a2 2 0 0 1-3.2.1L14.5 17h-5l-1.8 2.1a2 2 0 0 1-3.2-.1L3 17a5 5 0 0 1 4-8Z" /><path d="M8 12v4M6 14h4M16.5 13h.01M18.5 15h.01" /></svg>
  if (name === 'transport') return <svg {...props}><path d="M5 17V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v9M4 17h16v3h-3v-3H7v3H4v-3ZM8 10h8M8 14h.01M16 14h.01" /></svg>
  if (name === 'housing') return <svg {...props}><path d="m3 11 9-8 9 8M6 9v11h12V9M10 20v-6h4v6" /></svg>
  if (name === 'other') return <svg {...props}><circle cx="6" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /></svg>
  if (name === 'salary') return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 9h10M7 13h4M16 15h2" /></svg>
  if (name === 'advice') return <svg {...props}><path d="M9 18h6M10 21h4M8.5 15a7 7 0 1 1 7 0c-.9.7-1.2 1.2-1.2 3h-4.6c0-1.8-.3-2.3-1.2-3Z" /></svg>
  if (name === 'rule') return <svg {...props}><path d="M5 4h14v16H5zM8 9l1.5 1.5L12 8M13 10h3M8 15l1.5 1.5L12 14M13 16h3" /></svg>
  if (name === 'shield') return <svg {...props}><path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 10 4.2-2.2 7-5.5 7-10V6l-7-3Z" /><path d="m9.3 12 1.7 1.7 3.8-4" /></svg>
  if (name === 'chevron') return <svg {...props}><path d="m9 18 6-6-6-6" /></svg>
  return <svg {...props}><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2" /></svg>
}

export default LedgerIcon
