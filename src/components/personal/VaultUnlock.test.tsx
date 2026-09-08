import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createApiClient } from '../../api/client'
import { CAPABILITY_CATALOG_VERSION, CAPABILITY_EXECUTION_LIST_VERSION } from '../../api/personal-capability-api'
import { createPersonalApi } from '../../api/personal-api'
import type { PersonalSession } from '../../api/personal-api'
import { PersonalProvider, usePersonal } from '../../state/PersonalContext'
import { envelope, listFixture, sessionFixture } from '../../test/personal-fixtures'
import ProviderManager from './ProviderManager'

const futureSession = (overrides: Partial<PersonalSession> = {}) => sessionFixture({
  session: { sessionId: 'vault-test-session', expiresAt: '2099-01-01T00:00:00.000Z' },
  ...overrides,
})

function failure(status: number, code: string) {
  return new Response(JSON.stringify({
    success: false, data: null,
    error: { code, message: 'raw-server-message-must-not-be-shown' },
    timestamp: '2026-09-05T00:00:00.000Z',
  }), { status, headers: { 'content-type': 'application/json' } })
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((accept) => { resolve = accept })
  return { promise, resolve }
}

/** Exercises the actual client, authorization callback, context and product components. */
function serverFixture() {
  let currentSession: PersonalSession | null = futureSession()
  const unlock = vi.fn<(options: RequestInit) => Promise<Response> | Response>()
  const unexpected: string[] = []
  const fetcher = vi.fn<typeof fetch>(async (input, options = {}) => {
    const path = new URL(String(input), 'http://localhost').pathname
    const method = options.method ?? 'GET'
    if (path === '/api/v1/personal/session' && method === 'GET') {
      return currentSession ? envelope(currentSession) : failure(401, 'ACCESS_DENIED')
    }
    if (path === '/api/v1/personal/deletions/current' && method === 'GET') return failure(401, 'DELETION_ACCESS_DENIED')
    if (path === '/api/v1/personal/access' && method === 'GET') return envelope({ status: 'authentication_required', registration: 'disabled' })
    if (path === '/api/v1/personal/assistants' && method === 'GET') return envelope(listFixture())
    if (['/api/v1/personal/providers', '/api/v1/personal/models'].includes(path) && method === 'GET') return envelope({ items: [] })
    if (path === '/api/v1/personal/capabilities' && method === 'GET') return envelope({ schemaVersion: CAPABILITY_CATALOG_VERSION, items: [] })
    if (path === '/api/v1/personal/capability-executions' && method === 'GET') return envelope({ schemaVersion: CAPABILITY_EXECUTION_LIST_VERSION, items: [], nextCursor: null })
    if (path === '/api/v1/personal/vault' && method === 'GET') return envelope({ status: 'ready' })
    if (path === '/api/v1/personal/vault/unlock' && method === 'POST') return unlock(options)
    unexpected.push(`${method} ${path}`)
    throw new Error('Unexpected test request')
  })
  const api = createPersonalApi(createApiClient({ fetchImplementation: fetcher }))
  return {
    api, fetcher, unlock, unexpected,
    setSession(value: PersonalSession | null) { currentSession = value },
    requests(path: string) { return fetcher.mock.calls.filter(([input]) => String(input) === `/api/v1/personal${path}`) },
  }
}

async function openCapability() {
  const navigation = await screen.findByRole('navigation', { name: '主导航' })
  fireEvent.click(within(navigation).getByRole('button', { name: /^能力$/ }))
  await screen.findByText('尚未配置供应商。')
}

function draftProvider(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '新增服务' }))
  fireEvent.change(screen.getByLabelText('供应商名称'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://127.0.0.1:9999/v1' } })
}

function submitUnlock(value: string) {
  fireEvent.change(screen.getByLabelText('解锁凭据库口令'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: /^解锁凭据库$/ }))
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear() })

describe('real-client vault unlock authorization boundary', () => {
  it('keeps the authenticated page and its legitimate draft after a wrong passphrase, clears the secret and permits a correct retry in StrictMode', async () => {
    const server = serverFixture()
    server.unlock.mockReturnValueOnce(failure(403, 'VAULT_UNLOCK_FAILED')).mockReturnValueOnce(envelope({ status: 'ready' }))
    render(<StrictMode><App personalApi={server.api} /></StrictMode>)
    await openCapability()
    draftProvider('尚未提交的供应商草稿')

    submitUnlock('isolated-wrong-vault-passphrase')
    expect(await screen.findByRole('alert')).toHaveTextContent('解锁口令错误，请重新输入。当前访问会话仍然有效。')
    expect(screen.getByLabelText('解锁凭据库口令')).toHaveValue('')
    expect(screen.getByLabelText('供应商名称')).toHaveValue('尚未提交的供应商草稿')
    expect(screen.getByLabelText('Base URL')).toHaveValue('http://127.0.0.1:9999/v1')
    expect(within(screen.getByRole('navigation', { name: '主导航' })).getAllByRole('button')).toHaveLength(6)
    expect(screen.queryByRole('heading', { name: '验证个人访问' })).not.toBeInTheDocument()
    expect(server.requests('/session')).toHaveLength(1)
    expect(server.requests('/deletions/current')).toHaveLength(0)

    submitUnlock('isolated-correct-vault-passphrase')
    expect(await screen.findByText('凭据库：ready')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('解锁凭据库口令')).toHaveValue('')
    expect(screen.getByLabelText('供应商名称')).toHaveValue('尚未提交的供应商草稿')
    expect(server.unlock).toHaveBeenCalledTimes(2)
    expect(server.unlock.mock.calls.map(([options]) => JSON.parse(String(options.body)))).toEqual([
      { passphrase: 'isolated-wrong-vault-passphrase' },
      { passphrase: 'isolated-correct-vault-passphrase' },
    ])
    expect(server.requests('/vault')).toHaveLength(1)
    expect(document.body).not.toHaveTextContent('raw-server-message-must-not-be-shown')
    expect(localStorage.length).toBe(0)
    for (let index = 0; index < sessionStorage.length; index++) {
      expect(sessionStorage.getItem(sessionStorage.key(index)!)).not.toContain('vault-passphrase')
    }
    expect(server.unexpected).toEqual([])
  })

  it('does not exempt the unlock endpoint from a true session 401: it restores access and removes the protected page', async () => {
    const server = serverFixture()
    server.unlock.mockImplementation(() => { server.setSession(null); return failure(401, 'ACCESS_DENIED') })
    render(<App personalApi={server.api} />)
    await openCapability()
    draftProvider('已失效会话的草稿')

    submitUnlock('isolated-expired-session-passphrase')
    expect(await screen.findByRole('heading', { name: '验证个人访问' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('解锁凭据库口令')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('供应商名称')).not.toBeInTheDocument()
    expect(screen.queryByText('凭据库：ready')).not.toBeInTheDocument()
    expect(screen.getByLabelText('个人访问口令')).toHaveValue('')
    expect(server.requests('/session')).toHaveLength(2)
    expect(server.requests('/deletions/current')).toHaveLength(1)
    expect(server.requests('/access')).toHaveLength(1)
    expect(server.requests('/vault')).toHaveLength(0)
    expect(server.unexpected).toEqual([])
  })

  it.each(['success', 'wrong-passphrase', 'unauthorized'] as const)('ignores an old unlock %s and finally after the context moves to a new session', async (outcome) => {
    const server = serverFixture()
    const oldResponse = deferredResponse()
    const newResponse = deferredResponse()
    // Deliberately allow the transport to resolve after abort to prove the view guard.
    server.unlock.mockImplementationOnce(() => oldResponse.promise).mockImplementationOnce(() => newResponse.promise)
    const replacement = futureSession({
      user: { userId: 'vault-new-owner', displayName: '新会话用户', avatar: null },
      session: { sessionId: 'vault-replacement-session', expiresAt: '2099-01-01T00:00:00.000Z' },
      csrfToken: 'vault-replacement-csrf',
    })
    function SessionHarness() {
      const personal = usePersonal()
      return <><button type="button" onClick={() => { server.setSession(replacement); personal.acceptSession(replacement) }}>接受新的已验证会话</button>
        <output aria-label="访问状态">{personal.state.kind === 'ready' ? personal.state.session.user.displayName : personal.state.kind}</output>
        {personal.state.kind === 'ready' && <ProviderManager key={personal.scope} />}</>
    }
    render(<StrictMode><PersonalProvider api={server.api}><SessionHarness /></PersonalProvider></StrictMode>)
    await screen.findByText('尚未配置供应商。')
    submitUnlock('isolated-old-request-passphrase')
    expect(server.unlock).toHaveBeenCalledTimes(1)
    const oldSignal = server.unlock.mock.calls[0][0].signal

    fireEvent.click(screen.getByRole('button', { name: '接受新的已验证会话' }))
    await screen.findByText('尚未配置供应商。')
    expect(oldSignal?.aborted).toBe(true)
    draftProvider('新会话的合法草稿')
    submitUnlock('isolated-new-request-passphrase')
    expect(server.unlock).toHaveBeenCalledTimes(2)
    await act(async () => oldResponse.resolve(outcome === 'success' ? envelope({ status: 'ready' }) : failure(outcome === 'unauthorized' ? 401 : 403, outcome === 'unauthorized' ? 'ACCESS_DENIED' : 'VAULT_UNLOCK_FAILED')))

    expect(screen.getByLabelText('访问状态')).toHaveTextContent('新会话用户')
    expect(screen.getByLabelText('供应商名称')).toHaveValue('新会话的合法草稿')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('凭据库：ready')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^解锁凭据库$/ })).toBeDisabled()
    expect(screen.getByLabelText('解锁凭据库口令')).toBeDisabled()
    expect(server.unlock.mock.calls[1][0].signal?.aborted).toBe(false)
    expect(server.requests('/session')).toHaveLength(1)
    expect(server.requests('/vault')).toHaveLength(0)

    await act(async () => newResponse.resolve(envelope({ status: 'ready' })))
    expect(await screen.findByText('凭据库：ready')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('解锁凭据库口令')).toBeEnabled())
    expect(screen.getByLabelText('供应商名称')).toHaveValue('新会话的合法草稿')
    expect(server.requests('/vault')).toHaveLength(1)
    expect(server.unexpected).toEqual([])
  })

  it('also rejects an un-aborted old 401 without expiring a newer API session', async () => {
    const server = serverFixture()
    const oldResponse = deferredResponse()
    server.unlock.mockImplementationOnce(() => oldResponse.promise).mockReturnValueOnce(failure(401, 'ACCESS_DENIED'))
    const unauthorized = vi.fn()
    server.api.onUnauthorized(unauthorized)
    server.api.setSession(futureSession())
    const oldRequest = server.api.request('/vault/unlock', 'POST', { passphrase: 'isolated-old-client-passphrase' })
    const oldRejection = expect(oldRequest).rejects.toMatchObject({ status: 401, code: 'ACCESS_DENIED' })
    server.api.setSession(futureSession({ csrfToken: 'new-client-csrf' }))
    oldResponse.resolve(failure(401, 'ACCESS_DENIED'))
    await oldRejection
    expect(unauthorized).not.toHaveBeenCalled()
    await expect(server.api.request('/vault/unlock', 'POST', { passphrase: 'isolated-current-client-passphrase' })).rejects.toMatchObject({ status: 401, code: 'ACCESS_DENIED' })
    expect(unauthorized).toHaveBeenCalledTimes(1)
    expect(server.unexpected).toEqual([])
  })
})
