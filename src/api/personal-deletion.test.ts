import { describe, expect, it } from 'vitest'
import { ApiClientError } from './client'
import { parseDeletionAccess } from './personal-deletion'
import type { DeletionAccess } from './personal-deletion'

function waitingFixture(): DeletionAccess {
  return {
    csrfToken: 'isolated-deletion-csrf',
    deletion: {
      deletionId: 'isolated-deletion-record', status: 'waiting',
      requestedAt: '2026-09-05T10:00:00.000Z',
      cancellableUntil: '2026-09-12T10:00:00.000Z',
      serverTime: '2026-09-05T11:00:00.000Z',
      onlineDeletedAt: null, receiptExpiresAt: null, backupDeadlineAt: null,
      reason: null,
      scope: { tableCount: 12, rowCount: 24, managedFileCount: 2, managedBackupCount: 1 },
      onlineData: 'pending',
      managedFiles: { status: 'pending', remaining: 2 },
      managedBackups: { status: 'pending', remaining: 1 },
      storage: { sqlite: 'pending', wal: 'pending', physicalErasure: 'not_claimed', userCopies: 'not_managed' },
      externalCall: 'not_performed', providerCharge: 'not_incurred',
    },
  }
}

function completedFixture(): DeletionAccess {
  const waiting = waitingFixture()
  return {
    ...waiting,
    deletion: {
      ...waiting.deletion, status: 'completed', onlineData: 'deleted',
      serverTime: '2026-09-13T10:00:00.000Z',
      onlineDeletedAt: '2026-09-12T10:00:00.000Z',
      receiptExpiresAt: '2026-10-12T10:00:00.000Z',
      backupDeadlineAt: '2026-09-26T10:00:00.000Z',
      managedFiles: { status: 'completed', remaining: 0 },
      managedBackups: { status: 'completed', remaining: 0 },
      storage: { sqlite: 'logical_rows_deleted', wal: 'checkpoint_completed', physicalErasure: 'not_claimed', userCopies: 'not_managed' },
    },
  }
}

function expectInvalid(value: unknown) {
  expect(() => parseDeletionAccess(value)).toThrow(ApiClientError)
  expect(() => parseDeletionAccess(value)).toThrow(expect.objectContaining({ code: 'invalid_response', status: null }))
}

describe('personal deletion safe response projection', () => {
  it('accepts a complete waiting response without mutating the source', () => {
    const source = waitingFixture()
    const parsed = parseDeletionAccess(source)
    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(parsed.deletion).not.toBe(source.deletion)
    expect(parsed.deletion.status).toBe('waiting')
  })

  it('accepts actual completed online and managed-copy deletion without claiming physical erasure or user-copy deletion', () => {
    const source = completedFixture()
    expect(parseDeletionAccess(source)).toEqual(source)
    expect(parseDeletionAccess(source).deletion.storage).toMatchObject({ physicalErasure: 'not_claimed', userCopies: 'not_managed' })
  })

  it.each(['permanently_disabled', 'deleted', '', null, undefined])('rejects an unknown or absent deletion status: %s', (status) => {
    const source = waitingFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, status } })
  })

  it.each(['requestedAt', 'cancellableUntil', 'serverTime', 'onlineDeletedAt', 'receiptExpiresAt', 'backupDeadlineAt'])('rejects malformed %s', (field) => {
    const source = waitingFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, [field]: 'not-a-valid-time' } })
  })

  it.each(['2026-09-05', '2026-09-05T10:00:00+08:00', '2026-99-05T10:00:00.000Z', '2026-02-30T10:00:00.000Z'])('rejects a noncanonical or nonexistent server date: %s', (serverTime) => {
    const source = waitingFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, serverTime } })
  })

  it.each(['tableCount', 'rowCount', 'managedFileCount', 'managedBackupCount'])('rejects a negative scope count for %s', (field) => {
    const source = waitingFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, scope: { ...source.deletion.scope, [field]: -1 } } })
  })

  it.each(['managedFiles', 'managedBackups'] as const)('rejects negative remaining counts for %s', (field) => {
    const source = waitingFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, [field]: { status: 'pending', remaining: -1 } } })
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects an unsafe or noninteger count: %s', (rowCount) => {
    const source = waitingFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, scope: { ...source.deletion.scope, rowCount } } })
  })

  it('rejects a missing CSRF token rather than accepting a status-only object', () => {
    expectInvalid({ deletion: waitingFixture().deletion })
  })

  it.each(['', null, 123])('rejects an invalid CSRF token: %s', (csrfToken) => {
    expectInvalid({ ...waitingFixture(), csrfToken })
  })

  it('rejects completed while online data remains pending', () => {
    const source = completedFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, onlineData: 'pending' } })
  })

  it('rejects completed without an actual online deletion timestamp', () => {
    const source = completedFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, onlineDeletedAt: null } })
  })

  it.each([{ sqlite: 'pending' }, { wal: 'pending' }, { wal: 'checkpoint_pending' }])('rejects completed while database cleanup remains incomplete: %j', (storage) => {
    const source = completedFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, storage: { ...source.deletion.storage, ...storage } } })
  })

  it.each(['managedFiles', 'managedBackups'] as const)('rejects overall completion while %s is pending, including zero remaining', (field) => {
    const source = completedFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, [field]: { status: 'pending', remaining: 0 } } })
  })

  it.each(['managedFiles', 'managedBackups'] as const)('rejects completed %s with remaining copies', (field) => {
    const source = completedFixture()
    expectInvalid({ ...source, deletion: { ...source.deletion, [field]: { status: 'completed', remaining: 1 } } })
  })

  it('projects only allowlisted safe fields at every object level', () => {
    const safe = waitingFixture()
    const source = {
      ...safe,
      passphrase: 'isolated-unknown-secret', userBody: 'isolated-private-body',
      deletion: {
        ...safe.deletion,
        rawBody: 'isolated-private-body', credentials: { apiKey: 'isolated-unknown-secret' },
        scope: { ...safe.deletion.scope, rowContents: ['isolated-private-body'] },
        managedFiles: { ...safe.deletion.managedFiles, privatePaths: ['isolated-private-path'] },
        managedBackups: { ...safe.deletion.managedBackups, backupContent: 'isolated-private-body' },
        storage: { ...safe.deletion.storage, encryptionKey: 'isolated-unknown-secret' },
      },
    }
    const parsed = parseDeletionAccess(source)
    expect(parsed).toEqual(safe)
    expect(JSON.stringify(parsed)).not.toContain('isolated-unknown-secret')
    expect(JSON.stringify(parsed)).not.toContain('isolated-private-body')
    expect(JSON.stringify(parsed)).not.toContain('isolated-private-path')
    expect(source.passphrase).toBe('isolated-unknown-secret')
  })

  it('does not promote waiting to completed even when serverTime is beyond the cancellation deadline', () => {
    const source = waitingFixture()
    source.deletion.serverTime = '2026-10-20T10:00:00.000Z'
    const parsed = parseDeletionAccess(source)
    expect(Date.parse(parsed.deletion.serverTime)).toBeGreaterThan(Date.parse(parsed.deletion.cancellableUntil))
    expect(parsed.deletion.status).toBe('waiting')
    expect(parsed.deletion.onlineData).toBe('pending')
    expect(parsed.deletion.onlineDeletedAt).toBeNull()
    expect(parsed.deletion.managedBackups).toEqual({ status: 'pending', remaining: 1 })
  })
})
