import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';

const STATE_SOURCE_TYPES = Object.freeze([
  'message_version',
  'event',
  'conversation_summary',
]);

function requireOnlyFields(value, field, allowedFields) {
  const input = requirePlainObject(value, field);
  const unexpectedFields = Object.keys(input).filter(
    (name) => !allowedFields.includes(name),
  );

  if (unexpectedFields.length > 0) {
    throw new ValidationError(`${field} contains unsupported fields.`, {
      field,
      unexpectedFields,
    });
  }

  return input;
}

function requireNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ValidationError(`${field} must be a number between 0 and 1.`, {
      field,
    });
  }

  return value;
}

function requireStringArray(value, field, { maximum, itemMaxLength }) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ValidationError(`${field} must be an array with at most ${maximum} items.`, {
      field,
    });
  }

  const normalized = value.map((item, index) => requireString(
    item,
    `${field}[${index}]`,
    { maxLength: itemMaxLength },
  ));

  if (new Set(normalized).size !== normalized.length) {
    throw new ValidationError(`${field} must not contain duplicate items.`, { field });
  }

  return normalized;
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') {
    return 50;
  }

  if (!/^\d+$/.test(String(value))) {
    throw new ValidationError('limit must be an integer between 1 and 100.', {
      field: 'limit',
    });
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('limit must be an integer between 1 and 100.', {
      field: 'limit',
    });
  }

  return limit;
}

function normalizeSource(value) {
  const input = requirePlainObject(value, 'source');
  const type = requireString(input.type, 'source.type', { maxLength: 40 });

  if (!STATE_SOURCE_TYPES.includes(type)) {
    throw new ValidationError('source.type is not supported.', {
      field: 'source.type',
      allowedValues: STATE_SOURCE_TYPES,
    });
  }

  if (type === 'message_version') {
    const source = requireOnlyFields(
      input,
      'source',
      ['type', 'conversationId', 'messageId', 'messageVersionId'],
    );
    return {
      type,
      conversationId: requireString(source.conversationId, 'source.conversationId', {
        maxLength: 128,
      }),
      messageId: requireString(source.messageId, 'source.messageId', {
        maxLength: 128,
      }),
      messageVersionId: requireString(
        source.messageVersionId,
        'source.messageVersionId',
        { maxLength: 128 },
      ),
    };
  }

  if (type === 'conversation_summary') {
    const source = requireOnlyFields(
      input,
      'source',
      ['type', 'conversationId', 'summaryId'],
    );
    return {
      type,
      conversationId: requireString(source.conversationId, 'source.conversationId', {
        maxLength: 128,
      }),
      summaryId: requireString(source.summaryId, 'source.summaryId', {
        maxLength: 128,
      }),
    };
  }

  const source = requireOnlyFields(input, 'source', ['type', 'eventId']);
  return {
    type,
    eventId: requireString(source.eventId, 'source.eventId', { maxLength: 128 }),
  };
}

export function createSubjectStateService({
  subjectService,
  conversationService,
  subjectStateRepository,
  conversationSummaryRepository,
  messageVersionRepository,
  eventRepository,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireSubject(userId, subjectId) {
    return subjectService.getSubject(userId, subjectId);
  }

  function requireSubjectEvent(userId, subjectId, eventId, purpose) {
    const event = eventRepository.findById(userId, eventId);
    if (!event || event.subjectId !== subjectId) {
      throw new NotFoundError(`${purpose} Event was not found for this subject.`);
    }

    return event;
  }

  function validateSource(userId, subjectId, source) {
    if (source.type === 'event') {
      requireSubjectEvent(userId, subjectId, source.eventId, 'State source');
      return;
    }

    const conversation = conversationService.getConversation(
      userId,
      subjectId,
      source.conversationId,
    );

    if (source.type === 'message_version') {
      const version = messageVersionRepository.findById(
        conversation.userId,
        conversation.subjectId,
        conversation.conversationId,
        source.messageId,
        source.messageVersionId,
      );

      if (!version) {
        throw new NotFoundError('State source MessageVersion was not found.');
      }

      return;
    }

    const summary = conversationSummaryRepository.findById(
      conversation.userId,
      conversation.subjectId,
      conversation.conversationId,
      source.summaryId,
    );
    if (!summary) {
      throw new NotFoundError('State source ConversationSummary was not found.');
    }
  }

  return {
    createStateUpdate(userId, subjectId, value) {
      const input = requireOnlyFields(value, 'body', [
        'currentState',
        'emotion',
        'intensity',
        'changeReason',
        'unresolvedEventIds',
        'continuityConstraints',
        'source',
      ]);
      const requiredFields = [
        'currentState',
        'emotion',
        'intensity',
        'changeReason',
        'unresolvedEventIds',
        'continuityConstraints',
        'source',
      ];
      const missingFields = requiredFields.filter((field) => !Object.hasOwn(input, field));
      if (missingFields.length > 0) {
        throw new ValidationError('State update is missing required fields.', {
          missingFields,
        });
      }

      const subject = requireSubject(userId, subjectId);
      const currentState = requirePlainObject(input.currentState, 'currentState');
      const emotion = requireString(input.emotion, 'emotion', { maxLength: 120 });
      const intensity = requireNumber(input.intensity, 'intensity');
      const changeReason = requireString(input.changeReason, 'changeReason', {
        maxLength: 1_000,
      });
      const unresolvedEventIds = requireStringArray(
        input.unresolvedEventIds,
        'unresolvedEventIds',
        { maximum: 50, itemMaxLength: 128 },
      );
      const continuityConstraints = requireStringArray(
        input.continuityConstraints,
        'continuityConstraints',
        { maximum: 50, itemMaxLength: 500 },
      );
      const source = normalizeSource(input.source);

      return runInTransaction(() => {
        validateSource(subject.ownerUserId, subject.subjectId, source);
        unresolvedEventIds.forEach((eventId) => {
          requireSubjectEvent(
            subject.ownerUserId,
            subject.subjectId,
            eventId,
            'Unresolved',
          );
        });
        const now = clock().toISOString();
        const state = {
          subjectStateId: idFactory(),
          userId: subject.ownerUserId,
          subjectId: subject.subjectId,
          stateVersion: subjectStateRepository.nextVersion(
            subject.ownerUserId,
            subject.subjectId,
          ),
          currentState,
          emotion,
          intensity,
          changeReason,
          unresolvedEventIds,
          continuityConstraints,
          source,
          createdAt: now,
        };

        subjectStateRepository.insert(state);
        unresolvedEventIds.forEach((eventId, index) => {
          subjectStateRepository.insertUnresolvedEvent({
            subjectStateEventId: idFactory(),
            subjectStateId: state.subjectStateId,
            userId: state.userId,
            subjectId: state.subjectId,
            order: index + 1,
            eventId,
            createdAt: now,
          });
        });
        subjectStateRepository.setCurrent(
          state.userId,
          state.subjectId,
          state.subjectStateId,
          now,
        );

        return subjectStateRepository.findById(
          state.userId,
          state.subjectId,
          state.subjectStateId,
        );
      });
    },
    getCurrentState(userId, subjectId) {
      const subject = requireSubject(userId, subjectId);
      return subjectStateRepository.findCurrent(subject.ownerUserId, subject.subjectId);
    },
    getStateUpdate(userId, subjectId, subjectStateId) {
      const subject = requireSubject(userId, subjectId);
      const normalizedStateId = requireString(subjectStateId, 'subjectStateId', {
        maxLength: 128,
      });
      const state = subjectStateRepository.findById(
        subject.ownerUserId,
        subject.subjectId,
        normalizedStateId,
      );

      if (!state) {
        throw new NotFoundError('Subject state update was not found.');
      }

      return state;
    },
    listStateUpdates(userId, subjectId, filters = {}) {
      const subject = requireSubject(userId, subjectId);
      return subjectStateRepository.findMany(
        subject.ownerUserId,
        subject.subjectId,
        normalizeLimit(filters.limit),
      );
    },
  };
}
