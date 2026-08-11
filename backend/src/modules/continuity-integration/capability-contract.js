export const CAPABILITY_CONTRACT_VERSION = 'continuity-capability/v1';
export const CAPABILITY_REQUEST_SCHEMA_VERSION = 'continuity-capability-request/v1';
export const CAPABILITY_RESULT_SCHEMA_VERSION = 'continuity-capability-result/v1';
export const CAPABILITY_MODEL_OUTPUT_SCHEMA_VERSION = 'continuity-model-output/v1';

export const CAPABILITY_REQUEST_SCHEMA_ID =
  'urn:continuity-engine:capability:schema:request:v1';
export const CAPABILITY_RESULT_SCHEMA_ID =
  'urn:continuity-engine:capability:schema:result:v1';
export const CAPABILITY_MODEL_OUTPUT_SCHEMA_ID =
  'urn:continuity-engine:capability:schema:model-output:v1';

export const CAPABILITY_RESULT_STATUSES = Object.freeze([
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'CANCELLED',
  'EXPIRED',
  'UNKNOWN',
]);

export const ENGINE_RISK_TO_VIO = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

export const CAPABILITY_RESULT_RULES = Object.freeze({
  SUCCEEDED: Object.freeze({ retryClass: null, requiresOutput: true }),
  FAILED_RETRYABLE: Object.freeze({ retryClass: 'retry', requiresOutput: false }),
  FAILED_TERMINAL: Object.freeze({ retryClass: 'never', requiresOutput: false }),
  CANCELLED: Object.freeze({ retryClass: 'never', requiresOutput: false }),
  EXPIRED: Object.freeze({ retryClass: 'never', requiresOutput: false }),
  UNKNOWN: Object.freeze({ retryClass: 'query', requiresOutput: false }),
});
