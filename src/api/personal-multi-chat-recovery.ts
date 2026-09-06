export type MultiChatRecoveryFact = {
  version: 1
  idempotencyKey: string
  operationType: string
  conversationId?: string
  branchId?: string
  turnId?: string
  messageId?: string
  messageVersionId?: string
  attachmentId?: string
  confirmationId?: string
  statusBefore?: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
const PREFIX = 'vio:personal:chat:r3:recovery:v1:'
const KEY = /^vio-r3-[a-f0-9-]+$/
const ID = /^[^\s]{1,512}$/
const OPERATION = /^[a-z][a-z0-9_.-]{1,80}$/

function storageKey(ownerId: string, assistantId: string) {
  return `${PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(assistantId)}`
}

function valid(value: unknown): value is MultiChatRecoveryFact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (item.version !== 1 || !KEY.test(String(item.idempotencyKey)) || !OPERATION.test(String(item.operationType))) return false
  if (!Object.keys(item).every((key) => ['version', 'idempotencyKey', 'operationType', 'conversationId', 'branchId', 'turnId', 'messageId', 'messageVersionId', 'attachmentId', 'confirmationId', 'statusBefore'].includes(key))) return false
  return ['conversationId', 'branchId', 'turnId', 'messageId', 'messageVersionId', 'attachmentId', 'confirmationId', 'statusBefore'].every((key) => item[key] === undefined || ID.test(String(item[key])))
}

export function readMultiChatRecovery(storage: StorageLike | null, ownerId: string, assistantId: string) {
  if (!storage || !ownerId || !assistantId) return null
  const key = storageKey(ownerId, assistantId)
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!valid(value)) { storage.removeItem(key); return null }
    return value
  } catch { return null }
}

export function writeMultiChatRecovery(storage: StorageLike | null, ownerId: string, assistantId: string, fact: MultiChatRecoveryFact) {
  if (!storage || !ownerId || !assistantId || !valid(fact)) return
  try { storage.setItem(storageKey(ownerId, assistantId), JSON.stringify(fact)) } catch { /* recovery index is best effort */ }
}

export function clearMultiChatRecovery(storage: StorageLike | null, ownerId: string, assistantId: string) {
  try { storage?.removeItem(storageKey(ownerId, assistantId)) } catch { /* storage unavailable */ }
}

export function clearMultiChatRecoveryForOwner(storage: StorageLike | null, ownerId: string) {
  if (!storage || !ownerId) return
  const prefix = `${PREFIX}${encodeURIComponent(ownerId)}:`
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)))
    keys.forEach((key) => storage.removeItem(key))
  } catch { /* storage unavailable */ }
}
