import { ApiClientError } from './client'
import { platformApi } from './platform-api'
import type { HealthStatus } from './types'

export type BackendConnectionResult =
  | {
      status: 'connected'
      checkedAt: string
      health: HealthStatus
    }
  | {
      status: 'unavailable'
      checkedAt: string
      errorCode: string
    }

export async function checkBackendConnection(): Promise<BackendConnectionResult> {
  try {
    const response = await platformApi.getHealth({ timeoutMs: 3_000 })
    return {
      status: 'connected',
      checkedAt: response.timestamp,
      health: response.data,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      checkedAt: new Date().toISOString(),
      errorCode: error instanceof ApiClientError ? error.code : 'unknown_error',
    }
  }
}
