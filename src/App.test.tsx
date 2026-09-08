import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ApiClientError } from './api/client'
import { createPersonalApi } from './api/personal-api'
import { assistantFixture, listFixture, profileFixture, sessionFixture } from './test/personal-fixtures'

// Runtime status has its own strict client and 30+ lifecycle regressions.
vi.mock('./components/profile/SubjectRuntimeSettings', () => ({ default: () => null }))

function apiFixture(authenticated = true) {
  const api = createPersonalApi()
  vi.spyOn(api, 'session').mockImplementation(async () => { if (!authenticated) throw new ApiClientError('Unauthenticated', { status: 401, code: 'AUTH_REQUIRED' }); return sessionFixture() })
  vi.spyOn(api, 'access').mockResolvedValue({ status: 'authentication_required', registration: 'disabled' })
  vi.spyOn(api, 'deletionCurrent').mockRejectedValue(new ApiClientError('No deletion access', { status: 401, code: 'DELETION_ACCESS_DENIED' }))
  vi.spyOn(api, 'assistants').mockResolvedValue(listFixture())
  vi.spyOn(api, 'profile').mockResolvedValue(profileFixture())
  vi.spyOn(api, 'assistant').mockResolvedValue(assistantFixture())
  vi.spyOn(api, 'sessions').mockResolvedValue({ items: [] })
  vi.spyOn(api, 'request').mockImplementation(async (path) => {
    if (path.startsWith('/chat/conversations?')) return { assistant: { assistantId: 'test-alpha', name: '测试助手一' }, conversations: [], selectionVersion: 0, nextCursor: null, externalCall: 'not_performed' }
    if (path === '/chat/conversations/current') return { assistant: { assistantId: 'test-alpha', name: '测试助手一' }, conversation: null, selectionVersion: 0, messages: [], activeTurn: null, externalCall: 'not_performed' }
    if (path === '/chat/default') return { assistant: { assistantId: 'test-alpha', name: '测试助手一' }, conversation: null, messages: [], activeTurn: null, externalCall: 'not_performed' }
    if (path === '/capabilities') return { schemaVersion: 'vio-capability-catalog/v1', items: [] }
    if (path.startsWith('/capability-executions?')) return { schemaVersion: 'vio-capability-execution-list/v1', items: [], nextCursor: null }
    return { items: [] }
  })
  return api
}
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear() })

describe('R2 personal application entry', () => {
  it('replaces public demo login with a real access check and explicit postponement', async () => {
    const api = apiFixture(false)
    render(<App personalApi={api} />)
    expect(await screen.findByRole('heading', { name: '验证个人访问' })).toBeInTheDocument()
    expect(api.session).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/邮箱验证码、Google 登录与公开注册暂缓/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '使用 Google 继续' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '获取验证码' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('requires all agreements and awaits initialization, with no duplicate submit', async () => {
    const api = apiFixture(false)
    vi.mocked(api.access).mockResolvedValue({ status: 'initialization_required', registration: 'disabled' })
    let resolve!: (value: ReturnType<typeof sessionFixture>) => void
    const initialize = vi.spyOn(api, 'initialize').mockImplementation(() => new Promise((accept) => { resolve = accept }))
    render(<App personalApi={api} />)
    await screen.findByRole('heading', { name: '初始化个人空间' })
    fireEvent.change(screen.getByLabelText('初始化邀请'), { target: { value: 'test-invitation' } })
    fireEvent.change(screen.getByLabelText('设置个人访问口令'), { target: { value: 'test-passphrase-only' } })
    fireEvent.click(screen.getByRole('button', { name: '创建个人空间' }))
    expect(initialize).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('三项说明')
    screen.getAllByRole('checkbox').forEach((item) => fireEvent.click(item))
    act(() => { fireEvent.click(screen.getByRole('button', { name: '创建个人空间' })); fireEvent.click(screen.getByRole('button', { name: '创建个人空间' })) })
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('设置个人访问口令')).toHaveValue('')
    expect(screen.queryByRole('heading', { name: '首次设置' })).not.toBeInTheDocument()
    await act(async () => resolve(sessionFixture({ onboardingCompleted: false })))
    expect(screen.getByRole('heading', { name: '首次设置' })).toBeInTheDocument()
  })

  it('does not enter after failed access; clears secret input and allows retry', async () => {
    const api = apiFixture(false)
    const login = vi.spyOn(api, 'login').mockRejectedValueOnce(new ApiClientError('raw-secret-fixture', { status: 401, code: 'ACCESS_DENIED' })).mockResolvedValueOnce(sessionFixture())
    render(<App personalApi={api} />)
    await screen.findByRole('heading', { name: '验证个人访问' })
    fireEvent.change(screen.getByLabelText('个人访问口令'), { target: { value: 'test-only' } })
    fireEvent.change(screen.getByLabelText('此访问设备名称'), { target: { value: '测试设备' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并进入' }))
    expect(await screen.findByRole('alert')).not.toHaveTextContent('raw-secret-fixture')
    expect(screen.getByLabelText('个人访问口令')).toHaveValue('')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('个人访问口令'), { target: { value: 'test-correct' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并进入' }))
    expect(await screen.findByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    expect(login).toHaveBeenCalledTimes(2)
  })

  it('restores a server session in StrictMode once, preserves six tabs and quarantines old recovery data', async () => {
    const api = apiFixture()
    const old = '{"version":1,"content":"old-account-content"}'
    sessionStorage.setItem('vio-live:conversation:pending-turn:v1', old)
    render(<StrictMode><App personalApi={api} /></StrictMode>)
    const nav = await screen.findByRole('navigation', { name: '主导航' })
    expect(api.session).toHaveBeenCalledTimes(1)
    expect(within(nav).getAllByRole('button')).toHaveLength(6)
    fireEvent.click(within(nav).getByRole('button', { name: '对话' }))
    expect(await screen.findByText(/独立多会话/)).toBeInTheDocument()
    expect(api.request).toHaveBeenCalledWith(expect.stringMatching(/^\/chat\/conversations\?/), 'GET', undefined, expect.anything())
    expect(api.request).not.toHaveBeenCalledWith('/chat/default', expect.anything(), expect.anything(), expect.anything())
    expect(screen.queryByText('old-account-content')).not.toBeInTheDocument()
    expect(sessionStorage.getItem('vio-live:conversation:pending-turn:v1')).toBe(old)
  })

  it('keeps first setup open on failure, retries the same key and really saves skip defaults', async () => {
    const api = apiFixture()
    vi.mocked(api.session).mockResolvedValue(sessionFixture({ onboardingCompleted: false }))
    const onboarding = vi.spyOn(api, 'onboarding').mockRejectedValueOnce(new ApiClientError('Timeout', { code: 'request_timeout', status: null })).mockResolvedValueOnce(sessionFixture())
    render(<App personalApi={api} />)
    await screen.findByRole('heading', { name: '首次设置' })
    fireEvent.change(screen.getByLabelText('个人显示名'), { target: { value: '真实保存测试' } })
    fireEvent.change(screen.getByLabelText('首个助手名称'), { target: { value: '首个测试助手' } })
    fireEvent.click(screen.getByRole('button', { name: '跳过高级设置并保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请求超时')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '跳过高级设置并保存' }))
    await screen.findByRole('navigation')
    expect(onboarding.mock.calls[0][1].idempotencyKey).toBe(onboarding.mock.calls[1][1].idempotencyKey)
    expect(onboarding.mock.calls[1][0]).toMatchObject({ displayName: '真实保存测试', assistant: { name: '首个测试助手', settings: { positioning: '', contextMode: 'balanced' } }, preferences: { storagePreference: 'local', contextMode: 'balanced' } })
  })

  it('recovers from a network failure without substituting a fixed identity', async () => {
    const api = apiFixture()
    vi.mocked(api.session).mockRejectedValueOnce(new ApiClientError('Network', { code: 'network_error', status: null })).mockResolvedValueOnce(sessionFixture())
    render(<App personalApi={api} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('无法连接')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试访问恢复' }))
    await screen.findByRole('navigation')
    expect(api.session).toHaveBeenCalledTimes(2)
  })

  it('mounts assistant management and creates through the real API boundary with repeat protection', async () => {
    const api = apiFixture()
    const create = vi.spyOn(api, 'createAssistant').mockResolvedValue(assistantFixture('test-gamma', '第三助手'))
    render(<App personalApi={api} />)
    await screen.findByRole('navigation')
    fireEvent.click(screen.getByRole('button', { name: /^我的$/ }))
    const createButton = await screen.findByRole('button', { name: /^创建助手$/ })
    await waitFor(() => expect(createButton).toBeEnabled())
    fireEvent.change(screen.getByLabelText('助手名称'), { target: { value: '第三助手' } })
    act(() => { fireEvent.click(createButton); fireEvent.click(createButton) })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({ name: '第三助手' })
    expect(create.mock.calls[0][1].idempotencyKey).toMatch(/^vio-personal-/)
  })

  it('labels the capability page as the real R6 server-backed surface while keeping devices in R9', async () => {
    const api = apiFixture()
    render(<App personalApi={api} />)
    await screen.findByRole('navigation')
    fireEvent.click(screen.getByRole('button', { name: /^能力$/ }))
    expect(screen.getByText('CAPABILITY CENTER · R6 UNIFIED EXECUTION')).toBeInTheDocument()
    expect(screen.getByText('真实配置、显式执行、恢复与统一历史')).toBeInTheDocument()
    expect(screen.getByText('服务端事实')).toBeInTheDocument()
    expect(screen.getByText('0 个已验证连接 · R9 未施工')).toBeInTheDocument()
    expect(screen.getByText(/当前页面不展示模拟连接、模拟授权或可执行控制/)).toBeInTheDocument()
    expect(screen.queryByText('2 台已连接设备')).not.toBeInTheDocument()
    expect(screen.queryByText('CAPABILITY CENTER · 本地模拟')).not.toBeInTheDocument()
  })

  it.each(['success', 'failure'] as const)('ignores access %s after cancellation, including the old finally', async (outcome) => {
    const api = apiFixture(false)
    let resolve!: (value: ReturnType<typeof sessionFixture>) => void
    let reject!: (error: Error) => void
    vi.spyOn(api, 'login').mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
    render(<App personalApi={api} />)
    await screen.findByRole('heading', { name: '验证个人访问' })
    fireEvent.change(screen.getByLabelText('个人访问口令'), { target: { value: 'test-only-password' } })
    fireEvent.change(screen.getByLabelText('此访问设备名称'), { target: { value: '测试访问' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并进入' }))
    fireEvent.click(screen.getByRole('button', { name: /^取消$/ }))
    fireEvent.change(screen.getByLabelText('个人访问口令'), { target: { value: 'new-input' } })
    await act(async () => outcome === 'success' ? resolve(sessionFixture()) : reject(new Error('late-secret')))
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('个人访问口令')).toHaveValue('new-input')
  })
})
