import { useState } from 'react'
import { capabilityMock } from '../../data/capabilityMock'
import CapabilityIcon from './CapabilityIcon'
import CapabilitySection from './CapabilitySection'

function ModelApiSection() {
  const [testResult, setTestResult] = useState<string | null>(null)
  const primaryService = capabilityMock.modelApi.services[0]

  return (
    <CapabilitySection
      id="model-api"
      index="01"
      eyebrow="MODEL / API"
      title="模型 / API"
      summary={`${capabilityMock.modelApi.connectedCount} 个已连接模型`}
      icon="model"
      tone="violet"
    >
      <div className="capability-model-toolbar">
        <span>
          <i aria-hidden="true" />
          已连接模型
        </span>
        <button type="button" onClick={() => setTestResult('新增服务入口 · 模拟')}>
          <CapabilityIcon name="plus" />
          新增服务
        </button>
      </div>

      <article className="capability-model-card">
        <div className="capability-model-name">
          <span className="capability-item-icon">
            <CapabilityIcon name="model" />
          </span>
          <div>
            <small>{primaryService.provider}</small>
            <strong>{primaryService.modelName}</strong>
          </div>
          <span>已连接</span>
        </div>

        <dl className="capability-model-details">
          <div>
            <dt>Base URL</dt>
            <dd>{primaryService.baseUrl}</dd>
          </div>
          <div>
            <dt>模型名称</dt>
            <dd>{primaryService.modelName}</dd>
          </div>
          <div>
            <dt>默认任务</dt>
            <dd>{primaryService.defaultTasks.join(' · ')}</dd>
          </div>
        </dl>

        <button
          className="capability-test-button"
          type="button"
          onClick={() => setTestResult('连接测试通过 · 本地模拟')}
        >
          <CapabilityIcon name="test" />
          连接测试
        </button>
      </article>

      {testResult && <p className="capability-inline-notice">{testResult}</p>}
    </CapabilitySection>
  )
}

export default ModelApiSection
