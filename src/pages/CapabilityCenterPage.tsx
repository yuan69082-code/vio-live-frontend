import CapabilityHeader from '../components/capability/CapabilityHeader'
import DeviceSection from '../components/capability/DeviceSection'
import McpSection from '../components/capability/McpSection'
import ModelApiSection from '../components/capability/ModelApiSection'
import PluginSection from '../components/capability/PluginSection'
import SkillSection from '../components/capability/SkillSection'
import ToolSection from '../components/capability/ToolSection'
import { capabilityMock } from '../data/capabilityMock'

function CapabilityCenterPage() {
  return (
    <div className="capability-page">
      <CapabilityHeader />

      <section className="capability-body" aria-label="能力中心内容">
        <div className="capability-summary" aria-label="能力概览">
          <div>
            <span>{capabilityMock.summary.connected}</span>
            <small>已连接</small>
          </div>
          <div>
            <span>{capabilityMock.summary.active}</span>
            <small>已启用</small>
          </div>
          <div>
            <span>{capabilityMock.summary.needsAttention}</span>
            <small>待处理</small>
          </div>
          <p>当前均为本地模拟配置，不会发起真实连接。</p>
        </div>

        <ModelApiSection />
        <McpSection />
        <SkillSection />
        <PluginSection />
        <ToolSection />
        <DeviceSection />
      </section>
    </div>
  )
}

export default CapabilityCenterPage
