import type { AssistantList, PersonalAssistant, PersonalProfile, PersonalSession } from '../api/personal-api'
import { emptyAssistantSettings } from '../api/personal-api'

// Isolated unit-test data only; never imported by the product entry.
export function sessionFixture(overrides: Partial<PersonalSession> = {}): PersonalSession {
  return {
    user: { userId: 'test-owner', displayName: '测试用户', avatar: null },
    session: { sessionId: 'test-session', expiresAt: '2026-10-04T00:00:00.000Z' },
    csrfToken: 'test-csrf', onboardingCompleted: true, currentAssistantId: 'test-alpha', selectionVersion: 1,
    preferences: { storagePreference: 'local', contextMode: 'balanced' },
    storage: { actualLocation: 'server_database', cloudSync: false }, vaultStatus: 'ready', ...overrides,
  }
}
export function assistantFixture(id = 'test-alpha', name = '测试助手一'): PersonalAssistant {
  return { assistantId: id, name, avatar: null, settings: { ...emptyAssistantSettings }, status: 'active', version: 1 }
}
export function listFixture(): AssistantList {
  return { items: [assistantFixture(), assistantFixture('test-beta', '测试助手二')], currentAssistantId: 'test-alpha', selectionVersion: 1 }
}
export function profileFixture(): PersonalProfile {
  const session = sessionFixture()
  return { ...session.user, preferences: session.preferences, storage: session.storage, version: 1 }
}
export function envelope(value: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data: status < 400 ? value : null, error: status < 400 ? null : { code: 'ACCESS_DENIED', message: 'Access denied' }, timestamp: '2026-09-04T00:00:00.000Z' }), { status, headers: { 'content-type': 'application/json' } })
}
