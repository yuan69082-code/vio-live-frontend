import { PrivateDomainIconName } from '../../data/privateDomainMock'

function PrivateDomainIcon({ name }: { name: PrivateDomainIconName }) {
  const sharedProps = {
    'aria-hidden': true,
    className: 'private-domain-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'impression') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5.5 19c.8-3.8 3-5.7 6.5-5.7s5.7 1.9 6.5 5.7" />
        <path d="m18 5 .6 1.3 1.4.6-1.4.6-.6 1.3-.6-1.3-1.4-.6 1.4-.6L18 5Z" />
      </svg>
    )
  }

  if (name === 'diary') {
    return (
      <svg {...sharedProps}>
        <path d="M6 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Z" />
        <path d="M8.5 4v16M11.5 9h4M11.5 13h4" />
      </svg>
    )
  }

  if (name === 'unspoken') {
    return (
      <svg {...sharedProps}>
        <path d="M5 16.5 4 20l3.8-1.5A8.3 8.3 0 1 0 4 12a8 8 0 0 0 1 4.5Z" />
        <circle cx="8.5" cy="12" r=".8" />
        <circle cx="12" cy="12" r=".8" />
        <circle cx="15.5" cy="12" r=".8" />
      </svg>
    )
  }

  if (name === 'anniversary') {
    return (
      <svg {...sharedProps}>
        <rect x="4" y="6.5" width="16" height="13" rx="3" />
        <path d="M8 4v5M16 4v5M4 10.5h16" />
        <path d="m12 13 .8 1.5 1.7.8-1.7.8-.8 1.5-.8-1.5-1.7-.8 1.7-.8L12 13Z" />
      </svg>
    )
  }

  if (name === 'lock') {
    return (
      <svg {...sharedProps}>
        <rect x="5" y="10" width="14" height="10" rx="3" />
        <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2.5" />
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

  if (name === 'history') {
    return (
      <svg {...sharedProps}>
        <path d="M4.5 11a8 8 0 1 1 2.2 6.2M4.5 11V6.5M4.5 11H9" />
        <path d="M12 8v4.5l3 1.5" />
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

  if (name === 'scope') {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="7.5" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5" />
      </svg>
    )
  }

  if (name === 'record') {
    return (
      <svg {...sharedProps}>
        <rect x="5" y="3.5" width="14" height="17" rx="3" />
        <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
      </svg>
    )
  }

  if (name === 'back') {
    return (
      <svg {...sharedProps}>
        <path d="m14.5 5-7 7 7 7" />
      </svg>
    )
  }

  if (name === 'send') {
    return (
      <svg {...sharedProps}>
        <path d="m4 11.5 16-7-5 15-3.5-6L4 11.5Z" />
        <path d="m11.5 13.5 3.5-3.5" />
      </svg>
    )
  }

  return (
    <svg {...sharedProps}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export default PrivateDomainIcon
