import { isDeepStrictEqual } from 'node:util';

import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import {
  CONTRACT_VERSION,
  EXPECTED_BINDING_FIXTURE_HASH,
  FACT_PACKAGE_SCHEMA_VERSION,
  FACT_SCHEMA_VERSION,
  OBSERVATION_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  fixedSubjectBindingFixture,
} from './first-round-contract.js';
import {
  calculateBindingFixtureHash,
  calculateContentHash,
  calculateRequestHash,
  canonicalizeJson,
} from './first-round-hashing.js';
import {
  validateFirstRoundRequest,
  validateFixedSubjectBindingFixture,
} from './first-round-validator.js';

const inputFields = Object.freeze([
  'requestId',
  'userId',
  'assistantId',
  'conversationId',
  'messageId',
  'messageVersionId',
  'observationId',
  'sourceEventId',
  'factId',
  'expectedEngineRevision',
]);

function requireConstructionInput(value) {
  const input = requirePlainObject(value, 'request');
  const unknown = Object.keys(input).filter((field) => !inputFields.includes(field));
  if (unknown.length > 0) {
    throw new ValidationError('First-round request input contains unsupported fields.', {
      unexpectedFields: unknown,
    });
  }
  for (const field of inputFields.filter((item) => item !== 'expectedEngineRevision')) {
    input[field] = requireString(input[field], field, { maxLength: 128 });
  }
  if (!Number.isSafeInteger(input.expectedEngineRevision) || input.expectedEngineRevision < 0) {
    throw new ValidationError('expectedEngineRevision must be a non-negative safe integer.', {
      field: 'expectedEngineRevision',
    });
  }
  return input;
}

function contractTimestamp(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError('Contract clock must return a valid Date.');
  }
  return value.toISOString().replace('.000Z', 'Z');
}

function requireActive(record, message) {
  if (!record || record.status !== 'active') throw new NotFoundError(message);
  return record;
}

function assertEventProvenance(event, input, messageVersion) {
  const expectedData = {
    conversationId: input.conversationId,
    messageId: input.messageId,
    messageVersionId: input.messageVersionId,
    senderType: 'user',
  };
  const actualData = Object.fromEntries(
    Object.keys(expectedData).map((key) => [key, event.data?.[key]]),
  );
  if (
    event.subjectId !== input.assistantId
    || event.eventType !== 'message_created'
    || event.status !== 'pending'
    || event.source.type !== 'message-service'
    || event.source.reference !== input.messageId
    || !isDeepStrictEqual(actualData, expectedData)
    || messageVersion.senderType !== 'user'
  ) {
    throw new ValidationError(
      'sourceEventId is not the matching Vio message_created source fact.',
      { field: 'sourceEventId' },
    );
  }
}

function storedRequestMatchesInput(record, input) {
  return record.userId === input.userId
    && record.assistantId === input.assistantId
    && record.conversationId === input.conversationId
    && record.messageId === input.messageId
    && record.messageVersionId === input.messageVersionId
    && record.observationId === input.observationId
    && record.sourceEventId === input.sourceEventId
    && record.factId === input.factId
    && record.expectedEngineRevision === input.expectedEngineRevision;
}

export function createFirstRoundContinuityRequestService({
  continuityRepository,
  userRepository,
  subjectRepository,
  conversationRepository,
  messageRepository,
  messageVersionRepository,
  eventRepository,
  runInTransaction,
  clock = () => new Date(),
}) {
  function requireStoredBinding() {
    const stored = continuityRepository.findFixedBinding();
    if (!stored) {
      throw new NotFoundError('Fixed first-round SubjectBinding fixture is not loaded.');
    }
    validateFixedSubjectBindingFixture(stored.fixture, stored.bindingFixtureHash);
    return stored;
  }

  function prepareFixedBindingFixtureForTests() {
    const fixture = fixedSubjectBindingFixture();
    const user = requireActive(
      userRepository.findById(fixture.userId),
      'Fixed first-round Vio user was not found or active.',
    );
    const assistant = requireActive(
      subjectRepository.findById(user.userId, fixture.assistantId),
      'Fixed first-round Vio assistant was not found or active.',
    );
    if (assistant.ownerUserId !== user.userId) {
      throw new ValidationError('Fixed first-round assistant ownership does not match.');
    }
    const bindingFixtureHash = calculateBindingFixtureHash(fixture);
    if (bindingFixtureHash !== EXPECTED_BINDING_FIXTURE_HASH) {
      throw new ValidationError('Fixed first-round SubjectBinding hash is invalid.');
    }
    validateFixedSubjectBindingFixture(fixture, bindingFixtureHash);

    return runInTransaction(() => {
      const existing = continuityRepository.findFixedBinding();
      if (existing) {
        validateFixedSubjectBindingFixture(
          existing.fixture,
          existing.bindingFixtureHash,
        );
        return existing;
      }
      return continuityRepository.insertFixedBinding({
        fixture,
        bindingFixtureHash,
        fixtureJson: canonicalizeJson(fixture).toString('utf8'),
        loadedAt: contractTimestamp(clock()),
      });
    });
  }

  function constructAndStoreRequest(value) {
    const input = requireConstructionInput(value);

    return runInTransaction(() => {
      const stored = continuityRepository.findRequestById(input.requestId);
      if (stored) {
        if (!storedRequestMatchesInput(stored, input)) {
          throw new ConflictError('requestId is already bound to a different logical request.');
        }
        requireStoredBinding();
        validateFirstRoundRequest(stored.logicalRequest);
        return structuredClone(stored.logicalRequest);
      }

      const bindingRecord = requireStoredBinding();
      const binding = bindingRecord.fixture;
      if (input.userId !== binding.userId || input.assistantId !== binding.assistantId) {
        throw new ValidationError('Request identity does not match the fixed SubjectBinding.');
      }

      requireActive(userRepository.findById(input.userId), 'Vio user was not found or active.');
      requireActive(
        subjectRepository.findById(input.userId, input.assistantId),
        'Vio assistant was not found for this user or active.',
      );
      const conversation = requireActive(
        conversationRepository.findById(
          input.userId,
          input.assistantId,
          input.conversationId,
        ),
        'Conversation was not found for this user and assistant or active.',
      );
      const message = requireActive(
        messageRepository.findById(
          input.userId,
          input.assistantId,
          input.conversationId,
          input.messageId,
        ),
        'Message was not found for this conversation or active.',
      );
      const messageVersion = messageVersionRepository.findById(
        input.userId,
        input.assistantId,
        input.conversationId,
        input.messageId,
        input.messageVersionId,
      );
      if (!messageVersion) throw new NotFoundError('MessageVersion was not found.');
      if (
        conversation.userId !== input.userId
        || conversation.subjectId !== input.assistantId
        || message.senderType !== 'user'
        || message.currentVersionId !== messageVersion.messageVersionId
        || messageVersion.changeReason !== 'original'
        || messageVersion.versionNumber !== 1
      ) {
        throw new ValidationError('Conversation or MessageVersion ownership is invalid.');
      }
      const sourceEvent = eventRepository.findById(input.userId, input.sourceEventId);
      if (!sourceEvent) throw new NotFoundError('Source Vio Event was not found.');
      assertEventProvenance(sourceEvent, input, messageVersion);

      const identity = {
        userId: binding.userId,
        assistantId: binding.assistantId,
        subjectId: binding.subjectId,
        bindingId: binding.bindingId,
        bindingVersion: binding.bindingVersion,
      };
      const conversationReference = {
        conversationId: input.conversationId,
        messageId: input.messageId,
        messageVersionId: input.messageVersionId,
      };
      const createdAt = contractTimestamp(clock());
      const request = {
        contractVersion: CONTRACT_VERSION,
        schemaVersion: REQUEST_SCHEMA_VERSION,
        requestId: input.requestId,
        requestHash: 'sha256:' + '0'.repeat(64),
        requestType: 'user_message',
        identity,
        conversation: conversationReference,
        expectedEngineRevision: input.expectedEngineRevision,
        platformFactPackage: {
          schemaVersion: FACT_PACKAGE_SCHEMA_VERSION,
          facts: [{
            schemaVersion: FACT_SCHEMA_VERSION,
            factId: input.factId,
            factType: 'message_version',
            identity: structuredClone(identity),
            conversationId: input.conversationId,
            messageId: input.messageId,
            messageVersionId: input.messageVersionId,
            senderType: 'user',
            content: messageVersion.content,
            contentHash: calculateContentHash(messageVersion.content),
            createdAt: messageVersion.createdAt,
          }],
          observationRefs: [input.observationId],
        },
        observations: [{
          schemaVersion: OBSERVATION_SCHEMA_VERSION,
          observationId: input.observationId,
          sourceEventId: input.sourceEventId,
          observationType: 'message_created',
          identity: structuredClone(identity),
          occurredAt: sourceEvent.occurredAt,
          observedAt: createdAt,
          messageVersionRef: structuredClone(conversationReference),
        }],
        constraints: { purpose: 'reply_to_user_message' },
        createdAt,
      };
      request.requestHash = calculateRequestHash(request);
      validateFirstRoundRequest(request);
      const saved = continuityRepository.insertRequest({
        requestId: request.requestId,
        requestHash: request.requestHash,
        bindingId: binding.bindingId,
        bindingVersion: binding.bindingVersion,
        bindingFixtureHash: bindingRecord.bindingFixtureHash,
        userId: binding.userId,
        assistantId: binding.assistantId,
        subjectId: binding.subjectId,
        expectedEngineRevision: request.expectedEngineRevision,
        conversationId: input.conversationId,
        messageId: input.messageId,
        messageVersionId: input.messageVersionId,
        observationId: input.observationId,
        sourceEventId: input.sourceEventId,
        factId: input.factId,
        createdAt,
        logicalRequestJson: canonicalizeJson(request).toString('utf8'),
        recordedAt: createdAt,
      });
      return structuredClone(saved.logicalRequest);
    });
  }

  return Object.freeze({
    prepareFixedBindingFixtureForTests,
    loadFixedBindingFixture() {
      return structuredClone(requireStoredBinding());
    },
    constructAndStoreRequest,
    getStoredRequest(requestId) {
      const normalizedRequestId = requireString(requestId, 'requestId', { maxLength: 128 });
      const stored = continuityRepository.findRequestById(normalizedRequestId);
      if (!stored) throw new NotFoundError('First-round continuity request was not found.');
      validateFirstRoundRequest(stored.logicalRequest);
      return structuredClone(stored.logicalRequest);
    },
  });
}
