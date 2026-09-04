import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createApiClient } from '../api/client'
import { createPersonalApi } from '../api/personal-api'
import type { DeletionAccess } from '../api/personal-deletion'
import { assistantFixture, listFixture, profileFixture, sessionFixture } from '../test/personal-fixtures'
import { completedDeletionFixture, deletionFixture } from '../test/deletion-fixtures'

vi.mock('../components/profile/SubjectRuntimeSettings', () => ({ default: () => null }))

function reply(data: unknown, status = 200, code = 'ACCESS_DENIED') {
  return new Response(JSON.stringify({ success: status < 400, data: status < 400 ? data : null, error: status < 400 ? null : { code, message: 'test-only-error' }, timestamp: '2026-09-05T00:00:00.000Z' }), { status, headers: { 'content-type': 'application/json' } })
}

function fixture(initialDeletion: DeletionAccess | null = null) {
  const server = { ordinary: !initialDeletion, deletion: initialDeletion, deletionCookie: Boolean(initialDeletion), loseApplicationResponse: false, offline: false, denyCancellation: false, receiptExpired: false, denyDeletionAccess: false }
  const overrides = new Map<string, (options: RequestInit) => Response | Promise<Response>>()
  const fetcher = vi.fn<typeof fetch>(async (url, options = {}) => {
    const path = String(url).replace('/api/v1/personal', '')
    const method = options.method ?? 'GET'
    const override = overrides.get(`${method} ${path}`)
    if (override) return override(options)
    if (server.offline) throw new TypeError('test network unavailable')
    if (path === '/session') return server.ordinary ? reply(sessionFixture()) : reply(null, 401)
    if (path === '/deletions/current') {
      if (server.receiptExpired) return reply(null, 410, 'DELETION_RECEIPT_EXPIRED')
      return server.deletion && server.deletionCookie ? reply(server.deletion) : reply(null, 401, 'DELETION_ACCESS_DENIED')
    }
    if (path === '/access') return reply({ status: server.deletion ? 'deletion_authentication_required' : 'authentication_required', registration: 'disabled' })
    if (path === '/profile') return reply(profileFixture())
    if (path === '/assistants') return reply(listFixture())
    if (path.startsWith('/assistants/')) return reply(assistantFixture())
    if (path === '/sessions' && method === 'GET') return reply({ items: [] })
    if (path === '/sessions' && method === 'POST') { server.ordinary = true; return reply(sessionFixture({ session: { sessionId: 'new-login-session', expiresAt: '2026-10-04T00:00:00.000Z' }, csrfToken: 'new-login-csrf' })) }
    if (path === '/diagnostics') return reply({ identity: 'verified_personal_owner', database: 'available', vault: 'locked', authentication: 'session_cookie' })
    if (path === '/access-audit') return reply({ items: [] })
    if (path === '/deletions' && method === 'POST') {
      const body = JSON.parse(String(options.body))
      if (!body.confirmationId) return reply({ operationStatus: 'confirmation_required', security: { confirmation: { confirmationId: 'deletion-confirmation' } } })
      server.ordinary = false; server.deletion = deletionFixture(); server.deletionCookie = true
      if (server.loseApplicationResponse) throw new TypeError('test response lost after commit')
      return reply({ operationStatus: 'completed', ...server.deletion })
    }
    if (path === '/confirmations/deletion-confirmation/decision') return reply({})
    if (path === '/operation-cancellations') return reply({ status: 'cancelled' })
    if (path === '/deletion-access') {
      if (server.denyDeletionAccess) return reply(null, 401, 'DELETION_ACCESS_DENIED')
      server.deletionCookie = true; return reply(server.deletion)
    }
    if (path === '/deletions/current/cancellation') {
      if (server.denyCancellation) return reply(null, 403, 'DELETION_VERIFICATION_FAILED')
      server.deletion = null; server.deletionCookie = false; server.ordinary = false
      return reply({ status: 'cancelled', reauthenticationRequired: true })
    }
    throw new Error(`Unhandled test route: ${method} ${path}`)
  })
  return { server, overrides, fetcher, api: createPersonalApi(createApiClient({ fetchImplementation: fetcher })) }
}

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear() })

async function openRequest() {
  await screen.findByRole('navigation')
  fireEvent.click(screen.getByRole('button', { name: /^我的$/ }))
  fireEvent.click(screen.getByLabelText('我已理解删除范围、后果与期限'))
  fireEvent.click(screen.getByRole('button', { name: '提交删除申请' }))
  await screen.findByRole('group', { name: '后端安全确认' })
}

describe('R2 deletion application and dedicated access lifecycle', () => {
  it('rejects confirmation, retires only that key, then applies once with a new key and removes business navigation', async () => {
    const f = fixture(); sessionStorage.setItem('unowned-old-cache', 'preserve')
    render(<App personalApi={f.api} />)
    await openRequest()
    fireEvent.click(screen.getByRole('button', { name: '拒绝并取消' }))
    await screen.findByText('已拒绝并取消本次服务端操作。')
    expect(f.server.deletion).toBeNull()
    fireEvent.click(screen.getByLabelText('我已理解删除范围、后果与期限'))
    fireEvent.click(screen.getByRole('button', { name: '提交删除申请' }))
    await screen.findByRole('group', { name: '后端安全确认' })
    const applications = f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/deletions'))
    expect(new Headers(applications[0][1]?.headers).get('Idempotency-Key')).not.toBe(new Headers(applications[1][1]?.headers).get('Idempotency-Key'))
    act(() => { fireEvent.click(screen.getByRole('button', { name: '批准本次操作' })); fireEvent.click(screen.getByRole('button', { name: '批准本次操作' })) })
    expect(await screen.findByRole('heading', { name: '个人空间删除状态' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建助手' })).not.toBeInTheDocument()
    expect(sessionStorage.getItem('unowned-old-cache')).toBe('preserve')
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/deletions'))).toHaveLength(3)
  })

  it('recovers a committed application with a lost response without resubmitting or claiming a failure means no deletion', async () => {
    const f = fixture(); f.server.loseApplicationResponse = true
    render(<App personalApi={f.api} />); await openRequest()
    fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
    await screen.findByRole('heading', { name: '个人空间删除状态' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/deletions'))).toHaveLength(2)
  })

  it('uses server time in StrictMode and never turns an overdue waiting record into completed', async () => {
    const f = fixture(deletionFixture({ serverTime: '2026-09-20T00:00:00.000Z' }))
    render(<StrictMode><App personalApi={f.api} /></StrictMode>)
    await screen.findByRole('heading', { name: '等待服务端执行，尚未删除' })
    expect(screen.getByText('期限已到；不代表执行成功')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vio 受管范围整体删除完成' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试到期执行或清理' })).toBeEnabled()
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/deletions/current/retry'))).toHaveLength(0)
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/deletions/current'))).toHaveLength(1)
  })

  it.each(['non-json', 'bad-envelope', 'missing-operation', 'bad-confirmation'] as const)('recovers deletion after an approved HTTP 200 %s response without keeping business available', async (kind) => {
    const f = fixture()
    f.overrides.set('POST /deletions', (options) => {
      if (!JSON.parse(String(options.body)).confirmationId) return reply({ operationStatus: 'confirmation_required', security: { confirmation: { confirmationId: 'deletion-confirmation' } } })
      f.server.ordinary = false; f.server.deletion = deletionFixture(); f.server.deletionCookie = true
      if (kind === 'non-json') return new Response('not-json', { status: 200 })
      if (kind === 'bad-envelope') return new Response(JSON.stringify({ data: f.server.deletion }), { status: 200 })
      if (kind === 'bad-confirmation') return reply({ operationStatus: 'confirmation_required', security: {} })
      return reply(f.server.deletion)
    })
    render(<App personalApi={f.api} />); await openRequest()
    fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
    await screen.findByRole('heading', { name: '个人空间删除状态' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/deletions'))).toHaveLength(2)
  })

  it('leaves business immediately when approved deletion loses its response and the service stays offline', async () => {
    const f = fixture()
    f.overrides.set('POST /deletions', (options) => {
      if (!JSON.parse(String(options.body)).confirmationId) return reply({ operationStatus: 'confirmation_required', security: { confirmation: { confirmationId: 'deletion-confirmation' } } })
      f.server.ordinary = false; f.server.deletion = deletionFixture(); f.server.deletionCookie = true; f.server.offline = true
      throw new TypeError('test response and service lost')
    })
    render(<App personalApi={f.api} />); await openRequest()
    const keyBefore = sessionStorage.getItem(sessionStorage.key(0)!)
    fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
    await screen.findByRole('heading', { name: '个人访问暂不可用' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vio 受管范围整体删除完成' })).not.toBeInTheDocument()
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(keyBefore)
    f.server.offline = false
    fireEvent.click(screen.getByRole('button', { name: '重试访问恢复' }))
    await screen.findByRole('heading', { name: '个人空间删除状态' })
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/deletions'))).toHaveLength(2)
  })

  it('does not restore ordinary business while an approved request is still unknown and no deletion cookie was received', async () => {
    const f = fixture()
    f.overrides.set('POST /deletions', (options) => {
      if (!JSON.parse(String(options.body)).confirmationId) return reply({ operationStatus: 'confirmation_required', security: { confirmation: { confirmationId: 'deletion-confirmation' } } })
      throw new TypeError('test unknown pending request')
    })
    render(<App personalApi={f.api} />); await openRequest()
    fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
    await screen.findByRole('heading', { name: '验证删除专用访问' })
    expect(f.server.ordinary).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新读取访问状态' }))
    await screen.findByRole('heading', { name: '验证删除专用访问' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/session'))).toHaveLength(1)
  })

  it('keeps controlled cancellation failures isolated, then requires a fresh normal login after cancellation', async () => {
    const f = fixture(deletionFixture()); f.server.denyCancellation = true
    render(<App personalApi={f.api} />)
    await screen.findByRole('heading', { name: '个人空间删除状态' })
    fireEvent.change(screen.getByLabelText('撤销删除验证口令'), { target: { value: 'wrong-test-value' } })
    fireEvent.change(screen.getByLabelText('本次验证设备名称'), { target: { value: '隔离测试设备' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人并撤销删除' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('撤销删除验证口令')).toHaveValue('')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    f.server.denyCancellation = false
    fireEvent.change(screen.getByLabelText('撤销删除验证口令'), { target: { value: 'correct-test-value' } })
    fireEvent.click(screen.getByRole('button', { name: '验证本人并撤销删除' }))
    await screen.findByRole('heading', { name: '验证个人访问' })
    expect(screen.getByText(/旧访问令牌不会恢复/)).toBeInTheDocument()
    expect(f.server.ordinary).toBe(false)
    expect(f.fetcher.mock.calls.some(([url, options]) => String(url).endsWith('/sessions') && options?.method === 'POST')).toBe(false)
    fireEvent.change(screen.getByLabelText('个人访问口令'), { target: { value: 'fresh-test-login' } })
    fireEvent.change(screen.getByLabelText('此访问设备名称'), { target: { value: '重新登录设备' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并进入' }))
    await screen.findByRole('navigation')
  })

  it('hides stale completed results when the backend is unreachable and recovers by a real client reread', async () => {
    const f = fixture(completedDeletionFixture())
    render(<App personalApi={f.api} />)
    await screen.findByRole('heading', { name: 'Vio 受管范围整体删除完成' })
    f.server.offline = true
    fireEvent.click(screen.getByRole('button', { name: '重新核对删除状态' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('heading', { name: '当前删除状态无法确认' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vio 受管范围整体删除完成' })).not.toBeInTheDocument()
    f.server.offline = false
    fireEvent.click(screen.getByRole('button', { name: '重新核对删除状态' }))
    await screen.findByRole('heading', { name: 'Vio 受管范围整体删除完成' })
  })

  it('distinguishes failed execution, online deletion with backup cleanup pending, and overall completion', async () => {
    const f = fixture(deletionFixture({ serverTime: '2026-09-12T01:00:00.000Z', status: 'failed', reason: 'DELETE_EXECUTION_FAILED' }))
    let retries = 0
    f.overrides.set('POST /deletions/current/retry', () => {
      retries++
      f.server.deletion = retries === 1 ? deletionFixture({ ...completedDeletionFixture().deletion, status: 'cleanup_pending', managedBackups: { status: 'pending', remaining: 1 }, reason: 'BACKUP_CLEANUP_PENDING' }) : completedDeletionFixture()
      return reply(f.server.deletion)
    })
    render(<App personalApi={f.api} />)
    await screen.findByRole('heading', { name: '删除或清理未完成' })
    fireEvent.click(screen.getByRole('button', { name: '重试到期执行或清理' }))
    await screen.findByText('在线数据已删除')
    expect(screen.getByText('等待清理 1 份；整体尚未完成')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vio 受管范围整体删除完成' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试到期执行或清理' }))
    await screen.findByRole('heading', { name: 'Vio 受管范围整体删除完成' })
    expect(retries).toBe(2)
  })

  it('does not invent a result after the deletion receipt expires', async () => {
    const f = fixture(completedDeletionFixture()); f.server.receiptExpired = true
    render(<App personalApi={f.api} />)
    await screen.findByRole('heading', { name: '删除凭据查询期已结束' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vio 受管范围整体删除完成' })).not.toBeInTheDocument()
  })

  it('recovers deletion-only access by controlled verification without granting business access', async () => {
    const f = fixture(deletionFixture()); f.server.deletionCookie = false; f.server.denyDeletionAccess = true
    render(<App personalApi={f.api} />)
    await screen.findByRole('heading', { name: '验证删除专用访问' })
    fireEvent.change(screen.getByLabelText('删除状态验证口令'), { target: { value: 'bad-test' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并查看删除状态' }))
    await screen.findByRole('alert'); expect(screen.getByLabelText('删除状态验证口令')).toHaveValue('')
    f.server.denyDeletionAccess = false
    fireEvent.change(screen.getByLabelText('删除状态验证口令'), { target: { value: 'good-test' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并查看删除状态' }))
    await screen.findByRole('heading', { name: '个人空间删除状态' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it.each(['success', 'failure'] as const)('does not let a late old profile %s repopulate business state after deletion is accepted', async (outcome) => {
    const f = fixture(); let resolve!: (value: Response) => void
    f.overrides.set('GET /profile', () => new Promise((yes) => { resolve = yes }))
    render(<App personalApi={f.api} />); await openRequest()
    fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
    await screen.findByRole('heading', { name: '个人空间删除状态' })
    await act(async () => resolve(outcome === 'success' ? reply({ ...profileFixture(), displayName: '旧响应不应显示' }) : reply(null, 401)))
    await waitFor(() => expect(screen.queryByRole('navigation')).not.toBeInTheDocument())
    expect(screen.queryByText('旧响应不应显示')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '个人空间删除状态' })).toBeInTheDocument()
  })
})
