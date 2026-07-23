import { PrivateDirectoryItem } from '../../data/privateDomainMock'
import PrivateDomainIcon from './PrivateDomainIcon'

type PrivateDirectoryProps = {
  items: PrivateDirectoryItem[]
  onSelect: (id: string) => void
}

function PrivateDirectory({ items, onSelect }: PrivateDirectoryProps) {
  return (
    <section className="private-directory" aria-labelledby="private-directory-title">
      <div className="private-section-heading">
        <div>
          <span className="private-section-icon">
            <PrivateDomainIcon name="lock" />
          </span>
          <div>
            <small>PRIVATE DIRECTORY</small>
            <h2 id="private-directory-title">私域目录</h2>
          </div>
        </div>
        <span>4 项 · 全部锁定</span>
      </div>

      <div className="private-directory-list">
        {items.map((item) => (
          <button
            key={item.id}
            className={`private-directory-card private-directory-card-${item.tone}`}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-label={`申请查看 ${item.title}`}
          >
            <span className="private-directory-icon">
              <PrivateDomainIcon name={item.icon} />
            </span>
            <span className="private-directory-copy">
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
            <span className="private-directory-lock">
              <PrivateDomainIcon name="lock" />
              锁定
            </span>
            <PrivateDomainIcon name="chevron" />
          </button>
        ))}
      </div>
    </section>
  )
}

export default PrivateDirectory
