import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SubjectRuntimeApiError,
  subjectRuntimeApi,
} from '../../api'
import type {
  SubjectRuntimeApi,
  SubjectRuntimeCapability,
  SubjectRuntimeConnectionState,
  SubjectRuntimeStatusRead,
} from '../../api'

const stateLabels: Record<SubjectRuntimeConnectionState, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  ready: '已就绪',
  degraded: '已降级',
  incompatible: '端口协议不兼容',
  paused: '已暂停',
  reconnecting: '断开后重连中',
}

const capabilityLabels: Record<SubjectRuntimeCapability, string> = {
  observation_input: '观察输入',
  expression_result: '主体表达',
  state_projection: '状态投影',
  cancellation: '取消操作',
  recovery: '恢复操作',
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'success'; value: SubjectRuntimeStatusRead }
  | { kind: 'error'; code: SubjectRuntimeApiError['code'] }

function errorCopy(code: SubjectRuntimeApiError['code']) {
  if (code === 'timeout') {
    return {
      title: '主体运行时状态读取超时',
      detail: '本地后端没有在规定时间内返回状态，请稍后重新读取。',
    }
  }
  if (code === 'incompatible_response') {
    return {
      title: '主体运行时状态响应不兼容',
      detail: '返回内容未通过 Subject Runtime Port v1 严格校验，当前状态不会被采用。',
    }
  }
  if (code === 'cancelled') {
    return {
      title: '主体运行时状态读取已取消',
      detail: '本次只读请求已停止，没有执行外部运行时操作。',
    }
  }
  return {
    title: 'Vio 本地后端暂时无法访问',
    detail: '请确认本地后端正在运行，然后重新读取。',
  }
}

function statusTone(state: SubjectRuntimeConnectionState) {
  if (state === 'ready') return 'ready'
  if (state === 'degraded' || state === 'reconnecting') return 'warning'
  if (state === 'incompatible') return 'danger'
  if (state === 'paused') return 'paused'
  return 'neutral'
}

function formatReadTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function SubjectRuntimeSettings({ api = subjectRuntimeApi }: { api?: SubjectRuntimeApi }) {
  const [view, setView] = useState<ViewState>({ kind: 'loading' })
  const mountedRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)

  const readStatus = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setView({ kind: 'loading' })

    try {
      const value = await api.getStatus({ signal: controller.signal })
      if (mountedRef.current && controllerRef.current === controller) {
        setView({ kind: 'success', value })
      }
    } catch (error) {
      if (!mountedRef.current || controllerRef.current !== controller) return
      const code = error instanceof SubjectRuntimeApiError
        ? error.code
        : 'incompatible_response'
      setView({ kind: 'error', code })
    }
  }, [api])

  useEffect(() => {
    mountedRef.current = true
    void readStatus()
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [readStatus])

  return (
    <section className="subject-runtime-settings" aria-labelledby="subject-runtime-settings-title">
      <header className="subject-runtime-settings-heading">
        <div>
          <span>SUBJECT RUNTIME</span>
          <h2 id="subject-runtime-settings-title">主体运行时</h2>
          <p>来自当前 Vio 本地后端的只读状态</p>
        </div>
        <button
          type="button"
          disabled={view.kind === 'loading'}
          onClick={() => void readStatus()}
        >
          {view.kind === 'loading' ? '读取中…' : '重新读取'}
        </button>
      </header>

      <div className="subject-runtime-settings-content" role="status" aria-live="polite" aria-atomic="true">
        {view.kind === 'loading' ? (
          <div className="subject-runtime-loading">
            <span aria-hidden="true" />
            <div><strong>正在读取主体运行时状态…</strong><small>仅访问当前 Vio 本地后端</small></div>
          </div>
        ) : view.kind === 'error' ? (
          <div className="subject-runtime-error">
            <span aria-hidden="true">!</span>
            <div>
              <strong>{errorCopy(view.code).title}</strong>
              <p>{errorCopy(view.code).detail}</p>
              <small>未采用缓存状态，也没有连接或操作外部运行时。</small>
            </div>
          </div>
        ) : (
          <RuntimeStatusDetails value={view.value} />
        )}
      </div>
    </section>
  )
}

function RuntimeStatusDetails({ value }: { value: SubjectRuntimeStatusRead }) {
  const { status, readAt } = value
  const isNone = status.mode === 'none'
  const connectionLabel = isNone ? '未连接（正常）' : stateLabels[status.state]
  const headline = isNone ? 'Vio 可独立使用' : status.runtimeName
  const summary = isNone
    ? '未配置外部主体运行时'
    : `当前使用 ${status.adapterKind === 'third_party' ? '第三方' : '外部'}主体运行时适配器`

  return (
    <div className="subject-runtime-details" data-state={status.state}>
      <div className={`subject-runtime-summary is-${isNone ? 'standalone' : statusTone(status.state)}`}>
        <div>
          <small>{isNone ? 'INDEPENDENT MODE' : 'EXTERNAL RUNTIME'}</small>
          <strong>{headline}</strong>
          <p>{summary}</p>
        </div>
        <span>{connectionLabel}</span>
      </div>

      {status.state === 'incompatible' ? (
        <p className="subject-runtime-alert">端口协议不兼容；该外部运行时不会被显示为已就绪。</p>
      ) : null}

      <dl className="subject-runtime-facts">
        <div><dt>Vio 平台</dt><dd>{status.platformStatus === 'available' ? '可用' : status.platformStatus}</dd></div>
        <div><dt>运行方式</dt><dd>{isNone ? '独立运行' : '外部运行时'}</dd></div>
        <div><dt>运行时状态</dt><dd>{isNone ? '未配置' : status.runtimeStatus}</dd></div>
        <div><dt>运行时版本</dt><dd>{status.runtimeVersion ?? '未提供'}</dd></div>
        <div><dt>Adapter ID</dt><dd>{status.adapterId}</dd></div>
        <div><dt>Adapter 种类</dt><dd>{status.adapterKind}</dd></div>
        <div><dt>Adapter 版本</dt><dd>{status.adapterVersion}</dd></div>
        <div><dt>Port Version</dt><dd>{status.portVersion}</dd></div>
        <div>
          <dt>版本协商</dt>
          <dd>{status.versionNegotiation.status === 'compatible' ? '兼容' : '不兼容'} · {status.versionNegotiation.reason}</dd>
        </div>
        <div><dt>状态原因</dt><dd>{status.reason ?? '无'}</dd></div>
      </dl>

      <div className="subject-runtime-capabilities">
        <strong>已协商能力</strong>
        {status.capabilities.length === 0 ? (
          <p>无（独立运行不伪造外部能力）</p>
        ) : (
          <ul>
            {status.capabilities.map((capability) => (
              <li key={capability}>{capabilityLabels[capability]}<small>{capability}</small></li>
            ))}
          </ul>
        )}
      </div>

      <footer className="subject-runtime-read-meta">
        <span>只读查询 · 未执行外部调用</span>
        <time dateTime={readAt}>最后读取：{formatReadTime(readAt)}</time>
      </footer>
    </div>
  )
}

export default SubjectRuntimeSettings
