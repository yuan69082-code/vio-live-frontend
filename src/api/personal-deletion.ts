import { ApiClientError } from './client'

export type DeletionStatus = {
  deletionId: string
  status: 'waiting' | 'processing' | 'cleanup_pending' | 'failed' | 'completed' | 'cancelled'
  requestedAt: string
  cancellableUntil: string
  serverTime: string
  onlineDeletedAt: string | null
  receiptExpiresAt: string | null
  backupDeadlineAt: string | null
  reason: string | null
  scope: { tableCount: number; rowCount: number; managedFileCount: number; managedBackupCount: number }
  onlineData: 'pending' | 'deleted'
  managedFiles: { status: 'pending' | 'completed'; remaining: number }
  managedBackups: { status: 'pending' | 'completed'; remaining: number }
  storage: { sqlite: 'pending' | 'logical_rows_deleted'; wal: 'pending' | 'checkpoint_completed' | 'checkpoint_pending'; physicalErasure: 'not_claimed'; userCopies: 'not_managed' }
  externalCall: 'not_performed'
  providerCharge: 'not_incurred'
}
export type DeletionAccess = { deletion: DeletionStatus; csrfToken: string }

function invalid(): never { throw new ApiClientError('Invalid deletion response', { code: 'invalid_response', status: null }) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function text(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 512) invalid(); return value }
function timestamp(value: unknown): string {
  const result = text(value)
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?Z$/.exec(result)
  const parsed = new Date(result)
  // Date.parse normalizes impossible dates (for example February 30); do not
  // let that silently change an authoritative server deadline.
  if (!parts || !Number.isFinite(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(parts[1]) || parsed.getUTCMonth() + 1 !== Number(parts[2]) ||
    parsed.getUTCDate() !== Number(parts[3]) || parsed.getUTCHours() !== Number(parts[4]) ||
    parsed.getUTCMinutes() !== Number(parts[5]) || parsed.getUTCSeconds() !== Number(parts[6])) invalid()
  return result
}
function optionalTime(value: unknown) { return value === null ? null : timestamp(value) }
function count(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value }
function choice<const T extends readonly string[]>(value: unknown, choices: T): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) invalid()
  return value as T[number]
}
function cleanup(value: unknown) {
  const item = record(value)
  const result = { status: choice(item.status, ['pending', 'completed'] as const), remaining: count(item.remaining) }
  if (result.status === 'completed' && result.remaining !== 0) invalid()
  return result
}

/** Project only the safe contract fields; never infer completed from browser time. */
export function parseDeletionAccess(value: unknown): DeletionAccess {
  const access = record(value); const item = record(access.deletion)
  const scope = record(item.scope); const storage = record(item.storage)
  const reason = item.reason === null ? null : text(item.reason)
  if (reason && !/^[a-zA-Z0-9_-]+$/.test(reason)) invalid()
  const deletion: DeletionStatus = {
    deletionId: text(item.deletionId), status: choice(item.status, ['waiting', 'processing', 'cleanup_pending', 'failed', 'completed', 'cancelled'] as const),
    requestedAt: timestamp(item.requestedAt), cancellableUntil: timestamp(item.cancellableUntil), serverTime: timestamp(item.serverTime),
    onlineDeletedAt: optionalTime(item.onlineDeletedAt), receiptExpiresAt: optionalTime(item.receiptExpiresAt), backupDeadlineAt: optionalTime(item.backupDeadlineAt), reason,
    scope: { tableCount: count(scope.tableCount), rowCount: count(scope.rowCount), managedFileCount: count(scope.managedFileCount), managedBackupCount: count(scope.managedBackupCount) },
    onlineData: choice(item.onlineData, ['pending', 'deleted'] as const), managedFiles: cleanup(item.managedFiles), managedBackups: cleanup(item.managedBackups),
    storage: { sqlite: choice(storage.sqlite, ['pending', 'logical_rows_deleted'] as const), wal: choice(storage.wal, ['pending', 'checkpoint_completed', 'checkpoint_pending'] as const), physicalErasure: choice(storage.physicalErasure, ['not_claimed'] as const), userCopies: choice(storage.userCopies, ['not_managed'] as const) },
    externalCall: choice(item.externalCall, ['not_performed'] as const), providerCharge: choice(item.providerCharge, ['not_incurred'] as const),
  }
  if (deletion.status === 'completed' && (deletion.onlineData !== 'deleted' || !deletion.onlineDeletedAt || deletion.managedFiles.status !== 'completed' || deletion.managedBackups.status !== 'completed' || deletion.storage.sqlite !== 'logical_rows_deleted' || deletion.storage.wal !== 'checkpoint_completed')) invalid()
  return { deletion, csrfToken: text(access.csrfToken) }
}
