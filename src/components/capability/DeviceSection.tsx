import CapabilitySection from './CapabilitySection'

function DeviceSection() {
  return (
    <CapabilitySection
      id="device"
      index="06"
      eyebrow="PHONE / DEVICES"
      title="手机 / 设备入口"
      summary="0 个已验证连接 · R9 未施工"
      icon="device"
      tone="slate"
    >
      <div className="capability-list" role="status">
        <p>设备接入与控制属于 R9。当前页面不展示模拟连接、模拟授权或可执行控制。</p>
      </div>
    </CapabilitySection>
  )
}

export default DeviceSection
