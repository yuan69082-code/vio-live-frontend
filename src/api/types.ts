export type ApiMeta = Record<string, unknown>

export type ApiErrorPayload = {
  code: string
  message: string
  details?: unknown
  requestId?: string
}

export type ApiSuccessEnvelope<T> = {
  success: true
  data: T
  error: null
  timestamp: string
  meta?: ApiMeta
}

export type ApiFailureEnvelope = {
  success: false
  data: null
  error: ApiErrorPayload
  timestamp: string
  meta?: ApiMeta
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiFailureEnvelope

export type RequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

export type HealthStatus = {
  status: string
  service: string
  version: string
  database: string
}

export type User = {
  userId: string
  email: string
  displayName: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type CreateUserInput = {
  email: string
  displayName?: string
}

export type SubjectBasicSettings = Record<string, unknown>

export type Subject = {
  subjectId: string
  ownerUserId: string
  name: string
  avatarRef: string | null
  basicSettings: SubjectBasicSettings
  status: string
  createdAt: string
  updatedAt: string
}

export type CreateSubjectInput = {
  name: string
  avatarRef?: string | null
  basicSettings?: SubjectBasicSettings
}

export type UpdateSubjectInput = {
  name?: string
  avatarRef?: string | null
  basicSettings?: SubjectBasicSettings
}

export type DashboardBasicStatus = {
  userStatus: string
  subjectStatus: string
  ready: boolean
  continuityStatus: 'not_available'
}

export type Dashboard = {
  user: User
  subject: Subject
  basicStatus: DashboardBasicStatus
}
