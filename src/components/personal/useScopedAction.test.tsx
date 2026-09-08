import { act, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../../api/client'
import { personalError, useScopedAction } from './useScopedAction'

function pending() {
  let resolve!: (value: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function Harness({ scope, work, accept }: {
  scope: string; work: (signal: AbortSignal) => Promise<string>; accept: (value: string) => void
}) {
  const task = useScopedAction(scope)
  return <><button onClick={() => void task.run(work, accept)}>执行</button>
    <button onClick={task.cancel}>取消</button><output>{task.busy ? '忙碌' : '空闲'}</output>
    {task.error && <p role="alert">{task.error}</p>}</>
}

describe('scoped async view state', () => {
  it('maps R5 fail-closed memory errors without exposing raw server text', () => {
    expect(personalError(new ApiClientError('raw body path', { code: 'MEMORY_SOURCE_NOT_FOUND', status: 404 }))).toContain('拒绝返回整条记忆')
    expect(personalError(new ApiClientError('raw deleted body', { code: 'MEMORY_BODY_UNAVAILABLE', status: 410 }))).toContain('不能恢复正文')
    expect(personalError(new ApiClientError('raw stale version', { code: 'MEMORY_VERSION_CONFLICT', status: 409 }))).toContain('重新读取')
    expect(personalError(new ApiClientError('raw ledger detail', { code: 'MEMORY_LEDGER_INCONSISTENT', status: 500 }))).not.toMatch(/raw|ledger detail/)
  })

  it('holds a synchronous mutex, even before controls can rerender', async () => {
    const job = pending(); const work = vi.fn(() => job.promise); const accept = vi.fn()
    render(<Harness scope="a" work={work} accept={accept} />)
    act(() => { fireEvent.click(screen.getByText('执行')); fireEvent.click(screen.getByText('执行')) })
    expect(work).toHaveBeenCalledTimes(1)
    await act(async () => job.resolve('saved'))
    expect(accept).toHaveBeenCalledExactlyOnceWith('saved')
    expect(screen.getByText('空闲')).toBeInTheDocument()
  })

  it.each(['success', 'failure'] as const)('does not let late %s or finally affect a new scope request', async (outcome) => {
    const oldJob = pending(); const newJob = pending(); const accept = vi.fn()
    const work = vi.fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => oldJob.promise).mockImplementationOnce(() => newJob.promise)
    const view = render(<Harness scope="a" work={work} accept={accept} />)
    fireEvent.click(screen.getByText('执行'))
    view.rerender(<Harness scope="b" work={work} accept={accept} />)
    expect(work.mock.calls[0][0].aborted).toBe(true)
    fireEvent.click(screen.getByText('执行'))
    await act(async () => outcome === 'success' ? oldJob.resolve('old') : oldJob.reject(new Error('sensitive-fixture')))
    expect(accept).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('忙碌')).toBeInTheDocument()
    expect(work.mock.calls[1][0].aborted).toBe(false)
    await act(async () => newJob.resolve('new'))
    expect(accept).toHaveBeenCalledExactlyOnceWith('new')
  })

  it.each(['cancel', 'unmount'] as const)('aborts on %s and ignores the final response', async (mode) => {
    const job = pending(); const work = vi.fn<(signal: AbortSignal) => Promise<string>>(() => job.promise); const accept = vi.fn()
    const view = render(<Harness scope="a" work={work} accept={accept} />)
    fireEvent.click(screen.getByText('执行'))
    if (mode === 'cancel') fireEvent.click(screen.getByText('取消'))
    else view.unmount()
    expect(work.mock.calls[0][0].aborted).toBe(true)
    await act(async () => job.resolve('late'))
    expect(accept).not.toHaveBeenCalled()
  })

  it('survives StrictMode, sanitizes failure and allows a retry', async () => {
    const work = vi.fn().mockRejectedValueOnce(new Error('do-not-display')).mockResolvedValueOnce('saved')
    const accept = vi.fn()
    render(<StrictMode><Harness scope="a" work={work} accept={accept} /></StrictMode>)
    expect(work).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByText('执行')))
    expect(screen.getByRole('alert')).not.toHaveTextContent('do-not-display')
    await act(async () => fireEvent.click(screen.getByText('执行')))
    expect(accept).toHaveBeenCalledExactlyOnceWith('saved')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
