import { describe, expect, it, vi } from 'vitest'
import type { PersonalApi, PersonalRequestOptions } from './personal-api'
import {
  CAPABILITY_CATALOG_VERSION,
  CAPABILITY_EXECUTION_LIST_VERSION,
  CAPABILITY_EXECUTION_VERSION,
  createPersonalCapabilityApi,
  parseCapabilityCatalog,
  parseCapabilityDiscoveryRecovery,
  parseCapabilityExecution,
  parseCapabilityExecutionRecovery,
  parseCapabilityOperation,
  parseExecutionInput,
} from './personal-capability-api'

const at = '2026-09-08T00:00:00.000Z'
const digest = `sha256:${'a'.repeat(64)}`

function item(category = 'local_tool') {
  return { capabilityId: `cap-${category}`, category, name: '受控能力', version: '1', status: 'enabled', lifecycleStatus: 'installed', operations: ['execute'], externalCall: 'not_performed' }
}

function execution(status = 'succeeded') {
  return {
    schemaVersion: CAPABILITY_EXECUTION_VERSION,
    executionId: 'execution-r6', category: 'local_tool', capabilityId: 'cap-local_tool', capabilityVersion: '1', operationName: 'execute', status,
    attemptCount: 1, inputHash: digest,
    confirmation: status === 'waiting_confirmation' ? { confirmationId: 'confirmation-r6', status: 'pending' } : null,
    result: status === 'succeeded' ? { status: 'succeeded', contentHash: digest, output: { length: 4, lines: 1 }, usage: { status: 'not_incurred', inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: { status: 'not_incurred', amountMicros: null, currency: null } } : null,
    error: status === 'failed_terminal' ? { code: 'CAPABILITY_PERMISSION_DENIED' } : null,
    createdAt: at, updatedAt: at, completedAt: ['succeeded', 'failed_terminal', 'cancelled'].includes(status) ? at : null, externalCall: status === 'outcome_unknown' ? 'possibly_performed' : 'not_performed',
  }
}

describe('R6 capability API contract', () => {
  it('strictly parses the safe catalog projection and rejects leaked endpoint fields', () => {
    const value = { schemaVersion: CAPABILITY_CATALOG_VERSION, items: [item()] }
    expect(parseCapabilityCatalog(value).items[0]).toMatchObject({ category: 'local_tool', operations: ['execute'] })
    expect(() => parseCapabilityCatalog({ ...value, items: [{ ...item(), serviceUrl: 'https://secret.invalid' }] })).toThrow(/Invalid R6/)
    expect(() => parseCapabilityCatalog({ ...value, items: [{ ...item(), operations: ['execute', 'execute'] }] })).toThrow(/Invalid R6/)
  })

  it('strictly parses confirmation, completed discovery and denies impossible combinations', () => {
    expect(parseCapabilityOperation({ operationStatus: 'confirmation_required', capability: null, discovery: null, security: { decision: 'confirm', confirmationId: 'confirmation-r6', confirmationStatus: 'pending' }, error: null, externalCall: 'not_performed' }).security.confirmationId).toBe('confirmation-r6')
    const discovery = { snapshotId: 'snapshot-r6', status: 'ready', toolCount: 1, tools: [{ name: 'inspect', description: '受控工具', inputSchemaHash: digest, outputSchemaHash: null }], externalCall: 'performed' }
    const completedDiscovery = { operationStatus: 'completed', capability: null, discovery, security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: null, externalCall: 'performed' }
    expect(parseCapabilityOperation(completedDiscovery).discovery?.toolCount).toBe(1)
    expect(parseCapabilityOperation(completedDiscovery).discovery?.tools[0].outputSchemaHash).toBeNull()
    expect(() => parseCapabilityOperation({ ...completedDiscovery, capability: item() })).toThrow(/Invalid R6/)
    const unknown = { operationStatus: 'outcome_unknown', capability: null, discovery: null, security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: { code: 'MCP_NETWORK_UNAVAILABLE' }, externalCall: 'possibly_performed' }
    expect(parseCapabilityDiscoveryRecovery({ status: 'found', operation: unknown }).operation?.operationStatus).toBe('outcome_unknown')
    expect(() => parseCapabilityOperation({ ...unknown, externalCall: 'performed' })).toThrow(/Invalid R6/)
  })

  it('parses immutable execution, usage and recovery while rejecting raw input or malformed totals', () => {
    expect(parseCapabilityExecution(execution()).result?.output).toEqual({ length: 4, lines: 1 })
    expect(parseCapabilityExecution({ ...execution('waiting_confirmation') }).confirmation?.confirmationId).toBe('confirmation-r6')
    expect(parseCapabilityExecutionRecovery({ status: 'found', execution: execution() }).execution?.status).toBe('succeeded')
    expect(parseCapabilityExecutionRecovery({ status: 'not_found', execution: null })).toEqual({ status: 'not_found', execution: null })
    expect(parseCapabilityExecution(execution('outcome_unknown')).externalCall).toBe('possibly_performed')
    expect(parseCapabilityExecution({ ...execution(), category: 'model_api', capabilityVersion: 'r1-model-execution/v1', operationName: 'chat', externalCall: 'performed' }).capabilityVersion).toBe('r1-model-execution/v1')
    expect(() => parseCapabilityExecution({ ...execution(), input: { text: 'must-not-return' } })).toThrow(/Invalid R6/)
    expect(() => parseCapabilityExecution({ ...execution('failed_terminal'), error: { code: 'CAPABILITY_PERMISSION_DENIED', retryable: false } })).toThrow(/Invalid R6/)
    const invalidUsage = execution() as ReturnType<typeof execution>
    invalidUsage.result!.usage.totalTokens = 1
    expect(() => parseCapabilityExecution(invalidUsage)).toThrow(/Invalid R6/)
  })

  it('accepts only bounded JSON objects as execution input', () => {
    expect(parseExecutionInput('{"text":"hello","options":{"trim":true}}')).toEqual({ text: 'hello', options: { trim: true } })
    expect(() => parseExecutionInput('[]')).toThrow('JSON 对象')
    expect(() => parseExecutionInput('{"__proto__":{}}')).toThrow(/Invalid R6/)
  })

  it('uses the frozen routes and bodies without browser-supplied identity', async () => {
    const request = vi.fn<(path: string, method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown, options?: PersonalRequestOptions) => Promise<unknown>>(async (path) => {
      if (path === '/capabilities') return { schemaVersion: CAPABILITY_CATALOG_VERSION, items: [item()] }
      if (path.startsWith('/capability-executions?')) return { schemaVersion: CAPABILITY_EXECUTION_LIST_VERSION, items: [execution()], nextCursor: null }
      if (path === '/capability-executions') return execution()
      throw new Error(`unexpected ${path}`)
    })
    const api = createPersonalCapabilityApi({ request } as unknown as PersonalApi)
    await api.catalog()
    await api.executions({ category: 'local_tool', status: 'succeeded' })
    await api.execute({ category: 'local_tool', capabilityId: 'cap-local_tool', operationName: 'execute', input: { text: 'hello' } }, 'r6-test-key')
    expect(request).toHaveBeenNthCalledWith(1, '/capabilities', 'GET', undefined, undefined)
    expect(request.mock.calls[1][0]).toContain('category=local_tool')
    expect(request.mock.calls[1][0]).toContain('status=succeeded')
    expect(request.mock.calls[2][2]).toEqual({ category: 'local_tool', capabilityId: 'cap-local_tool', operationName: 'execute', input: { text: 'hello' } })
    expect(request.mock.calls[2][2]).not.toHaveProperty('userId')
    expect(request.mock.calls[2][2]).not.toHaveProperty('assistantId')
    expect(request.mock.calls[2][3]).toMatchObject({ idempotencyKey: 'r6-test-key' })
  })

  it('uses every frozen configuration and recovery route with explicit idempotency', async () => {
    const completed = (capability = item()) => ({ operationStatus: 'completed', capability, discovery: null, security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: null, externalCall: 'not_performed' })
    const discovery = { snapshotId: 'snapshot-r6', status: 'ready', toolCount: 1, tools: [{ name: 'inspect', description: '', inputSchemaHash: digest, outputSchemaHash: null }], externalCall: 'performed' }
    const request = vi.fn<(path: string, method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown, options?: PersonalRequestOptions) => Promise<unknown>>(async (path) => {
      if (path.includes('/discovery/by-idempotency-key/')) return { status: 'found', operation: { operationStatus: 'completed', capability: null, discovery, security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: null, externalCall: 'performed' } }
      if (path.endsWith('/discovery')) return { operationStatus: 'completed', capability: null, discovery, security: { decision: 'allow', confirmationId: null, confirmationStatus: 'not_required' }, error: null, externalCall: 'performed' }
      if (path === '/capabilities/local-tools') return completed()
      if (path === '/capabilities/mcp-servers') return completed(item('mcp_tool'))
      if (path === '/capabilities/skills') return completed(item('skill'))
      if (path === '/capabilities/plugins' || path.endsWith('/lifecycle')) return completed(item('plugin_action'))
      if (path.includes('/by-idempotency-key/')) return { status: 'found', execution: execution() }
      if (path.endsWith('/recovery') || path === '/capability-executions/execution-r6') return execution()
      if (path.includes('/confirmations/')) return {}
      throw new Error(`unexpected ${path}`)
    })
    const api = createPersonalCapabilityApi({ request } as unknown as PersonalApi)
    await api.installLocalTool('builtin.text.inspect/v1', null, 'config-key-01')
    await api.installMcp({ name: 'MCP', serviceUrl: 'https://mcp.invalid/service', description: '受信测试', acknowledgeTrustedEndpoint: true }, null, 'config-key-02')
    await api.discoverMcp('cap-mcp_tool', 'confirm-r6', 'config-key-03')
    await api.discoveryByKey('cap-mcp_tool', 'config-key-03')
    await api.installSkill({ name: 'Skill', version: '1', description: '受控步骤', steps: [{ stepId: 'step-1', category: 'local_tool', capabilityId: 'cap-local_tool', operationName: 'execute' }] }, null, 'config-key-04')
    await api.installPlugin({ name: 'Plugin', version: '1', description: '本地清单', actions: [{ actionId: 'run', skillId: 'cap-skill' }] }, null, 'config-key-05')
    await api.pluginLifecycle('cap-plugin_action', 'disable', null, 'config-key-06')
    await api.execution('execution-r6')
    await api.executionByKey('execute-key-01')
    await api.recover('execution-r6', 'retry', null, 'recovery-key-01')
    await api.decide('confirmation-r6', 'approve')
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/capabilities/local-tools', '/capabilities/mcp-servers', '/capabilities/mcp-servers/cap-mcp_tool/discovery', '/capabilities/mcp-servers/cap-mcp_tool/discovery/by-idempotency-key/config-key-03', '/capabilities/skills', '/capabilities/plugins',
      '/capabilities/plugins/cap-plugin_action/lifecycle', '/capability-executions/execution-r6', '/capability-executions/by-idempotency-key/execute-key-01',
      '/capability-executions/execution-r6/recovery', '/confirmations/confirmation-r6/decision',
    ])
    expect(request.mock.calls.filter((call) => call[1] === 'POST' && call[0].startsWith('/capabilities/')).every((call) => call[3]?.idempotencyKey?.startsWith('config-key-'))).toBe(true)
    expect(request.mock.calls[9][2]).toEqual({ action: 'retry' })
    expect(request.mock.calls[9][3]?.idempotencyKey).toBe('recovery-key-01')
    expect(JSON.stringify(request.mock.calls)).not.toContain('userId')
    expect(JSON.stringify(request.mock.calls)).not.toContain('assistantId')
  })
})
