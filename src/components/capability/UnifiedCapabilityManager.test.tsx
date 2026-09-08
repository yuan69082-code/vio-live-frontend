import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../../api/client'
import { CAPABILITY_CATALOG_VERSION, CAPABILITY_EXECUTION_LIST_VERSION, CAPABILITY_EXECUTION_VERSION } from '../../api/personal-capability-api'
import { writeCapabilityRecovery } from '../../api/personal-capability-recovery'
import type { PersonalApi, PersonalRequestOptions, PersonalSession } from '../../api/personal-api'
import { PersonalProvider, usePersonal } from '../../state/PersonalContext'
import { sessionFixture } from '../../test/personal-fixtures'
import UnifiedCapabilityManager from './UnifiedCapabilityManager'

const at = '2026-09-08T00:00:00.000Z'
const digest = `sha256:${'a'.repeat(64)}`
type Request = (path: string, method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown, options?: PersonalRequestOptions) => Promise<unknown>

function capability(category: 'local_tool' | 'mcp_tool' | 'skill' | 'plugin_action' = 'local_tool', id = `cap-${category}`) {
  return { capabilityId: id, category, name: `${category} test`, version: '1', status: 'enabled', lifecycleStatus: 'installed', operations: ['execute'], externalCall: 'not_performed' }
}
function catalog(items = [capability()]) { return { schemaVersion: CAPABILITY_CATALOG_VERSION, items } }
function execution(status: 'waiting_confirmation' | 'retryable' | 'outcome_unknown' | 'succeeded' | 'cancelled' = 'succeeded', id = 'execution-r6') {
  return {
    schemaVersion: CAPABILITY_EXECUTION_VERSION, executionId: id, category: 'local_tool', capabilityId: 'cap-local_tool', capabilityVersion: '1', operationName: 'execute', status,
    attemptCount: status === 'succeeded' ? 1 : 0, inputHash: digest,
    confirmation: status === 'waiting_confirmation' ? { confirmationId: 'confirmation-r6', status: 'pending' } : null,
    result: status === 'succeeded' ? { status: 'succeeded', contentHash: digest, output: { length: 7, lines: 1 }, usage: { status: 'not_incurred', inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: { status: 'not_incurred', amountMicros: null, currency: null } } : null,
    error: null, createdAt: at, updatedAt: at, completedAt: ['succeeded', 'cancelled'].includes(status) ? at : null, externalCall: status === 'outcome_unknown' ? 'possibly_performed' : 'not_performed',
  }
}
function history(items: ReturnType<typeof execution>[] = []) { return { schemaVersion: CAPABILITY_EXECUTION_LIST_VERSION, items, nextCursor: null } }
function operation(operationStatus: 'completed' | 'confirmation_required', item = capability()) {
  return operationStatus === 'completed'
    ? { operationStatus, capability: item, discovery: null, security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: null, externalCall: 'not_performed' }
    : { operationStatus, capability: null, discovery: null, security: { decision: 'confirm', confirmationId: 'confirmation-config-r6', confirmationStatus: 'pending' }, error: null, externalCall: 'not_performed' }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept }); return { promise, resolve } }

function personalApi(request: Request, session: PersonalSession = sessionFixture()): PersonalApi {
  return { request: request as PersonalApi['request'], setSession: vi.fn(), setDeletionAccess: vi.fn(), onUnauthorized: vi.fn(), session: vi.fn().mockResolvedValue(session) } as unknown as PersonalApi
}
function Harness({ api, strict = false, switcher = false }: { api: PersonalApi; strict?: boolean; switcher?: boolean }) {
  const view = <PersonalProvider api={api}><Inner switcher={switcher} /></PersonalProvider>
  return strict ? <StrictMode>{view}</StrictMode> : view
}
function Inner({ switcher }: { switcher: boolean }) {
  const personal = usePersonal()
  if (personal.state.kind !== 'ready') return <p>正在验证</p>
  const session = personal.state.session
  return <>{switcher && <button type="button" onClick={() => personal.acceptSession({ ...session, currentAssistantId: session.currentAssistantId === 'test-beta' ? 'test-alpha' : 'test-beta', selectionVersion: session.selectionVersion + 1 })}>切换助手</button>}<UnifiedCapabilityManager /></>
}

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear() })

describe('R6 UnifiedCapabilityManager', () => {
  it('loads the current assistant catalog and immutable execution history from the server', async () => {
    const request = vi.fn<Request>(async (path) => {
      if (path === '/capabilities') return catalog([capability('local_tool'), capability('mcp_tool')])
      if (path.startsWith('/capability-executions?')) return history([execution()])
      throw new Error(`unexpected ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    expect(await screen.findAllByText('local_tool test')).not.toHaveLength(0)
    expect(screen.getAllByText('mcp_tool test')).not.toHaveLength(0)
    expect(screen.getByText('已成功 · 尝试 1 次')).toBeInTheDocument()
    expect(screen.queryByText('能力结果已由服务端持久化。')).not.toBeInTheDocument()
    expect(request.mock.calls.some(([path]) => path.includes('limit=25'))).toBe(true)
  })

  it('prevents duplicate install, resumes one confirmed request with the same key, and reloads catalog', async () => {
    let installed = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    const request = vi.fn<Request>(async (path, method, body) => {
      if (path === '/capabilities') return catalog(installed ? [capability()] : [])
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capabilities/local-tools' && method === 'POST') {
        if (!(body as { confirmationId?: string }).confirmationId) return operation('confirmation_required')
        installed = true; return operation('completed')
      }
      if (path === '/confirmations/confirmation-config-r6/decision' && method === 'POST') return {}
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} strict />)
    expect(await screen.findAllByText('当前助手尚无此类已安装能力。')).not.toHaveLength(0)
    const install = screen.getByRole('button', { name: '安装 builtin.text.inspect/v1' })
    act(() => { fireEvent.click(install); fireEvent.click(install) })
    expect(await screen.findByRole('group', { name: 'R6 配置安全确认' })).toBeInTheDocument()
    const first = request.mock.calls.find(([path]) => path === '/capabilities/local-tools')!
    expect(request.mock.calls.filter(([path]) => path === '/capabilities/local-tools')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '批准本次配置' }))
    expect(await screen.findByText('安装内置文本检查工具已由服务端确认完成。')).toBeInTheDocument()
    const writes = request.mock.calls.filter(([path]) => path === '/capabilities/local-tools')
    expect(writes).toHaveLength(2)
    expect(writes[0][3]?.idempotencyKey).toBe(first[3]?.idempotencyKey)
    expect(writes[1][3]?.idempotencyKey).toBe(first[3]?.idempotencyKey)
    expect(writes[1][2]).toEqual({ definitionId: 'builtin.text.inspect/v1', confirmationId: 'confirmation-config-r6' })
    expect(await screen.findAllByText('local_tool test')).not.toHaveLength(0)
  })

  it('does not let a completed configuration notice hide a later execution result', async () => {
    let installed = false
    const request = vi.fn<Request>(async (path, method) => {
      if (path === '/capabilities') return catalog(installed ? [capability()] : [])
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capabilities/local-tools' && method === 'POST') { installed = true; return operation('completed') }
      if (path === '/capability-executions' && method === 'POST') return execution('succeeded')
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('当前助手尚无此类已安装能力。')
    fireEvent.click(screen.getByRole('button', { name: '安装 builtin.text.inspect/v1' }))
    await screen.findByText('安装内置文本检查工具已由服务端确认完成。')
    await screen.findAllByText('local_tool test')
    fireEvent.change(screen.getByLabelText('执行能力'), { target: { value: 'cap-local_tool' } })
    fireEvent.click(screen.getByRole('button', { name: '执行一次' }))
    expect(await screen.findByText('能力结果已由服务端持久化。')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: '当前能力执行结果' })).toHaveTextContent('已成功')
  })

  it('retries only the same configuration decision after an unknown confirmation response', async () => {
    let decisionCalls = 0
    const installKeys: string[] = []
    const request = vi.fn<Request>(async (path, method, body, options) => {
      if (path === '/capabilities') return catalog([])
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capabilities/local-tools' && method === 'POST') {
        installKeys.push(String(options?.idempotencyKey))
        return (body as { confirmationId?: string }).confirmationId ? operation('completed') : operation('confirmation_required')
      }
      if (path === '/confirmations/confirmation-config-r6/decision' && method === 'POST') {
        decisionCalls += 1
        expect(body).toEqual({ decision: 'approve' })
        if (decisionCalls === 1) throw new ApiClientError('lost decision response', { code: 'network_error', status: null })
        return {}
      }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('当前助手尚无此类已安装能力。')
    fireEvent.click(screen.getByRole('button', { name: '安装 builtin.text.inspect/v1' }))
    await screen.findByRole('group', { name: 'R6 配置安全确认' })
    fireEvent.click(screen.getByRole('button', { name: '批准本次配置' }))
    expect(await screen.findByRole('button', { name: '重试同一个确认决定' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拒绝配置' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试同一个确认决定' }))
    expect(await screen.findByText('安装内置文本检查工具已由服务端确认完成。')).toBeInTheDocument()
    expect(decisionCalls).toBe(2)
    expect(installKeys).toHaveLength(2)
    expect(installKeys[1]).toBe(installKeys[0])
  })

  it('allows only the explicit development loopback MCP exception while leaving final target validation to the server', async () => {
    const request = vi.fn<Request>(async (path, method, body) => {
      if (path === '/capabilities') return catalog([])
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capabilities/mcp-servers' && method === 'POST') {
        expect(body).toMatchObject({
          name: 'Controlled loopback',
          serviceUrl: 'http://127.0.0.1:18787/mcp',
          trustMode: 'explicit_https',
          acknowledgeTrustedEndpoint: true,
        })
        return operation('completed', capability('mcp_tool'))
      }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('当前助手尚无此类已安装能力。')
    fireEvent.change(screen.getByLabelText('服务地址名称'), { target: { value: 'Controlled loopback' } })
    fireEvent.change(screen.getByLabelText('MCP 服务地址'), { target: { value: 'http://127.0.0.1:18787/mcp' } })
    fireEvent.change(screen.getByLabelText('用途说明'), { target: { value: 'Only for the injected R6 fixture' } })
    fireEvent.click(screen.getByLabelText('我确认这是本人明确信任的无凭据端点'))
    fireEvent.click(screen.getByRole('button', { name: '提交服务端安装' }))
    expect(await screen.findByText('安装 MCP 服务已由服务端确认完成。')).toBeInTheDocument()
    expect(request.mock.calls.filter(([path]) => path === '/capabilities/mcp-servers')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('服务地址名称'), { target: { value: 'Unsafe private target' } })
    fireEvent.change(screen.getByLabelText('MCP 服务地址'), { target: { value: 'http://192.168.1.10/mcp' } })
    fireEvent.change(screen.getByLabelText('用途说明'), { target: { value: 'Must not pass the browser preflight' } })
    fireEvent.click(screen.getByLabelText('我确认这是本人明确信任的无凭据端点'))
    fireEvent.click(screen.getByRole('button', { name: '提交服务端安装' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('仅本机开发页可提交 loopback HTTP 测试地址')
    expect(request.mock.calls.filter(([path]) => path === '/capabilities/mcp-servers')).toHaveLength(1)
  })

  it('recovers a lost execution only by the original key and never persists input or output', async () => {
    let originalKey = ''
    const request = vi.fn<Request>(async (path, method, _body, options) => {
      if (path === '/capabilities') return catalog()
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capability-executions' && method === 'POST') { originalKey = String(options?.idempotencyKey); throw new ApiClientError('lost raw input', { code: 'network_error', status: null }) }
      if (path === `/capability-executions/by-idempotency-key/${originalKey}`) return { status: 'found', execution: execution() }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} strict />)
    await screen.findAllByText('local_tool test')
    fireEvent.change(screen.getByLabelText('执行能力'), { target: { value: 'cap-local_tool' } })
    fireEvent.change(screen.getByLabelText('能力执行输入'), { target: { value: '{"text":"只在内存中的敏感测试输入"}' } })
    const submit = screen.getByRole('button', { name: '执行一次' })
    act(() => { fireEvent.click(submit); fireEvent.click(submit) })
    expect(await screen.findByText('执行结果尚未确认；只能按原操作键查询。')).toBeInTheDocument()
    expect(request.mock.calls.filter(([path]) => path === '/capability-executions')).toHaveLength(1)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('敏感测试输入')
    fireEvent.click(screen.getByRole('button', { name: '按原操作键查询' }))
    expect(await screen.findByText('能力结果已由服务端持久化。')).toBeInTheDocument()
    expect(screen.getByText(/"length": 7/)).toBeInTheDocument()
    expect(request.mock.calls.filter(([path]) => path === '/capability-executions')).toHaveLength(1)
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it('approves a waiting execution through confirmation and a separately idempotent resume', async () => {
    const request = vi.fn<Request>(async (path, method, body) => {
      if (path === '/capabilities') return catalog()
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capability-executions' && method === 'POST') return execution('waiting_confirmation')
      if (path === '/confirmations/confirmation-r6/decision' && method === 'POST') return {}
      if (path === '/capability-executions/execution-r6/recovery' && method === 'POST') { expect(body).toEqual({ action: 'resume', confirmationId: 'confirmation-r6' }); return execution('succeeded') }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('local_tool test')
    fireEvent.change(screen.getByLabelText('执行能力'), { target: { value: 'cap-local_tool' } })
    fireEvent.click(screen.getByRole('button', { name: '执行一次' }))
    expect(await screen.findByText('执行尚未开始，服务端要求当前助手的安全确认。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批准并恢复同一执行' }))
    expect(await screen.findByText('能力结果已由服务端持久化。')).toBeInTheDocument()
    const recovery = request.mock.calls.find(([path]) => path === '/capability-executions/execution-r6/recovery')!
    expect(recovery[3]?.idempotencyKey).toMatch(/^vio-capability-recovery-/)
  })

  it('offers retry only for a server-proven retryable execution', async () => {
    const request = vi.fn<Request>(async (path, method, body) => {
      if (path === '/capabilities') return catalog()
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capability-executions' && method === 'POST') return execution('retryable')
      if (path === '/capability-executions/execution-r6/recovery' && method === 'POST') { expect(body).toEqual({ action: 'retry' }); return execution('succeeded') }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('local_tool test')
    fireEvent.change(screen.getByLabelText('执行能力'), { target: { value: 'cap-local_tool' } })
    fireEvent.click(screen.getByRole('button', { name: '执行一次' }))
    expect(await screen.findByText('服务端证明上次请求未发送，可以显式安全重试。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '安全重试' }))
    expect(await screen.findByText('能力结果已由服务端持久化。')).toBeInTheDocument()
    const recovery = request.mock.calls.find(([path]) => path === '/capability-executions/execution-r6/recovery')!
    expect(recovery[3]?.idempotencyKey).toMatch(/^vio-capability-recovery-/)
  })

  it('cancels only a not-yet-crossed execution and clears its recovery index', async () => {
    const request = vi.fn<Request>(async (path, method, body) => {
      if (path === '/capabilities') return catalog()
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capability-executions' && method === 'POST') return execution('waiting_confirmation')
      if (path === '/capability-executions/execution-r6/recovery' && method === 'POST') { expect(body).toEqual({ action: 'cancel' }); return execution('cancelled') }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('local_tool test')
    fireEvent.change(screen.getByLabelText('执行能力'), { target: { value: 'cap-local_tool' } })
    fireEvent.click(screen.getByRole('button', { name: '执行一次' }))
    expect(await screen.findByText('执行尚未开始，服务端要求当前助手的安全确认。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消未越界执行' }))
    expect(await screen.findByText('服务端状态：已取消。')).toBeInTheDocument()
    expect(sessionStorage.length).toBe(0)
    expect(screen.queryByRole('button', { name: '安全重试' })).not.toBeInTheDocument()
  })

  it('retries only the same execution confirmation decision after an unknown response', async () => {
    let decisionCalls = 0
    const request = vi.fn<Request>(async (path, method, body) => {
      if (path === '/capabilities') return catalog()
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capability-executions' && method === 'POST') return execution('waiting_confirmation')
      if (path === '/confirmations/confirmation-r6/decision' && method === 'POST') { decisionCalls += 1; expect(body).toEqual({ decision: 'approve' }); if (decisionCalls === 1) throw new ApiClientError('lost', { code: 'network_error', status: null }); return {} }
      if (path === '/capability-executions/execution-r6/recovery' && method === 'POST') return execution('succeeded')
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('local_tool test')
    fireEvent.change(screen.getByLabelText('执行能力'), { target: { value: 'cap-local_tool' } })
    fireEvent.click(screen.getByRole('button', { name: '执行一次' }))
    await screen.findByText('执行尚未开始，服务端要求当前助手的安全确认。')
    fireEvent.click(screen.getByRole('button', { name: '批准并恢复同一执行' }))
    expect(await screen.findByRole('button', { name: '重试同一个执行确认决定' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拒绝并取消' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试同一个执行确认决定' }))
    expect(await screen.findByText('能力结果已由服务端持久化。')).toBeInTheDocument()
    expect(decisionCalls).toBe(2)
  })

  it('reuses one recovery key after a lost recovery response', async () => {
    let recoveryCalls = 0
    const recoveryKeys: string[] = []
    const request = vi.fn<Request>(async (path, method, _body, options) => {
      if (path === '/capabilities') return catalog()
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capability-executions' && method === 'POST') return execution('retryable')
      if (path === '/capability-executions/execution-r6/recovery' && method === 'POST') { recoveryCalls += 1; recoveryKeys.push(String(options?.idempotencyKey)); if (recoveryCalls === 1) throw new ApiClientError('lost', { code: 'network_error', status: null }); return execution('succeeded') }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('local_tool test')
    fireEvent.change(screen.getByLabelText('执行能力'), { target: { value: 'cap-local_tool' } })
    fireEvent.click(screen.getByRole('button', { name: '执行一次' }))
    await screen.findByText('服务端证明上次请求未发送，可以显式安全重试。')
    fireEvent.click(screen.getByRole('button', { name: '安全重试' }))
    expect(await screen.findByRole('button', { name: '重试同一个恢复操作' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '安全重试' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试同一个恢复操作' }))
    expect(await screen.findByText('能力结果已由服务端持久化。')).toBeInTheDocument()
    expect(recoveryKeys).toHaveLength(2)
    expect(recoveryKeys[1]).toBe(recoveryKeys[0])
  })

  it('shows enable for a disabled installed plugin and no lifecycle action after uninstall', async () => {
    const disabledPlugin = { ...capability('plugin_action', 'plugin-disabled'), status: 'disabled' }
    const uninstalledPlugin = { ...capability('plugin_action', 'plugin-gone'), status: 'disabled', lifecycleStatus: 'uninstalled' }
    const request = vi.fn<Request>(async (path) => {
      if (path === '/capabilities') return catalog([disabledPlugin, uninstalledPlugin])
      if (path.startsWith('/capability-executions?')) return history()
      throw new Error(`unexpected ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    expect(await screen.findByRole('button', { name: '启用' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '停用' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '卸载' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '卸载' })[1]).toBeDisabled()
  })

  it('queries a possibly-sent MCP discovery by its original key without replaying POST', async () => {
    const unknown = { operationStatus: 'outcome_unknown', capability: null, discovery: null, security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: { code: 'MCP_NETWORK_UNAVAILABLE' }, externalCall: 'possibly_performed' }
    let discoveryPosts = 0
    const request = vi.fn<Request>(async (path, method) => {
      if (path === '/capabilities') return catalog([capability('mcp_tool')])
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capabilities/mcp-servers/cap-mcp_tool/discovery' && method === 'POST') { discoveryPosts += 1; return unknown }
      if (path.includes('/capabilities/mcp-servers/cap-mcp_tool/discovery/by-idempotency-key/')) return { status: 'found', operation: unknown }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('mcp_tool test')
    fireEvent.click(screen.getByRole('button', { name: '重新发现工具' }))
    expect(await screen.findByText('MCP 发现可能已越过外部边界；只能按原键查询冻结事实，不能自动重发。')).toBeInTheDocument()
    expect(discoveryPosts).toBe(1)
    expect(screen.queryByRole('button', { name: '沿用原键重试同一配置' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '按原键查询发现事实' }))
    await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('/discovery/by-idempotency-key/'))).toBe(true))
    expect(discoveryPosts).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '结束核对并允许新操作' }))
    fireEvent.click(screen.getByRole('button', { name: '重新发现工具' }))
    await waitFor(() => expect(discoveryPosts).toBe(2))
  })

  it('restores an unresolved MCP discovery query after remount without persisting its request body', async () => {
    const unknown = { operationStatus: 'outcome_unknown', capability: null, discovery: null, security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: { code: 'MCP_NETWORK_UNAVAILABLE' }, externalCall: 'possibly_performed' }
    const completed = {
      operationStatus: 'completed', capability: null,
      discovery: { snapshotId: 'snapshot-r6', status: 'ready', toolCount: 1, tools: [{ name: 'inspect', description: 'Bounded inspection', inputSchemaHash: digest, outputSchemaHash: null }], externalCall: 'performed' },
      security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: null, externalCall: 'performed',
    }
    let discoveryPosts = 0
    const request = vi.fn<Request>(async (path, method) => {
      if (path === '/capabilities') return catalog([capability('mcp_tool')])
      if (path.startsWith('/capability-executions?')) return history()
      if (path === '/capabilities/mcp-servers/cap-mcp_tool/discovery' && method === 'POST') { discoveryPosts += 1; return unknown }
      if (path.includes('/capabilities/mcp-servers/cap-mcp_tool/discovery/by-idempotency-key/')) return { status: 'found', operation: completed }
      throw new Error(`unexpected ${method} ${path}`)
    })
    const first = render(<Harness api={personalApi(request)} />)
    await screen.findAllByText('mcp_tool test')
    fireEvent.click(screen.getByRole('button', { name: '重新发现工具' }))
    await screen.findByText('MCP 发现可能已越过外部边界；只能按原键查询冻结事实，不能自动重发。')
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/https|description|trusted|response|credential/i)
    first.unmount()

    render(<Harness api={personalApi(request)} />)
    expect(await screen.findByText('检测到当前助手存在未核对的 MCP 发现；只能按原键查询，不能自动重发。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '按原键查询发现事实' }))
    expect(await screen.findByText('MCP 发现完成：1 个严格校验工具。')).toBeInTheDocument()
    expect(discoveryPosts).toBe(1)
    expect(sessionStorage.length).toBe(0)
  })

  it('ignores an old assistant response and keeps outcome-unknown query-only', async () => {
    const old = deferred<unknown>(); let calls = 0
    const request = vi.fn<Request>(async (path) => {
      if (path === '/capabilities') { calls++; return calls === 1 ? old.promise : catalog([capability('skill', 'cap-beta')]) }
      if (path.startsWith('/capability-executions?')) return history([execution('outcome_unknown', 'execution-beta')])
      throw new Error(`unexpected ${path}`)
    })
    render(<Harness api={personalApi(request)} switcher />)
    await waitFor(() => expect(request.mock.calls.some(([path]) => path === '/capabilities')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '切换助手' }))
    expect(await screen.findAllByText('skill test')).not.toHaveLength(0)
    await act(async () => old.resolve(catalog([capability('local_tool', 'cap-old')])) )
    expect(screen.queryByText('local_tool test')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('结果未知 · 尝试 0 次'))
    expect(within(screen.getByRole('article', { name: '当前能力执行结果' })).getByText('结果未知')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '安全重试' })).not.toBeInTheDocument()
  })

  it('clears the old assistant view before the new catalog arrives', async () => {
    const next = deferred<unknown>(); let catalogCalls = 0
    const request = vi.fn<Request>(async (path) => {
      if (path === '/capabilities') { catalogCalls += 1; return catalogCalls === 1 ? catalog([capability()]) : next.promise }
      if (path.startsWith('/capability-executions?')) return history()
      throw new Error(`unexpected ${path}`)
    })
    render(<Harness api={personalApi(request)} switcher />)
    expect(await screen.findAllByText('local_tool test')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '切换助手' }))
    expect(screen.queryByText('local_tool test')).not.toBeInTheDocument()
    await act(async () => next.resolve(catalog([capability('skill', 'cap-beta')])) )
    expect(await screen.findAllByText('skill test')).not.toHaveLength(0)
  })

  it('keeps only the namespaced recovery key when switching away and back', async () => {
    const session = sessionFixture()
    writeCapabilityRecovery(sessionStorage, session.user.userId, 'test-alpha', { version: 1, idempotencyKey: 'vio-capability-recovery-index', executionId: null })
    const request = vi.fn<Request>(async (path) => {
      if (path === '/capabilities') return catalog([])
      if (path.startsWith('/capability-executions?')) return history()
      throw new Error(`unexpected ${path}`)
    })
    render(<Harness api={personalApi(request, session)} switcher />)
    expect(await screen.findByText('检测到当前助手存在未核对的能力执行，请按原操作键查询。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '切换助手' }))
    await waitFor(() => expect(screen.queryByText('检测到当前助手存在未核对的能力执行，请按原操作键查询。')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '切换助手' }))
    expect(await screen.findByText('检测到当前助手存在未核对的能力执行，请按原操作键查询。')).toBeInTheDocument()
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/input|output|content/i)
  })
})
