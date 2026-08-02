export const FIRST_ROUND_SUCCESS_STATUS = 'completed';
export const FIRST_ROUND_ERROR_STATUS = 'failed_terminal';
export const FIRST_ROUND_PROJECTION_SCHEMA_VERSION =
  'engine-subject-state-projection/first-round-v1';
export const FIRST_ROUND_SNAPSHOT_SCHEMA_VERSION = 1;
export const FIRST_ROUND_SUBJECT_ROLE = 'subject';

export const FIRST_ROUND_ERROR_RULES = Object.freeze({
  SCHEMA_INVALID: Object.freeze({
    message: 'Request schema is invalid.',
    retryClass: 'never',
  }),
  SUBJECT_BINDING_MISMATCH: Object.freeze({
    message: 'Subject binding does not match.',
    retryClass: 'never',
  }),
  REVISION_CONFLICT: Object.freeze({
    message: 'Engine revision does not match.',
    retryClass: 'reassemble',
  }),
  IDEMPOTENCY_KEY_REUSED: Object.freeze({
    message: 'requestId is already bound to a different requestHash.',
    retryClass: 'never',
  }),
});

export const FIRST_ROUND_ERROR_CODES = Object.freeze(
  Object.keys(FIRST_ROUND_ERROR_RULES),
);

export const FIRST_ROUND_PROCESSING_STAGES = Object.freeze([
  'received',
  'projection_saved',
  'pointer_applied',
  'completed',
  'terminal_error',
  'reconciling',
  'quarantined',
]);
