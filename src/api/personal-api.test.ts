import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { createPersonalApi, finishOperation, operationKey } from './personal-api'
import { envelope, sessionFixture } from '../test/personal-fixtures'

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

describe('personal session client boundary', () => {
  it('uses same-origin cookies, no-store, CSRF and idempotency, never a development user header', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope({}))
    const api = createPersonalApi(createApiClient({ fetchImplementation: fetcher }))
    api.setSession(sessionFixture())
    await api.request('/onboarding', 'POST', { displayName: '测试' }, { idempotencyKey: 'test-key' })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/personal/onboarding', expect.objectContaining({
      credentials: 'same-origin', redirect: 'error', cache: 'no-store', method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'X-Vio-CSRF': 'test-csrf', 'Idempotency-Key': 'test-key' },
      body: JSON.stringify({ displayName: '测试' }),
    }))
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('x-vio-user-id')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('expires current authorization on 401 but not on a late 401 from the old session', async () => {
    let respond!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolve) => { respond = resolve })).mockResolvedValueOnce(envelope(null, 401))
    const api = createPersonalApi(createApiClient({ fetchImplementation: fetcher }))
    const expired = vi.fn(); api.onUnauthorized(expired); api.setSession(sessionFixture())
    const old = api.profile().catch(() => undefined)
    api.setSession(sessionFixture({ csrfToken: 'new-csrf' }))
    respond(envelope(null, 401)); await old
    expect(expired).not.toHaveBeenCalled()
    await expect(api.profile()).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledTimes(1)
  })

  it('retains only operation keys across retries and isolates different users', () => {
    const a = operationKey('unit-owner-a', 'create')
    expect(operationKey('unit-owner-a', 'create')).toBe(a)
    expect(operationKey('unit-owner-b', 'create')).not.toBe(a)
    finishOperation('unit-owner-a', 'create')
    expect(operationKey('unit-owner-a', 'create')).not.toBe(a)
    for (let i = 0; i < sessionStorage.length; i++) expect(sessionStorage.getItem(sessionStorage.key(i)!)).toMatch(/^vio-personal-[a-f0-9-]+$/)
  })

  it('keeps the in-memory retry key if browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const key = operationKey('unit-blocked', 'create')
    expect(operationKey('unit-blocked', 'create')).toBe(key)
  })

  it('does not let a late old operation finish retire the replacement key', () => {
    const oldKey = operationKey('unit-late-finish', 'create-provider')
    finishOperation('unit-late-finish', 'create-provider', oldKey)
    const replacement = operationKey('unit-late-finish', 'create-provider')
    expect(replacement).not.toBe(oldKey)
    finishOperation('unit-late-finish', 'create-provider', oldKey)
    expect(operationKey('unit-late-finish', 'create-provider')).toBe(replacement)
  })

  it('preserves the contract operation path when recovering a scoped provider operation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope({ status: 'not_found' }))
    const api = createPersonalApi(createApiClient({ fetchImplementation: fetcher }))
    await api.operation('save-credential/provider-test', 'vio-personal-test-key')
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/personal/operations?operation=save-credential%2Fprovider-test&key=vio-personal-test-key',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('sends R5 sensitive read context only in GET headers and never in its URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope({}))
    const api = createPersonalApi(createApiClient({ fetchImplementation: fetcher }))
    await api.request('/memories/memory-r5', 'GET', undefined, { confirmationId: 'confirmation-r5', securitySessionId: 'security-session-r5' })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/personal/memories/memory-r5', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ 'X-Vio-Confirmation-Id': 'confirmation-r5', 'X-Vio-Security-Session-Id': 'security-session-r5' }),
    }))
    expect(String(fetcher.mock.calls[0][0])).not.toMatch(/confirmation|security/)
  })
})
