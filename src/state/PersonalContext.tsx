import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiClientError } from '../api/client'
import { createPersonalApi } from '../api/personal-api'
import type { AssistantList, PersonalAccess, PersonalApi, PersonalSession } from '../api/personal-api'
import { personalError } from '../components/personal/useScopedAction'
import { parseDeletionAccess } from '../api/personal-deletion'
import type { DeletionAccess } from '../api/personal-deletion'
import { clearPersonalChatRecoveryForOwner } from '../api/personal-chat-recovery'
import { clearMultiChatRecoveryForOwner } from '../api/personal-multi-chat-recovery'

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'access'; access: PersonalAccess; message?: string } | { kind: 'ready'; session: PersonalSession } | { kind: 'deletion'; access: DeletionAccess } | { kind: 'deletion-receipt-expired' }
type PersonalContextValue = {
  api: PersonalApi; state: State; scope: string; assistants: AssistantList | null
  acceptSession: (session: PersonalSession) => void; restore: () => Promise<void>; expire: () => void
  reloadAssistants: (signal?: AbortSignal) => Promise<void>
  guarded: <T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, commit?: (result: T) => void) => Promise<T>
  acceptDeletion: (access: DeletionAccess) => void
  requireAccessAfterCancellation: () => void
  openDeletionAccess: () => void
  recoverDeletion: () => Promise<void>
  guardedDeletion: <T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) => Promise<T>
}
const Context = createContext<PersonalContextValue | null>(null)
const cancelled = () => new ApiClientError('Context changed', { code: 'request_aborted', status: null })

export function PersonalProvider({ children, api: suppliedApi }: { children: ReactNode; api?: PersonalApi }) {
  const [api] = useState(() => suppliedApi ?? createPersonalApi())
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [assistants, setAssistants] = useState<AssistantList | null>(null)
  const [scope, setScope] = useState('initial')
  const current = useRef<PersonalSession | null>(null)
  const currentDeletion = useRef<DeletionAccess | null>(null)
  const deletionRecoveryPending = useRef(false)
  const generation = useRef(0)
  const readVersion = useRef(0)
  const requests = useRef(new Set<AbortController>())

  const invalidate = useCallback(() => {
    generation.current++
    requests.current.forEach((request) => request.abort())
    requests.current.clear()
    current.current = null
    currentDeletion.current = null
    api.setSession(null)
    setAssistants(null)
    setScope(`scope-${generation.current}`)
  }, [api])

  const acceptDeletion = useCallback((input: DeletionAccess) => {
    const value = parseDeletionAccess(input)
    deletionRecoveryPending.current = true
    if (currentDeletion.current?.deletion.deletionId !== value.deletion.deletionId) invalidate()
    else if (Date.parse(value.deletion.serverTime) < Date.parse(currentDeletion.current.deletion.serverTime)) return
    currentDeletion.current = value
    api.setDeletionAccess(value)
    setState({ kind: 'deletion', access: value })
  }, [api, invalidate])

  const requireAccessAfterCancellation = useCallback(() => {
    deletionRecoveryPending.current = false
    invalidate()
    setState({ kind: 'access', access: { status: 'authentication_required', registration: 'disabled' }, message: '删除申请已撤销。旧访问令牌不会恢复，请重新验证个人访问。' })
  }, [invalidate])

  const openDeletionAccess = useCallback(() => {
    invalidate()
    setState({ kind: 'access', access: { status: 'deletion_authentication_required', registration: 'disabled' } })
  }, [invalidate])

  const expire = useCallback(() => {
    const ownerId = current.current?.user.userId
    if (ownerId) {
      try { clearPersonalChatRecoveryForOwner(window.sessionStorage, ownerId) } catch { /* storage unavailable */ }
      try { clearMultiChatRecoveryForOwner(window.sessionStorage, ownerId) } catch { /* storage unavailable */ }
    }
    invalidate()
    setState({ kind: 'access', access: { status: 'authentication_required', registration: 'disabled' }, message: '访问已结束或失效，请重新验证。' })
  }, [invalidate])

  const acceptSession = useCallback((value: PersonalSession) => {
    if (!value?.user?.userId || !value.session?.sessionId || !value.csrfToken
      || typeof value.onboardingCompleted !== 'boolean' || value.storage?.actualLocation !== 'server_database' || value.storage.cloudSync !== false) {
      throw new ApiClientError('Invalid session response', { code: 'invalid_response', status: null })
    }
    const previousOwnerId = current.current?.user.userId
    const identityChanged = current.current?.session.sessionId !== value.session.sessionId || previousOwnerId !== value.user.userId
    if (previousOwnerId && previousOwnerId !== value.user.userId) {
      try { clearPersonalChatRecoveryForOwner(window.sessionStorage, previousOwnerId) } catch { /* storage unavailable */ }
      try { clearMultiChatRecoveryForOwner(window.sessionStorage, previousOwnerId) } catch { /* storage unavailable */ }
    }
    if (identityChanged) invalidate()
    else if (current.current && value.selectionVersion < current.current.selectionVersion) {
      value = { ...value, currentAssistantId: current.current.currentAssistantId, selectionVersion: current.current.selectionVersion }
    }
    current.current = value
    api.setSession(value)
    setState({ kind: 'ready', session: value })
  }, [api, invalidate])

  const restore = useCallback(async () => {
    invalidate()
    const version = generation.current
    const controller = new AbortController()
    requests.current.add(controller)
    setState({ kind: 'loading' })
    const active = () => version === generation.current && !controller.signal.aborted
    try {
      let session: PersonalSession
      try {
        // An approved deletion with an unknown outcome cannot restore business
        // from an ordinary session read while the deletion may still commit.
        if (deletionRecoveryPending.current) throw new ApiClientError('Deletion recovery required', { code: 'DELETION_ACCESS_DENIED', status: 401 })
        session = await api.session({ signal: controller.signal })
      }
      catch (error) {
        if (!(error instanceof ApiClientError) || error.status !== 401) throw error
        try {
          const deletion = await api.deletionCurrent({ signal: controller.signal })
          if (active()) acceptDeletion(deletion)
          return
        } catch (deletionError) {
          if (deletionError instanceof ApiClientError && deletionError.status === 410 && deletionError.code === 'DELETION_RECEIPT_EXPIRED') {
            if (active()) setState({ kind: 'deletion-receipt-expired' })
            return
          }
          if (!(deletionError instanceof ApiClientError) || deletionError.status !== 401) throw deletionError
        }
        if (deletionRecoveryPending.current) {
          if (active()) setState({ kind: 'access', access: { status: 'deletion_authentication_required', registration: 'disabled' } })
          return
        }
        const access = await api.access({ signal: controller.signal })
        if (active()) setState({ kind: 'access', access })
        return
      }
      if (active()) acceptSession(session)
    } catch (error) {
      if (active()) setState({ kind: 'error', message: personalError(error) })
    } finally { requests.current.delete(controller) }
  }, [api, invalidate, acceptSession, acceptDeletion])

  const recoverDeletion = useCallback(async () => {
    deletionRecoveryPending.current = true
    await restore()
  }, [restore])

  const guarded = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, commit?: (result: T) => void): Promise<T> => {
    const version = generation.current
    const sessionId = current.current?.session.sessionId
    if (!sessionId || signal?.aborted) throw cancelled()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    requests.current.add(controller)
    try {
      const value = await work(controller.signal)
      if (version !== generation.current || controller.signal.aborted || current.current?.session.sessionId !== sessionId) throw cancelled()
      commit?.(value)
      return value
    } finally { requests.current.delete(controller); signal?.removeEventListener('abort', abort) }
  }, [])

  const guardedDeletion = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const version = generation.current
    const deletionId = currentDeletion.current?.deletion.deletionId
    if (!deletionId || signal?.aborted) throw cancelled()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    requests.current.add(controller)
    try {
      const value = await work(controller.signal)
      if (version !== generation.current || controller.signal.aborted || currentDeletion.current?.deletion.deletionId !== deletionId) throw cancelled()
      return value
    } finally { requests.current.delete(controller); signal?.removeEventListener('abort', abort) }
  }, [])

  const reloadAssistants = useCallback(async (signal?: AbortSignal) => {
    const version = ++readVersion.current
    await guarded((ownedSignal) => api.assistants({ signal: ownedSignal }), signal, (value) => {
      if (version !== readVersion.current) return
      if (!Array.isArray(value.items) || !Number.isInteger(value.selectionVersion)) throw new ApiClientError('Invalid list', { code: 'invalid_response', status: null })
      setAssistants((previous) => previous && previous.selectionVersion > value.selectionVersion ? previous : value)
      if (current.current && value.selectionVersion >= current.current.selectionVersion) {
        const updated = { ...current.current, currentAssistantId: value.currentAssistantId, selectionVersion: value.selectionVersion }
        current.current = updated
        setState({ kind: 'ready', session: updated })
      }
    })
  }, [api, guarded])

  useEffect(() => {
    api.onUnauthorized(() => {
      if (current.current) {
        try { clearPersonalChatRecoveryForOwner(window.sessionStorage, current.current.user.userId) } catch { /* storage unavailable */ }
        try { clearMultiChatRecoveryForOwner(window.sessionStorage, current.current.user.userId) } catch { /* storage unavailable */ }
      }
      if (current.current || currentDeletion.current) void restore()
    })
    let active = true
    queueMicrotask(() => { if (active) void restore() })
    return () => { active = false; generation.current++; requests.current.forEach((request) => request.abort()); requests.current.clear(); api.onUnauthorized(undefined) }
  }, [api, expire, restore])

  const activeSessionId = state.kind === 'ready' ? state.session.session.sessionId : null
  const expiresAt = state.kind === 'ready' ? state.session.session.expiresAt : null
  useEffect(() => {
    if (!activeSessionId || !expiresAt) return
    let timer: ReturnType<typeof setTimeout>
    let active = true
    const schedule = () => {
      const remaining = Date.parse(expiresAt) - Date.now()
      if (remaining <= 0) { expire(); return }
      timer = setTimeout(schedule, Math.min(remaining, 2_147_000_000))
    }
    schedule()
    const revalidate = () => {
      if (document.visibilityState !== 'visible' || !active) return
      void guarded((signal) => api.session({ signal }), undefined, acceptSession).catch(() => {})
    }
    document.addEventListener('visibilitychange', revalidate)
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', revalidate) }
  }, [activeSessionId, expiresAt, api, guarded, acceptSession, expire])

  return <Context.Provider value={{ api, state, scope, assistants, acceptSession, restore, expire, reloadAssistants, guarded, acceptDeletion, requireAccessAfterCancellation, openDeletionAccess, recoverDeletion, guardedDeletion }}>{children}</Context.Provider>
}

export const useOptionalPersonal = () => useContext(Context)
export function usePersonal() {
  const context = useContext(Context)
  if (!context) throw new Error('PersonalProvider is required')
  return context
}
