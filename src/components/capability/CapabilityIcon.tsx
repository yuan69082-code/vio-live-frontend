import { CapabilityIconName } from '../../data/capabilityMock'

function CapabilityIcon({ name }: { name: CapabilityIconName }) {
  const sharedProps = {
    'aria-hidden': true,
    className: 'capability-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'model') {
    return (
      <svg {...sharedProps}>
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <circle cx="9" cy="10" r="1" />
        <circle cx="15" cy="10" r="1" />
        <path d="M8.5 15h7M12 4V2M2 12h2M20 12h2" />
      </svg>
    )
  }

  if (name === 'mcp') {
    return (
      <svg {...sharedProps}>
        <circle cx="5" cy="12" r="2.2" />
        <circle cx="19" cy="6" r="2.2" />
        <circle cx="19" cy="18" r="2.2" />
        <path d="M7.2 12h3.3c3 0 4.2-4 6.3-5M10.5 12c3 0 4.2 4 6.3 5" />
      </svg>
    )
  }

  if (name === 'skill') {
    return (
      <svg {...sharedProps}>
        <path d="m12 3 2.3 4.7L19.5 9l-3.8 3.7.9 5.3-4.6-2.5L7.4 18l.9-5.3L4.5 9l5.2-1.3L12 3Z" />
      </svg>
    )
  }

  if (name === 'plugin') {
    return (
      <svg {...sharedProps}>
        <path d="M8.5 3.5v4M15.5 3.5v4M6 7.5h12v3a6 6 0 0 1-5 5.9V21h-2v-4.6A6 6 0 0 1 6 10.5v-3Z" />
      </svg>
    )
  }

  if (name === 'tool') {
    return (
      <svg {...sharedProps}>
        <path d="M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.5 2.5-3-3 2.5-2.5Z" />
      </svg>
    )
  }

  if (name === 'device') {
    return (
      <svg {...sharedProps}>
        <rect x="7" y="2.5" width="10" height="19" rx="3" />
        <path d="M10.5 5h3M11 18.5h2" />
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

  if (name === 'test') {
    return (
      <svg {...sharedProps}>
        <path d="M9 3.5v5l-4.5 8a2.7 2.7 0 0 0 2.4 4h10.2a2.7 2.7 0 0 0 2.4-4l-4.5-8v-5M8 3.5h8" />
        <path d="M7.5 15h9" />
      </svg>
    )
  }

  if (name === 'shield') {
    return (
      <svg {...sharedProps}>
        <path d="M12 3.5 19 6v5.5c0 4.2-2.3 7-7 9-4.7-2-7-4.8-7-9V6l7-2.5Z" />
        <path d="M9.2 12.2 11 14l4-4" />
      </svg>
    )
  }

  if (name === 'clock') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.8 1.7" />
      </svg>
    )
  }

  if (name === 'update') {
    return (
      <svg {...sharedProps}>
        <path d="M19 8V4l-1.7 1.7A8 8 0 1 0 20 12M14.5 4.8A8 8 0 0 1 19 8" />
      </svg>
    )
  }

  if (name === 'trash') {
    return (
      <svg {...sharedProps}>
        <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
      </svg>
    )
  }

  if (name === 'settings') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.5 1a7 7 0 0 0-1.7-1L14.3 3h-4l-.4 3a7 7 0 0 0-1.7 1L5.7 6l-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.5-1a7 7 0 0 0 1.7 1l.4 3h4l.4-3a7 7 0 0 0 1.7-1l2.5 1 2-3.4-2-1.6a7 7 0 0 0 .1-1Z" />
      </svg>
    )
  }

  if (name === 'spark') {
    return (
      <svg {...sharedProps}>
        <path d="M12 3.5c.7 4.7 2.4 6.4 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.6 6.3-2.3 7-7Z" />
      </svg>
    )
  }

  if (name === 'link') {
    return (
      <svg {...sharedProps}>
        <path d="m10 14 4-4M8.5 16.5l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M15.5 7.5l1-1a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" />
      </svg>
    )
  }

  if (name === 'phone') {
    return (
      <svg {...sharedProps}>
        <rect x="7" y="2.5" width="10" height="19" rx="3" />
        <path d="M10.5 5h3M11 18.5h2" />
      </svg>
    )
  }

  return (
    <svg {...sharedProps}>
      <rect x="3" y="5" width="18" height="13" rx="2.5" />
      <path d="M8 21h8M12 18v3" />
    </svg>
  )
}

export default CapabilityIcon
