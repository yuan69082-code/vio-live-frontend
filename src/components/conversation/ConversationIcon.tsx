export type ConversationIconName =
  | 'chevron'
  | 'memory'
  | 'state'
  | 'tool'
  | 'edit'
  | 'regenerate'
  | 'delete'
  | 'branch'
  | 'image'
  | 'file'
  | 'voice'
  | 'send'

function ConversationIcon({ name }: { name: ConversationIconName }) {
  const sharedProps = {
    'aria-hidden': true,
    className: 'conversation-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'chevron') {
    return (
      <svg {...sharedProps}>
        <path d="m9 6 6 6-6 6" />
      </svg>
    )
  }

  if (name === 'memory') {
    return (
      <svg {...sharedProps}>
        <path d="M8.5 4.5A3.5 3.5 0 0 0 5 8v1.2A3.7 3.7 0 0 0 3.5 12a3.5 3.5 0 0 0 2 3.2V16a3.5 3.5 0 0 0 6.5 1.8V6.2a3.5 3.5 0 0 0-3.5-1.7Z" />
        <path d="M15.5 4.5A3.5 3.5 0 0 1 19 8v1.2a3.7 3.7 0 0 1 1.5 2.8 3.5 3.5 0 0 1-2 3.2V16a3.5 3.5 0 0 1-6.5 1.8V6.2a3.5 3.5 0 0 1 3.5-1.7Z" />
      </svg>
    )
  }

  if (name === 'state') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 8v4l2.7 1.7" />
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

  if (name === 'edit') {
    return (
      <svg {...sharedProps}>
        <path d="m14.5 5.5 4 4L9 19H5v-4l9.5-9.5Z" />
      </svg>
    )
  }

  if (name === 'regenerate') {
    return (
      <svg {...sharedProps}>
        <path d="M19 8V4l-1.6 1.6A8 8 0 1 0 20 12" />
        <path d="M14.5 4.8A8 8 0 0 1 19 8" />
      </svg>
    )
  }

  if (name === 'delete') {
    return (
      <svg {...sharedProps}>
        <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
      </svg>
    )
  }

  if (name === 'branch') {
    return (
      <svg {...sharedProps}>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="7" r="2" />
        <circle cx="6" cy="19" r="2" />
        <path d="M6 7v10M8 12h3a7 7 0 0 0 7-3" />
      </svg>
    )
  }

  if (name === 'image') {
    return (
      <svg {...sharedProps}>
        <rect x="3.5" y="4" width="17" height="16" rx="3" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="m5.5 17 4-4 3 3 2.5-2.5 3.5 3.5" />
      </svg>
    )
  }

  if (name === 'file') {
    return (
      <svg {...sharedProps}>
        <path d="M6 3.5h7l5 5v12H6z" />
        <path d="M13 3.5v5h5M9 13h6M9 16h4" />
      </svg>
    )
  }

  if (name === 'voice') {
    return (
      <svg {...sharedProps}>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
      </svg>
    )
  }

  return (
    <svg {...sharedProps}>
      <path d="m5 12 14-7-4.5 14-3-5.5L5 12Z" />
      <path d="m11.5 13.5 3.3-3.3" />
    </svg>
  )
}

export default ConversationIcon
