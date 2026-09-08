import { ApiClientError } from './client'
import type { PersonalApi, PersonalRequestOptions } from './personal-api'

export const CAPABILITY_CATALOG_VERSION = 'vio-capability-catalog/v1' as const
export const CAPABILITY_EXECUTION_VERSION = 'vio-capability-execution/v1' as const
export const CAPABILITY_EXECUTION_LIST_VERSION = 'vio-capability-execution-list/v1' as const
export const SKILL_VERSION = 'vio-skill/v1' as const
export const PLUGIN_VERSION = 'vio-plugin/v1' as const

export type CapabilityCategory = 'model_api' | 'local_tool' | 'mcp_tool' | 'skill' | 'plugin_action'
export type ExecutableCapabilityCategory = Exclude<CapabilityCategory, 'model_api'>
export type CapabilityItem = {
  capabilityId: string
  category: CapabilityCategory
  name: string
  version: string
  status: 'enabled' | 'disabled'
  lifecycleStatus: 'installed' | 'enabled' | 'disabled' | 'uninstalled'
  operations: string[]
  externalCall: 'not_performed'
}
export type CapabilityCatalog = { schemaVersion: typeof CAPABILITY_CATALOG_VERSION; items: CapabilityItem[] }
export type CapabilityDiscovery = {
  snapshotId: string
  status: 'ready'
  toolCount: number
  tools: Array<{ name: string; description: string; inputSchemaHash: string; outputSchemaHash: string | null }>
  externalCall: 'performed'
}
export type CapabilityOperationResult = {
  operationStatus: 'completed' | 'confirmation_required' | 'denied' | 'failed' | 'outcome_unknown'
  capability: CapabilityItem | null
  discovery: CapabilityDiscovery | null
  security: {
    decision: 'allow' | 'confirm' | 'deny'
    confirmationId: string | null
    confirmationStatus: 'not_required' | 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired'
  }
  error: { code: string } | null
  externalCall: 'not_performed' | 'performed' | 'possibly_performed'
}
export type CapabilityDiscoveryRecovery = { status: 'found' | 'not_found'; operation: CapabilityOperationResult | null }
export type CapabilityExecutionStatus = 'waiting_confirmation' | 'prepared' | 'in_flight' | 'retryable' | 'outcome_unknown' | 'succeeded' | 'failed_terminal' | 'cancelled'
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type CapabilityExecution = {
  schemaVersion: typeof CAPABILITY_EXECUTION_VERSION
  executionId: string
  category: CapabilityCategory
  capabilityId: string
  capabilityVersion: string
  operationName: string
  status: CapabilityExecutionStatus
  attemptCount: number
  inputHash: string
  confirmation: { confirmationId: string; status: 'pending' } | null
  result: {
    status: 'succeeded'
    contentHash: string
    output: { [key: string]: JsonValue }
    usage: { status: string; inputTokens: number; outputTokens: number; totalTokens: number }
    cost: { status: string; amountMicros: number | null; currency: string | null }
  } | null
  error: { code: string } | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  externalCall: 'not_performed' | 'performed' | 'possibly_performed'
}
export type CapabilityExecutionList = { schemaVersion: typeof CAPABILITY_EXECUTION_LIST_VERSION; items: CapabilityExecution[]; nextCursor: string | null }
export type CapabilityExecutionRecovery = { status: 'found' | 'not_found'; execution: CapabilityExecution | null }
export type SkillStepInput = { stepId: string; category: 'local_tool' | 'mcp_tool'; capabilityId: string; operationName: string }

const categories = ['model_api', 'local_tool', 'mcp_tool', 'skill', 'plugin_action'] as const
const executionCategories = ['local_tool', 'mcp_tool', 'skill', 'plugin_action'] as const
const executionStatuses = ['waiting_confirmation', 'prepared', 'in_flight', 'retryable', 'outcome_unknown', 'succeeded', 'failed_terminal', 'cancelled'] as const
const externalCalls = ['not_performed', 'performed', 'possibly_performed'] as const

function invalid(): never { throw new ApiClientError('Invalid R6 capability response', { code: 'invalid_response', status: null }) }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown> }
function exact(value: unknown, keys: readonly string[]) { const item = record(value); if (Object.keys(item).length !== keys.length || Object.keys(item).some((key) => !keys.includes(key))) invalid(); return item }
function text(value: unknown, max = 256, empty = false) { if (typeof value !== 'string' || value.length > max || (!empty && value.length === 0)) invalid(); return value }
function id(value: unknown) { const result = text(value, 256); if (!/^[A-Za-z0-9._:-]+$/.test(result)) invalid(); return result }
function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] { if (typeof value !== 'string' || !values.includes(value)) invalid(); return value as T[number] }
function integer(value: unknown, min = 0) { if (!Number.isSafeInteger(value) || Number(value) < min) invalid(); return Number(value) }
function hash(value: unknown) { const result = text(value, 71); if (!/^sha256:[a-f0-9]{64}$/.test(result)) invalid(); return result }
function instant(value: unknown) { const result = text(value, 40); if (!result.endsWith('Z') || !Number.isFinite(Date.parse(result))) invalid(); return result }
function nullableInstant(value: unknown) { return value === null ? null : instant(value) }
function nullableText(value: unknown, max = 128) { return value === null ? null : text(value, max) }

function parseJson(value: unknown, depth = 0): JsonValue {
  if (depth > 10) invalid()
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return value }
  if (Array.isArray(value)) return value.map((entry) => parseJson(entry, depth + 1))
  const item = record(value)
  const result: { [key: string]: JsonValue } = {}
  for (const [key, entry] of Object.entries(item)) {
    if (!key || key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key)) invalid()
    result[key] = parseJson(entry, depth + 1)
  }
  return result
}

export function parseCapabilityItem(value: unknown): CapabilityItem {
  const item = exact(value, ['capabilityId', 'category', 'name', 'version', 'status', 'lifecycleStatus', 'operations', 'externalCall'])
  if (!Array.isArray(item.operations) || item.operations.length > 64) invalid()
  const operations = item.operations.map((operation) => id(operation))
  if (new Set(operations).size !== operations.length) invalid()
  return {
    capabilityId: id(item.capabilityId), category: oneOf(item.category, categories), name: text(item.name, 256), version: text(item.version, 128),
    status: oneOf(item.status, ['enabled', 'disabled'] as const), lifecycleStatus: oneOf(item.lifecycleStatus, ['installed', 'enabled', 'disabled', 'uninstalled'] as const),
    operations, externalCall: oneOf(item.externalCall, ['not_performed'] as const),
  }
}

export function parseCapabilityCatalog(value: unknown): CapabilityCatalog {
  const item = exact(value, ['schemaVersion', 'items'])
  if (!Array.isArray(item.items) || item.items.length > 500) invalid()
  return { schemaVersion: oneOf(item.schemaVersion, [CAPABILITY_CATALOG_VERSION] as const), items: item.items.map(parseCapabilityItem) }
}

function parseDiscovery(value: unknown): CapabilityDiscovery {
  const item = exact(value, ['snapshotId', 'status', 'toolCount', 'tools', 'externalCall'])
  if (!Array.isArray(item.tools) || item.tools.length > 500) invalid()
  const tools = item.tools.map((value) => { const tool = exact(value, ['name', 'description', 'inputSchemaHash', 'outputSchemaHash']); return { name: id(tool.name), description: text(tool.description, 4000, true), inputSchemaHash: hash(tool.inputSchemaHash), outputSchemaHash: tool.outputSchemaHash === null ? null : hash(tool.outputSchemaHash) } })
  const toolCount = integer(item.toolCount)
  if (toolCount !== tools.length) invalid()
  return { snapshotId: id(item.snapshotId), status: oneOf(item.status, ['ready'] as const), toolCount, tools, externalCall: oneOf(item.externalCall, ['performed'] as const) }
}

export function parseCapabilityOperation(value: unknown): CapabilityOperationResult {
  const item = exact(value, ['operationStatus', 'capability', 'discovery', 'security', 'error', 'externalCall'])
  const operationStatus = oneOf(item.operationStatus, ['completed', 'confirmation_required', 'denied', 'failed', 'outcome_unknown'] as const)
  const capability = item.capability === null ? null : parseCapabilityItem(item.capability)
  const discovery = item.discovery === null ? null : parseDiscovery(item.discovery)
  const rawSecurity = exact(item.security, ['decision', 'confirmationId', 'confirmationStatus'])
  const security = {
    decision: oneOf(rawSecurity.decision, ['allow', 'confirm', 'deny'] as const),
    confirmationId: rawSecurity.confirmationId === null ? null : id(rawSecurity.confirmationId),
    confirmationStatus: oneOf(rawSecurity.confirmationStatus, ['not_required', 'pending', 'approved', 'rejected', 'consumed', 'expired'] as const),
  }
  const error = item.error === null ? null : (() => { const entry = exact(item.error, ['code']); return { code: id(entry.code) } })()
  const externalCall = oneOf(item.externalCall, externalCalls)
  if (operationStatus === 'confirmation_required') {
    if (capability || discovery || error || externalCall !== 'not_performed' || security.decision !== 'confirm' || !security.confirmationId || security.confirmationStatus !== 'pending') invalid()
  } else if (operationStatus === 'denied') {
    if (capability || discovery || error || externalCall !== 'not_performed' || security.decision !== 'deny' || security.confirmationId || security.confirmationStatus !== 'not_required') invalid()
  } else if (operationStatus === 'completed') {
    if ((capability === null) === (discovery === null) || error || security.decision === 'deny' || security.confirmationStatus === 'pending' || (discovery ? externalCall !== 'performed' : externalCall !== 'not_performed')) invalid()
  } else if (capability || discovery || !error || security.decision !== 'allow' || security.confirmationStatus === 'pending'
    || (operationStatus === 'outcome_unknown' ? externalCall !== 'possibly_performed' : externalCall === 'possibly_performed')) invalid()
  return { operationStatus, capability, discovery, security, error, externalCall }
}

export function parseCapabilityDiscoveryRecovery(value: unknown): CapabilityDiscoveryRecovery {
  const item = exact(value, ['status', 'operation'])
  const status = oneOf(item.status, ['found', 'not_found'] as const)
  const operation = item.operation === null ? null : parseCapabilityOperation(item.operation)
  if ((status === 'found') !== Boolean(operation)) invalid()
  return { status, operation }
}

function parseExecutionResult(value: unknown): NonNullable<CapabilityExecution['result']> {
  const item = exact(value, ['status', 'contentHash', 'output', 'usage', 'cost'])
  const output = parseJson(item.output)
  if (!output || typeof output !== 'object' || Array.isArray(output) || JSON.stringify(output).length > 262_144) invalid()
  const usage = exact(item.usage, ['status', 'inputTokens', 'outputTokens', 'totalTokens'])
  const cost = exact(item.cost, ['status', 'amountMicros', 'currency'])
  const parsedUsage = { status: id(usage.status), inputTokens: integer(usage.inputTokens), outputTokens: integer(usage.outputTokens), totalTokens: integer(usage.totalTokens) }
  if (parsedUsage.inputTokens + parsedUsage.outputTokens !== parsedUsage.totalTokens) invalid()
  return {
    status: oneOf(item.status, ['succeeded'] as const), contentHash: hash(item.contentHash), output: output as { [key: string]: JsonValue }, usage: parsedUsage,
    cost: { status: id(cost.status), amountMicros: cost.amountMicros === null ? null : integer(cost.amountMicros), currency: nullableText(cost.currency, 12) },
  }
}

export function parseCapabilityExecution(value: unknown): CapabilityExecution {
  const item = exact(value, ['schemaVersion', 'executionId', 'category', 'capabilityId', 'capabilityVersion', 'operationName', 'status', 'attemptCount', 'inputHash', 'confirmation', 'result', 'error', 'createdAt', 'updatedAt', 'completedAt', 'externalCall'])
  const status = oneOf(item.status, executionStatuses)
  const confirmation = item.confirmation === null ? null : (() => { const entry = exact(item.confirmation, ['confirmationId', 'status']); return { confirmationId: id(entry.confirmationId), status: oneOf(entry.status, ['pending'] as const) } })()
  const result = item.result === null ? null : parseExecutionResult(item.result)
  const error = item.error === null ? null : (() => { const entry = exact(item.error, ['code']); return { code: id(entry.code) } })()
  const completedAt = nullableInstant(item.completedAt)
  if (status === 'waiting_confirmation' ? !confirmation || result || error || completedAt : confirmation) invalid()
  if (status === 'succeeded' ? !result || error || !completedAt : result) invalid()
  if (['failed_terminal', 'cancelled'].includes(status) && !completedAt) invalid()
  const externalCall = oneOf(item.externalCall, externalCalls)
  if ((status === 'outcome_unknown') !== (externalCall === 'possibly_performed')) invalid()
  return {
    schemaVersion: oneOf(item.schemaVersion, [CAPABILITY_EXECUTION_VERSION] as const), executionId: id(item.executionId), category: oneOf(item.category, categories),
    capabilityId: id(item.capabilityId), capabilityVersion: text(item.capabilityVersion, 128), operationName: id(item.operationName), status, attemptCount: integer(item.attemptCount),
    inputHash: hash(item.inputHash), confirmation, result, error, createdAt: instant(item.createdAt), updatedAt: instant(item.updatedAt), completedAt,
    externalCall,
  }
}

export function parseCapabilityExecutionList(value: unknown): CapabilityExecutionList {
  const item = exact(value, ['schemaVersion', 'items', 'nextCursor'])
  if (!Array.isArray(item.items) || item.items.length > 100) invalid()
  return { schemaVersion: oneOf(item.schemaVersion, [CAPABILITY_EXECUTION_LIST_VERSION] as const), items: item.items.map(parseCapabilityExecution), nextCursor: item.nextCursor === null ? null : id(item.nextCursor) }
}

export function parseCapabilityExecutionRecovery(value: unknown): CapabilityExecutionRecovery {
  const item = exact(value, ['status', 'execution'])
  const status = oneOf(item.status, ['found', 'not_found'] as const)
  const execution = item.execution === null ? null : parseCapabilityExecution(item.execution)
  if ((status === 'found') !== Boolean(execution)) invalid()
  return { status, execution }
}

export function parseExecutionInput(textValue: string): { [key: string]: JsonValue } {
  if (!textValue.trim() || textValue.length > 65_536) throw new Error('输入必须是 1–65536 字符的 JSON 对象。')
  let value: unknown
  try { value = JSON.parse(textValue) } catch { throw new Error('输入必须是有效 JSON 对象。') }
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('输入必须是 JSON 对象。')
  return parsed as { [key: string]: JsonValue }
}

function filters(filters: { category?: CapabilityCategory | ''; status?: CapabilityExecutionStatus | ''; cursor?: string; limit?: number }) {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.status) params.set('status', filters.status)
  if (filters.cursor) params.set('cursor', filters.cursor)
  params.set('limit', String(filters.limit ?? 50))
  return params.toString()
}

export function createPersonalCapabilityApi(api: PersonalApi) {
  return {
    async catalog(options?: PersonalRequestOptions) { return parseCapabilityCatalog(await api.request('/capabilities', 'GET', undefined, options)) },
    async installLocalTool(definitionId: 'builtin.text.inspect/v1', confirmationId: string | null, key: string, options?: PersonalRequestOptions) { return parseCapabilityOperation(await api.request('/capabilities/local-tools', 'POST', { definitionId, ...(confirmationId ? { confirmationId } : {}) }, { ...options, idempotencyKey: key })) },
    async installMcp(input: { name: string; serviceUrl: string; description: string; acknowledgeTrustedEndpoint: true }, confirmationId: string | null, key: string, options?: PersonalRequestOptions) { return parseCapabilityOperation(await api.request('/capabilities/mcp-servers', 'POST', { ...input, trustMode: 'explicit_https', ...(confirmationId ? { confirmationId } : {}) }, { ...options, idempotencyKey: key })) },
    async discoverMcp(capabilityId: string, confirmationId: string | null, key: string, options?: PersonalRequestOptions) { return parseCapabilityOperation(await api.request(`/capabilities/mcp-servers/${encodeURIComponent(capabilityId)}/discovery`, 'POST', confirmationId ? { confirmationId } : {}, { ...options, idempotencyKey: key })) },
    async discoveryByKey(capabilityId: string, key: string, options?: PersonalRequestOptions) { return parseCapabilityDiscoveryRecovery(await api.request(`/capabilities/mcp-servers/${encodeURIComponent(capabilityId)}/discovery/by-idempotency-key/${encodeURIComponent(key)}`, 'GET', undefined, options)) },
    async installSkill(input: { name: string; version: string; description: string; steps: SkillStepInput[] }, confirmationId: string | null, key: string, options?: PersonalRequestOptions) { return parseCapabilityOperation(await api.request('/capabilities/skills', 'POST', { schemaVersion: SKILL_VERSION, ...input, ...(confirmationId ? { confirmationId } : {}) }, { ...options, idempotencyKey: key })) },
    async installPlugin(input: { name: string; version: string; description: string; actions: Array<{ actionId: string; skillId: string }> }, confirmationId: string | null, key: string, options?: PersonalRequestOptions) { return parseCapabilityOperation(await api.request('/capabilities/plugins', 'POST', { schemaVersion: PLUGIN_VERSION, ...input, ...(confirmationId ? { confirmationId } : {}) }, { ...options, idempotencyKey: key })) },
    async pluginLifecycle(capabilityId: string, action: 'enable' | 'disable' | 'uninstall', confirmationId: string | null, key: string, options?: PersonalRequestOptions) { return parseCapabilityOperation(await api.request(`/capabilities/plugins/${encodeURIComponent(capabilityId)}/lifecycle`, 'POST', { action, ...(confirmationId ? { confirmationId } : {}) }, { ...options, idempotencyKey: key })) },
    async executions(query: { category?: CapabilityCategory | ''; status?: CapabilityExecutionStatus | ''; cursor?: string; limit?: number } = {}, options?: PersonalRequestOptions) { return parseCapabilityExecutionList(await api.request(`/capability-executions?${filters(query)}`, 'GET', undefined, options)) },
    async execution(executionId: string, options?: PersonalRequestOptions) { return parseCapabilityExecution(await api.request(`/capability-executions/${encodeURIComponent(executionId)}`, 'GET', undefined, options)) },
    async executionByKey(key: string, options?: PersonalRequestOptions) { return parseCapabilityExecutionRecovery(await api.request(`/capability-executions/by-idempotency-key/${encodeURIComponent(key)}`, 'GET', undefined, options)) },
    async execute(input: { category: ExecutableCapabilityCategory; capabilityId: string; operationName: string; input: { [key: string]: JsonValue } }, key: string, options?: PersonalRequestOptions) { return parseCapabilityExecution(await api.request('/capability-executions', 'POST', input, { ...options, idempotencyKey: key })) },
    async recover(executionId: string, action: 'resume' | 'retry' | 'cancel', confirmationId: string | null, key: string, options?: PersonalRequestOptions) { return parseCapabilityExecution(await api.request(`/capability-executions/${encodeURIComponent(executionId)}/recovery`, 'POST', { action, ...(confirmationId ? { confirmationId } : {}) }, { ...options, idempotencyKey: key })) },
    decide(confirmationId: string, decision: 'approve' | 'reject', options?: PersonalRequestOptions) { return api.request(`/confirmations/${encodeURIComponent(confirmationId)}/decision`, 'POST', { decision }, options) },
  }
}

export type PersonalCapabilityApi = ReturnType<typeof createPersonalCapabilityApi>
