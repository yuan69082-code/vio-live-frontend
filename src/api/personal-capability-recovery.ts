export type CapabilityRecoveryFact = { version: 1; idempotencyKey: string; executionId: string | null }
export type CapabilityDiscoveryRecoveryFact = { version: 1; idempotencyKey: string; capabilityId: string }

const prefix = 'vio:personal:capability-execution:'
const discoveryPrefix = 'vio:personal:capability-discovery:'
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/
const idPattern = /^[A-Za-z0-9._:-]{1,256}$/

function storageKey(ownerId: string, assistantId: string) { return `${prefix}${encodeURIComponent(ownerId)}:${encodeURIComponent(assistantId)}` }
function discoveryStorageKey(ownerId: string, assistantId: string) { return `${discoveryPrefix}${encodeURIComponent(ownerId)}:${encodeURIComponent(assistantId)}` }

export function readCapabilityRecovery(storage: Storage | null, ownerId: string, assistantId: string): CapabilityRecoveryFact | null {
  if (!storage || !ownerId || !assistantId) return null
  try {
    const raw = storage.getItem(storageKey(ownerId, assistantId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<CapabilityRecoveryFact>
    if (value.version !== 1 || typeof value.idempotencyKey !== 'string' || !keyPattern.test(value.idempotencyKey)
      || (value.executionId !== null && (typeof value.executionId !== 'string' || !idPattern.test(value.executionId)))) return null
    return { version: 1, idempotencyKey: value.idempotencyKey, executionId: value.executionId }
  } catch { return null }
}

export function writeCapabilityRecovery(storage: Storage | null, ownerId: string, assistantId: string, fact: CapabilityRecoveryFact) {
  if (!storage || !ownerId || !assistantId || !keyPattern.test(fact.idempotencyKey) || (fact.executionId !== null && !idPattern.test(fact.executionId))) return
  try { storage.setItem(storageKey(ownerId, assistantId), JSON.stringify(fact)) } catch { /* storage can be unavailable */ }
}

export function clearCapabilityRecovery(storage: Storage | null, ownerId: string, assistantId: string, expectedKey?: string) {
  if (!storage || !ownerId || !assistantId) return
  try {
    if (expectedKey) {
      const current = readCapabilityRecovery(storage, ownerId, assistantId)
      if (current?.idempotencyKey !== expectedKey) return
    }
    storage.removeItem(storageKey(ownerId, assistantId))
  } catch { /* storage can be unavailable */ }
}

export function readCapabilityDiscoveryRecovery(storage: Storage | null, ownerId: string, assistantId: string): CapabilityDiscoveryRecoveryFact | null {
  if (!storage || !ownerId || !assistantId) return null
  try {
    const raw = storage.getItem(discoveryStorageKey(ownerId, assistantId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<CapabilityDiscoveryRecoveryFact>
    if (value.version !== 1 || typeof value.idempotencyKey !== 'string' || !keyPattern.test(value.idempotencyKey)
      || typeof value.capabilityId !== 'string' || !idPattern.test(value.capabilityId)) return null
    return { version: 1, idempotencyKey: value.idempotencyKey, capabilityId: value.capabilityId }
  } catch { return null }
}

export function writeCapabilityDiscoveryRecovery(storage: Storage | null, ownerId: string, assistantId: string, fact: CapabilityDiscoveryRecoveryFact) {
  if (!storage || !ownerId || !assistantId || !keyPattern.test(fact.idempotencyKey) || !idPattern.test(fact.capabilityId)) return
  try { storage.setItem(discoveryStorageKey(ownerId, assistantId), JSON.stringify(fact)) } catch { /* storage can be unavailable */ }
}

export function clearCapabilityDiscoveryRecovery(storage: Storage | null, ownerId: string, assistantId: string, expectedKey?: string) {
  if (!storage || !ownerId || !assistantId) return
  try {
    if (expectedKey) {
      const current = readCapabilityDiscoveryRecovery(storage, ownerId, assistantId)
      if (current?.idempotencyKey !== expectedKey) return
    }
    storage.removeItem(discoveryStorageKey(ownerId, assistantId))
  } catch { /* storage can be unavailable */ }
}

export function clearCapabilityRecoveryForOwner(storage: Storage | null, ownerId: string) {
  if (!storage || !ownerId) return
  const ownerPrefix = `${prefix}${encodeURIComponent(ownerId)}:`
  const discoveryOwnerPrefix = `${discoveryPrefix}${encodeURIComponent(ownerId)}:`
  try {
    const keys: string[] = []
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith(ownerPrefix) || key?.startsWith(discoveryOwnerPrefix)) keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
  } catch { /* storage can be unavailable */ }
}
