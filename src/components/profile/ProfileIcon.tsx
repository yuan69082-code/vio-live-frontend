import type { ProfileIconName } from '../../data/profileMock'

function ProfileIcon({ name }: { name: ProfileIconName }) {
  const props = {
    'aria-hidden': true,
    className: 'profile-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'profile' || name === 'account') return <svg {...props}><circle cx="12" cy="8" r="4" /><path d="M4.8 20c.6-4 3.2-6.2 7.2-6.2s6.6 2.2 7.2 6.2" /></svg>
  if (name === 'login') return <svg {...props}><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" /></svg>
  if (name === 'link') return <svg {...props}><path d="m9.5 14.5 5-5M7.3 16.7l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M16.7 7.3l1-1a3.5 3.5 0 1 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" /></svg>
  if (name === 'agent') return <svg {...props}><circle cx="12" cy="10" r="5" /><path d="M8 16.5 6 21l6-2 6 2-2-4.5M12 3V1.5" /><circle cx="10" cy="9.5" r=".5" /><circle cx="14" cy="9.5" r=".5" /></svg>
  if (name === 'spark') return <svg {...props}><path d="M12 3.5c.7 4.6 2.4 6.3 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.7 6.3-2.4 7-7Z" /></svg>
  if (name === 'persona') return <svg {...props}><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg>
  if (name === 'rule') return <svg {...props}><path d="M5 4h14v16H5zM8 9l1.5 1.5L12 8M13 10h3M8 15l1.5 1.5L12 14M13 16h3" /></svg>
  if (name === 'appearance') return <svg {...props}><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 0-4H12a1.5 1.5 0 0 1 0-3h2.5A6.5 6.5 0 0 0 12 3Z" /><circle cx="7.5" cy="10" r=".8" /><circle cx="9.5" cy="6.8" r=".8" /><circle cx="14" cy="6.5" r=".8" /></svg>
  if (name === 'theme') return <svg {...props}><circle cx="12" cy="12" r="8" /><path d="M12 4v16M12 4a8 8 0 0 1 0 16" /></svg>
  if (name === 'background') return <svg {...props}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m5.5 17 4.2-4.5 3.2 3 2.4-2.4 3.2 3.9M16.5 8.5h.01" /></svg>
  if (name === 'bubble') return <svg {...props}><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9h8M8 12h5" /></svg>
  if (name === 'decoration') return <svg {...props}><path d="M12 3 14 8l5 2-5 2-2 5-2-5-5-2 5-2 2-5ZM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16Z" /></svg>
  if (name === 'data') return <svg {...props}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>
  if (name === 'export') return <svg {...props}><path d="M5 11v9h14v-9M12 3v12M8 7l4-4 4 4" /></svg>
  if (name === 'trash') return <svg {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
  if (name === 'backup') return <svg {...props}><path d="M7 18a5 5 0 0 1 .4-10A6 6 0 0 1 19 10.2 4 4 0 0 1 18 18H7Z" /><path d="M12 16V9M9.5 11.5 12 9l2.5 2.5" /></svg>
  if (name === 'shield') return <svg {...props}><path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 10 4.2-2.2 7-5.5 7-10V6l-7-3Z" /><path d="m9.3 12 1.7 1.7 3.8-4" /></svg>
  if (name === 'permission') return <svg {...props}><circle cx="9" cy="9" r="3" /><path d="M3.5 20c.4-4 2.2-6 5.5-6 1.8 0 3.2.6 4.1 1.7M16 13l4 2v3c0 1.8-1.2 3-4 4-2.8-1-4-2.2-4-4v-3l4-2Z" /></svg>
  if (name === 'question') return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 1 1 3.4 2c-.8.5-1.2 1-1.2 2M12 16.5h.01" /></svg>
  if (name === 'tool') return <svg {...props}><path d="M14 6.5a4 4 0 0 0-5.3 5.1L3.5 17 7 20.5l5.4-5.2A4 4 0 0 0 17.5 10l-2.2 2.2-2.5-2.5L15 7.5 14 6.5Z" /></svg>
  if (name === 'privacy' || name === 'lock') return <svg {...props}><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2" /></svg>
  if (name === 'document') return <svg {...props}><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6" /></svg>
  if (name === 'chevron') return <svg {...props}><path d="m9 18 6-6-6-6" /></svg>
  return <svg {...props}><path d="m5 12 4 4L19 6" /></svg>
}

export default ProfileIcon
