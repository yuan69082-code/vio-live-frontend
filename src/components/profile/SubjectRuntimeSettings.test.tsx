import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import styles from '../../styles.css?inline'
import {
  SUBJECT_RUNTIME_PORT_VERSION,
  SubjectRuntimeApiError,
} from '../../api'
import type { SubjectRuntimeApi, SubjectRuntimeStatusRead } from '../../api'
import ProfilePage from '../../pages/ProfilePage'

const readAt = '2026-08-25T08:00:00.000Z'

function noneRead(): SubjectRuntimeStatusRead {
  return {
    readAt,
    status: {
      portVersion: SUBJECT_RUNTIME_PORT_VERSION,
      mode: 'none',
      adapterId: 'none',
      adapterKind: 'none',
      adapterVersion: 'none-adapter/v1',
      state: 'disconnected',
      platformStatus: 'available',
      runtimeStatus: 'not_configured',
      runtimeName: null,
      runtimeVersion: null,
      capabilities: [],
      reason: 'external_runtime_not_configured',
      versionNegotiation: {
        portVersion: SUBJECT_RUNTIME_PORT_VERSION,
        adapterId: 'none',
        status: 'compatible',
        selectedVersion: SUBJECT_RUNTIME_PORT_VERSION,
        reason: 'version_match',
      },
      externalCall: 'not_performed',
    },
  }
}

function externalRead(
  state: 'disconnected' | 'connecting' | 'ready' | 'degraded' | 'incompatible' | 'paused' | 'reconnecting' = 'ready',
): SubjectRuntimeStatusRead {
  const incompatible = state === 'incompatible'
  const runtimeStatus = {
    disconnected: 'disconnected',
    connecting: 'connecting',
    ready: 'available',
    degraded: 'degraded',
    incompatible: 'incompatible',
    paused: 'paused',
    reconnecting: 'connecting',
  } as const
  return {
    readAt,
    status: {
      portVersion: SUBJECT_RUNTIME_PORT_VERSION,
      mode: 'external',
      adapterId: 'third-party.example',
      adapterKind: 'third_party',
      adapterVersion: 'example-adapter/v1',
      state,
      platformStatus: 'available',
      runtimeStatus: runtimeStatus[state],
      runtimeName: 'Example Runtime',
      runtimeVersion: 'example-runtime/v1',
      capabilities: ['observation_input', 'expression_result', 'state_projection'],
      reason: null,
      versionNegotiation: {
        portVersion: SUBJECT_RUNTIME_PORT_VERSION,
        adapterId: 'third-party.example',
        status: incompatible ? 'incompatible' : 'compatible',
        selectedVersion: incompatible ? null : SUBJECT_RUNTIME_PORT_VERSION,
        reason: incompatible ? 'no_common_port_version' : 'version_match',
      },
      externalCall: 'not_performed',
    },
  }
}

function apiWith(getStatus: SubjectRuntimeApi['getStatus']): SubjectRuntimeApi {
  return { getStatus }
}

describe('R0-C Subject Runtime settings', () => {
  it('reads once on entry and presents None Adapter as normal independent Vio operation', async () => {
    const getStatus = vi.fn(async () => noneRead())
    render(<ProfilePage runtimeApi={apiWith(getStatus)} />)

    expect(screen.getByText('正在读取主体运行时状态…')).toBeInTheDocument()
    expect(await screen.findByText('Vio 可独立使用')).toBeInTheDocument()
    expect(screen.getByText('未配置外部主体运行时')).toBeInTheDocument()
    expect(screen.getByText('未连接（正常）')).toBeInTheDocument()
    expect(screen.getByText('可用')).toBeInTheDocument()
    expect(screen.queryByText(/Engine 故障|系统异常|服务不可用/)).not.toBeInTheDocument()
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('shows a third-party runtime identity, version, negotiated capabilities, and read time', async () => {
    const getStatus = vi.fn(async () => externalRead())
    render(<ProfilePage runtimeApi={apiWith(getStatus)} />)

    expect(await screen.findByText('Example Runtime')).toBeInTheDocument()
    expect(screen.getByText('example-runtime/v1')).toBeInTheDocument()
    expect(screen.getByText('third-party.example')).toBeInTheDocument()
    expect(screen.getByText('third_party')).toBeInTheDocument()
    expect(screen.getByText('example-adapter/v1')).toBeInTheDocument()
    expect(screen.getByText('状态投影')).toBeInTheDocument()
    expect(screen.getByText('兼容 · version_match')).toBeInTheDocument()
    expect(screen.getByText(/最后读取：/).closest('time')).toHaveAttribute('datetime', readAt)
    expect(screen.queryByText('Continuity Engine')).not.toBeInTheDocument()
  })

  it.each([
    ['disconnected', '未连接'],
    ['connecting', '连接中'],
    ['degraded', '已降级'],
    ['paused', '已暂停'],
    ['reconnecting', '断开后重连中'],
  ] as const)('keeps %s distinct as %s', async (state, label) => {
    render(<ProfilePage runtimeApi={apiWith(vi.fn(async () => externalRead(state)))} />)
    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('makes an incompatible negotiation explicit and never labels it ready', async () => {
    render(<ProfilePage runtimeApi={apiWith(vi.fn(async () => externalRead('incompatible')))} />)

    expect(await screen.findByText('端口协议不兼容')).toBeInTheDocument()
    expect(screen.getByText(/不会被显示为已就绪/)).toBeInTheDocument()
    expect(screen.getByText('不兼容 · no_common_port_version')).toBeInTheDocument()
    expect(screen.queryByText('已就绪')).not.toBeInTheDocument()
  })

  it('shows backend unavailability and makes one additional request per manual retry', async () => {
    const getStatus = vi.fn()
      .mockRejectedValueOnce(new SubjectRuntimeApiError('offline', 'backend_unavailable'))
      .mockResolvedValueOnce(noneRead())
    render(<ProfilePage runtimeApi={apiWith(getStatus)} />)

    expect(await screen.findByText('Vio 本地后端暂时无法访问')).toBeInTheDocument()
    expect(screen.getByText(/未采用缓存状态/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))

    expect(await screen.findByText('Vio 可独立使用')).toBeInTheDocument()
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['timeout', '主体运行时状态读取超时'],
    ['incompatible_response', '主体运行时状态响应不兼容'],
  ] as const)('shows the exact %s error without a fabricated current status', async (code, label) => {
    const getStatus = vi.fn(async () => {
      throw new SubjectRuntimeApiError('failed', code)
    })
    render(<ProfilePage runtimeApi={apiWith(getStatus)} />)

    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.queryByText('Vio 可独立使用')).not.toBeInTheDocument()
    expect(screen.queryByText('Example Runtime')).not.toBeInTheDocument()
  })

  it('aborts an unfinished read when the settings page unmounts', async () => {
    let observedSignal: AbortSignal | undefined
    const getStatus = vi.fn((_options) => {
      observedSignal = _options.signal
      return new Promise<SubjectRuntimeStatusRead>(() => undefined)
    })
    const view = render(<ProfilePage runtimeApi={apiWith(getStatus)} />)
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1))

    view.unmount()

    expect(observedSignal?.aborted).toBe(true)
  })

  it('does not poll after the single automatic settings read', async () => {
    vi.useFakeTimers()
    const getStatus = vi.fn(async () => noneRead())
    render(<ProfilePage runtimeApi={apiWith(getStatus)} />)
    await act(async () => Promise.resolve())

    await act(async () => vi.advanceTimersByTimeAsync(120_000))

    expect(getStatus).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('keeps the local-settings disclosure accurate and leaves other settings explicitly unconnected', async () => {
    render(<ProfilePage runtimeApi={apiWith(vi.fn(async () => noneRead()))} />)
    await screen.findByText('Vio 可独立使用')

    expect(screen.getByText(/主体运行时状态来自当前 Vio 本地后端/)).toBeInTheDocument()
    expect(screen.getByText(/不会连接或操作外部运行时/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^数据导出/ }))
    expect(screen.getByText('数据导出入口 · 未执行真实操作')).toBeInTheDocument()
  })

  it.each([320, 360])('keeps all runtime facts visible without a wide fixed layout at %ipx', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    render(<ProfilePage runtimeApi={apiWith(vi.fn(async () => externalRead()))} />)

    expect(await screen.findByText('Example Runtime')).toBeVisible()
    expect(screen.getByText('vio-subject-runtime-port/v1')).toBeVisible()
    expect(screen.getByText('example-adapter/v1')).toBeVisible()
    expect(styles).toContain('.subject-runtime-facts')
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(styles).toContain('overflow-wrap: anywhere;')
  })
})
