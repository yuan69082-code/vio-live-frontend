import { ApiClientError, createApiClient } from './client'
import type { RequestOptions } from './types'
import { parseDeletionAccess } from './personal-deletion'
import type { DeletionAccess } from './personal-deletion'

export type PersonalPreferences = { storagePreference: 'local' | 'cloud' | 'hybrid'; contextMode: string }
export type PersonalStorage = { actualLocation: 'server_database'; cloudSync: false }
export type PersonalUser = { userId: string; displayName: string | null; avatar: string | null }
export type PersonalSession = {
  user: PersonalUser; session: { sessionId: string; expiresAt: string }; csrfToken: string
  onboardingCompleted: boolean; currentAssistantId: string | null; selectionVersion: number
  preferences: PersonalPreferences; storage: PersonalStorage; vaultStatus: string
}
export type PersonalAccess = { status: 'initialization_required' | 'authentication_required' | 'deletion_authentication_required'; registration: 'disabled' }
export type AssistantSettings = { positioning: string; personality: string; persona: string; requirements: string; contextMode: string }
export type PersonalAssistant = { assistantId: string; name: string; avatar: string | null; settings: AssistantSettings; status: string; version: number }
export type AssistantList = { items: PersonalAssistant[]; currentAssistantId: string | null; selectionVersion: number }
export type PersonalProfile = PersonalUser & { preferences: PersonalPreferences; storage: PersonalStorage; version: number }
export type OnboardingInput = {
  displayName: string; avatar: string | null
  assistant: { name: string; avatar: string | null; settings: AssistantSettings }
  preferences: PersonalPreferences
}
export type AccessSession = { sessionId: string; deviceName: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean; status: string }
export type Vault = { status: 'locked' | 'ready' | 'unavailable'; transport: { keyId: string; algorithm: 'RSA-OAEP-256+A256GCM'; publicKeySpki: string } }
export type Confirmation = { operationStatus: 'confirmation_required'; security: { confirmation: { confirmationId: string; status: string; [key: string]: unknown } } }
export type PersonalRequestOptions = RequestOptions & { idempotencyKey?: string; confirmationId?: string; securitySessionId?: string }
export type OperationRecovery = { status: 'completed' | 'confirmation_required' | 'cancelled' | 'not_found'; result?: Record<string, unknown>; confirmation?: Record<string, unknown> }

/** Single same-origin personal contract; credentials and CSRF never enter storage. */
export function createPersonalApi(client = createApiClient()) {
  let csrf = ''
  let unauthorized: (() => void) | undefined
  async function request<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET', body?: unknown, options: PersonalRequestOptions = {}) {
    const requestCsrf = csrf
    try {
      const response = await client.request<T>(`/api/v1/personal${path}`, {
        ...options, method, body,
        headers: {
          ...(method !== 'GET' && requestCsrf ? { 'X-Vio-CSRF': requestCsrf } : {}),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          ...(method === 'GET' && options.confirmationId ? { 'X-Vio-Confirmation-Id': options.confirmationId } : {}),
          ...(method === 'GET' && options.securitySessionId ? { 'X-Vio-Security-Session-Id': options.securitySessionId } : {}),
        },
      })
      if (options.signal?.aborted) throw new ApiClientError('Cancelled', { code: 'request_aborted', status: null })
      return response.data
    } catch (error) {
      // A request from a former identity must not expire a newer session.
      if (!options.signal?.aborted && error instanceof ApiClientError && error.status === 401 && csrf === requestCsrf) unauthorized?.()
      throw error
    }
  }
  return {
    request,
    setSession(value: PersonalSession | null) { csrf = value?.csrfToken ?? '' },
    setDeletionAccess(value: DeletionAccess) { csrf = value.csrfToken },
    onUnauthorized(callback?: () => void) { unauthorized = callback },
    access: (o?: PersonalRequestOptions) => request<PersonalAccess>('/access', 'GET', undefined, o),
    session: (o?: PersonalRequestOptions) => request<PersonalSession>('/session', 'GET', undefined, o),
    initialize: (input: { invitation: string; passphrase: string; agreementVersion: 'personal-use/v1' }, o: PersonalRequestOptions) => request<PersonalSession>('/initialize', 'POST', input, o),
    login: (input: { passphrase: string; deviceName: string }, o?: PersonalRequestOptions) => request<PersonalSession>('/sessions', 'POST', input, o),
    logout: (o?: PersonalRequestOptions) => request('/session', 'DELETE', undefined, o),
    onboarding: (input: OnboardingInput, o: PersonalRequestOptions) => request<PersonalSession>('/onboarding', 'POST', input, o),
    assistants: (o?: PersonalRequestOptions) => request<AssistantList>('/assistants', 'GET', undefined, o),
    createAssistant: (input: OnboardingInput['assistant'], o: PersonalRequestOptions) => request<PersonalAssistant>('/assistants', 'POST', input, o),
    assistant: (id: string, o?: PersonalRequestOptions) => request<PersonalAssistant>(`/assistants/${encodeURIComponent(id)}`, 'GET', undefined, o),
    updateAssistant: (id: string, input: OnboardingInput['assistant'] & { expectedVersion: number }, o?: PersonalRequestOptions) => request<PersonalAssistant>(`/assistants/${encodeURIComponent(id)}`, 'PATCH', input, o),
    selectAssistant: (input: { assistantId: string; expectedSelectionVersion: number }, o?: PersonalRequestOptions) => request<AssistantList>('/current-assistant', 'PUT', input, o),
    profile: (o?: PersonalRequestOptions) => request<PersonalProfile>('/profile', 'GET', undefined, o),
    updateProfile: (input: Pick<PersonalProfile, 'displayName' | 'avatar' | 'preferences'> & { expectedVersion: number }, o?: PersonalRequestOptions) => request<PersonalProfile>('/profile', 'PATCH', input, o),
    sessions: (o?: PersonalRequestOptions) => request<{ items: AccessSession[] }>('/sessions', 'GET', undefined, o),
    revokeSession: (id: string, o?: PersonalRequestOptions) => request(`/sessions/${encodeURIComponent(id)}`, 'DELETE', undefined, o),
    vault: (o?: PersonalRequestOptions) => request<Vault>('/vault', 'GET', undefined, o),
    operation: (operation: string, key: string, o?: PersonalRequestOptions) => request<OperationRecovery>(`/operations?operation=${encodeURIComponent(operation)}&key=${encodeURIComponent(key)}`, 'GET', undefined, o),
    cancelOperation: (input: { operation: string; key: string }, o?: PersonalRequestOptions) => request<OperationRecovery>('/operation-cancellations', 'POST', input, o),
    deletionCurrent: async (o?: PersonalRequestOptions) => parseDeletionAccess(await request('/deletions/current', 'GET', undefined, o)),
    deletionAccess: async (input: { passphrase: string }, o?: PersonalRequestOptions) => parseDeletionAccess(await request('/deletion-access', 'POST', input, o)),
    retryDeletion: async (o?: PersonalRequestOptions) => parseDeletionAccess(await request('/deletions/current/retry', 'POST', {}, o)),
    cancelDeletion: async (input: { passphrase: string; deviceName: string }, o?: PersonalRequestOptions) => {
      const value = await request<{ status: string; reauthenticationRequired: boolean }>('/deletions/current/cancellation', 'POST', input, o)
      if (value?.status !== 'cancelled' || value.reauthenticationRequired !== true) throw new ApiClientError('Invalid cancellation response', { code: 'invalid_response', status: null })
      return value
    },
  }
}
export type PersonalApi = ReturnType<typeof createPersonalApi>

const volatileOperationKeys = new Map<string, string>()
/** Only a random operation key is persisted; no payload or secrets. */
export function operationKey(scope: string, operation: string): string {
  const storageKey = `vio:personal:operation:${encodeURIComponent(scope)}:${operation}`
  try {
    const existing = sessionStorage.getItem(storageKey)
    if (existing && /^vio-personal-[a-f0-9-]+$/.test(existing)) { volatileOperationKeys.set(storageKey, existing); return existing }
  } catch { /* unavailable storage does not bypass the server's safeguards */ }
  const key = volatileOperationKeys.get(storageKey) ?? `vio-personal-${crypto.randomUUID()}`
  volatileOperationKeys.set(storageKey, key)
  try { sessionStorage.setItem(storageKey, key) } catch { /* component still holds the key */ }
  return key
}

export function finishOperation(scope: string, operation: string, expectedKey?: string) {
  const storageKey = `vio:personal:operation:${encodeURIComponent(scope)}:${operation}`
  // A late completion/cancellation may only retire its own key, not a newer one.
  if (!expectedKey || volatileOperationKeys.get(storageKey) === expectedKey) volatileOperationKeys.delete(storageKey)
  try {
    if (!expectedKey || sessionStorage.getItem(storageKey) === expectedKey) sessionStorage.removeItem(storageKey)
  } catch { /* no secret data */ }
}

export const emptyAssistantSettings: AssistantSettings = { positioning: '', personality: '', persona: '', requirements: '', contextMode: 'balanced' }
