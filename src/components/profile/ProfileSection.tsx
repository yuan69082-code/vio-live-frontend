import type { PropsWithChildren } from 'react'
import type { ProfileIconName } from '../../data/profileMock'
import ProfileIcon from './ProfileIcon'

type ProfileSectionProps = PropsWithChildren<{
  index: string
  eyebrow: string
  title: string
  summary: string
  icon: ProfileIconName
  tone?: 'purple' | 'blue' | 'rose' | 'aqua' | 'gold' | 'slate'
}>

function ProfileSection({ index, eyebrow, title, summary, icon, tone = 'purple', children }: ProfileSectionProps) {
  return (
    <section className={`profile-section profile-section-${tone}`} aria-labelledby={`profile-section-${index}`}>
      <div className="profile-section-heading">
        <span><ProfileIcon name={icon} /></span>
        <div><small>{eyebrow}</small><h2 id={`profile-section-${index}`}>{title}</h2><p>{summary}</p></div>
        <span>{index} / 06</span>
      </div>
      {children}
    </section>
  )
}

export default ProfileSection
