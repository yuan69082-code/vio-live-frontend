import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../api/client'
import type { ConversationDetail, ConversationList, ConversationSummary, PersonalMultiChatApi, R3Message } from '../api/personal-multi-chat-api'
import type { PersonalChatTurn } from '../api/personal-chat-api'
import { createPersonalApi } from '../api/personal-api'
import type { PersonalAssistant, PersonalSession } from '../api/personal-api'
import { PersonalProvider, usePersonal } from '../state/PersonalContext'
import { assistantFixture, sessionFixture } from '../test/personal-fixtures'
import PersonalMultiConversationPage from './PersonalMultiConversationPage'

const at = '2026-09-06T01:00:00.000Z'

function conversation(id: string, title: string, current = false, status: 'active' | 'archived' = 'active'): ConversationSummary {
  return { conversationId: id, title, status, isCurrent: current, currentBranchId: `branch-${id}`, messageCount: 2, createdAt: at, updatedAt: at, archivedAt: status === 'archived' ? at : null, version: 3 }
}
function message(id: string, senderType: 'user' | 'subject', content: string, sequenceNumber: number, versionKind: R3Message['versionKind'] = 'original'): R3Message {
  return { messageId: id, messageVersionId: `version-${id}`, senderType, content, sequenceNumber, createdAt: at, versionCreatedAt: at, versionKind, attachmentIds: [], hidden: false }
}
function detail(assistant: PersonalAssistant, current: ConversationSummary | null = conversation('alpha-main', '主会话', true), messages: R3Message[] = [], activeTurn: PersonalChatTurn | null = null): ConversationDetail {
  return { assistant: { assistantId: assistant.assistantId, name: assistant.name }, conversation: current, branch: current ? { branchId: current.currentBranchId, parentBranchId: null, forkMessageId: null, title: 'Main', isCurrent: true, createdAt: at, updatedAt: at, version: 4, conversationVersion: current.version } : null, messages, activeTurn, externalCall: 'not_performed', selectionVersion: 2 }
}
function list(assistant: PersonalAssistant, items: ConversationSummary[]): ConversationList {
  return { assistant: { assistantId: assistant.assistantId, name: assistant.name }, conversations: items, nextCursor: null, externalCall: 'not_performed', selectionVersion: 2 }
}
function turn(conversationId = 'alpha-main'): PersonalChatTurn {
  return { turnId: 'turn-r3', conversationId, status: 'completed', createdAt: at, updatedAt: at, completedAt: at, userMessage: { messageId: 'sent-user', messageVersionId: 'sent-user-version', senderType: 'user', content: '本次问题', sequenceNumber: 3, createdAt: at }, assistantMessage: { messageId: 'sent-subject', messageVersionId: 'sent-subject-version', senderType: 'subject', content: '后端真实回复', sequenceNumber: 4, createdAt: at }, confirmation: null, error: null, execution: null, externalCall: 'performed' }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no }), resolve, reject }
}
function personalApi(session: PersonalSession = sessionFixture()) {
  const api = createPersonalApi()
  vi.spyOn(api, 'session').mockResolvedValue(session)
  return api
}
function chatApi(overrides: Partial<PersonalMultiChatApi> = {}): PersonalMultiChatApi {
  return {
    conversations: vi.fn(), current: vi.fn(), conversation: vi.fn(), createConversation: vi.fn(), selectConversation: vi.fn(), renameConversation: vi.fn(), archiveConversation: vi.fn(), restoreConversation: vi.fn(), deleteConversation: vi.fn(),
    versions: vi.fn(), editMessage: vi.fn(), regenerateMessage: vi.fn(), selectVersion: vi.fn(), deleteMessage: vi.fn(), branches: vi.fn(), createBranch: vi.fn(), selectBranch: vi.fn(), clearBranch: vi.fn(),
    createTurn: vi.fn(), turn: vi.fn(), turnByKey: vi.fn(), recover: vi.fn(), decide: vi.fn(), uploadAttachment: vi.fn(), attachment: vi.fn(), removeAttachment: vi.fn(), exportConversation: vi.fn(), operationByKey: vi.fn(),
    ...overrides,
  } as PersonalMultiChatApi
}
function ReadyPage({ assistant, api, onNavigate = vi.fn() }: { assistant: PersonalAssistant; api: PersonalMultiChatApi; onNavigate?: (target: 'capability' | 'profile') => void }) {
  const personal = usePersonal()
  if (personal.state.kind !== 'ready') return <span>访问恢复中</span>
  return <PersonalMultiConversationPage assistant={assistant} assistantsLoaded api={api} onNavigate={onNavigate} />
}
function renderPage(api: PersonalMultiChatApi, assistant = assistantFixture(), strict = false) {
  const content = <PersonalProvider api={personalApi()}><ReadyPage assistant={assistant} api={api} /></PersonalProvider>
  return render(strict ? <StrictMode>{content}</StrictMode> : content)
}

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  localStorage.clear()
})

describe('R3 personal multi-conversation page', () => {
  it('shows the server-assistant boundary when no assistant is selected and routes to profile', async () => {
    const navigate = vi.fn()
    function NoAssistantPage() {
      const personal = usePersonal()
      if (personal.state.kind !== 'ready') return <span>访问恢复中</span>
      return <PersonalMultiConversationPage assistant={null} assistantsLoaded onNavigate={navigate} api={chatApi()} />
    }
    render(<PersonalProvider api={personalApi()}><NoAssistantPage /></PersonalProvider>)
    expect(await screen.findByText('尚未选择助手')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '进入“我的”选择助手' }))
    expect(navigate).toHaveBeenCalledWith('profile')
  })

  it('loads the server catalog/current history and performs real create, select, rename, archive, restore and delete writes', async () => {
    const assistant = assistantFixture('test-alpha', '真实助手')
    const first = conversation('alpha-main', '主会话', true)
    const second = conversation('alpha-second', '第二会话')
    const archived = conversation('alpha-old', '归档会话', false, 'archived')
    let selected = first
    let filter: 'active' | 'archived' = 'active'
    const api = chatApi({
      conversations: vi.fn().mockImplementation((_id, input) => { filter = input.status; return Promise.resolve(list(assistant, filter === 'archived' ? [archived] : [selected.conversationId === first.conversationId ? { ...first, isCurrent: true } : first, selected.conversationId === second.conversationId ? { ...second, isCurrent: true } : second])) }),
      current: vi.fn().mockImplementation(() => Promise.resolve(detail(assistant, { ...selected, isCurrent: true }, [message('history-user', 'user', '真实历史提问', 1), message('history-subject', 'subject', '真实历史回答', 2)]))),
      conversation: vi.fn().mockImplementation((_id, id) => Promise.resolve(detail(assistant, id === second.conversationId ? second : archived))),
      createConversation: vi.fn().mockResolvedValue({ operation: 'created' }), selectConversation: vi.fn().mockImplementation((id) => { selected = id === second.conversationId ? second : first; return Promise.resolve({}) }),
      renameConversation: vi.fn().mockResolvedValue({}), archiveConversation: vi.fn().mockResolvedValue({}), restoreConversation: vi.fn().mockResolvedValue({}), deleteConversation: vi.fn().mockResolvedValue({}),
    })
    renderPage(api, assistant)
    expect(await screen.findByText('真实历史回答')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /切换会话/ }))
    const drawer = screen.getByRole('complementary', { name: '会话列表' })
    expect(within(drawer).getByText('第二会话')).toBeInTheDocument()
    fireEvent.click(within(drawer).getByRole('button', { name: '＋ 新建会话' }))
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '新会话' } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: '确认' })); fireEvent.click(screen.getByRole('button', { name: '确认' })) })
    await waitFor(() => expect(api.createConversation).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /第二会话/ }))
    await waitFor(() => expect(api.selectConversation).toHaveBeenCalledWith('alpha-second', 2, expect.stringMatching(/^vio-r3-/), expect.anything()))
    expect(await screen.findByRole('heading', { name: '第二会话' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('输入消息')).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: /切换会话/ }))
    fireEvent.click(within(screen.getByRole('complementary', { name: '会话列表' })).getAllByRole('button', { name: '重命名' })[1])
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '第二会话改名' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(api.renameConversation).toHaveBeenCalledWith('alpha-second', '第二会话改名', 3, expect.stringMatching(/^vio-r3-/), expect.anything()))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '会话操作' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('输入消息')).toBeEnabled())

    fireEvent.click(within(screen.getByRole('complementary', { name: '会话列表' })).getAllByRole('button', { name: '归档' })[1])
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(api.archiveConversation).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText('输入消息')).toBeEnabled())

    fireEvent.click(within(screen.getByRole('complementary', { name: '会话列表' })).getByRole('button', { name: '已归档' }))
    await waitFor(() => expect(filter).toBe('archived'))
    fireEvent.click(await within(screen.getByRole('complementary', { name: '会话列表' })).findByRole('button', { name: '恢复' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(api.restoreConversation).toHaveBeenCalled())

    fireEvent.click(within(screen.getByRole('complementary', { name: '会话列表' })).getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalled())
  })

  it('edits, regenerates, selects versions, hides messages, creates/switches branches and clears the visible window through the API', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const user = message('user-one', 'user', '旧问题', 1)
    const subject = message('subject-one', 'subject', '旧回答', 2)
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])), current: vi.fn().mockResolvedValue(detail(assistant, current, [user, subject])), conversation: vi.fn().mockResolvedValue(detail(assistant, current, [user, subject])),
      editMessage: vi.fn().mockResolvedValue({}), regenerateMessage: vi.fn().mockResolvedValue({ message: subject, execution: {}, externalCall: 'performed' }), versions: vi.fn().mockResolvedValue([{ ...user, messageVersionId: 'version-user-one-old', content: '更早问题' }, user]), selectVersion: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}), createBranch: vi.fn().mockResolvedValue({}), branches: vi.fn().mockResolvedValue([{ ...detail(assistant, current).branch!, isCurrent: true }, { ...detail(assistant, current).branch!, branchId: 'branch-alt', title: 'Alternative', isCurrent: false }]),
      selectBranch: vi.fn().mockResolvedValue({}), clearBranch: vi.fn().mockResolvedValue({}),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage(api, assistant)
    await screen.findByText('旧回答')
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    fireEvent.change(screen.getByLabelText('新内容'), { target: { value: '新问题' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(api.editMessage).toHaveBeenCalledWith('alpha-main', 'user-one', { branchId: 'branch-alpha-main', baseVersionId: 'version-user-one', content: '新问题' }, expect.stringMatching(/^vio-r3-/), expect.anything()))
    await waitFor(() => expect(screen.getByRole('button', { name: /重新生成/ })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    await waitFor(() => expect(api.regenerateMessage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: /重新生成/ })).toBeEnabled())
    fireEvent.click(screen.getAllByRole('button', { name: '版本' })[0])
    fireEvent.click(await screen.findByRole('button', { name: /更早问题/ }))
    await waitFor(() => expect(api.selectVersion).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '消息操作' })).not.toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: /从这里重来/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(api.createBranch).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '消息操作' })).not.toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(api.deleteMessage).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /分支：Main/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Alternative/ }))
    await waitFor(() => expect(api.selectBranch).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /分支：Main/ }))
    const clearVisible = await screen.findByRole('button', { name: '清空当前可见窗口' })
    await waitFor(() => expect(clearVisible).toBeEnabled())
    fireEvent.click(clearVisible)
    await waitFor(() => expect(api.clearBranch).toHaveBeenCalled())
  })

  it('prevents duplicate sends in StrictMode and recovers a lost response with the original key without storing message content', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const pending = deferred<PersonalChatTurn>()
    const api = chatApi({ conversations: vi.fn().mockResolvedValue(list(assistant, [current])), current: vi.fn().mockResolvedValue(detail(assistant, current)), conversation: vi.fn().mockResolvedValue(detail(assistant, current)), createTurn: vi.fn().mockImplementation(() => pending.promise) })
    const view = renderPage(api, assistant, true)
    await screen.findByText('开始一段新对话')
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '本次问题' } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); fireEvent.click(screen.getByRole('button', { name: '发送消息' })) })
    expect(api.createTurn).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toContain('本次问题')
    await act(async () => pending.resolve(turn()))
    view.unmount()

    let submittedKey = ''
    let recovered = false
    const recoveredMessages = [message('sent-user', 'user', '本次问题', 1), message('sent-subject', 'subject', '后端真实回复', 2)]
    const recoveryApi = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])), current: vi.fn().mockImplementation(() => Promise.resolve(detail(assistant, current, recovered ? recoveredMessages : []))), conversation: vi.fn().mockImplementation(() => Promise.resolve(detail(assistant, current, recovered ? recoveredMessages : []))),
      createTurn: vi.fn().mockImplementation((_id, _body, key) => { submittedKey = key; return Promise.reject(new ApiClientError('lost', { code: 'request_timeout', status: null })) }),
      turnByKey: vi.fn().mockImplementation((key) => { expect(key).toBe(submittedKey); recovered = true; return Promise.resolve(turn()) }),
    })
    renderPage(recoveryApi, assistant)
    await screen.findByText('开始一段新对话')
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '本次问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('请求超时，当前结果未知。')
    const stored = sessionStorage.getItem(sessionStorage.key(0)!)!
    expect(stored).toContain(submittedKey)
    expect(stored).not.toContain('本次问题')
    fireEvent.click(screen.getByRole('button', { name: '按原键查询' }))
    expect(await screen.findByText('后端真实回复')).toBeInTheDocument()
    expect(screen.getByLabelText('输入消息')).toHaveValue('')
    expect(recoveryApi.createTurn).toHaveBeenCalledTimes(1)
    expect(recoveryApi.turnByKey).toHaveBeenCalledTimes(1)
  })

  it('adopts a polled waiting state and exposes its real recovery action instead of leaving the page processing', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const processing = { ...turn(current.conversationId), status: 'processing' as const, completedAt: null, assistantMessage: null, externalCall: 'not_performed' as const }
    const waiting = { ...processing, status: 'waiting_confirmation' as const, confirmation: { confirmationId: 'confirmation-r3', kind: 'security' as const } }
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])),
      current: vi.fn().mockResolvedValue(detail(assistant, current, [], processing)),
      turn: vi.fn().mockResolvedValue(waiting),
    })
    renderPage(api, assistant)
    expect(await screen.findByText('等待安全确认', {}, { timeout: 3_000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeEnabled()
    expect(screen.queryByText('轮次处理中')).not.toBeInTheDocument()
  })

  it.each(['success', 'failure'] as const)('isolates assistant changes from a late %s and restores the selected assistant history', async (outcome) => {
    const alpha = assistantFixture('test-alpha', '助手甲')
    const beta = assistantFixture('test-beta', '助手乙')
    const alphaPending = deferred<ConversationDetail>()
    let alphaReads = 0
    const api = chatApi({
      conversations: vi.fn().mockImplementation((id) => Promise.resolve(list(id === alpha.assistantId ? alpha : beta, [conversation(`${id}-main`, `${id}会话`, true)]))),
      current: vi.fn().mockImplementation((id) => {
        if (id === alpha.assistantId && alphaReads++ === 0) return alphaPending.promise
        const selectedAssistant = id === alpha.assistantId ? alpha : beta
        return Promise.resolve(detail(selectedAssistant, conversation(`${id}-main`, `${id}会话`, true), [message(`${id}-message`, 'subject', id === alpha.assistantId ? '甲的真实历史' : '乙的真实历史', 1)]))
      }),
      conversation: vi.fn(),
    })
    function Switcher() {
      const [active, setActive] = useState(alpha)
      return <><button type="button" onClick={() => setActive((value) => value.assistantId === alpha.assistantId ? beta : alpha)}>测试切换助手</button><ReadyPage assistant={active} api={api} /></>
    }
    render(<PersonalProvider api={personalApi()}><Switcher /></PersonalProvider>)
    await screen.findByText('正在读取会话记录…')
    await waitFor(() => expect(api.current).toHaveBeenCalledWith(alpha.assistantId, expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: '测试切换助手' }))
    expect(await screen.findByText('乙的真实历史')).toBeInTheDocument()
    await act(async () => outcome === 'success' ? alphaPending.resolve(detail(alpha, conversation('test-alpha-main', '甲会话', true), [message('late-alpha', 'subject', '迟到甲内容', 1)])) : alphaPending.reject(new ApiClientError('late', { code: 'network_error', status: null })))
    expect(screen.queryByText('迟到甲内容')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '测试切换助手' }))
    expect(await screen.findByText('甲的真实历史')).toBeInTheDocument()
    expect(screen.queryByText('乙的真实历史')).not.toBeInTheDocument()
  })

  it('aborts an old assistant write and prevents its late finally from unlocking the new assistant write', async () => {
    const alpha = assistantFixture('test-alpha', '助手甲')
    const beta = assistantFixture('test-beta', '助手乙')
    const alphaConversation = conversation('alpha-main', '甲会话', true)
    const betaConversation = conversation('beta-main', '乙会话', true)
    const betaSecond = conversation('beta-second', '乙的第二会话')
    const alphaPending = deferred<PersonalChatTurn>()
    const betaPending = deferred<PersonalChatTurn>()
    let alphaSignal: AbortSignal | undefined
    const api = chatApi({
      conversations: vi.fn().mockImplementation((id) => Promise.resolve(list(id === alpha.assistantId ? alpha : beta, id === alpha.assistantId ? [alphaConversation] : [betaConversation, betaSecond]))),
      current: vi.fn().mockImplementation((id) => Promise.resolve(detail(id === alpha.assistantId ? alpha : beta, id === alpha.assistantId ? alphaConversation : betaConversation))),
      conversation: vi.fn().mockImplementation((id) => Promise.resolve(detail(id === alpha.assistantId ? alpha : beta, id === alpha.assistantId ? alphaConversation : betaConversation))),
      createTurn: vi.fn().mockImplementation((id, _input, _key, options) => {
        if (id === alphaConversation.conversationId) { alphaSignal = options?.signal; return alphaPending.promise }
        return betaPending.promise
      }),
      selectConversation: vi.fn().mockResolvedValue({}),
    })
    function Switcher() {
      const [active, setActive] = useState(alpha)
      return <><button type="button" onClick={() => setActive(beta)}>测试切换助手</button><ReadyPage assistant={active} api={api} /></>
    }
    render(<PersonalProvider api={personalApi()}><Switcher /></PersonalProvider>)
    await screen.findByRole('heading', { name: '甲会话' })
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '甲请求' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(api.createTurn).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '测试切换助手' }))
    await screen.findByRole('heading', { name: '乙会话' })
    expect(alphaSignal?.aborted).toBe(true)
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '乙请求' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(api.createTurn).toHaveBeenCalledTimes(2))
    await act(async () => alphaPending.resolve(turn(alphaConversation.conversationId)))
    fireEvent.click(screen.getByRole('button', { name: /切换会话/ }))
    fireEvent.click(screen.getByRole('button', { name: /乙的第二会话/ }))
    expect(api.selectConversation).not.toHaveBeenCalled()
    await act(async () => betaPending.resolve(turn(betaConversation.conversationId)))
  })

  it('uploads and removes a controlled attachment, sends its id, exports one conversation, and routes configuration failures', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const failedTurn = { ...turn(), status: 'failed' as const, completedAt: null, assistantMessage: null, error: { code: 'VAULT_LOCKED', retryable: false }, externalCall: 'not_performed' as const }
    const navigate = vi.fn()
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])), current: vi.fn().mockResolvedValue(detail(assistant, current)), conversation: vi.fn().mockResolvedValue(detail(assistant, current)),
      uploadAttachment: vi.fn().mockResolvedValue({ attachmentId: 'attachment-r3', fileName: 'note.txt', mediaType: 'text/plain', kind: 'file', sizeBytes: 5, sha256: 'sha256:test', status: 'ready', createdAt: at, messageVersionId: null }),
      removeAttachment: vi.fn().mockRejectedValue(new ApiClientError('lost response', { code: 'network_error', status: null })),
      operationByKey: vi.fn().mockImplementation((key) => Promise.resolve({ operationId: 'attachment-delete-operation', operationType: 'attachment.delete', idempotencyKey: key, status: 'completed', resourceType: 'attachment', resourceId: 'attachment-r3', error: null, result: { attachmentId: 'attachment-r3', status: 'deleted', externalCall: 'not_performed' }, createdAt: at, updatedAt: at, completedAt: at, externalCall: 'not_performed' })),
      createTurn: vi.fn().mockResolvedValue(failedTurn), exportConversation: vi.fn().mockResolvedValue({ exportId: 'export-r3', fileName: 'conversation.md', mediaType: 'text/markdown', content: '# 真实导出', sha256: `sha256:${'a'.repeat(64)}`, createdAt: at }),
    })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<PersonalProvider api={personalApi()}><ReadyPage assistant={assistant} api={api} onNavigate={navigate} /></PersonalProvider>)
    await screen.findByText('开始一段新对话')
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('文件附件选择'), { target: { files: [file] } })
    expect(await screen.findByText('note.txt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(await screen.findByText('无法连接 Vio 服务，当前结果未知。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '按原键查询' }))
    await waitFor(() => expect(screen.queryByText('note.txt')).not.toBeInTheDocument())
    expect(screen.queryByText('无法连接 Vio 服务，当前结果未知。')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('文件附件选择'), { target: { files: [file] } })
    expect(await screen.findByText('note.txt')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '带附件问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(api.createTurn).toHaveBeenCalledWith('alpha-main', { branchId: 'branch-alpha-main', content: '带附件问题', attachmentIds: ['attachment-r3'] }, expect.stringMatching(/^vio-r3-/), expect.anything()))
    expect(await screen.findByText('凭据库尚未解锁。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '进入“能力”配置' }))
    expect(navigate).toHaveBeenCalledWith('capability')
    fireEvent.click(screen.getByRole('button', { name: '导出 Markdown' }))
    await waitFor(() => expect(api.exportConversation).toHaveBeenCalled())
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('loads stable cursor pages without resetting the open drawer', async () => {
    const assistant = assistantFixture()
    const first = conversation('alpha-first', '第一页会话', true)
    const second = conversation('alpha-second', '第二页会话')
    const api = chatApi({
      conversations: vi.fn().mockImplementation((_id, input) => Promise.resolve({
        ...list(assistant, input.cursor ? [second] : [first]),
        nextCursor: input.cursor ? null : 'cursor-page-2',
      })),
      current: vi.fn().mockResolvedValue(detail(assistant, first)),
    })
    renderPage(api, assistant)
    await screen.findByRole('heading', { name: '第一页会话' })
    fireEvent.click(screen.getByRole('button', { name: /切换会话/ }))
    fireEvent.click(screen.getByRole('button', { name: '加载更多会话' }))
    expect(await screen.findByText('第二页会话')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '会话列表' })).toBeInTheDocument()
    expect(api.conversations).toHaveBeenCalledWith(assistant.assistantId, expect.objectContaining({ cursor: 'cursor-page-2' }), expect.anything())
  })

  it('keeps catalog failures scoped to the drawer and retries without erasing the loaded conversation', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const api = chatApi({
      conversations: vi.fn()
        .mockRejectedValueOnce(new ApiClientError('catalog unavailable', { code: 'network_error', status: null }))
        .mockResolvedValue(list(assistant, [current])),
      current: vi.fn().mockResolvedValue(detail(assistant, current, [message('current-message', 'subject', '详情仍然可见', 1)])),
    })
    renderPage(api, assistant)
    expect(await screen.findByText('详情仍然可见')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /切换会话/ }))
    const drawer = screen.getByRole('complementary', { name: '会话列表' })
    expect(await within(drawer).findByText('无法连接 Vio 服务，当前结果未知。')).toBeInTheDocument()
    expect(screen.getByText('详情仍然可见')).toBeInTheDocument()
    fireEvent.click(within(drawer).getByRole('button', { name: '重试读取会话列表' }))
    expect(await within(drawer).findByText('主会话')).toBeInTheDocument()
    expect(screen.getByText('详情仍然可见')).toBeInTheDocument()
  })

  it.each(['success', 'failure'] as const)('keeps a newly selected conversation when the previous conversation read finishes with late %s', async (outcome) => {
    const assistant = assistantFixture()
    const first = conversation('alpha-first', '第一会话', true)
    const second = conversation('alpha-second', '第二会话')
    const staleRead = deferred<ConversationDetail>()
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [first, second])),
      current: vi.fn().mockResolvedValue(detail(assistant, first, [message('first-current', 'subject', '第一会话当前内容', 1)])),
      conversation: vi.fn().mockImplementation((_assistantId, conversationId) => conversationId === first.conversationId
        ? staleRead.promise
        : Promise.resolve(detail(assistant, { ...second, isCurrent: true }, [message('second-current', 'subject', '第二会话新内容', 1)]))),
      selectConversation: vi.fn().mockResolvedValue({}),
    })
    renderPage(api, assistant)
    await screen.findByText('第一会话当前内容')
    fireEvent.click(screen.getByRole('button', { name: /切换会话/ }))
    const drawer = screen.getByRole('complementary', { name: '会话列表' })
    fireEvent.click(within(drawer).getByRole('button', { name: /第一会话/ }))
    fireEvent.click(within(drawer).getByRole('button', { name: /第二会话/ }))
    expect(await screen.findByText('第二会话新内容')).toBeInTheDocument()
    await act(async () => outcome === 'success'
      ? staleRead.resolve(detail(assistant, first, [message('first-late', 'subject', '第一会话迟到内容', 1)]))
      : staleRead.reject(new ApiClientError('late read', { code: 'network_error', status: null })))
    expect(screen.getByText('第二会话新内容')).toBeInTheDocument()
    expect(screen.queryByText('第一会话迟到内容')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('handles regeneration rejection and approval with a new operation key and real server result', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const subject = message('subject-confirm', 'subject', '原回答', 1)
    const confirmation = (id: string) => ({ operationStatus: 'confirmation_required' as const, confirmation: { confirmationId: id, kind: 'security' as const }, externalCall: 'not_performed' as const })
    const regenerated = { ...subject, messageVersionId: 'version-subject-regenerated', content: '真实重新生成回答', versionKind: 'regenerated' as const }
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])), current: vi.fn().mockResolvedValue(detail(assistant, current, [subject])), conversation: vi.fn().mockResolvedValue(detail(assistant, current, [regenerated])),
      regenerateMessage: vi.fn().mockResolvedValueOnce(confirmation('confirmation-reject')).mockResolvedValueOnce(confirmation('confirmation-approve')).mockResolvedValueOnce({
        message: regenerated,
        execution: { executionId: 'execution-r3', modelId: 'model-r3', providerId: 'provider-r3', status: 'completed', inputTokens: 4, outputTokens: 3, totalTokens: 7, finishReason: 'stop' },
        externalCall: 'performed',
      }),
      decide: vi.fn().mockResolvedValue({}),
    })
    renderPage(api, assistant)
    await screen.findByText('原回答')
    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    expect(await screen.findByRole('dialog', { name: '重新生成确认' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(await screen.findByText('已拒绝本次重新生成；未调用供应商。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    expect(await screen.findByRole('button', { name: '批准并重新生成' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批准并重新生成' }))
    await waitFor(() => expect(api.regenerateMessage).toHaveBeenCalledTimes(3))
    const calls = vi.mocked(api.regenerateMessage).mock.calls
    expect(calls[0][3]).not.toBe(calls[2][3])
    expect(calls[2][2]).toMatchObject({ confirmationId: 'confirmation-approve', confirmationKind: 'security' })
    expect(api.decide).toHaveBeenNthCalledWith(1, 'confirmation-reject', 'reject', expect.anything())
    expect(api.decide).toHaveBeenNthCalledWith(2, 'confirmation-approve', 'approve', expect.anything())
  })

  it('closes a consumed regeneration confirmation after a terminal provider failure and permits a fresh attempt', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const subject = message('subject-provider-failure', 'subject', '原回答', 1)
    const confirmation = (id: string) => ({ operationStatus: 'confirmation_required' as const, confirmation: { confirmationId: id, kind: 'security' as const }, externalCall: 'not_performed' as const })
    const regenerated = { ...subject, messageVersionId: 'version-subject-after-retry', content: '重试后的真实回答', versionKind: 'regenerated' as const }
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])),
      current: vi.fn().mockResolvedValue(detail(assistant, current, [subject])),
      conversation: vi.fn().mockResolvedValue(detail(assistant, current, [regenerated])),
      regenerateMessage: vi.fn()
        .mockResolvedValueOnce(confirmation('confirmation-failed-provider'))
        .mockResolvedValueOnce({
          operationId: 'operation-provider-failure', operationType: 'message.regenerate', idempotencyKey: 'regeneration-provider-failure-key', status: 'failed',
          resourceType: 'message', resourceId: subject.messageId, error: { code: 'PROVIDER_RATE_LIMITED' }, result: null,
          createdAt: at, updatedAt: at, completedAt: at, externalCall: 'performed',
        })
        .mockResolvedValueOnce(confirmation('confirmation-retry'))
        .mockResolvedValueOnce({
          message: regenerated,
          execution: { executionId: 'execution-after-retry', modelId: 'model-r3', providerId: 'provider-r3', status: 'completed', inputTokens: 4, outputTokens: 3, totalTokens: 7, finishReason: 'stop' },
          externalCall: 'performed',
        }),
      decide: vi.fn().mockResolvedValue({}),
    })
    renderPage(api, assistant)
    await screen.findByText('原回答')

    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    fireEvent.click(await screen.findByRole('button', { name: '批准并重新生成' }))
    expect(await screen.findByText('PROVIDER_RATE_LIMITED')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '重新生成确认' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    fireEvent.click(await screen.findByRole('button', { name: '批准并重新生成' }))
    await waitFor(() => expect(api.regenerateMessage).toHaveBeenCalledTimes(4))
    expect(await screen.findByText('重试后的真实回答')).toBeInTheDocument()
    const calls = vi.mocked(api.regenerateMessage).mock.calls
    expect(calls[0][3]).not.toBe(calls[2][3])
  })

  it('hides a consumed regeneration confirmation after response loss and recovers by the original key without a duplicate provider call', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const subject = message('subject-lost-regeneration', 'subject', '待恢复回答', 1)
    const regenerated = { ...subject, messageVersionId: 'version-subject-recovered', content: '按原键恢复的重新生成回答', versionKind: 'regenerated' as const }
    let key = ''
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])),
      current: vi.fn().mockResolvedValue(detail(assistant, current, [subject])),
      conversation: vi.fn().mockResolvedValue(detail(assistant, current, [regenerated])),
      regenerateMessage: vi.fn()
        .mockResolvedValueOnce({ operationStatus: 'confirmation_required', confirmation: { confirmationId: 'confirmation-response-loss', kind: 'security' }, externalCall: 'not_performed' })
        .mockImplementationOnce((_conversationId, _messageId, _input, operationKey) => { key = operationKey; return Promise.reject(new ApiClientError('lost', { code: 'request_timeout', status: null })) }),
      decide: vi.fn().mockResolvedValue({}),
      operationByKey: vi.fn().mockImplementation((operationKey) => Promise.resolve({
        operationId: 'operation-recovered-regeneration', operationType: 'message.regenerate', idempotencyKey: operationKey, status: 'completed',
        resourceType: 'message', resourceId: subject.messageId, error: null,
        result: { message: regenerated, execution: { executionId: 'execution-recovered', modelId: 'model-r3', providerId: 'provider-r3', status: 'completed', inputTokens: 4, outputTokens: 3, totalTokens: 7, finishReason: 'stop' }, externalCall: 'performed' },
        createdAt: at, updatedAt: at, completedAt: at, externalCall: 'performed',
      })),
    })
    renderPage(api, assistant)
    await screen.findByText('待恢复回答')

    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    fireEvent.click(await screen.findByRole('button', { name: '批准并重新生成' }))
    expect(await screen.findByText('请求超时，当前结果未知。')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '重新生成确认' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '按原键查询' }))
    expect(await screen.findByText('按原键恢复的重新生成回答')).toBeInTheDocument()
    expect(api.operationByKey).toHaveBeenCalledWith(key, expect.anything())
    expect(api.regenerateMessage).toHaveBeenCalledTimes(2)
  })

  it('reuses the original turn key only after a 404 recovery check proves a safe retry', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const keys: string[] = []
    let completed = false
    const messages = [message('safe-user', 'user', '安全重试消息', 1), message('safe-subject', 'subject', '安全重试回复', 2)]
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])),
      current: vi.fn().mockImplementation(() => Promise.resolve(detail(assistant, current, completed ? messages : []))),
      conversation: vi.fn().mockImplementation(() => Promise.resolve(detail(assistant, current, completed ? messages : []))),
      createTurn: vi.fn().mockImplementation((_id, _input, key) => {
        keys.push(key)
        if (keys.length === 1) return Promise.reject(new ApiClientError('lost', { code: 'request_timeout', status: null }))
        completed = true
        return Promise.resolve(turn())
      }),
      turnByKey: vi.fn().mockRejectedValue(new ApiClientError('missing', { code: 'TURN_NOT_FOUND', status: 404 })),
    })
    renderPage(api, assistant)
    await screen.findByText('开始一段新对话')
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '安全重试消息' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    fireEvent.click(await screen.findByRole('button', { name: '按原键查询' }))
    expect(await screen.findByText('服务端未找到原操作；可复用原幂等键安全重试原动作。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('安全重试回复')).toBeInTheDocument()
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('recovers a completed export response by its persisted random key and downloads the exact server result', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const key = 'vio-r3-99999999-9999-4999-8999-999999999999'
    sessionStorage.setItem('vio:personal:chat:r3:recovery:v1:test-owner:test-alpha', JSON.stringify({ version: 1, idempotencyKey: key, operationType: 'conversation.export', conversationId: current.conversationId }))
    const exported = { exportId: 'export-recovered', fileName: 'recovered.json', mediaType: 'application/json', content: '{"server":true}', sha256: `sha256:${'b'.repeat(64)}`, createdAt: at }
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])), current: vi.fn().mockResolvedValue(detail(assistant, current)), conversation: vi.fn().mockResolvedValue(detail(assistant, current)),
      operationByKey: vi.fn().mockResolvedValue({ operationId: 'operation-export', operationType: 'conversation.export', idempotencyKey: key, status: 'completed', resourceType: 'export', resourceId: exported.exportId, error: null, result: { export: exported, externalCall: 'not_performed' }, createdAt: at, updatedAt: at, completedAt: at, externalCall: 'not_performed' }),
    })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:recovered') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage(api, assistant)
    await waitFor(() => expect(api.operationByKey).toHaveBeenCalledWith(key, expect.anything()))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('vio:personal:chat:r3:recovery:v1:test-owner:test-alpha')).toBeNull()
  })

  it('recovers a lost regeneration confirmation response without calling regeneration again', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const subject = message('subject-recover', 'subject', '待重新生成回答', 1)
    const key = 'vio-r3-88888888-8888-4888-8888-888888888888'
    sessionStorage.setItem('vio:personal:chat:r3:recovery:v1:test-owner:test-alpha', JSON.stringify({ version: 1, idempotencyKey: key, operationType: 'message.regenerate', conversationId: current.conversationId, branchId: current.currentBranchId, messageId: subject.messageId, messageVersionId: subject.messageVersionId }))
    const confirmationResult = { operationStatus: 'confirmation_required', confirmation: { confirmationId: 'confirmation-recovered', kind: 'budget' }, externalCall: 'not_performed' }
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])), current: vi.fn().mockResolvedValue(detail(assistant, current, [subject])), conversation: vi.fn().mockResolvedValue(detail(assistant, current, [subject])),
      operationByKey: vi.fn().mockResolvedValue({ operationId: 'operation-regeneration', operationType: 'message.regenerate', idempotencyKey: key, status: 'failed', resourceType: 'message', resourceId: subject.messageId, error: { code: 'TOKEN_BUDGET_CONFIRMATION_REQUIRED' }, result: confirmationResult, createdAt: at, updatedAt: at, completedAt: at, externalCall: 'not_performed' }),
    })
    renderPage(api, assistant)
    expect(await screen.findByRole('dialog', { name: '重新生成确认' })).toHaveTextContent('预算确认')
    expect(api.regenerateMessage).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('vio:personal:chat:r3:recovery:v1:test-owner:test-alpha')).toBeNull()
  })

  it('queries an uncertain cancellation first and reuses the original recovery key only when the turn is unchanged', async () => {
    const assistant = assistantFixture()
    const current = conversation('alpha-main', '主会话', true)
    const processing = { ...turn(), status: 'processing' as const, completedAt: null, assistantMessage: null, externalCall: 'not_performed' as const }
    const cancelled = { ...processing, status: 'cancelled' as const, completedAt: at, error: { code: 'TURN_CANCELLED', retryable: false } }
    const recoveryKeys: string[] = []
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(list(assistant, [current])), current: vi.fn().mockResolvedValue(detail(assistant, current, [], processing)), conversation: vi.fn().mockResolvedValue(detail(assistant, current, [], processing)),
      recover: vi.fn().mockImplementation((_turnId, _input, key) => {
        recoveryKeys.push(key)
        return recoveryKeys.length === 1 ? Promise.reject(new ApiClientError('lost', { code: 'request_timeout', status: null })) : Promise.resolve(cancelled)
      }),
      turn: vi.fn().mockResolvedValue(processing),
    })
    renderPage(api, assistant)
    fireEvent.click(await screen.findByRole('button', { name: '终止本轮' }))
    expect(await screen.findByText('终止失败，恢复结果尚未确认。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '按原键查询' }))
    fireEvent.click(await screen.findByRole('button', { name: '沿用原恢复键重试' }))
    expect(await screen.findByText('本轮已终止')).toBeInTheDocument()
    expect(recoveryKeys).toHaveLength(2)
    expect(recoveryKeys[1]).toBe(recoveryKeys[0])
  })
})
