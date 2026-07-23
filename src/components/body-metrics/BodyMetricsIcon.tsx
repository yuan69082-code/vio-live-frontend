export type BodyMetricsIconName =
  | 'back'
  | 'scale'
  | 'target'
  | 'height'
  | 'measure'
  | 'trend'
  | 'calendar'
  | 'plus'
  | 'close'
  | 'save'
  | 'sparkle'
  | 'advice'
  | 'shield'

function BodyMetricsIcon({ name }: { name: BodyMetricsIconName }) {
  const props = {
    'aria-hidden': true,
    className: 'body-metrics-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'back') return <svg {...props}><path d="m15 5-7 7 7 7" /></svg>
  if (name === 'scale') return <svg {...props}><rect x="3.5" y="4" width="17" height="16" rx="4" /><path d="M8 9a4.7 4.7 0 0 1 8 0M12 9l2-2" /></svg>
  if (name === 'target') return <svg {...props}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="m15 9 5-5M17 4h3v3" /></svg>
  if (name === 'height') return <svg {...props}><path d="M8 3h8M8 21h8M12 3v18M9.5 6 12 3l2.5 3M9.5 18l2.5 3 2.5-3" /></svg>
  if (name === 'measure') return <svg {...props}><path d="M4 7.5h16v9H4z" /><path d="M7 7.5v3M10 7.5v2M13 7.5v3M16 7.5v2" /></svg>
  if (name === 'trend') return <svg {...props}><path d="M4 17 9 12l3 3 7-8" /><path d="M15 7h4v4" /></svg>
  if (name === 'calendar') return <svg {...props}><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M8 3v4M16 3v4M3.5 9.5h17" /></svg>
  if (name === 'plus') return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>
  if (name === 'close') return <svg {...props}><path d="m6 6 12 12M18 6 6 18" /></svg>
  if (name === 'save') return <svg {...props}><path d="m5 12 4 4L19 6" /></svg>
  if (name === 'sparkle') return <svg {...props}><path d="M12 3c.5 4.4 2.6 6.5 7 7-4.4.5-6.5 2.6-7 7-.5-4.4-2.6-6.5-7-7 4.4-.5 6.5-2.6 7-7Z" /><path d="M18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z" /></svg>
  if (name === 'advice') return <svg {...props}><path d="M8.5 15.5c-1.4-1-2.5-2.7-2.5-4.7a6 6 0 0 1 12 0c0 2-1.1 3.7-2.5 4.7-.7.5-1 1-1 1.8h-5c0-.8-.3-1.3-1-1.8Z" /><path d="M9.5 21h5M9.5 17.5h5" /></svg>
  if (name === 'shield') return <svg {...props}><path d="M12 3.5 19 6v5.4c0 4.5-2.8 7.4-7 9.1-4.2-1.7-7-4.6-7-9.1V6l7-2.5Z" /><path d="M12 8v5M12 16h.01" /></svg>
  return null
}

export default BodyMetricsIcon
