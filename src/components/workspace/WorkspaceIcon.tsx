export type WorkspaceIconName =
  | 'target'
  | 'check'
  | 'bell'
  | 'device'
  | 'memory'
  | 'state'
  | 'tool'
  | 'permission'
  | 'unfinished'
  | 'chat'
  | 'continuity'
  | 'plug'
  | 'plus'
  | 'send'

function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
  const sharedProps = {
    'aria-hidden': true,
    className: 'workspace-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'target') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="7.5" />
        <circle cx="12" cy="12" r="3" />
        <path d="m15.5 8.5 4-4M16 4.5h3.5V8" />
      </svg>
    )
  }

  if (name === 'check') {
    return (
      <svg {...sharedProps}>
        <rect x="4" y="4" width="16" height="16" rx="5" />
        <path d="m8.2 12.3 2.5 2.5 5.4-5.7" />
      </svg>
    )
  }

  if (name === 'bell') {
    return (
      <svg {...sharedProps}>
        <path d="M6.5 10.5c0-3.3 2-5.5 5.5-5.5s5.5 2.2 5.5 5.5c0 3 1.5 4 1.5 5.5H5c0-1.5 1.5-2.5 1.5-5.5Z" />
        <path d="M10 19h4" />
      </svg>
    )
  }

  if (name === 'device' || name === 'plug') {
    return (
      <svg {...sharedProps}>
        <rect x="6" y="3.5" width="12" height="17" rx="3" />
        <path d="M10 6.5h4M10.5 17.5h3" />
      </svg>
    )
  }

  if (name === 'memory') {
    return (
      <svg {...sharedProps}>
        <path d="M8 5.5A3.5 3.5 0 0 0 4.5 9c0 1 .4 2 1.1 2.6A4 4 0 0 0 9 18h1V7.5a2 2 0 0 0-2-2ZM16 5.5A3.5 3.5 0 0 1 19.5 9c0 1-.4 2-1.1 2.6A4 4 0 0 1 15 18h-1V7.5a2 2 0 0 1 2-2Z" />
        <path d="M7 10h3M14 10h3M7.5 14H10M14 14h2.5" />
      </svg>
    )
  }

  if (name === 'state') {
    return (
      <svg {...sharedProps}>
        <path d="M4 14.5h3l2-6 3.3 9 2.2-6H20" />
      </svg>
    )
  }

  if (name === 'tool') {
    return (
      <svg {...sharedProps}>
        <path d="M14.5 6.2a4 4 0 0 0-5.2 5.2L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.2-5.2l-2.5 2.1-2.9-2.9 2.1-2.5Z" />
      </svg>
    )
  }

  if (name === 'permission') {
    return (
      <svg {...sharedProps}>
        <path d="M12 3.5 19 6v5.4c0 4.5-2.8 7.4-7 9.1-4.2-1.7-7-4.6-7-9.1V6l7-2.5Z" />
        <path d="m8.8 12 2 2 4.3-4.3" />
      </svg>
    )
  }

  if (name === 'unfinished') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    )
  }

  if (name === 'chat') {
    return (
      <svg {...sharedProps}>
        <path d="M5 17.5 3.8 20l3.4-1A8.5 8.5 0 1 0 4 12.3c0 1.9.6 3.7 1.7 5.1Z" />
        <path d="M8.2 11.8h7.6M8.2 15h4.8" />
      </svg>
    )
  }

  if (name === 'continuity') {
    return (
      <svg {...sharedProps}>
        <path d="M8.1 8.2C5.7 8.2 4 9.8 4 12s1.7 3.8 4.1 3.8c3.9 0 4.1-7.6 7.8-7.6 2.4 0 4.1 1.6 4.1 3.8s-1.7 3.8-4.1 3.8" />
      </svg>
    )
  }

  if (name === 'plus') {
    return (
      <svg {...sharedProps}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    )
  }

  if (name === 'send') {
    return (
      <svg {...sharedProps}>
        <path d="m4 12 16-7-5.5 14-3-5.5L4 12Z" />
        <path d="m11.5 13.5 4-4" />
      </svg>
    )
  }

  return null
}

export default WorkspaceIcon
