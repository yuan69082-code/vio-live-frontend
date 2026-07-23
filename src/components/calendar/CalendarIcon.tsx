import type { CalendarIconName } from '../../data/calendarMock'

function CalendarIcon({ name }: { name: CalendarIconName }) {
  const props = {
    'aria-hidden': true,
    className: 'calendar-icon',
    viewBox: '0 0 24 24',
  }

  if (name === 'back') return <svg {...props}><path d="m15 18-6-6 6-6" /></svg>
  if (name === 'previous') return <svg {...props}><path d="m14.5 17-5-5 5-5" /></svg>
  if (name === 'next') return <svg {...props}><path d="m9.5 17 5-5-5-5" /></svg>
  if (name === 'calendar') return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 10h18M7 14h2M12 14h2M17 14h.01M7 18h2M12 18h2" /></svg>
  if (name === 'anniversary') return <svg {...props}><path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z" /><path d="M12 5V3M8.5 5.5 7 4M15.5 5.5 17 4" /></svg>
  if (name === 'period') return <svg {...props}><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" /><path d="M9 15.5c.6 1.2 1.5 1.8 3 1.8" /></svg>
  if (name === 'intimacy') return <svg {...props}><path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z" /><path d="M8.5 11.5h7M12 8v7" /></svg>
  if (name === 'note') return <svg {...props}><path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" /></svg>
  if (name === 'plus') return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>
  if (name === 'chat') return <svg {...props}><path d="M5 17.5 3.8 20l3.4-1A8.5 8.5 0 1 0 4 12.3c0 1.9.6 3.7 1.7 5.1Z" /><path d="M8.2 11.8h7.6M8.2 15h4.8" /></svg>
  if (name === 'analysis') return <svg {...props}><path d="M5 19V9M10 19V5M15 19v-7M20 19V8" /><path d="m4 6 5-3 6 5 5-4" /></svg>
  if (name === 'reminder') return <svg {...props}><path d="M6.5 10.5c0-3.3 2-5.5 5.5-5.5s5.5 2.2 5.5 5.5c0 3 1.5 4 1.5 5.5H5c0-1.5 1.5-2.5 1.5-5.5ZM10 19h4" /></svg>
  if (name === 'close') return <svg {...props}><path d="m6 6 12 12M18 6 6 18" /></svg>
  return <svg {...props}><path d="m5 12 4 4L19 6" /></svg>
}

export default CalendarIcon
