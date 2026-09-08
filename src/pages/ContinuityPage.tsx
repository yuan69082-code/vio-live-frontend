import ContinuityCard from '../components/continuity/ContinuityCard'
import ContinuityHeader from '../components/continuity/ContinuityHeader'
import CurrentStateCard from '../components/continuity/CurrentStateCard'
import MemoryManager from '../components/memory/MemoryManager'
import { continuityMock } from '../data/continuityMock'
import type { PersonalAssistant } from '../api/personal-api'
import { useOptionalPersonal } from '../state/PersonalContext'

function ContinuityPage({ assistant = null }: { assistant?: PersonalAssistant | null }) {
  const personal = useOptionalPersonal()
  const realName = assistant?.name ?? '尚未选择助手'
  const realAvatar = assistant?.avatar?.trim() || realName.slice(0, 1) || 'V'
  return (
    <div className="continuity-page">
      <ContinuityHeader
        agentName={personal ? realName : continuityMock.agent.name}
        agentAvatar={personal ? realAvatar : continuityMock.agent.avatar}
        eyebrow={personal ? 'CONTINUITY · R5 LONG-TERM MEMORY' : undefined}
        description={personal ? '管理当前助手的真实本地长期记忆与上下文资格。' : undefined}
        badge={personal ? '服务端真实数据' : undefined}
      />

      <section className="continuity-body" aria-label="连续性信息">
        {personal && <MemoryManager key={`${personal.scope}:${assistant?.assistantId ?? 'none'}`} assistant={assistant} />}
        <div className="continuity-intro">
          <div>
            <span aria-hidden="true" />
            <strong>{personal ? '既有连续性展示原型（非 R5 记忆数据）' : '连续性快照'}</strong>
          </div>
          <small>所有内容均为模拟数据</small>
        </div>

        {continuityMock.sections.map((section) => (
          <ContinuityCard key={section.id} section={section} />
        ))}

        <CurrentStateCard {...continuityMock.state} />
      </section>
    </div>
  )
}

export default ContinuityPage
