import { ContinuityIconName } from '../../data/continuityMock'

function ContinuityIcon({ name }: { name: ContinuityIconName }) {
  const sharedProps = {
    'aria-hidden': true,
    className: 'continuity-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'identity') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5.5 19c.8-3.8 3-5.7 6.5-5.7s5.7 1.9 6.5 5.7" />
        <path d="m17.5 5 .7 1.4 1.5.7-1.5.7-.7 1.4-.7-1.4-1.5-.7 1.5-.7.7-1.4Z" />
      </svg>
    )
  }

  if (name === 'relationship') {
    return (
      <svg {...sharedProps}>
        <path d="M12 20s-7-4.3-7-9.8A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7 3.2C19 15.7 12 20 12 20Z" />
        <path d="M9.2 11.5h5.6" />
      </svg>
    )
  }

  if (name === 'thread') {
    return (
      <svg {...sharedProps}>
        <circle cx="5" cy="7" r="2" />
        <circle cx="19" cy="7" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M7 7h10M6.5 8.5 11 16M17.5 8.5 13 16" />
      </svg>
    )
  }

  if (name === 'time') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v5l3.4 2M8 3l-2 2M16 3l2 2" />
      </svg>
    )
  }

  if (name === 'thought') {
    return (
      <svg {...sharedProps}>
        <path d="M8.3 16.7A7 7 0 1 1 16 16.5c-1 .7-1.4 1.4-1.4 2.2H9.4c0-.8-.3-1.4-1.1-2Z" />
        <path d="M9.5 21h5M9.5 11.5l1.7 1.7 3.6-3.8" />
      </svg>
    )
  }

  return (
    <svg {...sharedProps}>
      <path d="M4 12h3l2-5 4 10 2-5h5" />
      <path d="M5 5.5A9 9 0 0 1 20.5 10M19 18.5A9 9 0 0 1 3.5 14" />
    </svg>
  )
}

export default ContinuityIcon
