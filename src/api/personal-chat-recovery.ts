export type PersonalChatRecoveryFact =
  | { version: 1; kind: 'turn'; idempotencyKey: string; turnId?: string }
  | { version: 1; kind: 'recovery'; idempotencyKey: string; turnId: string; action: 'resume' | 'retry' | 'cancel'; confirmationId?: string; statusBefore: string }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
const PREFIX = 'vio:personal:chat:recovery:v1:'
const KEY = /^vio-chat-[a-f0-9-]+$/

function storageKey(ownerId: string, assistantId: string) {
  return `${PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(assistantId)}`
}

function valid(value: unknown): value is PersonalChatRecoveryFact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (item.version !== 1 || !KEY.test(String(item.idempotencyKey))) return false
  if (item.kind === 'turn') return Object.keys(item).every((key) => ['version', 'kind', 'idempotencyKey', 'turnId'].includes(key)) && (item.turnId === undefined || typeof item.turnId === 'string')
  return Object.keys(item).every((key) => ['version', 'kind', 'idempotencyKey', 'turnId', 'action', 'confirmationId', 'statusBefore'].includes(key))
    && item.kind === 'recovery'
    && typeof item.turnId === 'string'
    && ['resume', 'retry', 'cancel'].includes(String(item.action))
    && typeof item.statusBefore === 'string'
    && (item.confirmationId === undefined || typeof item.confirmationId === 'string')
}

export function readPersonalChatRecovery(storage: StorageLike | null, ownerId: string, assistantId: string) {
  if (!storage) return null
  try {
    const raw = storage.getItem(storageKey(ownerId, assistantId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!valid(value)) { storage.removeItem(storageKey(ownerId, assistantId)); return null }
    return value
  } catch { return null }
}

export function writePersonalChatRecovery(storage: StorageLike | null, ownerId: string, assistantId: string, fact: PersonalChatRecoveryFact) {
  if (!storage) return
  try { storage.setItem(storageKey(ownerId, assistantId), JSON.stringify(fact)) } catch { /* recovery storage is best effort */ }
}

export function clearPersonalChatRecovery(storage: StorageLike | null, ownerId: string, assistantId: string) {
  try { storage?.removeItem(storageKey(ownerId, assistantId)) } catch { /* unavailable storage */ }
}

export function clearPersonalChatRecoveryForOwner(storage: StorageLike | null, ownerId: string) {
  if (!storage) return
  const prefix = `${PREFIX}${encodeURIComponent(ownerId)}:`
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)))
    keys.forEach((key) => storage.removeItem(key))
  } catch { /* unavailable storage */ }
}
