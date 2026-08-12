import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../api'
import type {
  ConversationApi,
  ConversationMessage,
  ConversationTurn,
  ConversationTurnStatus,
} from '../api'
import { PENDING_TURN_STORAGE_KEY } from '../api/conversation-recovery'
import ConversationPage from './ConversationPage'

const createdAt = '2026-08-12T01:02:00.000Z'

function message(
  senderType: 'user' | 'subject',
  sequenceNumber: number,
  content: string,
): ConversationMessage {
  return {
    messageId: `${senderType}-${sequenceNumber}`,
    messageVersionId: `${senderType}-version-${sequenceNumber}`,
    senderType,
    content,
    sequenceNumber,
    createdAt,
  }
}

function turn(
  status: ConversationTurnStatus,
  overrides: Partial<ConversationTurn> = {},
): ConversationTurn {
  return {
    turnId: 'turn-001',
    userId: 'user-001',
    subjectId: 'assistant-001',
    conversationId: 'conversation-001',
    status,
    userMessage: message('user', 1, '真实用户消息'),
    subjectMessage: status === 'completed' ? message('subject', 2, 'Engine 最终回复') : null,
    confirmation: status === 'confirmation_required' || status === 'budget_confirmation_required'
      ? { confirmationId: 'confirmation-001' }
      : null,
    failure: status === 'failed' ? { code: 'provider_terminal_failure' } : null,
    createdAt,
    updatedAt: createdAt,
    completedAt: status === 'completed' ? createdAt : null,
    ...overrides,
  }
}

function mockApi(overrides: Partial<ConversationApi> = {}) {
  return {
    listMessages: vi.fn(async () => []),
    createTurn: vi.fn(async () => turn('completed')),
    getTurn: vi.fn(async () => turn('completed')),
    resumeTurn: vi.fn(async () => turn('completed')),
    ...overrides,
  } as unknown as ConversationApi
}

async function ready() {
  await screen.findByText('开始一段新对话')
}

function typeAndSend(content = '请回复') {
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: content } })
  fireEvent.click(screen.getByLabelText('发送消息'))
}

beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-001') })
})

describe('ConversationPage V5 flow', () => {
  it('shows loading, empty state, real history and retries a failed history read', async () => {
    const listMessages = vi.fn()
      .mockRejectedValueOnce(new ApiClientError('offline', { code: 'network_error', status: null }))
      .mockResolvedValueOnce([message('user', 1, '历史问题')])
    const api = mockApi({ listMessages })
    render(<ConversationPage api={api} storage={sessionStorage} />)

    expect(screen.getByText('正在读取会话记录…')).toBeInTheDocument()
    await screen.findByText(/会话记录读取失败/)
    fireEvent.click(screen.getByRole('button', { name: '重试记录' }))

    expect(await screen.findByText('历史问题')).toBeInTheDocument()
    expect(listMessages).toHaveBeenCalledTimes(2)
  })

  it('sends once and renders exactly one real user message and one Engine subject message', async () => {
    const api = mockApi()
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()

    fireEvent.change(screen.getByLabelText('输入消息'), {
      target: { value: '  真实用户消息  ' },
    })
    fireEvent.click(screen.getByLabelText('发送消息'))
    fireEvent.click(screen.getByLabelText('发送消息'))

    expect(await screen.findByText('Engine 最终回复')).toBeInTheDocument()
    expect(api.createTurn).toHaveBeenCalledWith(
      '真实用户消息',
      'vio-turn-uuid-001',
      expect.objectContaining({ timeoutMs: 90_000 }),
    )
    expect(screen.getAllByText('真实用户消息')).toHaveLength(1)
    expect(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY)).toBeNull()
  })

  it('waits for an explicit confirmation click and submits the returned confirmation id once', async () => {
    const api = mockApi({ createTurn: vi.fn(async () => turn('confirmation_required')) })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend()

    expect(await screen.findByText('需要你的确认')).toBeInTheDocument()
    expect(api.resumeTurn).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: '确认并继续' })
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(api.resumeTurn).toHaveBeenCalledTimes(1))
    expect(api.resumeTurn).toHaveBeenCalledWith(
      'turn-001',
      { confirmationId: 'confirmation-001' },
      expect.any(Object),
    )
  })

  it('handles budget confirmation only after the user explicitly approves it', async () => {
    const api = mockApi({ createTurn: vi.fn(async () => turn('budget_confirmation_required')) })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend()

    const button = await screen.findByRole('button', { name: '确认预算并继续' })
    expect(api.resumeTurn).not.toHaveBeenCalled()
    fireEvent.click(button)

    await waitFor(() => expect(api.resumeTurn).toHaveBeenCalledWith(
      'turn-001',
      { confirmationId: 'confirmation-001' },
      expect.any(Object),
    ))
  })

  it('rechecks waiting budget with an empty resumption body only after a click', async () => {
    const api = mockApi({ createTurn: vi.fn(async () => turn('waiting_budget')) })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend()

    const button = await screen.findByRole('button', { name: '重新检查预算' })
    expect(api.resumeTurn).not.toHaveBeenCalled()
    fireEvent.click(button)

    await waitFor(() => expect(api.resumeTurn).toHaveBeenCalledWith(
      'turn-001',
      {},
      expect.any(Object),
    ))
  })

  it('warns that waiting retry may call the provider and submits one approved retry', async () => {
    let resolveResume: (value: ConversationTurn) => void = () => undefined
    const resumeTurn = vi.fn(() => new Promise<ConversationTurn>((resolve) => {
      resolveResume = resolve
    }))
    const api = mockApi({ createTurn: vi.fn(async () => turn('waiting_retry')), resumeTurn })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend()

    const button = await screen.findByRole('button', { name: '批准重试一次' })
    expect(screen.getByText(/再次调用模型服务/)).toBeInTheDocument()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(resumeTurn).toHaveBeenCalledTimes(1)
    expect(resumeTurn).toHaveBeenCalledWith('turn-001', { retryApproved: true }, expect.any(Object))

    await act(async () => resolveResume(turn('completed')))
  })

  it('recovers outcome unknown query-first and never displays a fake assistant reply', async () => {
    const getTurn = vi.fn(async () => turn('outcome_unknown'))
    const api = mockApi({
      createTurn: vi.fn(async () => turn('outcome_unknown')),
      getTurn,
    })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend()

    expect(await screen.findByText('轮次结果未知')).toBeInTheDocument()
    expect(screen.queryByText('Engine 最终回复')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查询并恢复' }))

    await waitFor(() => expect(api.resumeTurn).toHaveBeenCalledWith('turn-001', {}, expect.any(Object)))
    expect(getTurn.mock.invocationCallOrder[0]).toBeLessThan(
      (api.resumeTurn as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    )
  })

  it('keeps the original key and content after timeout, then replays the same create fact', async () => {
    const createTurn = vi.fn()
      .mockRejectedValueOnce(new ApiClientError('timeout', { code: 'request_timeout', status: null }))
      .mockResolvedValueOnce(turn('completed'))
    const api = mockApi({ createTurn })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend('不会重复')

    expect(await screen.findByText('发送结果尚未确认')).toBeInTheDocument()
    expect(screen.queryByText('不会重复')).not.toBeInTheDocument()
    const stored = JSON.parse(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY) ?? '{}')
    expect(stored).toMatchObject({
      idempotencyKey: 'vio-turn-uuid-001',
      content: '不会重复',
    })
    fireEvent.click(screen.getByRole('button', { name: '查询并恢复' }))

    expect(await screen.findByText('Engine 最终回复')).toBeInTheDocument()
    expect(createTurn).toHaveBeenCalledTimes(2)
    expect(createTurn.mock.calls[1].slice(0, 2)).toEqual(['不会重复', 'vio-turn-uuid-001'])
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('真实用户消息')).toHaveLength(1)
  })

  it('restores a saved turn by GET and removes no-longer-needed content without a new create key', async () => {
    sessionStorage.setItem(PENDING_TURN_STORAGE_KEY, JSON.stringify({
      version: 1,
      idempotencyKey: 'vio-turn-existing-001',
      content: '旧正文',
      turnId: 'turn-existing',
    }))
    const api = mockApi({ getTurn: vi.fn(async () => turn('confirmation_required', { turnId: 'turn-existing' })) })
    render(<ConversationPage api={api} storage={sessionStorage} />)

    expect(await screen.findByText('需要你的确认')).toBeInTheDocument()
    expect(api.getTurn).toHaveBeenCalledWith('turn-existing', expect.any(Object))
    expect(api.createTurn).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY) ?? '{}')).toEqual({
      version: 1,
      idempotencyKey: 'vio-turn-existing-001',
      turnId: 'turn-existing',
    })
  })

  it('limits processing polling and cancels pending polling when the page unmounts', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem(PENDING_TURN_STORAGE_KEY, JSON.stringify({
      version: 1,
      idempotencyKey: 'vio-turn-processing-001',
      turnId: 'turn-processing',
    }))
    const getTurn = vi.fn(async () => turn('processing', { turnId: 'turn-processing' }))
    const api = mockApi({ getTurn })
    const view = render(<ConversationPage api={api} storage={sessionStorage} />)
    await act(async () => Promise.resolve())

    for (let count = 0; count < 7; count += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(1_500))
    }
    expect(getTurn).toHaveBeenCalledTimes(7)
    expect(screen.getByText(/自动查询已停止/)).toBeInTheDocument()

    view.unmount()
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(getTurn).toHaveBeenCalledTimes(7)
    vi.useRealTimers()
  })

  it('shows failed and quarantined as terminal states without auto retry or assistant bubbles', async () => {
    const api = mockApi({ createTurn: vi.fn(async () => turn('failed')) })
    const view = render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend()

    expect(await screen.findByText('本轮处理失败')).toBeInTheDocument()
    expect(screen.getByText(/provider_terminal_failure/)).toBeInTheDocument()
    expect(api.resumeTurn).not.toHaveBeenCalled()
    expect(screen.queryByText('Engine 最终回复')).not.toBeInTheDocument()
    expect(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY)).toBeNull()

    view.unmount()
    const quarantinedApi = mockApi({ createTurn: vi.fn(async () => turn('quarantined')) })
    render(<ConversationPage api={quarantinedApi} storage={sessionStorage} />)
    await ready()
    typeAndSend()
    expect(await screen.findByText('本轮已隔离')).toBeInTheDocument()
    expect(quarantinedApi.resumeTurn).not.toHaveBeenCalled()
    expect(screen.queryByText('Engine 最终回复')).not.toBeInTheDocument()
  })

  it('supports Enter send, Shift+Enter newline, blank rejection and disabled attachments', async () => {
    const api = mockApi()
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()

    const input = screen.getByLabelText('输入消息')
    expect(screen.getByLabelText('添加图片，暂未接入')).toBeDisabled()
    expect(screen.getByLabelText('添加文件，暂未接入')).toBeDisabled()
    expect(screen.getByLabelText('语音输入，暂未接入')).toBeDisabled()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })
    expect(api.createTurn).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '换行' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(api.createTurn).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })

    await waitFor(() => expect(api.createTurn).toHaveBeenCalledTimes(1))
  })

  it('maps known 503 and 409 failures without retaining a false unknown result', async () => {
    const createTurn = vi.fn()
      .mockRejectedValueOnce(new ApiClientError('disabled', {
        code: 'continuity_engine_unavailable', status: 503,
      }))
      .mockRejectedValueOnce(new ApiClientError('conflict', {
        code: 'conflict', status: 409,
      }))
    const api = mockApi({ createTurn })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend('第一次')

    expect(await screen.findByText(/连续性服务当前未启用/)).toBeInTheDocument()
    expect(screen.queryByText('发送结果尚未确认')).not.toBeInTheDocument()
    expect(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY)).toBeNull()
    typeAndSend('第二次')
    expect(await screen.findByText(/幂等或并发事实冲突/)).toBeInTheDocument()
    expect(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY)).toBeNull()
  })

  it('maps 400 input errors and keeps a 404 recovery fact for explicit investigation', async () => {
    const badInputApi = mockApi({ createTurn: vi.fn(async () => {
      throw new ApiClientError('bad input', { code: 'validation_error', status: 400 })
    }) })
    const view = render(<ConversationPage api={badInputApi} storage={sessionStorage} />)
    await ready()
    typeAndSend('格式错误')
    expect(await screen.findByText(/消息或请求格式不符合/)).toBeInTheDocument()
    expect(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY)).toBeNull()

    view.unmount()
    sessionStorage.setItem(PENDING_TURN_STORAGE_KEY, JSON.stringify({
      version: 1,
      idempotencyKey: 'vio-turn-missing-001',
      turnId: 'turn-missing',
    }))
    const missingApi = mockApi({ getTurn: vi.fn(async () => {
      throw new ApiClientError('missing', { code: 'not_found', status: 404 })
    }) })
    render(<ConversationPage api={missingApi} storage={sessionStorage} />)
    expect(await screen.findByText(/没有找到这个轮次/)).toBeInTheDocument()
    expect(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY)).toContain('turn-missing')
  })

  it('keeps invalid mutation responses recoverable because the backend outcome may exist', async () => {
    const api = mockApi({ createTurn: vi.fn(async () => {
      throw new TypeError('invalid response')
    }) })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await ready()
    typeAndSend('待校验')

    expect(await screen.findByText('发送结果尚未确认')).toBeInTheDocument()
    expect(sessionStorage.getItem(PENDING_TURN_STORAGE_KEY)).toContain('vio-turn-uuid-001')
  })

  it('deduplicates a completed turn subject message already present in history', async () => {
    const existing = message('subject', 2, 'Engine 最终回复')
    const api = mockApi({ listMessages: vi.fn(async () => [existing]) })
    render(<ConversationPage api={api} storage={sessionStorage} />)
    await screen.findByText('Engine 最终回复')
    typeAndSend()

    await waitFor(() => expect(api.createTurn).toHaveBeenCalledTimes(1))
    expect(screen.getAllByText('Engine 最终回复')).toHaveLength(1)
  })
})
