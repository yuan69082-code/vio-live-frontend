import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../../api/client'
import { createPersonalApi, finishOperation, operationKey } from '../../api/personal-api'
import type { PersonalModel, PersonalProviderRecord } from '../../api/personal-configuration-types'
import { sealCredential } from '../../api/seal-credential'
import { PersonalProvider } from '../../state/PersonalContext'
import { sessionFixture } from '../../test/personal-fixtures'
import ProviderManager from './ProviderManager'

vi.mock('../../api/seal-credential', () => ({
  sealCredential: vi.fn(async () => ({ keyId: 'test-key', algorithm: 'RSA-OAEP-256+A256GCM', encryptedKey: 'test-wrapped-key', iv: 'test-iv', ciphertext: 'test-sealed-value' })),
}))

const provider: PersonalProviderRecord = {
  providerId: 'test-provider', displayName: '隔离测试服务', providerType: 'custom', baseUrl: 'http://127.0.0.1:19001',
  interfaceFormat: 'openai_compatible', status: 'enabled', version: 1,
  credentials: { apiKey: { status: 'configured', storage: 'test-only', masked: '••••••••' } },
}
const model: PersonalModel = {
  modelId: 'test-model', providerId: provider.providerId, modelName: '隔离测试模型', modelType: 'chat', capabilities: ['chat'],
  costDescription: '', testStatus: 'not_tested', status: 'enabled', version: 1, defaultForChat: false,
}
const operationNames = ['create-provider', 'update-provider/test-provider', 'create-model', 'update-model/test-model',
  'save-credential/test-provider', 'revoke-credential/test-provider', 'connection/test-provider']
const owners: string[] = []
afterEach(() => {
  for (const owner of owners.splice(0)) for (const operation of operationNames) finishOperation(owner, operation)
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.mocked(sealCredential).mockClear()
})

function configurationFixture(connectionStatus = 'succeeded') {
  const api = createPersonalApi()
  const owner = `test-owner-${crypto.randomUUID()}`
  owners.push(owner)
  vi.spyOn(api, 'session').mockResolvedValue(sessionFixture({ user: { userId: owner, displayName: '隔离测试用户', avatar: null } }))
  vi.spyOn(api, 'vault').mockResolvedValue({ status: 'ready', transport: { keyId: 'test-key', algorithm: 'RSA-OAEP-256+A256GCM', publicKeySpki: 'test-public-key' } })
  const calls: { path: string; key: string; approved: boolean }[] = []
  const cancellations = new Set<string>()
  const completed = vi.fn()
  const test = { testId: 'test-connection', providerId: provider.providerId, scope: 'authentication', status: connectionStatus,
    reason: 'test-only', startedAt: '2026-09-04T00:00:00Z', completedAt: '2026-09-04T00:00:01Z', generation: 'not_performed', providerCharge: 'not_incurred' }
  vi.spyOn(api, 'request').mockImplementation(async (path, method = 'GET', body, options = {}) => {
    if (path === '/providers' && method === 'GET') return { items: [provider] }
    if (path === '/models' && method === 'GET') return { items: [model] }
    if (path.startsWith('/confirmations/')) return {}
    const key = options.idempotencyKey ?? ''
    const approved = Boolean((body as { confirmationId?: string } | undefined)?.confirmationId)
    calls.push({ path, key, approved })
    if (cancellations.has(key)) return { operationStatus: 'cancelled' }
    if (!approved) return { operationStatus: 'confirmation_required', security: { confirmation: { confirmationId: `confirmation-${key}` } } }
    completed(path, key)
    return { operationStatus: 'completed', provider, model, test }
  })
  vi.spyOn(api, 'cancelOperation').mockImplementation(async ({ key }) => { cancellations.add(key); return { status: 'cancelled' } })
  vi.spyOn(api, 'operation').mockResolvedValue({ status: 'completed', result: { operationStatus: 'completed', test } })
  return { api, owner, calls, completed }
}

async function prepare(operation: string) {
  if (operation === 'create-provider') {
    fireEvent.click(screen.getByText('新增服务'))
    fireEvent.change(screen.getByLabelText('供应商名称'), { target: { value: '第二测试服务' } })
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://127.0.0.1:19002' } })
  } else if (operation.startsWith('update-provider')) fireEvent.click(screen.getByText('编辑供应商'))
  else if (operation === 'create-model') {
    fireEvent.click(screen.getByText('新增模型'))
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: '第二测试模型' } })
  } else if (operation.startsWith('update-model')) fireEvent.click(screen.getByText('编辑模型'))
}
function submit(operation: string) {
  if (operation === 'create-provider' || operation.startsWith('update-provider/')) fireEvent.click(screen.getByRole('button', { name: '保存供应商' }))
  else if (operation === 'create-model' || operation.startsWith('update-model/')) fireEvent.click(screen.getByRole('button', { name: '保存模型配置' }))
  else if (operation.startsWith('save-credential')) {
    fireEvent.change(screen.getByLabelText('供应商密钥'), { target: { value: 'non-real-test-credential' } })
    fireEvent.click(screen.getByText('保存 / 轮换密钥'))
  } else if (operation.startsWith('revoke-credential')) fireEvent.click(screen.getByText('撤销密钥'))
  else fireEvent.click(screen.getByText('测试连接'))
}

describe('configuration operation cancellation and fresh retry', () => {
  it.each(operationNames)('%s: reject → confirmed cancellation → new key → approve → completed', async (operation) => {
    const { api, owner, calls, completed } = configurationFixture()
    render(<PersonalProvider api={api}><ProviderManager /></PersonalProvider>)
    await screen.findByText('隔离测试服务')
    await prepare(operation)
    submit(operation)
    await screen.findByRole('group', { name: '后端安全确认' })
    const firstKey = calls[0].key
    expect(firstKey).toMatch(/^vio-personal-/)
    fireEvent.click(screen.getByText('拒绝并取消'))
    await screen.findByText('已拒绝并取消本次服务端操作。')
    expect(api.cancelOperation).toHaveBeenCalledWith({ operation, key: firstKey }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.queryByRole('group', { name: '后端安全确认' })).not.toBeInTheDocument()
    expect(completed).not.toHaveBeenCalled()
    if (operation.startsWith('save-credential')) {
      expect(screen.getByLabelText('供应商密钥')).toHaveValue('')
      fireEvent.click(screen.getByText('保存 / 轮换密钥'))
      expect(await screen.findByRole('alert')).toHaveTextContent('请先输入密钥')
      expect(calls).toHaveLength(1)
    }
    submit(operation)
    await screen.findByRole('group', { name: '后端安全确认' })
    const secondKey = calls[1].key
    expect(secondKey).not.toBe(firstKey)
    fireEvent.click(screen.getByText('批准本次操作'))
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1))
    expect(calls).toHaveLength(3)
    expect(calls[2]).toEqual({ ...calls[1], approved: true })
    expect(completed).toHaveBeenCalledWith(calls[1].path, secondKey)
    expect(operationKey(owner, operation)).not.toBe(secondKey)
    if (operation.startsWith('save-credential')) expect(sealCredential).toHaveBeenCalledTimes(2)
  })

  it.each(['running', 'outcome_unknown'])('retains a %s connection key through read recovery', async (status) => {
    const { api, owner, calls, completed } = configurationFixture(status)
    render(<PersonalProvider api={api}><ProviderManager /></PersonalProvider>)
    await screen.findByText('隔离测试服务')
    fireEvent.click(screen.getByText('测试连接'))
    fireEvent.click(await screen.findByText('批准本次操作'))
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1))
    const key = calls[0].key
    expect(operationKey(owner, 'connection/test-provider')).toBe(key)
    fireEvent.click(screen.getByText('恢复上次连接测试'))
    await waitFor(() => expect(api.operation).toHaveBeenCalledTimes(1))
    expect(operationKey(owner, 'connection/test-provider')).toBe(key)
    expect(completed).toHaveBeenCalledTimes(1)
  })

  it('does not abandon the key on a cancellation network failure and retries confirmation', async () => {
    const { api, owner, calls, completed } = configurationFixture()
    vi.mocked(api.cancelOperation).mockRejectedValueOnce(new ApiClientError('Isolated test failure', { code: 'network_error', status: null }))
    render(<PersonalProvider api={api}><ProviderManager /></PersonalProvider>)
    await screen.findByText('隔离测试服务')
    await prepare('create-provider')
    submit('create-provider')
    fireEvent.click(await screen.findByText('拒绝并取消'))
    expect(await screen.findByRole('alert')).toHaveTextContent('结果尚未确认')
    expect(screen.getByRole('button', { name: '保存供应商' })).toBeDisabled()
    expect(operationKey(owner, 'create-provider')).toBe(calls[0].key)
    expect(completed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('拒绝并取消'))
    await screen.findByText('已拒绝并取消本次服务端操作。')
    submit('create-provider')
    fireEvent.click(await screen.findByText('批准本次操作'))
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1))
    expect(calls[1].key).not.toBe(calls[0].key)
  })

  it('clears a lost-response credential draft after completed recovery, without remounting the provider', async () => {
    const { api, owner } = configurationFixture()
    vi.mocked(api.operation).mockResolvedValue({ status: 'completed', result: { operationStatus: 'completed', provider } })
    render(<PersonalProvider api={api}><ProviderManager /></PersonalProvider>)
    await screen.findByText('隔离测试服务')
    vi.mocked(api.request).mockRejectedValueOnce(new ApiClientError('Test response lost', { code: 'network_error', status: null }))
    submit('save-credential/test-provider')
    await screen.findByRole('alert')
    const originalKey = operationKey(owner, 'save-credential/test-provider')
    const originalInput = screen.getByLabelText('供应商密钥')
    fireEvent.click(screen.getByText('核对上次密钥保存'))
    await waitFor(() => expect(api.operation).toHaveBeenCalledWith('save-credential/test-provider', originalKey, expect.objectContaining({ signal: expect.any(AbortSignal) })))
    await waitFor(() => expect(screen.getByText('保存 / 轮换密钥')).not.toBeDisabled())
    expect(screen.getByLabelText('供应商密钥')).toBe(originalInput)
    expect(operationKey(owner, 'save-credential/test-provider')).not.toBe(originalKey)
    const writesBefore = vi.mocked(api.request).mock.calls.filter(([path, method]) => path.endsWith('/credential') && method === 'PUT').length
    fireEvent.click(screen.getByText('保存 / 轮换密钥'))
    expect(await screen.findByRole('alert')).toHaveTextContent('请先输入密钥')
    expect(vi.mocked(api.request).mock.calls.filter(([path, method]) => path.endsWith('/credential') && method === 'PUT')).toHaveLength(writesBefore)
    expect(sealCredential).toHaveBeenCalledTimes(1)
  })

  it.each(['recover', 'cancel'] as const)('%s confirms cancellation, clears the lost draft, and allows a fresh credential save', async (mode) => {
    const { api, owner, calls, completed } = configurationFixture()
    vi.mocked(api.operation).mockResolvedValue({ status: 'cancelled' })
    render(<PersonalProvider api={api}><ProviderManager /></PersonalProvider>)
    await screen.findByText('隔离测试服务')
    vi.mocked(api.request).mockRejectedValueOnce(new ApiClientError('Test response lost', { code: 'network_error', status: null }))
    submit('save-credential/test-provider')
    await screen.findByRole('alert')
    const originalKey = operationKey(owner, 'save-credential/test-provider')
    fireEvent.click(screen.getByText(mode === 'recover' ? '核对上次密钥保存' : '取消上次待处理密钥保存'))
    await screen.findByText(mode === 'recover' ? '上次操作已取消，可以重新发起。' : '服务端已取消待处理操作，请重新输入密钥。')
    expect(operationKey(owner, 'save-credential/test-provider')).not.toBe(originalKey)
    fireEvent.click(screen.getByText('保存 / 轮换密钥'))
    expect(await screen.findByRole('alert')).toHaveTextContent('请先输入密钥')
    expect(calls).toHaveLength(0)
    submit('save-credential/test-provider')
    fireEvent.click(await screen.findByText('批准本次操作'))
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1))
    expect(calls[0].key).not.toBe(originalKey)
    expect(calls[1].key).toBe(calls[0].key)
    expect(sealCredential).toHaveBeenCalledTimes(2)
  })

  it.each(['confirmation_required', 'not_found'] as const)('clears old credential memory but retains the original key on %s recovery', async (status) => {
    const { api, owner } = configurationFixture()
    vi.mocked(api.operation).mockResolvedValue({ status })
    render(<PersonalProvider api={api}><ProviderManager /></PersonalProvider>)
    await screen.findByText('隔离测试服务')
    vi.mocked(api.request).mockRejectedValueOnce(new ApiClientError('Test response lost', { code: 'network_error', status: null }))
    submit('save-credential/test-provider')
    await screen.findByRole('alert')
    const originalKey = operationKey(owner, 'save-credential/test-provider')
    fireEvent.click(screen.getByText('核对上次密钥保存'))
    await waitFor(() => expect(api.operation).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('保存 / 轮换密钥')).not.toBeDisabled())
    expect(operationKey(owner, 'save-credential/test-provider')).toBe(originalKey)
    if (status === 'confirmation_required') expect(screen.getByRole('alert')).toHaveTextContent('本地输入及临时密文已清除，原操作标识保留')
    fireEvent.click(screen.getByText('保存 / 轮换密钥'))
    expect(await screen.findByRole('alert')).toHaveTextContent('请先输入密钥')
    expect(operationKey(owner, 'save-credential/test-provider')).toBe(originalKey)
    expect(sealCredential).toHaveBeenCalledTimes(1)
  })
})
