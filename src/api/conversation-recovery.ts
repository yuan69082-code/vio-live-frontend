import { MAX_CONVERSATION_CONTENT_LENGTH } from './conversation-api'

export const PENDING_TURN_STORAGE_KEY = 'vio-live:conversation:pending-turn:v1'

export type PendingTurnFact = {
  version: 1
  idempotencyKey: string
  content?: string
  turnId?: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function isPendingTurnFact(value: unknown): value is PendingTurnFact {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const fact = value as Record<string, unknown>
  return (
    fact.version === 1
    && typeof fact.idempotencyKey === 'string'
    && /^vio-turn-[A-Za-z0-9._:-]+$/.test(fact.idempotencyKey)
    && (fact.content === undefined
      || (typeof fact.content === 'string' && fact.content.length <= MAX_CONVERSATION_CONTENT_LENGTH))
    && (fact.turnId === undefined || typeof fact.turnId === 'string')
    && (typeof fact.content === 'string' || typeof fact.turnId === 'string')
  )
}

export function readPendingTurn(storage: StorageLike | null): PendingTurnFact | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_TURN_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPendingTurnFact(parsed)) {
      storage.removeItem(PENDING_TURN_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writePendingTurn(storage: StorageLike | null, fact: PendingTurnFact) {
  if (!storage) return
  try {
    storage.setItem(PENDING_TURN_STORAGE_KEY, JSON.stringify(fact))
  } catch {
    // A blocked or full session store must not crash the conversation UI.
  }
}

export function clearPendingTurn(storage: StorageLike | null) {
  if (!storage) return
  try {
    storage.removeItem(PENDING_TURN_STORAGE_KEY)
  } catch {
    // A blocked session store must not crash the conversation UI.
  }
}
