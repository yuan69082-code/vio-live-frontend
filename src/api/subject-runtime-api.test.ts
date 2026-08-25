import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import {
  SUBJECT_RUNTIME_PORT_VERSION,
  createSubjectRuntimeApi,
} from './subject-runtime-api'

const timestamp = '2026-08-25T08:00:00.000Z'

function noneStatus() {
  return {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    mode: 'none',
    adapterId: 'none',
    adapterKind: 'none',
    adapterVersion: 'none-adapter/v1',
    state: 'disconnected',
    platformStatus: 'available',
    runtimeStatus: 'not_configured',
    runtimeName: null,
    runtimeVersion: null,
    capabilities: [],
    reason: 'external_runtime_not_configured',
    versionNegotiation: {
      portVersion: SUBJECT_RUNTIME_PORT_VERSION,
      adapterId: 'none',
      status: 'compatible',
      selectedVersion: SUBJECT_RUNTIME_PORT_VERSION,
      reason: 'version_match',
    },
    externalCall: 'not_performed',
  }
}

function externalStatus(
  state: 'disconnected' | 'connecting' | 'ready' | 'degraded' | 'incompatible' | 'paused' | 'reconnecting' = 'ready',
) {
  const runtimeStatus = {
    disconnected: 'disconnected',
    connecting: 'connecting',
    ready: 'available',
    degraded: 'degraded',
    incompatible: 'incompatible',
    paused: 'paused',
    reconnecting: 'connecting',
  }[state]
  const incompatible = state === 'incompatible'
  return {
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    mode: 'external',
    adapterId: 'third-party.example',
    adapterKind: 'third_party',
    adapterVersion: 'example-adapter/v1',
    state,
    platformStatus: 'available',
    runtimeStatus,
    runtimeName: 'Example Runtime',
    runtimeVersion: 'example-runtime/v1',
    capabilities: [
      'observation_input',
      'expression_result',
      'state_projection',
      'cancellation',
      'recovery',
    ],
    reason: state === 'degraded' ? 'runtime_degraded' : null,
    versionNegotiation: {
      portVersion: SUBJECT_RUNTIME_PORT_VERSION,
      adapterId: 'third-party.example',
      status: incompatible ? 'incompatible' : 'compatible',
      selectedVersion: incompatible ? null : SUBJECT_RUNTIME_PORT_VERSION,
      reason: incompatible ? 'no_common_port_version' : 'version_match',
    },
    externalCall: 'not_performed',
  }
}

function response(data: unknown, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    success: true,
    data,
    error: null,
    timestamp,
    ...extra,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function apiFor(data: unknown, extra: Record<string, unknown> = {}) {
  const fetchImplementation = vi.fn<typeof fetch>(async () => response(data, extra))
  return {
    api: createSubjectRuntimeApi(createApiClient({ fetchImplementation })),
    fetchImplementation,
  }
}

describe('Subject Runtime Port v1 frontend API', () => {
  it('requests the exact read-only path and accepts the complete None Adapter response', async () => {
    const { api, fetchImplementation } = apiFor(noneStatus())

    const result = await api.getStatus()

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation.mock.calls[0][0]).toBe('/api/v1/subject-runtime/status')
    expect(fetchImplementation.mock.calls[0][1]?.method).toBe('GET')
    expect(result).toEqual({ status: noneStatus(), readAt: timestamp })
  })

  it('accepts a complete third-party Adapter without treating it as Continuity Engine', async () => {
    const { api } = apiFor(externalStatus())

    await expect(api.getStatus()).resolves.toMatchObject({
      status: {
        adapterId: 'third-party.example',
        adapterKind: 'third_party',
        runtimeName: 'Example Runtime',
        state: 'ready',
      },
    })
  })

  it.each([
    'disconnected',
    'connecting',
    'ready',
    'degraded',
    'incompatible',
    'paused',
    'reconnecting',
  ] as const)('accepts the contracted %s connection state', async (state) => {
    const { api } = apiFor(externalStatus(state))
    await expect(api.getStatus()).resolves.toMatchObject({ status: { state } })
  })

  it('rejects missing fields, unknown fields, invalid enums, and secret-bearing fields', async () => {
    const { runtimeVersion: _missing, ...missing } = externalStatus()
    const cases = [
      missing,
      { ...externalStatus(), invented: true },
      { ...externalStatus(), state: 'invented' },
      { ...externalStatus(), apiKey: 'must-never-be-accepted' },
    ]
    for (const data of cases) {
      const { api } = apiFor(data)
      await expect(api.getStatus()).rejects.toMatchObject({ code: 'incompatible_response' })
    }
  })

  it('rejects invalid version negotiation and state/status combinations', async () => {
    const cases = [
      {
        ...externalStatus(),
        versionNegotiation: { ...externalStatus().versionNegotiation, selectedVersion: null },
      },
      { ...externalStatus(), runtimeStatus: 'degraded' },
      { ...externalStatus(), state: 'incompatible' },
      { ...noneStatus(), capabilities: ['recovery'] },
    ]
    for (const data of cases) {
      const { api } = apiFor(data)
      await expect(api.getStatus()).rejects.toMatchObject({ code: 'incompatible_response' })
    }
  })

  it('rejects non-JSON, malformed envelopes, unknown envelope fields, and impossible timestamps', async () => {
    const responses = [
      new Response('not json', { status: 200 }),
      new Response(JSON.stringify({ data: noneStatus() }), { status: 200 }),
      response(noneStatus(), { trace: 'not-contracted' }),
      response(noneStatus(), { timestamp: '2026-02-30T00:00:00Z' }),
    ]
    for (const item of responses) {
      const fetchImplementation = vi.fn<typeof fetch>(async () => item)
      const api = createSubjectRuntimeApi(createApiClient({ fetchImplementation }))
      await expect(api.getStatus()).rejects.toMatchObject({ code: 'incompatible_response' })
    }
  })

  it('maps a real request timeout without accepting a stale or invented status', async () => {
    const fetchImplementation = vi.fn<typeof fetch>((_input, options) => (
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    ))
    const api = createSubjectRuntimeApi(createApiClient({ fetchImplementation, defaultTimeoutMs: 5 }))

    await expect(api.getStatus()).rejects.toMatchObject({ code: 'timeout' })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('propagates caller cancellation through the existing apiClient AbortSignal', async () => {
    const fetchImplementation = vi.fn<typeof fetch>((_input, options) => (
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    ))
    const controller = new AbortController()
    const api = createSubjectRuntimeApi(createApiClient({ fetchImplementation }))
    const pending = api.getStatus({ signal: controller.signal })

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })
})
