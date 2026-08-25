import { SUBJECT_RUNTIME_PORT_VERSION } from './subject-runtime-port-v1.js';

const validObservationInput = Object.freeze({
  portVersion: SUBJECT_RUNTIME_PORT_VERSION,
  requestId: 'example-request-a',
  operationId: 'example-operation-a',
  identity: Object.freeze({
    userId: 'example-user-a',
    assistantId: 'example-assistant-a',
    subjectId: 'example-subject-a',
  }),
  observation: Object.freeze({
    observationId: 'example-observation-a',
    observationType: 'message_created',
    source: Object.freeze({
      system: 'vio',
      sourceType: 'event',
      sourceId: 'example-event-a',
    }),
    occurredAt: '2026-08-25T00:00:00Z',
    factRefs: Object.freeze([
      Object.freeze({ factType: 'message_version', factId: 'example-message-version-a' }),
    ]),
  }),
  timeout: Object.freeze({
    timeoutMs: 5_000,
    deadlineAt: '2026-08-25T00:00:05Z',
  }),
  createdAt: '2026-08-25T00:00:00Z',
});

const validExpressionResult = Object.freeze({
  portVersion: SUBJECT_RUNTIME_PORT_VERSION,
  requestId: 'example-request-a',
  operationId: 'example-operation-a',
  status: 'completed',
  expression: Object.freeze({
    expressionId: 'example-expression-a',
    subjectId: 'example-subject-a',
    contentType: 'text/plain',
    content: 'Example subject runtime expression.',
    createdAt: '2026-08-25T00:00:02Z',
  }),
  stateProjection: Object.freeze({
    projectionId: 'example-projection-a',
    subjectId: 'example-subject-a',
    runtimeId: 'third-party.example-runtime',
    runtimeVersion: 'example-runtime/v1',
    sourceOperationId: 'example-operation-a',
    runtimeRevision: 'example-revision-a',
    schemaVersion: 'example-runtime-state/v1',
    payload: Object.freeze({ summary: 'Opaque adapter projection example.' }),
    capturedAt: '2026-08-25T00:00:02Z',
  }),
  error: null,
  completedAt: '2026-08-25T00:00:02Z',
});

export const SUBJECT_RUNTIME_CONTRACT_EXAMPLES = Object.freeze({
  validObservationInput,
  validExpressionResult,
  invalidObservationUnknownField: Object.freeze({
    ...validObservationInput,
    engineRevision: 1,
  }),
  invalidObservationTimeout: Object.freeze({
    ...validObservationInput,
    timeout: Object.freeze({
      timeoutMs: 5_000,
      deadlineAt: '2026-08-25T00:00:06Z',
    }),
  }),
  invalidExpressionUnknownField: Object.freeze({
    ...validExpressionResult,
    stateMutation: Object.freeze({ operation: 'replace' }),
  }),
});

export function subjectRuntimeContractExamples() {
  return structuredClone(SUBJECT_RUNTIME_CONTRACT_EXAMPLES);
}
