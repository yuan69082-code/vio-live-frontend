import CapabilityHeader from '../components/capability/CapabilityHeader'
import DeviceSection from '../components/capability/DeviceSection'
import ProviderManager from '../components/personal/ProviderManager'
import UnifiedCapabilityManager from '../components/capability/UnifiedCapabilityManager'

function CapabilityCenterPage() {
  return (
    <div className="capability-page">
      <CapabilityHeader />

      <section className="capability-body" aria-label="能力中心内容">
        <ProviderManager />
        <UnifiedCapabilityManager />
        <DeviceSection />
      </section>
    </div>
  )
}

export default CapabilityCenterPage
