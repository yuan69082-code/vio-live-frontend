import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Subject } from '../../api/types'
import AssistantManager from './AssistantManager'
import type { AssistantManagerData, AssistantManagerProps } from './AssistantManager'

function subject(subjectId: string, name: string, ownerUserId = 'fixture-owner-a'): Subject {
  return {
    subjectId, name, ownerUserId, avatarRef: null, basicSettings: {}, status: 'active',
    createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
  }
}

const alpha = subject('fixture-assistant-a', '星光')
const beta = subject('fixture-assistant-b', '月亮')
const gamma = subject('fixture-assistant-c', '森林', 'fixture-owner-b')
const delta = subject('fixture-assistant-d', '海洋', 'fixture-owner-b')

function ready(
  contextKey = 'scope-a',
  assistants: readonly Subject[] = [alpha, beta],
  currentAssistantId: string | null = alpha.subjectId,
): AssistantManagerData {
  return { contextKey, status: 'ready', assistants, currentAssistantId }
}

function props(overrides: Partial<AssistantManagerProps> = {}): AssistantManagerProps {
  return {
    contextKey: 'scope-a', data: ready(),
    onReload: vi.fn(async () => {}), onCreate: vi.fn(async () => {}), onSelect: vi.fn(async () => {}),
    ...overrides,
  }
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function enterName(value: string) {
  fireEvent.change(screen.getByLabelText('助手名称'), { target: { value } })
}

function submitForm() {
  fireEvent.submit(screen.getByRole('form', { name: '创建助手' }))
}

function currentAssistant() {
  return screen.getByLabelText('当前助手')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AssistantManager controlled data and operations', () => {
  it('renders the provided list and current assistant without dispatching work on mount', () => {
    const config = props()
    render(<AssistantManager {...config} />)
    expect(within(screen.getByRole('list', { name: '助手列表' })).getAllByRole('listitem')).toHaveLength(2)
    expect(currentAssistant()).toHaveTextContent('星光')
    expect(screen.getByRole('button', { name: '当前助手：星光' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '当前助手：星光' })).toHaveAttribute('aria-pressed', 'true')
    expect(config.onReload).not.toHaveBeenCalled()
    expect(config.onCreate).not.toHaveBeenCalled()
    expect(config.onSelect).not.toHaveBeenCalled()
  })

  it('shows loading and prevents creation before authoritative data is available', () => {
    const config = props({ data: { contextKey: 'scope-a', status: 'loading' } })
    render(<AssistantManager {...config} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载助手列表')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByLabelText('助手名称')).toBeDisabled()
    submitForm()
    expect(config.onCreate).not.toHaveBeenCalled()
  })

  it('allows retrying a failed initial read and waits for replacement data props', async () => {
    const config = props({ data: { contextKey: 'scope-a', status: 'error' } })
    const view = render(<AssistantManager {...config} />)
    expect(screen.getByRole('alert')).toHaveTextContent('助手列表加载失败')
    fireEvent.click(screen.getByRole('button', { name: '重新加载助手列表' }))
    await waitFor(() => expect(config.onReload).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '重新加载助手列表' })).toBeEnabled())
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    view.rerender(<AssistantManager {...config} data={ready()} />)
    expect(screen.getByRole('list', { name: '助手列表' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the empty state and allows creating the first assistant', () => {
    render(<AssistantManager {...props({ data: ready('scope-a', [], null) })} />)
    expect(screen.getByText('还没有助手，可以在下方创建第一个助手。')).toBeInTheDocument()
    expect(currentAssistant()).toHaveTextContent('尚未选择助手')
    expect(screen.getByRole('button', { name: '创建助手' })).toBeEnabled()
  })

  it('does not guess a current assistant when the selection is missing from the list', () => {
    const config = props({ data: ready('scope-a', [alpha], beta.subjectId) })
    render(<AssistantManager {...config} />)
    expect(screen.getByRole('alert')).toHaveTextContent('当前助手不在此列表')
    expect(screen.getByRole('button', { name: '选择助手：星光' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '创建助手' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重新加载助手列表' })).toBeEnabled()
    expect(config.onSelect).not.toHaveBeenCalled()
  })

  it.each(['', '   ', '\n\t'])('rejects a blank name %j without calling save', (name) => {
    const config = props()
    render(<AssistantManager {...config} />)
    enterName(name)
    submitForm()
    expect(screen.getByRole('alert')).toHaveTextContent('请输入助手名称')
    expect(screen.getByLabelText('助手名称')).toHaveAttribute('aria-invalid', 'true')
    expect(config.onCreate).not.toHaveBeenCalled()
  })

  it('rejects names beyond the existing Subject limit and clears validation on edit', async () => {
    const config = props()
    render(<AssistantManager {...config} />)
    enterName('名'.repeat(81))
    submitForm()
    expect(screen.getByRole('alert')).toHaveTextContent('不能超过 80 个字符')
    expect(config.onCreate).not.toHaveBeenCalled()
    enterName('名'.repeat(80))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    submitForm()
    await waitFor(() => expect(config.onCreate).toHaveBeenCalledTimes(1))
  })

  it('submits trimmed domain input and never fabricates a saved list entry', async () => {
    const request = deferred()
    const onCreate = vi.fn<AssistantManagerProps['onCreate']>(() => request.promise)
    const config = props({ onCreate })
    const view = render(<AssistantManager {...config} />)
    enterName('  新助手  ')
    submitForm()
    expect(onCreate).toHaveBeenCalledWith({ name: '新助手' }, {
      contextKey: 'scope-a', signal: expect.any(AbortSignal),
    })
    expect(screen.getByRole('button', { name: '创建中…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在保存新助手')
    expect(screen.queryByRole('button', { name: '选择助手：新助手' })).not.toBeInTheDocument()
    await act(async () => request.resolve())
    expect(screen.getByLabelText('助手名称')).toHaveValue('')
    expect(screen.queryByRole('button', { name: '选择助手：新助手' })).not.toBeInTheDocument()
    const saved = subject('fixture-created', '新助手')
    view.rerender(<AssistantManager {...config} data={ready('scope-a', [alpha, beta, saved])} />)
    expect(screen.getByRole('button', { name: '选择助手：新助手' })).toBeInTheDocument()
    expect(currentAssistant()).toHaveTextContent('星光')
  })

  it('blocks duplicate form submissions synchronously', async () => {
    const request = deferred()
    const onCreate = vi.fn<AssistantManagerProps['onCreate']>(() => request.promise)
    render(<AssistantManager {...props({ onCreate })} />)
    enterName('新助手')
    act(() => { submitForm(); submitForm(); submitForm() })
    expect(onCreate).toHaveBeenCalledTimes(1)
    await act(async () => request.resolve())
  })

  it('changes current assistant only when the caller publishes the saved selection', async () => {
    const request = deferred()
    const onSelect = vi.fn<AssistantManagerProps['onSelect']>(() => request.promise)
    const config = props({ onSelect })
    const view = render(<AssistantManager {...config} />)
    fireEvent.click(screen.getByRole('button', { name: '选择助手：月亮' }))
    expect(onSelect).toHaveBeenCalledWith(beta.subjectId, {
      contextKey: 'scope-a', signal: expect.any(AbortSignal),
    })
    expect(screen.getByRole('status')).toHaveTextContent('正在切换助手')
    expect(currentAssistant()).toHaveTextContent('星光')
    await act(async () => request.resolve())
    expect(currentAssistant()).toHaveTextContent('星光')
    view.rerender(<AssistantManager {...config} data={ready('scope-a', [alpha, beta], beta.subjectId)} />)
    expect(currentAssistant()).toHaveTextContent('月亮')
    expect(screen.getByRole('button', { name: '当前助手：月亮' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('serializes select, create and reload actions while a mutation is pending', async () => {
    const request = deferred()
    const config = props({ onSelect: vi.fn(() => request.promise) })
    render(<AssistantManager {...config} />)
    enterName('新助手')
    const select = screen.getByRole('button', { name: '选择助手：月亮' })
    act(() => { fireEvent.click(select); fireEvent.click(select); submitForm() })
    fireEvent.click(screen.getByRole('button', { name: '重新加载助手列表' }))
    expect(config.onSelect).toHaveBeenCalledTimes(1)
    expect(config.onCreate).not.toHaveBeenCalled()
    expect(config.onReload).not.toHaveBeenCalled()
    await act(async () => request.resolve())
  })

  it('preserves a failed create draft, hides raw errors and offers an explicit retry', async () => {
    const onCreate = vi.fn<AssistantManagerProps['onCreate']>()
      .mockRejectedValueOnce(new Error('fixture-sensitive-error'))
      .mockResolvedValue(undefined)
    render(<AssistantManager {...props({ onCreate })} />)
    enterName('需要重试的助手')
    submitForm()
    expect(await screen.findByRole('alert')).toHaveTextContent('创建结果未确认')
    expect(screen.queryByText('fixture-sensitive-error')).not.toBeInTheDocument()
    expect(screen.getByLabelText('助手名称')).toHaveValue('需要重试的助手')
    fireEvent.click(screen.getByRole('button', { name: '重试创建助手' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByLabelText('助手名称')).toHaveValue(''))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the real current selection after failure and retries the requested target', async () => {
    const onSelect = vi.fn<AssistantManagerProps['onSelect']>()
      .mockRejectedValueOnce(new Error('fixture-selection-error'))
      .mockResolvedValue(undefined)
    render(<AssistantManager {...props({ onSelect })} />)
    fireEvent.click(screen.getByRole('button', { name: '选择助手：月亮' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('切换未完成')
    expect(currentAssistant()).toHaveTextContent('星光')
    fireEvent.click(screen.getByRole('button', { name: '重试切换到：月亮' }))
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2))
    expect(onSelect.mock.calls[1][0]).toBe(beta.subjectId)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(currentAssistant()).toHaveTextContent('星光')
  })

  it('retries a rejected reload without inventing new data', async () => {
    const onReload = vi.fn<AssistantManagerProps['onReload']>()
      .mockRejectedValueOnce(new Error('fixture-read-error'))
      .mockResolvedValue(undefined)
    render(<AssistantManager {...props({ onReload })} />)
    fireEvent.click(screen.getByRole('button', { name: '重新加载助手列表' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('重新加载失败')
    fireEvent.click(screen.getByRole('button', { name: '重新加载助手列表' }))
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(currentAssistant()).toHaveTextContent('星光')
  })

  it.each(['resolve', 'reject'] as const)('ignores a late create %s after an ownership context change', async (outcome) => {
    const request = deferred()
    const onCreate = vi.fn<AssistantManagerProps['onCreate']>(() => request.promise)
    const config = props({ onCreate })
    const view = render(<AssistantManager {...config} />)
    enterName('旧上下文草稿')
    submitForm()
    const signal = onCreate.mock.calls[0][1].signal
    view.rerender(<AssistantManager {...config} contextKey="scope-b" data={ready('scope-b', [gamma], gamma.subjectId)} />)
    expect(signal.aborted).toBe(true)
    expect(screen.getByLabelText('助手名称')).toHaveValue('')
    enterName('新上下文草稿')
    await act(async () => {
      if (outcome === 'resolve') request.resolve()
      else request.reject(new Error('old-context-error'))
    })
    expect(currentAssistant()).toHaveTextContent('森林')
    expect(screen.queryByText('星光')).not.toBeInTheDocument()
    expect(screen.getByLabelText('助手名称')).toHaveValue('新上下文草稿')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not unlock a new-context request when an old-context request settles', async () => {
    const oldRequest = deferred()
    const newRequest = deferred()
    const onSelect = vi.fn<AssistantManagerProps['onSelect']>()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise)
    const config = props({ onSelect })
    const view = render(<AssistantManager {...config} />)
    fireEvent.click(screen.getByRole('button', { name: '选择助手：月亮' }))
    view.rerender(<AssistantManager {...config} contextKey="scope-b" data={ready('scope-b', [gamma, delta], gamma.subjectId)} />)
    fireEvent.click(screen.getByRole('button', { name: '选择助手：海洋' }))
    await act(async () => oldRequest.resolve())
    expect(screen.getByRole('button', { name: '选择助手：海洋' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在切换助手')
    expect(onSelect.mock.calls[1][1].signal.aborted).toBe(false)
    await act(async () => newRequest.resolve())
    expect(screen.getByRole('button', { name: '选择助手：海洋' })).toBeEnabled()
  })

  it('invalidates pending work when the current assistant changes within the same owner scope', async () => {
    const request = deferred()
    const onCreate = vi.fn<AssistantManagerProps['onCreate']>(() => request.promise)
    const config = props({ onCreate })
    const view = render(<AssistantManager {...config} />)
    enterName('旧助手上下文草稿')
    submitForm()
    view.rerender(<AssistantManager {...config} data={ready('scope-a', [alpha, beta], beta.subjectId)} />)
    expect(onCreate.mock.calls[0][1].signal.aborted).toBe(true)
    enterName('切换后的新草稿')
    await act(async () => request.resolve())
    expect(currentAssistant()).toHaveTextContent('月亮')
    expect(screen.getByLabelText('助手名称')).toHaveValue('切换后的新草稿')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each(['create', 'select', 'reload'] as const)('aborts pending %s work on unmount and ignores rejection', async (kind) => {
    const request = deferred()
    const config = props({
      onCreate: vi.fn(() => request.promise),
      onSelect: vi.fn(() => request.promise),
      onReload: vi.fn(() => request.promise),
    })
    const view = render(<AssistantManager {...config} />)
    if (kind === 'create') { enterName('新助手'); submitForm() }
    else if (kind === 'select') fireEvent.click(screen.getByRole('button', { name: '选择助手：月亮' }))
    else fireEvent.click(screen.getByRole('button', { name: '重新加载助手列表' }))
    const callback = kind === 'create' ? config.onCreate : kind === 'select' ? config.onSelect : config.onReload
    const call = vi.mocked(callback).mock.calls[0]
    const context = call[call.length - 1] as { signal: AbortSignal }
    view.unmount()
    expect(context.signal.aborted).toBe(true)
    render(<AssistantManager {...props()} />)
    await act(async () => request.reject(new Error('unmounted-error')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not display a late data snapshot tagged for another context', () => {
    const config = props()
    const view = render(<AssistantManager {...config} contextKey="scope-b" data={ready('scope-b', [gamma], gamma.subjectId)} />)
    view.rerender(<AssistantManager {...config} contextKey="scope-b" data={ready()} />)
    expect(screen.queryByText('星光')).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载助手列表')
    expect(screen.getByRole('button', { name: '创建助手' })).toBeDisabled()
    submitForm()
    expect(config.onCreate).not.toHaveBeenCalled()
  })

  it('preserves a draft across loading and benign same-context data refreshes', () => {
    const config = props()
    const view = render(<AssistantManager {...config} />)
    enterName('保留草稿')
    view.rerender(<AssistantManager {...config} data={{ contextKey: 'scope-a', status: 'loading' }} />)
    view.rerender(<AssistantManager {...config} data={ready()} />)
    expect(screen.getByLabelText('助手名称')).toHaveValue('保留草稿')
  })

  it('handles StrictMode without automatic calls or duplicate submissions', async () => {
    const config = props()
    render(<StrictMode><AssistantManager {...config} /></StrictMode>)
    expect(config.onReload).not.toHaveBeenCalled()
    enterName('严格模式助手')
    submitForm()
    await waitFor(() => expect(config.onCreate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText('助手名称')).toHaveValue(''))
  })

  it('does not call fetch or persist data independently of the supplied callbacks', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const config = props()
    render(<AssistantManager {...config} />)
    enterName('仅回调保存')
    submitForm()
    await waitFor(() => expect(config.onCreate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText('助手名称')).toHaveValue(''))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(storageSpy).not.toHaveBeenCalled()
  })
})
