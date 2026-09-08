import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../api/client'
import type { PersonalChatApi, PersonalChatMessage, PersonalChatStatus, PersonalChatTurn } from '../api/personal-chat-api'
import { createPersonalApi } from '../api/personal-api'
import type { PersonalAssistant, PersonalSession } from '../api/personal-api'
import { PersonalProvider, usePersonal } from '../state/PersonalContext'
import { assistantFixture, sessionFixture } from '../test/personal-fixtures'
import PersonalConversationPage from './PersonalConversationPage'

const at = '2026-09-05T08:00:00.000Z'

function message(id: string, senderType: 'user' | 'subject', content: string, sequenceNumber: number): PersonalChatMessage {
  return { messageId: id, messageVersionId: `${id}-version`, senderType, content, sequenceNumber, createdAt: at }
}

function turn(status: PersonalChatStatus = 'completed', overrides: Partial<PersonalChatTurn> = {}): PersonalChatTurn {
  const userMessage = message('message-user', 'user', '真实问题', 1)
  return {
    turnId: 'turn-r1', conversationId: 'conversation-r1', status, createdAt: at, updatedAt: at,
    completedAt: status === 'completed' ? at : null, userMessage,
    assistantMessage: status === 'completed' ? message('message-assistant', 'subject', '真实回答', 2) : null,
    confirmation: status === 'waiting_confirmation' ? { confirmationId: 'confirmation-r1', kind: 'security' } : null,
    error: status === 'retryable' ? { code: 'PROVIDER_RETRYABLE_FAILURE', retryable: true } : null,
    execution: null, externalCall: status === 'outcome_unknown' ? 'outcome_unknown' : 'not_performed', ...overrides,
  }
}

function defaultChat(assistant: PersonalAssistant, messages: PersonalChatMessage[] = [], activeTurn: PersonalChatTurn | null = null) {
  return { assistant: { assistantId: assistant.assistantId, name: assistant.name }, conversation: messages.length || activeTurn ? { conversationId: `conversation-${assistant.assistantId}`, status: 'active', createdAt: at, updatedAt: at } : null, messages, activeTurn, externalCall: 'not_performed' as const }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no }), resolve, reject }
}

function personalApi(session: PersonalSession = sessionFixture()) {
  const api = createPersonalApi()
  vi.spyOn(api, 'session').mockResolvedValue(session)
  return api
}

function chatApi(overrides: Partial<PersonalChatApi> = {}): PersonalChatApi {
  return {
    defaultChat: vi.fn(), createTurn: vi.fn(), turn: vi.fn(), turnByKey: vi.fn(), decide: vi.fn(), recover: vi.fn(),
    ...overrides,
  } as PersonalChatApi
}

function ReadyPage({ assistant, api, onNavigate = vi.fn() }: { assistant: PersonalAssistant; api: PersonalChatApi; onNavigate?: (target: 'capability' | 'profile') => void }) {
  const personal = usePersonal()
  if (personal.state.kind !== 'ready') return <span>访问恢复中</span>
  return <PersonalConversationPage assistant={assistant} assistantsLoaded api={api} onNavigate={onNavigate} />
}

function renderPage(api: PersonalChatApi, assistant = assistantFixture(), strict = false) {
  const content = <PersonalProvider api={personalApi()}><ReadyPage assistant={assistant} api={api} /></PersonalProvider>
  return render(strict ? <StrictMode>{content}</StrictMode> : content)
}

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  localStorage.clear()
})

describe('R1 personal standalone conversation page', () => {
  it('shows the no-assistant state and its real profile navigation', async () => {
    const navigate = vi.fn()
    function NoAssistant() {
      const personal = usePersonal()
      if (personal.state.kind !== 'ready') return null
      return <PersonalConversationPage assistant={null} assistantsLoaded api={chatApi()} onNavigate={navigate} />
    }
    render(<PersonalProvider api={personalApi()}><NoAssistant /></PersonalProvider>)
    expect(await screen.findByText('尚未选择助手')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '进入“我的”选择助手' }))
    expect(navigate).toHaveBeenCalledWith('profile')
  })

  it('loads real history and inserts only the completed backend turn while preventing duplicate submit in StrictMode', async () => {
    const assistant = assistantFixture('test-alpha', '真实助手')
    const pending = deferred<PersonalChatTurn>()
    const api = chatApi({
      defaultChat: vi.fn().mockResolvedValue(defaultChat(assistant, [message('old-user', 'user', '历史提问', 1), message('old-assistant', 'subject', '历史回答', 2)])),
      createTurn: vi.fn().mockImplementation(() => pending.promise),
    })
    renderPage(api, assistant, true)
    expect(await screen.findByText('历史回答')).toBeInTheDocument()
    expect(api.defaultChat).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '本次真实问题' } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); fireEvent.click(screen.getByRole('button', { name: '发送消息' })) })
    expect(api.createTurn).toHaveBeenCalledTimes(1)
    expect(screen.getByText('消息正在提交并由后端处理…')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '消息记录' })).queryByText('本次真实问题')).not.toBeInTheDocument()
    await act(async () => pending.resolve(turn('completed', {
      userMessage: message('new-user', 'user', '本次真实问题', 3),
      assistantMessage: message('new-assistant', 'subject', '后端真实回复', 4),
    })))
    expect(screen.getByText('后端真实回复')).toBeInTheDocument()
    expect(screen.getByLabelText('输入消息')).toHaveValue('')
  })

  it.each(['success', 'failure'] as const)('isolates two assistants and ignores a late %s and finally from the old assistant', async (outcome) => {
    const alpha = assistantFixture('test-alpha', '助手甲')
    const beta = assistantFixture('test-beta', '助手乙')
    const firstAlpha = deferred<ReturnType<typeof defaultChat>>()
    const api = chatApi({
      defaultChat: vi.fn().mockImplementation((id: string) => {
        if (id === alpha.assistantId && vi.mocked(api.defaultChat).mock.calls.filter(([value]) => value === alpha.assistantId).length === 1) return firstAlpha.promise
        if (id === alpha.assistantId) return Promise.resolve(defaultChat(alpha, [message('alpha-history', 'subject', '甲的真实历史', 1)]))
        return Promise.resolve(defaultChat(beta, [message('beta-history', 'subject', '乙的真实历史', 1)]))
      }),
    })
    function Switcher() {
      const [active, setActive] = useState(alpha)
      return <><button type="button" onClick={() => setActive((value) => value.assistantId === alpha.assistantId ? beta : alpha)}>测试切换助手</button><ReadyPage key={active.assistantId} assistant={active} api={api} /></>
    }
    render(<PersonalProvider api={personalApi()}><Switcher /></PersonalProvider>)
    await screen.findByText('正在读取当前助手的默认会话…')
    fireEvent.click(screen.getByRole('button', { name: '测试切换助手' }))
    expect(await screen.findByText('乙的真实历史')).toBeInTheDocument()
    await act(async () => outcome === 'success' ? firstAlpha.resolve(defaultChat(alpha, [message('late-alpha', 'subject', '迟到甲内容', 1)])) : firstAlpha.reject(new ApiClientError('late', { code: 'network_error', status: null })))
    expect(screen.queryByText('迟到甲内容')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('输入消息')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '测试切换助手' }))
    expect(await screen.findByText('甲的真实历史')).toBeInTheDocument()
    expect(screen.queryByText('乙的真实历史')).not.toBeInTheDocument()
  })

  it('recovers a lost POST response after refresh by the original key without persisting message content', async () => {
    const assistant = assistantFixture()
    let usedKey = ''
    const api = chatApi({
      defaultChat: vi.fn().mockResolvedValue(defaultChat(assistant)),
      createTurn: vi.fn().mockImplementation((_content: string, key: string) => { usedKey = key; return Promise.reject(new ApiClientError('lost', { code: 'network_error', status: null })) }),
      turnByKey: vi.fn().mockResolvedValue(turn()),
    })
    const first = renderPage(api, assistant)
    await screen.findByText('开始一段新对话')
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '只在内存中的正文' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('无法连接 Vio 服务，当前结果尚未确认。')
    expect(usedKey).toMatch(/^vio-chat-/)
    expect(JSON.stringify([...Array(sessionStorage.length)].map((_, index) => [sessionStorage.key(index), sessionStorage.getItem(sessionStorage.key(index)!)]))).not.toContain('只在内存中的正文')
    first.unmount()
    renderPage(api, assistant)
    expect(await screen.findByText('真实回答')).toBeInTheDocument()
    expect(api.turnByKey).toHaveBeenCalledWith(usedKey, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.createTurn).toHaveBeenCalledTimes(1)
    expect(sessionStorage.length).toBe(0)
  })

  it('reuses the same turn key only after a 404 proves a retry is safe', async () => {
    const assistant = assistantFixture()
    const keys: string[] = []
    const api = chatApi({
      defaultChat: vi.fn().mockResolvedValue(defaultChat(assistant)),
      createTurn: vi.fn().mockImplementation((_content: string, key: string) => {
        keys.push(key)
        return keys.length === 1 ? Promise.reject(new ApiClientError('lost', { code: 'request_timeout', status: null })) : Promise.resolve(turn())
      }),
      turnByKey: vi.fn().mockRejectedValue(new ApiClientError('absent', { code: 'TURN_NOT_FOUND', status: 404 })),
    })
    renderPage(api, assistant)
    await screen.findByText('开始一段新对话')
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '原消息' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('请求超时，当前结果尚未确认。')
    fireEvent.click(screen.getByRole('button', { name: '按原键查询' }))
    await screen.findByText('服务端确认尚无此提交，可以安全沿用原幂等键重试。')
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('真实回答')).toBeInTheDocument()
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it.each([
    ['DEFAULT_CHAT_MODEL_NOT_CONFIGURED', '未配置默认聊天模型'],
    ['MODEL_DISABLED', '默认聊天模型已停用'],
    ['PROVIDER_DISABLED', '供应商已停用'],
    ['VAULT_LOCKED', '凭据库尚未解锁'],
    ['CREDENTIAL_UNAVAILABLE', '供应商凭据不可用'],
  ])('shows the real configuration failure %s and navigates to capability', async (code, label) => {
    const assistant = assistantFixture()
    const navigate = vi.fn()
    const failed = turn('failed', { error: { code, retryable: false } })
    const api = chatApi({ defaultChat: vi.fn().mockResolvedValue(defaultChat(assistant)), createTurn: vi.fn().mockResolvedValue(failed) })
    const content = <PersonalProvider api={personalApi()}><ReadyPage assistant={assistant} api={api} onNavigate={navigate} /></PersonalProvider>
    render(content)
    await screen.findByText('开始一段新对话')
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '配置检查' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText(label)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '进入“能力”配置' }))
    expect(navigate).toHaveBeenCalledWith('capability')
  })

  it('distinguishes safe retry from an unknown provider outcome', async () => {
    const assistant = assistantFixture()
    const api = chatApi({ defaultChat: vi.fn().mockResolvedValue(defaultChat(assistant, [], turn('retryable'))), recover: vi.fn().mockRejectedValue(new ApiClientError('offline', { code: 'network_error', status: null })) })
    const view = renderPage(api, assistant)
    expect(await screen.findByText('可以安全重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '安全重试一次' }))
    await screen.findByText('无法连接 Vio 服务，当前结果尚未确认。')
    expect(screen.getByText(/恢复结果尚未确认/)).toBeInTheDocument()
    view.unmount()

    const unknownApi = chatApi({ defaultChat: vi.fn().mockResolvedValue(defaultChat(assistant, [], turn('outcome_unknown', { error: { code: 'PROVIDER_OUTCOME_UNKNOWN', retryable: false } }))) })
    renderPage(unknownApi, assistant)
    expect(await screen.findByText('结果未知，禁止重试')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '安全重试一次' })).not.toBeInTheDocument()
  })

  it('retires a key after a definitive request-before-send failure and allows a new submit', async () => {
    const assistant = assistantFixture()
    const createTurn = vi.fn()
      .mockRejectedValueOnce(new ApiClientError('validation', { code: 'INVALID_CONTENT', status: 422 }))
      .mockResolvedValueOnce(turn())
    const api = chatApi({ defaultChat: vi.fn().mockResolvedValue(defaultChat(assistant)), createTurn })
    renderPage(api, assistant)
    await screen.findByText('开始一段新对话')
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '第一次' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('消息未通过服务端校验，请修改后重试。')
    expect(sessionStorage.length).toBe(0)
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '修改后' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('真实回答')).toBeInTheDocument()
    expect(createTurn).toHaveBeenCalledTimes(2)
    expect(createTurn.mock.calls[1][1]).not.toBe(createTurn.mock.calls[0][1])
  })

  it('labels a cancellation transport failure as termination failure and preserves the recovery key', async () => {
    const assistant = assistantFixture()
    const active = turn('ready')
    const api = chatApi({ defaultChat: vi.fn().mockResolvedValue(defaultChat(assistant, [], active)), recover: vi.fn().mockRejectedValue(new ApiClientError('offline', { code: 'network_error', status: null })) })
    renderPage(api, assistant)
    await screen.findByText('轮次处理中')
    fireEvent.click(screen.getByRole('button', { name: '终止本轮' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('终止失败')
    expect(screen.getByText(/恢复结果尚未确认/)).toBeInTheDocument()
    expect(sessionStorage.length).toBe(1)
  })

  it('clears recovery indexes on expiry and identity change without clearing unrelated storage', async () => {
    sessionStorage.setItem('vio:personal:chat:recovery:v1:test-owner:test-alpha', JSON.stringify({ version: 1, kind: 'turn', idempotencyKey: 'vio-chat-11111111-1111-4111-8111-111111111111' }))
    sessionStorage.setItem('vio:personal:chat:r3:recovery:v1:test-owner:test-alpha', JSON.stringify({ version: 1, idempotencyKey: 'vio-r3-11111111-1111-4111-8111-111111111111', operationType: 'conversation.turn' }))
    sessionStorage.setItem('vio:personal:memory:r5:recovery:v1:test-owner:test-alpha', JSON.stringify({ version: 1, idempotencyKey: 'vio-personal-11111111-1111-4111-8111-111111111111', operationType: 'memory.create' }))
    sessionStorage.setItem('unrelated', 'keep')
    function Controls() {
      const personal = usePersonal()
      if (personal.state.kind !== 'ready') return null
      return <><button type="button" onClick={personal.expire}>测试退出</button><button type="button" onClick={() => personal.acceptSession(sessionFixture({ user: { userId: 'new-owner', displayName: null, avatar: null }, session: { sessionId: 'new-session', expiresAt: '2026-10-05T00:00:00.000Z' }, csrfToken: 'new-csrf' }))}>测试换身份</button></>
    }
    const view = render(<PersonalProvider api={personalApi()}><Controls /></PersonalProvider>)
    await screen.findByRole('button', { name: '测试退出' })
    fireEvent.click(screen.getByRole('button', { name: '测试退出' }))
    expect(sessionStorage.getItem('vio:personal:chat:recovery:v1:test-owner:test-alpha')).toBeNull()
    expect(sessionStorage.getItem('vio:personal:chat:r3:recovery:v1:test-owner:test-alpha')).toBeNull()
    expect(sessionStorage.getItem('vio:personal:memory:r5:recovery:v1:test-owner:test-alpha')).toBeNull()
    expect(sessionStorage.getItem('unrelated')).toBe('keep')
    view.unmount()

    sessionStorage.setItem('vio:personal:chat:recovery:v1:test-owner:test-alpha', JSON.stringify({ version: 1, kind: 'turn', idempotencyKey: 'vio-chat-22222222-2222-4222-8222-222222222222' }))
    sessionStorage.setItem('vio:personal:chat:r3:recovery:v1:test-owner:test-alpha', JSON.stringify({ version: 1, idempotencyKey: 'vio-r3-22222222-2222-4222-8222-222222222222', operationType: 'conversation.turn' }))
    sessionStorage.setItem('vio:personal:memory:r5:recovery:v1:test-owner:test-alpha', JSON.stringify({ version: 1, idempotencyKey: 'vio-personal-22222222-2222-4222-8222-222222222222', operationType: 'memory.export' }))
    render(<PersonalProvider api={personalApi()}><Controls /></PersonalProvider>)
    await screen.findByRole('button', { name: '测试换身份' })
    fireEvent.click(screen.getByRole('button', { name: '测试换身份' }))
    expect(sessionStorage.getItem('vio:personal:chat:recovery:v1:test-owner:test-alpha')).toBeNull()
    expect(sessionStorage.getItem('vio:personal:chat:r3:recovery:v1:test-owner:test-alpha')).toBeNull()
    expect(sessionStorage.getItem('vio:personal:memory:r5:recovery:v1:test-owner:test-alpha')).toBeNull()
  })

  it('aborts a pending read on unmount and does not expose fixed legacy identity tokens', async () => {
    const assistant = assistantFixture()
    const pending = deferred<ReturnType<typeof defaultChat>>()
    let signal: AbortSignal | undefined
    const api = chatApi({ defaultChat: vi.fn().mockImplementation((_id, options) => { signal = options?.signal; return pending.promise }) })
    const view = renderPage(api, assistant)
    await screen.findByText('正在读取当前助手的默认会话…')
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => pending.resolve(defaultChat(assistant, [message('late', 'subject', '卸载后迟到', 1)])))
    expect(JSON.stringify(vi.mocked(api.defaultChat).mock.calls)).not.toMatch(/LOCAL_CONVERSATION_PROFILE|x-vio-user-id|user-001|assistant-001|conversation-001/)
  })
})
