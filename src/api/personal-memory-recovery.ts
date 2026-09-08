import type { MemoryOperationType } from './personal-memory-api'

export type MemoryRecoveryFact = {
  version: 1
  idempotencyKey: string
  operationType: MemoryOperationType
  memoryId?: string
  referenceId?: string
  deletionId?: string
}

const prefix = 'vio:personal:memory:r5:recovery:v1:'
const operationTypes = new Set<MemoryOperationType>([
  'memory.create', 'memory.edit', 'memory.context_inclusion', 'memory.archive', 'memory.restore',
  'memory.reference.create', 'memory.reference.delete', 'memory.deletion.request', 'memory.deletion.cancel',
  'memory.deletion.finalize', 'memory.import', 'memory.export',
])

function storageKey(ownerId: string, assistantId: string) {
  return `${prefix}${encodeURIComponent(ownerId)}:${encodeURIComponent(assistantId)}`
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

export function createMemoryOperationKey() {
  return `vio-personal-${crypto.randomUUID()}`
}

export function readMemoryRecovery(storage: Storage | null, ownerId: string, assistantId: string): MemoryRecoveryFact | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(storageKey(ownerId, assistantId))
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    const allowed = new Set(['version', 'idempotencyKey', 'operationType', 'memoryId', 'referenceId', 'deletionId'])
    if (Object.keys(value).some((key) => !allowed.has(key)) || value.version !== 1
      || !validId(value.idempotencyKey) || !/^vio-personal-[a-f0-9-]+$/.test(value.idempotencyKey)
      || !operationTypes.has(value.operationType as MemoryOperationType)) return null
    for (const field of ['memoryId', 'referenceId', 'deletionId'] as const) {
      if (value[field] !== undefined && !validId(value[field])) return null
    }
    return value as MemoryRecoveryFact
  } catch { return null }
}

export function writeMemoryRecovery(storage: Storage | null, ownerId: string, assistantId: string, fact: MemoryRecoveryFact) {
  if (!storage) return
  const safe = readMemoryRecoveryFromValue(fact)
  if (!safe) throw new Error('Invalid memory recovery fact')
  try { storage.setItem(storageKey(ownerId, assistantId), JSON.stringify(safe)) } catch { /* in-memory request state remains authoritative */ }
}

function readMemoryRecoveryFromValue(value: MemoryRecoveryFact): MemoryRecoveryFact | null {
  if (value.version !== 1 || !/^vio-personal-[a-f0-9-]+$/.test(value.idempotencyKey) || !operationTypes.has(value.operationType)) return null
  for (const field of ['memoryId', 'referenceId', 'deletionId'] as const) {
    if (value[field] !== undefined && !validId(value[field])) return null
  }
  return { version: 1, idempotencyKey: value.idempotencyKey, operationType: value.operationType,
    ...(value.memoryId ? { memoryId: value.memoryId } : {}), ...(value.referenceId ? { referenceId: value.referenceId } : {}), ...(value.deletionId ? { deletionId: value.deletionId } : {}) }
}

export function clearMemoryRecovery(storage: Storage | null, ownerId: string, assistantId: string, expectedKey?: string) {
  if (!storage) return
  try {
    if (!expectedKey || readMemoryRecovery(storage, ownerId, assistantId)?.idempotencyKey === expectedKey) storage.removeItem(storageKey(ownerId, assistantId))
  } catch { /* storage is optional */ }
}

export function clearMemoryRecoveryForOwner(storage: Storage | null, ownerId: string) {
  if (!storage) return
  const ownerPrefix = `${prefix}${encodeURIComponent(ownerId)}:`
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(ownerPrefix)))
    keys.forEach((key) => storage.removeItem(key))
  } catch { /* storage is optional */ }
}
