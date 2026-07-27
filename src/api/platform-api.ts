import { apiClient } from './client'
import type {
  ApiSuccessEnvelope,
  CreateSubjectInput,
  CreateUserInput,
  Dashboard,
  HealthStatus,
  RequestOptions,
  Subject,
  UpdateSubjectInput,
  User,
} from './types'

function pathPart(value: string) {
  return encodeURIComponent(value)
}

export const platformApi = {
  getHealth(options?: RequestOptions): Promise<ApiSuccessEnvelope<HealthStatus>> {
    return apiClient.request('/health', options)
  },

  createUser(
    input: CreateUserInput,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<User>> {
    return apiClient.request('/api/v1/users', {
      ...options,
      method: 'POST',
      body: input,
    })
  },

  getUser(
    userId: string,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<User>> {
    return apiClient.request(`/api/v1/users/${pathPart(userId)}`, options)
  },

  getCurrentUser(
    userId: string,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<User>> {
    return apiClient.request('/api/v1/users/current', {
      ...options,
      headers: { 'x-vio-user-id': userId },
    })
  },

  createSubject(
    userId: string,
    input: CreateSubjectInput,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<Subject>> {
    return apiClient.request(`/api/v1/users/${pathPart(userId)}/subjects`, {
      ...options,
      method: 'POST',
      body: input,
    })
  },

  listSubjects(
    userId: string,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<Subject[]>> {
    return apiClient.request(`/api/v1/users/${pathPart(userId)}/subjects`, options)
  },

  getSubject(
    userId: string,
    subjectId: string,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<Subject>> {
    return apiClient.request(
      `/api/v1/users/${pathPart(userId)}/subjects/${pathPart(subjectId)}`,
      options,
    )
  },

  updateSubject(
    userId: string,
    subjectId: string,
    input: UpdateSubjectInput,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<Subject>> {
    return apiClient.request(
      `/api/v1/users/${pathPart(userId)}/subjects/${pathPart(subjectId)}`,
      {
        ...options,
        method: 'PATCH',
        body: input,
      },
    )
  },

  getDashboard(
    userId: string,
    subjectId: string,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<Dashboard>> {
    return apiClient.request(
      `/api/v1/users/${pathPart(userId)}/subjects/${pathPart(subjectId)}/dashboard`,
      options,
    )
  },
}
