import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPersonalApi, finishOperation, operationKey } from '../../api/personal-api'
import { ApiClientError } from '../../api/client'
import { sessionFixture } from '../../test/personal-fixtures'
import { PersonalProvider, usePersonal } from '../../state/PersonalContext'
import { useConfirmedAction } from './ConfirmedAction'

function Harness({ work, cancel, accept, onCancelled, scope = 'confirmation-test' }: {
  work: (signal: AbortSignal, confirmationId?: string) => Promise<unknown>
  cancel: (signal: AbortSignal) => Promise<unknown>
  accept: (value: unknown) => void
  onCancelled?: () => void
  scope?: string
}) {
  const { state } = usePersonal()
  const action = useConfirmedAction(scope)
  if (state.kind !== 'ready') return <p>正在恢复测试会话</p>
  return <>
    <button type="button" onClick={() => void action.execute({ label: '保存测试配置', work, cancel, accept, onCancelled })}>执行测试操作</button>
    <button type="button" onClick={action.cancel}>取消等待</button>
    <button type="button" onClick={action.clearPending}>清理本地上下文</button>
    {action.controls}
  </>
}

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear() })

const needsConfirmation = { operationStatus: 'confirmation_required', security: { confirmation: { confirmationId: 'confirmation-test-id' } } }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function readyApi() {
  const api = createPersonalApi()
  vi.spyOn(api, 'session').mockResolvedValue(sessionFixture())
  vi.spyOn(api, 'request').mockResolvedValue({})
  return api
}

describe('backend confirmation cancellation', () => {
  it('rejects the safety confirmation and waits for the server operation cancellation', async () => {
    const api = createPersonalApi()
    vi.spyOn(api, 'session').mockResolvedValue(sessionFixture())
    vi.spyOn(api, 'request').mockResolvedValue({})
    const work = vi.fn().mockResolvedValue({ operationStatus: 'confirmation_required', security: { confirmation: { confirmationId: 'confirmation-test-id' } } })
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' })
    const accept = vi.fn()
    const onCancelled = vi.fn()
    render(<PersonalProvider api={api}><Harness work={work} cancel={cancel} accept={accept} onCancelled={onCancelled} /></PersonalProvider>)

    await screen.findByText('执行测试操作')
    fireEvent.click(screen.getByText('执行测试操作'))
    expect(await screen.findByRole('group', { name: '后端安全确认' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '拒绝并取消' }))

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    expect(api.request).toHaveBeenCalledWith(
      '/confirmations/confirmation-test-id/decision',
      'POST',
      { decision: 'reject' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(await screen.findByText('已拒绝并取消本次服务端操作。')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '后端安全确认' })).not.toBeInTheDocument()
    expect(accept).not.toHaveBeenCalled()
    expect(onCancelled).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unknown response', { status: 'not_found' }],
    ['incomplete completion', { status: 'completed' }],
  ])('retains confirmation and the operation key for %s', async (_label, result) => {
    const api = readyApi()
    const owner = crypto.randomUUID()
    const key = operationKey(owner, 'create-provider')
    const onCancelled = vi.fn(() => finishOperation(owner, 'create-provider', key))
    render(<PersonalProvider api={api}><Harness work={vi.fn().mockResolvedValue(needsConfirmation)} cancel={vi.fn().mockResolvedValue(result)} accept={vi.fn()} onCancelled={onCancelled} /></PersonalProvider>)
    fireEvent.click(await screen.findByText('执行测试操作'))
    fireEvent.click(await screen.findByText('拒绝并取消'))
    expect(await screen.findByRole('alert')).toHaveTextContent('服务端响应无法验证')
    expect(screen.getByRole('group', { name: '后端安全确认' })).toBeInTheDocument()
    expect(onCancelled).not.toHaveBeenCalled()
    expect(operationKey(owner, 'create-provider')).toBe(key)
    finishOperation(owner, 'create-provider', key)
  })

  it.each(['network_error', 'request_timeout'])('preserves the key after %s and allows cancellation verification retry', async (code) => {
    const api = readyApi()
    const owner = crypto.randomUUID()
    const key = operationKey(owner, 'create-provider')
    const cancel = vi.fn().mockRejectedValueOnce(new ApiClientError('Test-only transport failure', { code, status: null })).mockResolvedValueOnce({ status: 'cancelled' })
    const onCancelled = vi.fn(() => finishOperation(owner, 'create-provider', key))
    render(<PersonalProvider api={api}><Harness work={vi.fn().mockResolvedValue(needsConfirmation)} cancel={cancel} accept={vi.fn()} onCancelled={onCancelled} /></PersonalProvider>)
    fireEvent.click(await screen.findByText('执行测试操作'))
    fireEvent.click(await screen.findByText('拒绝并取消'))
    await screen.findByRole('alert')
    expect(onCancelled).not.toHaveBeenCalled()
    expect(operationKey(owner, 'create-provider')).toBe(key)
    fireEvent.click(screen.getByText('拒绝并取消'))
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1))
    expect(operationKey(owner, 'create-provider')).not.toBe(key)
    finishOperation(owner, 'create-provider')
  })

  it('uses the server completed result when cancellation loses the race', async () => {
    const result = { operationStatus: 'completed', provider: { providerId: 'test-provider' } }
    const accept = vi.fn()
    const onCancelled = vi.fn()
    render(<PersonalProvider api={readyApi()}><Harness work={vi.fn().mockResolvedValue(needsConfirmation)} cancel={vi.fn().mockResolvedValue({ status: 'completed', result })} accept={accept} onCancelled={onCancelled} /></PersonalProvider>)
    fireEvent.click(await screen.findByText('执行测试操作'))
    fireEvent.click(await screen.findByText('拒绝并取消'))
    await waitFor(() => expect(accept).toHaveBeenCalledWith(result))
    expect(onCancelled).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: '后端安全确认' })).not.toBeInTheDocument()
  })

  it('recovers a previously cancelled operation result without asking the user to clear storage', async () => {
    const onCancelled = vi.fn()
    const accept = vi.fn()
    render(<PersonalProvider api={readyApi()}><Harness work={vi.fn().mockResolvedValue({ operationStatus: 'cancelled' })} cancel={vi.fn()} accept={accept} onCancelled={onCancelled} /></PersonalProvider>)
    fireEvent.click(await screen.findByText('执行测试操作'))
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1))
    expect(accept).not.toHaveBeenCalled()
  })

  it('keeps one request owner under same-tick duplicate clicks in StrictMode', async () => {
    const pending = deferred<unknown>()
    const work = vi.fn().mockReturnValue(pending.promise)
    const accept = vi.fn()
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' })
    const onCancelled = vi.fn()
    render(<StrictMode><PersonalProvider api={readyApi()}><Harness work={work} cancel={cancel} accept={accept} onCancelled={onCancelled} /></PersonalProvider></StrictMode>)
    const trigger = await screen.findByText('执行测试操作')
    act(() => { trigger.click(); trigger.click() })
    expect(work).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(needsConfirmation))
    const reject = await screen.findByText('拒绝并取消')
    act(() => { reject.click(); reject.click() })
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    expect(onCancelled).toHaveBeenCalledTimes(1)
  })

  it.each(['cancel', 'clear', 'scope', 'unmount'] as const)('ignores late cancellation after %s, without releasing the original key', async (change) => {
    const api = readyApi()
    const pending = deferred<unknown>()
    const cancel = vi.fn().mockReturnValue(pending.promise)
    const owner = crypto.randomUUID()
    const key = operationKey(owner, 'create-provider')
    const onCancelled = vi.fn(() => finishOperation(owner, 'create-provider', key))
    const work = vi.fn().mockResolvedValue(needsConfirmation)
    const accept = vi.fn()
    const view = render(<PersonalProvider api={api}><Harness work={work} cancel={cancel} accept={accept} onCancelled={onCancelled} /></PersonalProvider>)
    fireEvent.click(await screen.findByText('执行测试操作'))
    fireEvent.click(await screen.findByText('拒绝并取消'))
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    if (change === 'cancel') fireEvent.click(screen.getByText('取消等待'))
    else if (change === 'clear') fireEvent.click(screen.getByText('清理本地上下文'))
    else if (change === 'scope') view.rerender(<PersonalProvider api={api}><Harness scope="new-view" work={work} cancel={cancel} accept={accept} onCancelled={onCancelled} /></PersonalProvider>)
    else view.unmount()
    expect(cancel.mock.calls[0][0].aborted).toBe(true)
    await act(async () => pending.resolve({ status: 'cancelled' }))
    expect(onCancelled).not.toHaveBeenCalled()
    expect(accept).not.toHaveBeenCalled()
    expect(operationKey(owner, 'create-provider')).toBe(key)
    expect(screen.queryByText('已拒绝并取消本次服务端操作。')).not.toBeInTheDocument()
    finishOperation(owner, 'create-provider', key)
  })
})
