export const CONTRACT_VERSION = 'continuity-integration/v1.1';
export const REQUEST_SCHEMA_VERSION = 'continuity-interaction-request/first-round-v1';
export const OBSERVATION_SCHEMA_VERSION =
  'vio-platform-observation/message-created-first-round-v1';
export const FACT_SCHEMA_VERSION =
  'vio-platform-fact/message-version-first-round-v1';
export const FACT_PACKAGE_SCHEMA_VERSION = 'vio-platform-fact-package/first-round-v1';

export const REQUEST_SCHEMA_ID =
  'urn:vio-live:continuity-integration:schema:request:first-round-v1';
export const OBSERVATION_SCHEMA_ID =
  'urn:vio-live:continuity-integration:schema:platform-observation:message-created:first-round-v1';
export const FACT_SCHEMA_ID =
  'urn:vio-live:continuity-integration:schema:platform-fact:message-version:first-round-v1';

export const SCHEMA_IDS = Object.freeze([
  REQUEST_SCHEMA_ID,
  OBSERVATION_SCHEMA_ID,
  FACT_SCHEMA_ID,
]);

export const EXPECTED_CONTENT_HASH =
  'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
export const EXPECTED_REQUEST_HASH =
  'sha256:ec07ad9ba66d1ffcdfa9177cd61bec1b880ad6ee99a6ec6449e732c1b86002d0';
export const EXPECTED_BINDING_FIXTURE_HASH =
  'sha256:c75b72194c0158a549f3fb30f04a5147ea11a4e777cb1a9cc1a54da6b93359f6';

const fixedBinding = Object.freeze({
  schemaVersion: 'subject-binding/first-round-v1',
  bindingId: 'binding-001',
  userId: 'user-001',
  assistantId: 'assistant-001',
  subjectId: 'subject-001',
  bindingVersion: 1,
  status: 'active',
  createdAt: '2026-07-30T00:00:00Z',
  effectiveAt: '2026-07-30T00:00:00Z',
  replacedBindingId: null,
});

export function fixedSubjectBindingFixture() {
  return structuredClone(fixedBinding);
}

export function conformanceRequest() {
  return {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: REQUEST_SCHEMA_VERSION,
    requestId: 'request-001',
    requestHash: EXPECTED_REQUEST_HASH,
    requestType: 'user_message',
    identity: {
      userId: 'user-001',
      assistantId: 'assistant-001',
      subjectId: 'subject-001',
      bindingId: 'binding-001',
      bindingVersion: 1,
    },
    conversation: {
      conversationId: 'conversation-001',
      messageId: 'message-001',
      messageVersionId: 'message-version-001',
    },
    expectedEngineRevision: 0,
    platformFactPackage: {
      schemaVersion: FACT_PACKAGE_SCHEMA_VERSION,
      facts: [{
        schemaVersion: FACT_SCHEMA_VERSION,
        factId: 'fact-001',
        factType: 'message_version',
        identity: {
          userId: 'user-001',
          assistantId: 'assistant-001',
          subjectId: 'subject-001',
          bindingId: 'binding-001',
          bindingVersion: 1,
        },
        conversationId: 'conversation-001',
        messageId: 'message-001',
        messageVersionId: 'message-version-001',
        senderType: 'user',
        content: 'hello',
        contentHash: EXPECTED_CONTENT_HASH,
        createdAt: '2026-07-30T00:00:00Z',
      }],
      observationRefs: ['observation-001'],
    },
    observations: [{
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      observationId: 'observation-001',
      sourceEventId: 'event-001',
      observationType: 'message_created',
      identity: {
        userId: 'user-001',
        assistantId: 'assistant-001',
        subjectId: 'subject-001',
        bindingId: 'binding-001',
        bindingVersion: 1,
      },
      occurredAt: '2026-07-30T00:00:00Z',
      observedAt: '2026-07-30T00:00:00Z',
      messageVersionRef: {
        conversationId: 'conversation-001',
        messageId: 'message-001',
        messageVersionId: 'message-version-001',
      },
    }],
    constraints: { purpose: 'reply_to_user_message' },
    createdAt: '2026-07-30T00:00:00Z',
  };
}
