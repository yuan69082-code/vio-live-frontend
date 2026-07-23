import type { DeviceIconName } from '../../data/deviceMock'

function DeviceIcon({ name }: { name: DeviceIconName }) {
  const props = {
    'aria-hidden': true,
    className: 'device-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'back') return <svg {...props}><path d="m15 18-6-6 6-6" /></svg>
  if (name === 'chevron') return <svg {...props}><path d="m9 18 6-6-6-6" /></svg>
  if (name === 'devices') return <svg {...props}><rect x="3.5" y="4" width="11" height="16" rx="3" /><path d="M8 17h2M17.5 7.5h3v9h-3M17.5 11h3" /></svg>
  if (name === 'lamp') return <svg {...props}><path d="M8 15h8M10 15v4h4v-4M7 12h10l-2.5-8h-5L7 12Z" /></svg>
  if (name === 'air') return <svg {...props}><path d="M4 8h9.5a2.5 2.5 0 1 0-2.3-3.5M4 12h14a2.5 2.5 0 1 1-2.3 3.5M4 16h6" /></svg>
  if (name === 'camera') return <svg {...props}><rect x="3" y="6" width="18" height="13" rx="3" /><circle cx="12" cy="12.5" r="3.3" /><path d="m8 6 1.3-2h5.4L16 6" /></svg>
  if (name === 'lock') return <svg {...props}><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2" /></svg>
  if (name === 'power') return <svg {...props}><path d="M12 3v8M7.3 6.7a7 7 0 1 0 9.4 0" /></svg>
  if (name === 'plus') return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>
  if (name === 'link') return <svg {...props}><path d="m9.5 14.5 5-5M7.3 16.7l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M16.7 7.3l1-1a3.5 3.5 0 1 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" /></svg>
  if (name === 'shield') return <svg {...props}><path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 10 4.2-2.2 7-5.5 7-10V6l-7-3Z" /><path d="m9.3 12 1.7 1.7 3.8-4" /></svg>
  if (name === 'automation') return <svg {...props}><path d="M7 7h10v10H7zM3 12h4M17 12h4M12 3v4M12 17v4" /><circle cx="12" cy="12" r="2" /></svg>
  if (name === 'log') return <svg {...props}><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6" /></svg>
  if (name === 'location') return <svg {...props}><path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></svg>
  if (name === 'activity') return <svg {...props}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
  if (name === 'stop') return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" /></svg>
  if (name === 'revoke') return <svg {...props}><path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 10 4.2-2.2 7-5.5 7-10V6l-7-3ZM8 8l8 8" /></svg>
  if (name === 'info') return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  if (name === 'permission') return <svg {...props}><circle cx="9" cy="9" r="3" /><path d="M3.5 20c.4-4 2.2-6 5.5-6 1.8 0 3.2.6 4.1 1.7M16 13l4 2v3c0 1.8-1.2 3-4 4-2.8-1-4-2.2-4-4v-3l4-2Z" /></svg>
  return <svg {...props}><path d="M6 8V5M18 8V5M7 8h10a2 2 0 0 1 2 2v3a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5v-3a2 2 0 0 1 2-2ZM12 18v3" /></svg>
}

export default DeviceIcon
