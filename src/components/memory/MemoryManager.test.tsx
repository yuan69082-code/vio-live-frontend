import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../../api/client'
import { MEMORY_CONTRACT_VERSION, MEMORY_EXPORT_VERSION, MEMORY_IMPORT_VERSION, type Memory, type MemoryExportResult } from '../../api/personal-memory-api'
import type { PersonalApi, PersonalAssistant, PersonalRequestOptions, PersonalSession } from '../../api/personal-api'
import { PersonalProvider, usePersonal } from '../../state/PersonalContext'
import { assistantFixture, sessionFixture } from '../../test/personal-fixtures'
import MemoryManager from './MemoryManager'

const at = '2026-09-08T00:00:00.000Z'
const digest = `sha256:${'a'.repeat(64)}`

function memory(id = 'memory-alpha', assistantId = 'test-alpha', body = '服务端真实记忆'): Memory {
  return {
    contractVersion: MEMORY_CONTRACT_VERSION, memoryId: id, assistantId, kind: 'preference', currentVersionId: `version-${id}`, version: 1,
    body, summary: `${assistantId} 摘要`, source: { sourceType: 'manual', sourceRef: `manual:${id}`, sourceContentHash: digest }, occurredAt: null,
    recordedAt: at, includeInContext: true, visibilityScope: 'current_assistant', sensitivity: 'normal', status: 'active',
    retention: { deletionState: 'not_requested', deletionId: null, requestedAt: null, finalizedAt: null }, updatedAt: at, externalCall: 'not_performed',
  }
}

function list(items: Memory[]) {
  return { contractVersion: MEMORY_CONTRACT_VERSION, items, nextCursor: null, query: null, selection: { strategy: 'lexical-overlap-recency/v1', scope: 'current_owner_current_assistant' }, externalCall: 'not_performed' }
}

function completed(value: Memory, operationType = 'memory.create') {
  return { contractVersion: MEMORY_CONTRACT_VERSION, operationStatus: 'completed', operation: { operationId: `operation-${value.memoryId}`, operationType, status: 'completed', resourceType: 'memory', resourceId: value.memoryId, errorCode: null, createdAt: at, completedAt: at }, memory: value, reference: null, deletion: null, confirmation: null, externalCall: 'not_performed' }
}

function confirmation(operationType: string, resourceType: string, id = 'confirmation-memory-r5') {
  return { contractVersion: MEMORY_CONTRACT_VERSION, operationStatus: 'confirmation_required', operation: { operationId: `operation-${operationType}`, operationType, status: 'confirmation_required', resourceType, resourceId: null, errorCode: null, createdAt: at, completedAt: null }, memory: null, reference: null, deletion: null, confirmation: { confirmationId: id, status: 'pending' }, externalCall: 'not_performed' }
}

function deletionResult(value: Memory, status: 'pending' | 'cancelled', operationType: 'memory.deletion.request' | 'memory.deletion.cancel') {
  const record = { deletionId: 'deletion-r5', memoryId: value.memoryId, status, requestedAt: at, cancelledAt: status === 'cancelled' ? at : null, finalizedAt: null, result: status, bodyRetained: true }
  return { contractVersion: MEMORY_CONTRACT_VERSION, operationStatus: 'completed', operation: { operationId: `operation-${operationType}`, operationType, status: 'completed', resourceType: 'deletion', resourceId: 'deletion-r5', errorCode: null, createdAt: at, completedAt: at }, memory: value, reference: null, deletion: record, confirmation: null, externalCall: 'not_performed' }
}

function exportResult(value: Memory, exportId = 'export-r5'): MemoryExportResult {
  return {
    contractVersion: MEMORY_EXPORT_VERSION,
    operationStatus: 'completed',
    operation: { operationId: `operation-${exportId}`, operationType: 'memory.export', status: 'completed', resourceType: 'export', resourceId: exportId, errorCode: null, createdAt: at, completedAt: at },
    export: {
      exportId, format: MEMORY_EXPORT_VERSION, status: 'completed', itemCount: 1, contentHash: digest, createdAt: at,
      items: [{ memoryId: value.memoryId, memoryVersionId: value.currentVersionId, version: value.version, kind: value.kind, body: value.body, summary: value.summary, source: value.source, occurredAt: value.occurredAt, recordedAt: value.recordedAt, includeInContext: value.includeInContext, visibilityScope: value.visibilityScope, sensitivity: value.sensitivity, contentHash: digest }],
    },
    confirmation: null,
    externalCall: 'not_performed',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

type RequestFn = (path: string, method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown, options?: PersonalRequestOptions) => Promise<unknown>

function personalApi(request: RequestFn, session: PersonalSession = sessionFixture()): PersonalApi {
  return {
    request: request as PersonalApi['request'], setSession: vi.fn(), setDeletionAccess: vi.fn(), onUnauthorized: vi.fn(), session: vi.fn().mockResolvedValue(session),
  } as unknown as PersonalApi
}

function Harness({ api, strict = false, switcher = false }: { api: PersonalApi; strict?: boolean; switcher?: boolean }) {
  const content = <PersonalProvider api={api}><MemoryHarness switcher={switcher} /></PersonalProvider>
  return strict ? <StrictMode>{content}</StrictMode> : content
}

function MemoryHarness({ switcher }: { switcher: boolean }) {
  const personal = usePersonal()
  const [assistant, setAssistant] = useState<PersonalAssistant>(assistantFixture())
  if (personal.state.kind !== 'ready') return <p>正在验证</p>
  const currentSession = personal.state.session
  return <>{switcher && <button type="button" onClick={() => {
    const beta = assistantFixture('test-beta', '测试助手二')
    personal.acceptSession({ ...currentSession, currentAssistantId: beta.assistantId, selectionVersion: 2 })
    setAssistant(beta)
  }}>切换到助手二</button>}<MemoryManager key={`${personal.scope}:${assistant.assistantId}`} assistant={assistant} /></>
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); sessionStorage.clear(); localStorage.clear() })

describe('R5 MemoryManager', () => {
  it('loads real current-assistant data and creates once under duplicate click in StrictMode', async () => {
    const saving = deferred<unknown>()
    let created = false
    const request = vi.fn<RequestFn>(async (path, method) => {
      if (path.startsWith('/memories?')) return list(created ? [memory(), memory('memory-new', 'test-alpha', '只在当前页面内存中的新正文')] : [memory()])
      if (path === '/memories' && method === 'POST') return saving.promise.then((value) => { created = true; return value })
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} strict />)
    expect(await screen.findByText('test-alpha 摘要')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建记忆' }))
    fireEvent.change(screen.getByLabelText('记忆正文'), { target: { value: '只在当前页面内存中的新正文' } })
    const unicodeSummary = '🙂'.repeat(512)
    fireEvent.change(screen.getByLabelText('记忆摘要'), { target: { value: unicodeSummary } })
    const submit = screen.getByRole('button', { name: '提交到服务端' })
    fireEvent.click(submit); fireEvent.click(submit)
    await waitFor(() => expect(request.mock.calls.filter(([path, method]) => path === '/memories' && method === 'POST')).toHaveLength(1))
    const createCall = request.mock.calls.find(([path, method]) => path === '/memories' && method === 'POST')!
    expect(createCall[2]).toMatchObject({ body: '只在当前页面内存中的新正文', summary: unicodeSummary, source: { sourceType: 'manual', sourceRef: null } })
    expect(createCall[2]).not.toHaveProperty('userId'); expect(createCall[2]).not.toHaveProperty('assistantId')
    await act(async () => saving.resolve(completed(memory('memory-new', 'test-alpha', '只在当前页面内存中的新正文'))))
    expect(await screen.findByText('创建记忆已由服务端确认完成。')).toBeInTheDocument()
    expect(screen.getAllByText('test-alpha 摘要')).toHaveLength(2)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('只在当前页面内存中的新正文')
    expect(localStorage.length).toBe(0)
  })

  it('does not reveal a sensitive list before confirmed GET retry', async () => {
    const challenge = { contractVersion: MEMORY_CONTRACT_VERSION, operationStatus: 'confirmation_required', confirmation: { confirmationId: 'confirmation-read-r5', status: 'pending' }, externalCall: 'not_performed' }
    const sensitive = { ...memory('memory-sensitive', 'test-alpha', '确认后才返回的敏感正文'), sensitivity: 'sensitive' as const }
    const request = vi.fn<RequestFn>(async (path, method, _body, options) => {
      if (path.startsWith('/memories?')) return options?.confirmationId ? list([sensitive]) : challenge
      if (path === '/confirmations/confirmation-read-r5/decision' && method === 'POST') return {}
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    expect(await screen.findByText('服务端要求确认后才能读取敏感记忆；本页尚未收到正文。')).toBeInTheDocument()
    expect(screen.queryByText('确认后才返回的敏感正文')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
    expect(await screen.findByText('test-alpha 摘要')).toBeInTheDocument()
    expect(request.mock.calls.find(([path, method, _body, options]) => path.startsWith('/memories?') && method === 'GET' && options?.confirmationId === 'confirmation-read-r5')?.[3]).toMatchObject({ confirmationId: 'confirmation-read-r5' })
  })

  it('closes the editor so a write confirmation can resume the original key and body', async () => {
    let current: Memory | null = null
    const request = vi.fn<RequestFn>(async (path, method, body) => {
      if (path.startsWith('/memories?')) return list(current ? [current] : [])
      if (path === '/memories' && method === 'POST') {
        if (!(body as { confirmationId: string | null }).confirmationId) return confirmation('memory.create', 'memory')
        current = memory('memory-confirmed', 'test-alpha', String((body as { body: string }).body))
        return completed(current)
      }
      if (path === '/confirmations/confirmation-memory-r5/decision' && method === 'POST') return {}
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findByText('当前筛选下没有记忆。')
    fireEvent.click(screen.getByRole('button', { name: '新建记忆' }))
    fireEvent.change(screen.getByLabelText('记忆正文'), { target: { value: '确认后按原正文保存' } })
    fireEvent.click(screen.getByRole('button', { name: '提交到服务端' }))
    expect(await screen.findByRole('group', { name: '记忆安全确认' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '创建长期记忆' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
    expect(await screen.findByText('创建记忆已由服务端确认完成。')).toBeInTheDocument()
    const createCalls = request.mock.calls.filter(([path]) => path === '/memories')
    expect(createCalls).toHaveLength(2)
    expect(createCalls[0][3]?.idempotencyKey).toBe(createCalls[1][3]?.idempotencyKey)
    expect(createCalls[1][2]).toMatchObject({ body: '确认后按原正文保存', confirmationId: 'confirmation-memory-r5' })
  })

  it('ends an explicitly rejected write and uses a fresh key for a new user submission', async () => {
    const keys: string[] = []
    let created: Memory | null = null
    const request = vi.fn<RequestFn>(async (path, method, body, options) => {
      if (path.startsWith('/memories?')) return list(created ? [created] : [])
      if (path === '/memories' && method === 'POST') {
        keys.push(String(options?.idempotencyKey))
        if (!(body as { confirmationId: string | null }).confirmationId) {
          return confirmation('memory.create', 'memory', `confirmation-${keys.length}`)
        }
        created = memory('memory-after-reject', 'test-alpha', String((body as { body: string }).body))
        return completed(created)
      }
      if (path.startsWith('/confirmations/') && method === 'POST') return {}
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findByText('当前筛选下没有记忆。')
    fireEvent.click(screen.getByRole('button', { name: '新建记忆' }))
    fireEvent.change(screen.getByLabelText('记忆正文'), { target: { value: '明确拒绝的正文' } })
    fireEvent.click(screen.getByRole('button', { name: '提交到服务端' }))
    fireEvent.click(await screen.findByRole('button', { name: '拒绝' }))
    expect(await screen.findByText('已拒绝本次写入确认；该操作已结束，可重新发起新的用户操作。')).toBeInTheDocument()
    expect(screen.queryByText(/结果尚未确认/)).not.toBeInTheDocument()
    expect(sessionStorage.length).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '新建记忆' }))
    fireEvent.change(screen.getByLabelText('记忆正文'), { target: { value: '重新发起的新正文' } })
    fireEvent.click(screen.getByRole('button', { name: '提交到服务端' }))
    fireEvent.click(await screen.findByRole('button', { name: '批准本次操作' }))
    expect(await screen.findByText('创建记忆已由服务端确认完成。')).toBeInTheDocument()
    expect(keys).toHaveLength(3)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[1]).toBe(keys[2])
  })

  it('recovers an unknown create only by its original key and never persists the body', async () => {
    let createKey = ''
    let recovered = false
    const request = vi.fn<RequestFn>(async (path, method, body, options) => {
      if (path.startsWith('/memories?')) return list(recovered ? [memory('memory-recovered', 'test-alpha', '由原键恢复的正文')] : [])
      if (path === '/memories' && method === 'POST') { createKey = String(options?.idempotencyKey); throw new ApiClientError('lost', { code: 'network_error', status: null }) }
      if (path === `/memories/operations/by-idempotency-key/${createKey}`) { recovered = true; return completed(memory('memory-recovered', 'test-alpha', '由原键恢复的正文')) }
      throw new Error(`unexpected ${method} ${path} ${JSON.stringify(body)}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findByText('当前筛选下没有记忆。')
    fireEvent.click(screen.getByRole('button', { name: '新建记忆' }))
    fireEvent.change(screen.getByLabelText('记忆正文'), { target: { value: '不得写入恢复缓存的正文' } })
    fireEvent.click(screen.getByRole('button', { name: '提交到服务端' }))
    expect(await screen.findByText(/结果尚未确认/)).toBeInTheDocument()
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('不得写入恢复缓存的正文')
    fireEvent.click(screen.getByRole('button', { name: '按原操作键查询' }))
    expect(await screen.findByText('创建记忆已由服务端确认完成。')).toBeInTheDocument()
    expect(screen.getByText('test-alpha 摘要')).toBeInTheDocument()
    expect(request.mock.calls.filter(([path]) => path === '/memories')).toHaveLength(1)
    expect(request.mock.calls.some(([path]) => path === `/memories/operations/by-idempotency-key/${createKey}`)).toBe(true)
  })

  it('keeps atomic import strict while sending exact-field invalid items for a best-effort server report', async () => {
    const request = vi.fn<RequestFn>(async (path, method) => {
      if (path.startsWith('/memories?')) return list([])
      if (path === '/memories/imports' && method === 'POST') return {
        contractVersion: MEMORY_IMPORT_VERSION,
        operationStatus: 'confirmation_required',
        operation: { operationId: 'operation-import-r5', operationType: 'memory.import', status: 'confirmation_required', resourceType: 'import', resourceId: null, errorCode: null, createdAt: at, completedAt: null },
        import: null,
        confirmation: { confirmationId: 'confirmation-import-r5', status: 'pending' },
        externalCall: 'not_performed',
      }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findByText('当前筛选下没有记忆。')
    const invalidItem = JSON.stringify([{ clientItemId: 'item-0001', kind: 'unsupported', body: '', summary: null, occurredAt: 'not-a-time', includeInContext: false, sensitivity: 'normal' }])
    fireEvent.change(screen.getByLabelText('导入记忆 JSON'), { target: { value: invalidItem } })
    fireEvent.click(screen.getByRole('button', { name: '提交导入' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('导入条目类型不符合 R5 格式')
    expect(request.mock.calls.filter(([path]) => path === '/memories/imports')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('模式'), { target: { value: 'best_effort' } })
    fireEvent.click(screen.getByRole('button', { name: '提交导入' }))
    expect(await screen.findByRole('group', { name: '记忆安全确认' })).toBeInTheDocument()
    expect(request.mock.calls.find(([path]) => path === '/memories/imports')?.[2]).toMatchObject({
      contractVersion: MEMORY_IMPORT_VERSION,
      mode: 'best_effort',
      items: [{ clientItemId: 'item-0001', kind: 'unsupported', body: '', occurredAt: 'not-a-time' }],
    })
  })

  it('offers a visible in-memory download link and does not repeat the completed server export when clicked', async () => {
    const current = memory('memory-export')
    const request = vi.fn<RequestFn>(async (path, method) => {
      if (path.startsWith('/memories?')) return list([current])
      if (path === '/memories/exports' && method === 'POST') return exportResult(current)
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findByText('test-alpha 摘要')

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:r5-export')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    fireEvent.click(screen.getByRole('button', { name: '请求导出并下载' }))
    expect(await screen.findByText('服务端导出已完成，请点击“下载导出文件”保存到设备。')).toBeInTheDocument()
    expect(request.mock.calls.filter(([path]) => path === '/memories/exports')).toHaveLength(1)
    expect(createObjectUrl).toHaveBeenCalledOnce()
    const anchor = screen.getByRole('link', { name: '下载导出文件' }) as HTMLAnchorElement
    expect(anchor).toHaveAttribute('href', 'blob:r5-export')
    expect(anchor.download).toBe('vio-memory-export-r5.json')
    expect(revokeObjectUrl).not.toHaveBeenCalled()
    anchor.addEventListener('click', (event) => event.preventDefault(), { once: true })
    fireEvent.click(anchor)
    expect(request.mock.calls.filter(([path]) => path === '/memories/exports')).toHaveLength(1)
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:r5-export'), { timeout: 1_500 })
    expect(screen.queryByRole('link', { name: '下载导出文件' })).not.toBeInTheDocument()
  })

  it('revokes a replaced export URL and the remaining URL when its assistant scope unmounts', async () => {
    const current = memory('memory-export-cleanup')
    let exportCount = 0
    const request = vi.fn<RequestFn>(async (path, method) => {
      if (path.startsWith('/memories?')) return list([current])
      if (path === '/memories/exports' && method === 'POST') { exportCount++; return exportResult(current, `export-r5-${exportCount}`) }
      throw new Error(`unexpected ${method} ${path}`)
    })
    const { unmount } = render(<Harness api={personalApi(request)} />)
    await screen.findByText('test-alpha 摘要')
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:r5-first').mockReturnValueOnce('blob:r5-second')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    fireEvent.click(screen.getByRole('button', { name: '请求导出并下载' }))
    expect(await screen.findByRole('link', { name: '下载导出文件' })).toHaveAttribute('href', 'blob:r5-first')
    fireEvent.click(screen.getByRole('button', { name: '请求导出并下载' }))
    await waitFor(() => expect(screen.getByRole('link', { name: '下载导出文件' })).toHaveAttribute('href', 'blob:r5-second'))
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:r5-first')
    expect(request.mock.calls.filter(([path]) => path === '/memories/exports')).toHaveLength(2)
    unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:r5-second')
  })

  it('reports a local download failure without repeating the completed server export', async () => {
    const current = memory('memory-export-failure')
    const request = vi.fn<RequestFn>(async (path, method) => {
      if (path.startsWith('/memories?')) return list([current])
      if (path === '/memories/exports' && method === 'POST') return exportResult(current)
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    await screen.findByText('test-alpha 摘要')
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('local blob failure') })

    fireEvent.click(screen.getByRole('button', { name: '请求导出并下载' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('服务端已完成导出，但浏览器未能生成下载；不会自动重新执行导出。')
    expect(request.mock.calls.filter(([path]) => path === '/memories/exports')).toHaveLength(1)
  })

  it('aborts the former assistant view and ignores its late success and finally', async () => {
    const alpha = deferred<unknown>()
    let listCalls = 0
    const request = vi.fn<RequestFn>(async (path) => {
      if (path.startsWith('/memories?')) {
        listCalls++
        return listCalls > 1 ? list([memory('memory-beta', 'test-beta', '助手二真实记忆')]) : alpha.promise
      }
      throw new Error(`unexpected ${path}`)
    })
    render(<Harness api={personalApi(request)} switcher />)
    await waitFor(() => expect(request.mock.calls.some(([path]) => String(path).startsWith('/memories?'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '切换到助手二' }))
    expect(await screen.findByText('test-beta 摘要')).toBeInTheDocument()
    await act(async () => alpha.resolve(list([memory('memory-alpha', 'test-alpha', '不应污染新助手')])) )
    expect(screen.queryByText('不应污染新助手')).not.toBeInTheDocument()
    expect(screen.getByText('测试助手二 的记忆中心')).toBeInTheDocument()
  })

  it('fails closed and removes an already displayed body when a required source becomes invalid', async () => {
    const current = memory('memory-source', 'test-alpha', '来源失效后不能继续显示的正文')
    const request = vi.fn<RequestFn>(async (path) => {
      if (path.startsWith('/memories?')) return list([current])
      if (path === '/memories/memory-source') return current
      if (path === '/memories/memory-source/versions') throw new ApiClientError('raw source path', { code: 'MEMORY_SOURCE_NOT_FOUND', status: 404 })
      throw new Error(`unexpected ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    fireEvent.click(await screen.findByRole('button', { name: /test-alpha 摘要/ }))
    expect(await screen.findByText('来源失效后不能继续显示的正文')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '读取版本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('拒绝返回整条记忆')
    expect(screen.queryByText('来源失效后不能继续显示的正文')).not.toBeInTheDocument()
  })

  it('reuses one key through deletion confirmation and allows a separately idempotent cancellation', async () => {
    let current = memory('memory-delete')
    const request = vi.fn<RequestFn>(async (path, method, body) => {
      if (path.startsWith('/memories?')) return list(current.status === 'deletion_pending' ? [] : [current])
      if (path === '/memories/memory-delete' && method === 'GET') return current
      if (path === '/memories/memory-delete/deletion' && method === 'POST') {
        if (!(body as { confirmationId: string | null }).confirmationId) return confirmation('memory.deletion.request', 'deletion')
        current = { ...current, status: 'deletion_pending', retention: { deletionState: 'requested', deletionId: 'deletion-r5', requestedAt: at, finalizedAt: null } }
        return deletionResult(current, 'pending', 'memory.deletion.request')
      }
      if (path === '/confirmations/confirmation-memory-r5/decision' && method === 'POST') return {}
      if (path === '/memories/memory-delete/deletion-cancellation' && method === 'POST') {
        current = { ...current, status: 'active', retention: { deletionState: 'not_requested', deletionId: null, requestedAt: null, finalizedAt: null } }
        return deletionResult(current, 'cancelled', 'memory.deletion.cancel')
      }
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    fireEvent.click(await screen.findByRole('button', { name: /test-alpha 摘要/ }))
    await screen.findByText('服务端真实记忆')
    fireEvent.click(screen.getByRole('button', { name: '申请删除' }))
    expect(await screen.findByRole('group', { name: '记忆安全确认' })).toBeInTheDocument()
    const firstWrite = request.mock.calls.find(([path]) => path === '/memories/memory-delete/deletion')!
    fireEvent.click(screen.getByRole('button', { name: '批准本次操作' }))
    expect(await screen.findByText('删除尚未最终完成')).toBeInTheDocument()
    const deletionCalls = request.mock.calls.filter(([path]) => path === '/memories/memory-delete/deletion')
    expect(deletionCalls).toHaveLength(2)
    expect(deletionCalls[0][3]?.idempotencyKey).toBe(deletionCalls[1][3]?.idempotencyKey)
    expect(firstWrite[2]).toMatchObject({ expectedVersion: 1, confirmationId: null, securitySessionId: null })
    expect(deletionCalls[1][2]).toMatchObject({ expectedVersion: 1, confirmationId: 'confirmation-memory-r5', securitySessionId: null })
    fireEvent.click(screen.getByRole('button', { name: '撤销删除申请' }))
    expect(await screen.findByText('撤销删除申请已由服务端确认完成。')).toBeInTheDocument()
    expect(request.mock.calls.find(([path]) => path === '/memories/memory-delete/deletion-cancellation')?.[2]).toEqual({ deletionId: 'deletion-r5' })
    expect(request.mock.calls.find(([path]) => path === '/memories/memory-delete/deletion-cancellation')?.[3]?.idempotencyKey).not.toBe(deletionCalls[0][3]?.idempotencyKey)
  })

  it('keeps the minimal server deletion receipt visible after the body is finalized', async () => {
    let current: Memory | null = { ...memory('memory-finalize'), status: 'deletion_pending', retention: { deletionState: 'requested', deletionId: 'deletion-finalize-r5', requestedAt: at, finalizedAt: null } }
    const request = vi.fn<RequestFn>(async (path, method, body) => {
      if (path.startsWith('/memories?')) return list(current ? [current] : [])
      if (path === '/memories/memory-finalize' && method === 'GET') return current
      if (path === '/memories/memory-finalize/deletion-finalization' && method === 'POST') {
        if (!(body as { confirmationId: string | null }).confirmationId) return confirmation('memory.deletion.finalize', 'deletion', 'confirmation-finalize-r5')
        current = null
        return {
          contractVersion: MEMORY_CONTRACT_VERSION, operationStatus: 'completed',
          operation: { operationId: 'operation-finalize-r5', operationType: 'memory.deletion.finalize', status: 'completed', resourceType: 'deletion', resourceId: 'deletion-finalize-r5', errorCode: null, createdAt: at, completedAt: at },
          memory: null, reference: null,
          deletion: { deletionId: 'deletion-finalize-r5', memoryId: 'memory-finalize', status: 'completed', requestedAt: at, cancelledAt: null, finalizedAt: at, result: 'deleted', bodyRetained: false },
          confirmation: null, externalCall: 'not_performed',
        }
      }
      if (path === '/confirmations/confirmation-finalize-r5/decision' && method === 'POST') return {}
      throw new Error(`unexpected ${method} ${path}`)
    })
    render(<Harness api={personalApi(request)} />)
    fireEvent.click(await screen.findByRole('button', { name: /test-alpha 摘要/ }))
    await screen.findByText('删除尚未最终完成')
    fireEvent.click(screen.getByRole('button', { name: '最终删除正文与版本' }))
    fireEvent.click(await screen.findByRole('button', { name: '批准本次操作' }))
    expect(await screen.findByRole('heading', { name: '最近删除凭据' })).toBeInTheDocument()
    expect(screen.getByText(/记忆正文已由服务端移除/)).toHaveTextContent('结果：deleted')
    expect(screen.queryByText('服务端真实记忆')).not.toBeInTheDocument()
  })
})
