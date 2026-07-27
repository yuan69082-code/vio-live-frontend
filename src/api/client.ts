import type {
  ApiEnvelope,
  ApiErrorPayload,
  ApiMeta,
  ApiSuccessEnvelope,
  RequestOptions,
} from './types'

type FetchImplementation = typeof fetch

type ApiClientOptions = {
  baseUrl?: string
  fetchImplementation?: FetchImplementation
  defaultTimeoutMs?: number
}

type ApiRequestOptions = RequestOptions & {
  method?: 'GET' | 'POST' | 'PATCH'
  headers?: Record<string, string>
  body?: unknown
}

type ApiClientErrorOptions = {
  code: string
  status: number | null
  details?: unknown
  requestId?: string
  timestamp?: string
}

const DEFAULT_TIMEOUT_MS = 8_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMeta(value: unknown): value is ApiMeta {
  return isRecord(value)
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return (
    isRecord(value)
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && (value.requestId === undefined || typeof value.requestId === 'string')
  )
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (
    !isRecord(value)
    || typeof value.success !== 'boolean'
    || typeof value.timestamp !== 'string'
    || !('data' in value)
    || !('error' in value)
    || (value.meta !== undefined && !isMeta(value.meta))
  ) {
    return false
  }

  if (value.success) {
    return value.error === null
  }

  return value.data === null && isErrorPayload(value.error)
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/$/, '')
  return `${normalizedBase}${path}`
}

export class ApiClientError extends Error {
  readonly code: string
  readonly status: number | null
  readonly details?: unknown
  readonly requestId?: string
  readonly timestamp?: string

  constructor(message: string, options: ApiClientErrorOptions) {
    super(message)
    this.name = 'ApiClientError'
    this.code = options.code
    this.status = options.status
    this.details = options.details
    this.requestId = options.requestId
    this.timestamp = options.timestamp
  }
}

export function createApiClient({
  baseUrl = '',
  fetchImplementation = fetch,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions = {}) {
  async function request<T>(
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<ApiSuccessEnvelope<T>> {
    if (!path.startsWith('/')) {
      throw new ApiClientError('API path must start with a slash.', {
        code: 'invalid_api_path',
        status: null,
      })
    }

    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = () => controller.abort()

    if (options.signal?.aborted) {
      controller.abort()
    } else {
      options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    }

    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const hasBody = options.body !== undefined
      const response = await fetchImplementation(joinUrl(baseUrl, path), {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      })

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new ApiClientError('Backend returned a non-JSON response.', {
          code: 'invalid_response',
          status: response.status,
        })
      }

      if (!isEnvelope(payload)) {
        throw new ApiClientError('Backend returned an invalid API envelope.', {
          code: 'invalid_response',
          status: response.status,
        })
      }

      if (!response.ok || !payload.success) {
        const error: ApiErrorPayload = payload.success
          ? {
              code: 'http_error',
              message: `Backend request failed with status ${response.status}.`,
            }
          : payload.error

        throw new ApiClientError(error.message, {
          code: error.code,
          status: response.status,
          details: error.details,
          requestId: error.requestId,
          timestamp: payload.timestamp,
        })
      }

      return payload as ApiSuccessEnvelope<T>
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error
      }

      if (timedOut) {
        throw new ApiClientError('Backend request timed out.', {
          code: 'request_timeout',
          status: null,
        })
      }

      if (controller.signal.aborted) {
        throw new ApiClientError('Backend request was aborted.', {
          code: 'request_aborted',
          status: null,
        })
      }

      throw new ApiClientError('Unable to reach the backend.', {
        code: 'network_error',
        status: null,
        details: error instanceof Error ? error.message : String(error),
      })
    } finally {
      clearTimeout(timeoutId)
      options.signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  return { request }
}

export const apiClient = createApiClient()
