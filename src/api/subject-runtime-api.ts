import { ApiClientError, apiClient } from './client'
import type { ApiSuccessEnvelope, RequestOptions } from './types'

export const SUBJECT_RUNTIME_PORT_VERSION = 'vio-subject-runtime-port/v1' as const

const runtimeModes = ['none', 'external'] as const
const adapterKinds = ['none', 'continuity_engine', 'third_party'] as const
const connectionStates = [
  'disconnected',
  'connecting',
  'ready',
  'degraded',
  'incompatible',
  'paused',
  'reconnecting',
] as const
const runtimeStatuses = [
  'not_configured',
  'disconnected',
  'connecting',
  'available',
  'degraded',
  'incompatible',
  'paused',
] as const
const runtimeCapabilities = [
  'observation_input',
  'expression_result',
  'state_projection',
  'cancellation',
  'recovery',
] as const
const negotiationStatuses = ['compatible', 'incompatible'] as const

export type SubjectRuntimeMode = (typeof runtimeModes)[number]
export type SubjectRuntimeAdapterKind = (typeof adapterKinds)[number]
export type SubjectRuntimeConnectionState = (typeof connectionStates)[number]
export type SubjectRuntimeStatusValue = (typeof runtimeStatuses)[number]
export type SubjectRuntimeCapability = (typeof runtimeCapabilities)[number]
export type SubjectRuntimeNegotiationStatus = (typeof negotiationStatuses)[number]

export type SubjectRuntimeVersionNegotiation = {
  portVersion: typeof SUBJECT_RUNTIME_PORT_VERSION
  adapterId: string
  status: SubjectRuntimeNegotiationStatus
  selectedVersion: typeof SUBJECT_RUNTIME_PORT_VERSION | null
  reason: 'version_match' | 'no_common_port_version'
}

export type SubjectRuntimeStatus = {
  portVersion: typeof SUBJECT_RUNTIME_PORT_VERSION
  mode: SubjectRuntimeMode
  adapterId: string
  adapterKind: SubjectRuntimeAdapterKind
  adapterVersion: string
  state: SubjectRuntimeConnectionState
  platformStatus: 'available'
  runtimeStatus: SubjectRuntimeStatusValue
  runtimeName: string | null
  runtimeVersion: string | null
  capabilities: SubjectRuntimeCapability[]
  reason: string | null
  versionNegotiation: SubjectRuntimeVersionNegotiation
  externalCall: 'not_performed'
}

export type SubjectRuntimeStatusRead = {
  status: SubjectRuntimeStatus
  readAt: string
}

export type SubjectRuntimeApiErrorCode =
  | 'backend_unavailable'
  | 'timeout'
  | 'cancelled'
  | 'incompatible_response'

export class SubjectRuntimeApiError extends Error {
  readonly code: SubjectRuntimeApiErrorCode

  constructor(message: string, code: SubjectRuntimeApiErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SubjectRuntimeApiError'
    this.code = code
  }
}

type RequestClient = {
  request<T>(path: string, options?: RequestOptions): Promise<ApiSuccessEnvelope<T>>
}

const identifierPattern = /^[a-z][a-z0-9._-]{1,127}$/
const utcPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/

function incompatible(path: string, message: string): never {
  throw new SubjectRuntimeApiError(
    `Subject runtime status response is incompatible at ${path}: ${message}.`,
    'incompatible_response',
  )
}

function exactObject(value: unknown, path: string, fields: readonly string[]) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    incompatible(path, 'must be an object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    incompatible(path, 'must be a plain object')
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) {
    incompatible(path, 'must not contain symbol fields')
  }
  const allowed = new Set(fields)
  const unknown = keys.filter((key) => typeof key === 'string' && !allowed.has(key))
  const missing = fields.filter((field) => !Object.hasOwn(value, field))
  if (unknown.length > 0 || missing.length > 0) {
    incompatible(path, [
      missing.length > 0 ? `missing ${missing.join(', ')}` : null,
      unknown.length > 0 ? `unknown ${unknown.join(', ')}` : null,
    ].filter(Boolean).join('; '))
  }
  return value as Record<string, unknown>
}

function text(value: unknown, path: string, maximum = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    incompatible(path, `must be a non-empty string no longer than ${maximum} characters`)
  }
  return value
}

function nullableText(value: unknown, path: string, maximum = 128) {
  return value === null ? null : text(value, path, maximum)
}

function oneOf<const T extends readonly string[]>(value: unknown, path: string, values: T): T[number] {
  if (typeof value !== 'string' || !values.includes(value as T[number])) {
    incompatible(path, `must be one of ${values.join(', ')}`)
  }
  return value as T[number]
}

function identifier(value: unknown, path: string) {
  const parsed = text(value, path)
  if (!identifierPattern.test(parsed)) incompatible(path, 'must be a valid identifier')
  return parsed
}

function utcTimestamp(value: unknown, path: string) {
  const parsed = text(value, path, 64)
  const match = utcPattern.exec(parsed)
  if (!match) incompatible(path, 'must be an RFC 3339 UTC timestamp')
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number)
  const [year, month, day, hour, minute, second] = parts
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    incompatible(path, 'must be a real RFC 3339 UTC timestamp')
  }
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || calendar.getUTCHours() !== hour
    || calendar.getUTCMinutes() !== minute
    || calendar.getUTCSeconds() !== second
  ) {
    incompatible(path, 'must be a real RFC 3339 UTC timestamp')
  }
  return parsed
}

function parseCapabilities(value: unknown) {
  if (!Array.isArray(value)) incompatible('$.data.capabilities', 'must be an array')
  const parsed = value.map((item, index) => oneOf(
    item,
    `$.data.capabilities[${index}]`,
    runtimeCapabilities,
  ))
  if (new Set(parsed).size !== parsed.length) {
    incompatible('$.data.capabilities', 'must not contain duplicates')
  }
  return parsed
}

function parseNegotiation(value: unknown, adapterId: string) {
  const record = exactObject(value, '$.data.versionNegotiation', [
    'portVersion',
    'adapterId',
    'status',
    'selectedVersion',
    'reason',
  ])
  if (record.portVersion !== SUBJECT_RUNTIME_PORT_VERSION) {
    incompatible('$.data.versionNegotiation.portVersion', `must be ${SUBJECT_RUNTIME_PORT_VERSION}`)
  }
  if (record.adapterId !== adapterId) {
    incompatible('$.data.versionNegotiation.adapterId', 'must match the status adapterId')
  }
  const status = oneOf(record.status, '$.data.versionNegotiation.status', negotiationStatuses)
  if (status === 'compatible') {
    if (
      record.selectedVersion !== SUBJECT_RUNTIME_PORT_VERSION
      || record.reason !== 'version_match'
    ) {
      incompatible('$.data.versionNegotiation', 'compatible negotiation must select this port version')
    }
  } else if (record.selectedVersion !== null || record.reason !== 'no_common_port_version') {
    incompatible('$.data.versionNegotiation', 'incompatible negotiation must have no selected version')
  }
  return {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId,
    status,
    selectedVersion: status === 'compatible' ? SUBJECT_RUNTIME_PORT_VERSION : null,
    reason: status === 'compatible' ? 'version_match' : 'no_common_port_version',
  } satisfies SubjectRuntimeVersionNegotiation
}

function parseStatus(value: unknown): SubjectRuntimeStatus {
  const record = exactObject(value, '$.data', [
    'portVersion',
    'mode',
    'adapterId',
    'adapterKind',
    'adapterVersion',
    'state',
    'platformStatus',
    'runtimeStatus',
    'runtimeName',
    'runtimeVersion',
    'capabilities',
    'reason',
    'versionNegotiation',
    'externalCall',
  ])
  if (record.portVersion !== SUBJECT_RUNTIME_PORT_VERSION) {
    incompatible('$.data.portVersion', `must be ${SUBJECT_RUNTIME_PORT_VERSION}`)
  }
  const mode = oneOf(record.mode, '$.data.mode', runtimeModes)
  const adapterId = identifier(record.adapterId, '$.data.adapterId')
  const adapterKind = oneOf(record.adapterKind, '$.data.adapterKind', adapterKinds)
  const adapterVersion = text(record.adapterVersion, '$.data.adapterVersion')
  const state = oneOf(record.state, '$.data.state', connectionStates)
  if (record.platformStatus !== 'available') {
    incompatible('$.data.platformStatus', 'must be available')
  }
  const runtimeStatus = oneOf(record.runtimeStatus, '$.data.runtimeStatus', runtimeStatuses)
  const runtimeName = nullableText(record.runtimeName, '$.data.runtimeName')
  const runtimeVersion = nullableText(record.runtimeVersion, '$.data.runtimeVersion')
  const capabilities = parseCapabilities(record.capabilities)
  const reason = nullableText(record.reason, '$.data.reason', 256)
  const versionNegotiation = parseNegotiation(record.versionNegotiation, adapterId)
  if (record.externalCall !== 'not_performed') {
    incompatible('$.data.externalCall', 'must be not_performed')
  }

  const expectedRuntimeStatus: Record<SubjectRuntimeConnectionState, SubjectRuntimeStatusValue> = {
    disconnected: mode === 'none' ? 'not_configured' : 'disconnected',
    connecting: 'connecting',
    ready: 'available',
    degraded: 'degraded',
    incompatible: 'incompatible',
    paused: 'paused',
    reconnecting: 'connecting',
  }
  if (runtimeStatus !== expectedRuntimeStatus[state]) {
    incompatible('$.data.runtimeStatus', 'must match mode and connection state')
  }
  if ((state === 'incompatible') !== (versionNegotiation.status === 'incompatible')) {
    incompatible('$.data.state', 'must be incompatible exactly when negotiation is incompatible')
  }

  if (mode === 'none') {
    if (
      adapterId !== 'none'
      || adapterKind !== 'none'
      || state !== 'disconnected'
      || runtimeName !== null
      || runtimeVersion !== null
      || capabilities.length !== 0
    ) {
      incompatible('$.data', 'None Adapter fields must describe a disconnected unconfigured runtime')
    }
  } else {
    if (adapterKind === 'none' || adapterId === 'none' || runtimeName === null) {
      incompatible('$.data', 'external mode requires a named external adapter and runtime')
    }
    if (adapterKind === 'continuity_engine' && adapterId !== 'continuity-engine') {
      incompatible('$.data.adapterId', 'Continuity Engine adapter must use continuity-engine')
    }
    if (
      adapterKind === 'third_party'
      && (adapterId === 'none' || adapterId === 'continuity-engine')
    ) {
      incompatible('$.data.adapterId', 'third-party adapters must not use reserved identifiers')
    }
    if (!capabilities.includes('observation_input') || !capabilities.includes('expression_result')) {
      incompatible('$.data.capabilities', 'external adapters must expose observation and expression capabilities')
    }
    if ((state === 'ready' || state === 'degraded') && runtimeVersion === null) {
      incompatible('$.data.runtimeVersion', `${state} requires a runtime version`)
    }
  }

  return {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    mode,
    adapterId,
    adapterKind,
    adapterVersion,
    state,
    platformStatus: 'available',
    runtimeStatus,
    runtimeName,
    runtimeVersion,
    capabilities: [...capabilities],
    reason,
    versionNegotiation,
    externalCall: 'not_performed',
  }
}

function parseEnvelope(value: ApiSuccessEnvelope<unknown>): SubjectRuntimeStatusRead {
  const envelope = exactObject(value, '$', ['success', 'data', 'error', 'timestamp'])
  if (envelope.success !== true || envelope.error !== null) {
    incompatible('$', 'must be a successful standard API envelope')
  }
  return {
    status: parseStatus(envelope.data),
    readAt: utcTimestamp(envelope.timestamp, '$.timestamp'),
  }
}

function mapError(error: unknown): SubjectRuntimeApiError {
  if (error instanceof SubjectRuntimeApiError) return error
  if (error instanceof ApiClientError) {
    if (error.code === 'request_timeout') {
      return new SubjectRuntimeApiError('Subject runtime status request timed out.', 'timeout', { cause: error })
    }
    if (error.code === 'request_aborted') {
      return new SubjectRuntimeApiError('Subject runtime status request was cancelled.', 'cancelled', { cause: error })
    }
    if (error.code === 'invalid_response') {
      return new SubjectRuntimeApiError('Subject runtime status response is incompatible.', 'incompatible_response', { cause: error })
    }
    return new SubjectRuntimeApiError('Vio local backend is unavailable.', 'backend_unavailable', { cause: error })
  }
  return new SubjectRuntimeApiError('Subject runtime status response is incompatible.', 'incompatible_response', { cause: error })
}

export function createSubjectRuntimeApi(client: RequestClient = apiClient) {
  return {
    async getStatus(options: RequestOptions = {}): Promise<SubjectRuntimeStatusRead> {
      try {
        const envelope = await client.request<unknown>('/api/v1/subject-runtime/status', options)
        return parseEnvelope(envelope)
      } catch (error) {
        throw mapError(error)
      }
    },
  }
}

export type SubjectRuntimeApi = ReturnType<typeof createSubjectRuntimeApi>

export const subjectRuntimeApi = createSubjectRuntimeApi()
