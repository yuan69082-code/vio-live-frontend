import type { DeletionAccess, DeletionStatus } from '../api/personal-deletion'

// Test-only server projections. No product module imports these records.
export function deletionFixture(overrides: Partial<DeletionStatus> = {}): DeletionAccess {
  return { csrfToken: 'test-deletion-csrf', deletion: {
    deletionId: 'test-deletion', status: 'waiting', requestedAt: '2026-09-05T00:00:00.000Z', cancellableUntil: '2026-09-12T00:00:00.000Z', serverTime: '2026-09-05T00:00:00.000Z',
    onlineDeletedAt: null, receiptExpiresAt: null, backupDeadlineAt: null, reason: null,
    scope: { tableCount: 4, rowCount: 8, managedFileCount: 0, managedBackupCount: 0 }, onlineData: 'pending',
    managedFiles: { status: 'pending', remaining: 0 }, managedBackups: { status: 'pending', remaining: 0 },
    storage: { sqlite: 'pending', wal: 'pending', physicalErasure: 'not_claimed', userCopies: 'not_managed' },
    externalCall: 'not_performed', providerCharge: 'not_incurred', ...overrides,
  } }
}

export function completedDeletionFixture(): DeletionAccess {
  return deletionFixture({ status: 'completed', serverTime: '2026-09-12T01:00:00.000Z', onlineData: 'deleted', onlineDeletedAt: '2026-09-12T00:00:00.000Z', backupDeadlineAt: '2026-09-26T00:00:00.000Z', receiptExpiresAt: '2026-10-12T00:00:00.000Z', managedFiles: { status: 'completed', remaining: 0 }, managedBackups: { status: 'completed', remaining: 0 }, storage: { sqlite: 'logical_rows_deleted', wal: 'checkpoint_completed', physicalErasure: 'not_claimed', userCopies: 'not_managed' } })
}
