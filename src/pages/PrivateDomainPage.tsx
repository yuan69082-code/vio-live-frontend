import { useState } from 'react'
import AccessRequestPanel from '../components/private-domain/AccessRequestPanel'
import PrivateDirectory from '../components/private-domain/PrivateDirectory'
import PrivateDomainHeader from '../components/private-domain/PrivateDomainHeader'
import PrivateDomainIcon from '../components/private-domain/PrivateDomainIcon'
import ViewRecords from '../components/private-domain/ViewRecords'
import { privateDomainMock } from '../data/privateDomainMock'

function PrivateDomainPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const selectedItem = privateDomainMock.directory.find(
    (item) => item.id === selectedId,
  )

  function handleSelect(id: string) {
    setSelectedId(id)
    setReason('')
    setSubmitted(false)
  }

  function handleBack() {
    setSelectedId(null)
    setReason('')
    setSubmitted(false)
  }

  return (
    <div className="private-domain-page">
      <PrivateDomainHeader />

      <div className="private-domain-body">
        {selectedItem ? (
          <AccessRequestPanel
            item={selectedItem}
            reason={reason}
            submitted={submitted}
            onReasonChange={setReason}
            onSubmit={() => setSubmitted(true)}
            onBack={handleBack}
          />
        ) : (
          <>
            <section className="private-domain-intro" aria-label="AI 私域说明">
              <span className="private-domain-intro-icon">
                <PrivateDomainIcon name="lock" />
              </span>
              <div>
                <small>独立边界</small>
                <h2>有些内容，需要先申请再靠近</h2>
                <p>所有条目默认锁定；每次开放范围由预设模拟状态决定。</p>
              </div>
            </section>

            <PrivateDirectory
              items={privateDomainMock.directory}
              onSelect={handleSelect}
            />
            <ViewRecords records={privateDomainMock.records} />
          </>
        )}
      </div>
    </div>
  )
}

export default PrivateDomainPage
