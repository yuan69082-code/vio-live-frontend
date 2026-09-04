import { useState } from 'react'
import CapabilityHeader from '../components/capability/CapabilityHeader'
import DeviceSection from '../components/capability/DeviceSection'
import McpSection from '../components/capability/McpSection'
import ProviderManager from '../components/personal/ProviderManager'
import PluginSection from '../components/capability/PluginSection'
import SkillSection from '../components/capability/SkillSection'
import ToolSection from '../components/capability/ToolSection'
import DeviceCenterPage from './DeviceCenterPage'

function CapabilityCenterPage() {
  const [showDeviceCenter, setShowDeviceCenter] = useState(false)

  if (showDeviceCenter) {
    return <DeviceCenterPage onBack={() => setShowDeviceCenter(false)} />
  }

  return (
    <div className="capability-page">
      <CapabilityHeader />

      <section className="capability-body" aria-label="能力中心内容">
        <ProviderManager />
        <p>以下 MCP、Skill、插件、Tool 与设备保留已有原型；真实执行归属后续阶段，不计入 R2 接通结果。</p>
        <McpSection />
        <SkillSection />
        <PluginSection />
        <ToolSection />
        <DeviceSection onOpenDeviceCenter={() => setShowDeviceCenter(true)} />
      </section>
    </div>
  )
}

export default CapabilityCenterPage
