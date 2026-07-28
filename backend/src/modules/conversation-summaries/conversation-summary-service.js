import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';

const SUMMARY_SOURCE_TYPES = Object.freeze(['message_version', 'event']);

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

function normalizeLimit(value, { fallback, maximum }) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (!/^\d+$/.test(String(value))) {
    throw new ValidationError(`limit must be an integer between 1 and ${maximum}.`, {
      field: 'limit',
    });
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new ValidationError(`limit must be an integer between 1 and ${maximum}.`, {
      field: 'limit',
    });
  }

  return limit;
}

function normalizeSources(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new ValidationError('sources must contain between 1 and 100 references.', {
      field: 'sources',
    });
  }

  const normalized = value.map((source, index) => {
    const field = `sources[${index}]`;
    const input = requirePlainObject(source, field);
    const type = requireString(input.type, `${field}.type`, { maxLength: 40 });

    if (!SUMMARY_SOURCE_TYPES.includes(type)) {
      throw new ValidationError(`${field}.type is not supported.`, {
        field: `${field}.type`,
        allowedValues: SUMMARY_SOURCE_TYPES,
      });
    }

    if (type === 'message_version') {
      const messageSource = requireOnlyFields(
        input,
        field,
        ['type', 'messageId', 'messageVersionId'],
      );
      return {
        type,
        messageId: requireString(messageSource.messageId, `${field}.messageId`, {
          maxLength: 128,
        }),
        messageVersionId: requireString(
          messageSource.messageVersionId,
          `${field}.messageVersionId`,
          { maxLength: 128 },
        ),
      };
    }

    const eventSource = requireOnlyFields(input, field, ['type', 'eventId']);
    return {
      type,
      eventId: requireString(eventSource.eventId, `${field}.eventId`, {
        maxLength: 128,
      }),
    };
  });
  const keys = normalized.map((source) => (
    source.type === 'message_version'
      ? `${source.type}:${source.messageId}:${source.messageVersionId}`
      : `${source.type}:${source.eventId}`
  ));

  if (new Set(keys).size !== keys.length) {
    throw new ValidationError('sources must not contain duplicate references.', {
      field: 'sources',
    });
  }

  return normalized;
}

export function createConversationSummaryService({
  conversationService,
  conversationSummaryRepository,
  messageVersionRepository,
  eventRepository,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function validateSources(conversation, sources) {
    for (const source of sources) {
      if (source.type === 'message_version') {
        const version = messageVersionRepository.findById(
          conversation.userId,
          conversation.subjectId,
          conversation.conversationId,
          source.messageId,
          source.messageVersionId,
        );

        if (!version) {
          throw new NotFoundError(
            'Summary message version source was not found in this conversation.',
          );
        }

        continue;
      }

      const event = eventRepository.findById(conversation.userId, source.eventId);
      if (!event || event.subjectId !== conversation.subjectId) {
        throw new NotFoundError('Summary event source was not found for this subject.');
      }
    }
  }

  return {
    createSummary(userId, subjectId, conversationId, value) {
      const input = requireOnlyFields(value, 'body', ['content', 'sources']);
      const content = requireString(input.content, 'content', { maxLength: 16_384 });
      const sources = normalizeSources(input.sources);

      return runInTransaction(() => {
        const conversation = conversationService.getConversation(
          userId,
          subjectId,
          conversationId,
        );
        validateSources(conversation, sources);
        const now = clock().toISOString();
        const summary = conversationSummaryRepository.insert({
          summaryId: idFactory(),
          userId: conversation.userId,
          subjectId: conversation.subjectId,
          conversationId: conversation.conversationId,
          summaryVersion: conversationSummaryRepository.nextVersion(
            conversation.userId,
            conversation.subjectId,
            conversation.conversationId,
          ),
          content,
          status: 'active',
          createdAt: now,
        });

        sources.forEach((source, index) => {
          conversationSummaryRepository.insertSource({
            summarySourceId: idFactory(),
            summaryId: summary.summaryId,
            userId: summary.userId,
            subjectId: summary.subjectId,
            conversationId: summary.conversationId,
            order: index + 1,
            type: source.type,
            messageId: source.messageId,
            messageVersionId: source.messageVersionId,
            eventId: source.eventId,
            createdAt: now,
          });
        });

        return conversationSummaryRepository.findById(
          summary.userId,
          summary.subjectId,
          summary.conversationId,
          summary.summaryId,
        );
      });
    },
    getSummary(userId, subjectId, conversationId, summaryId) {
      const conversation = conversationService.getConversation(
        userId,
        subjectId,
        conversationId,
      );
      const normalizedSummaryId = requireString(summaryId, 'summaryId', {
        maxLength: 128,
      });
      const summary = conversationSummaryRepository.findById(
        conversation.userId,
        conversation.subjectId,
        conversation.conversationId,
        normalizedSummaryId,
      );

      if (!summary) {
        throw new NotFoundError('Conversation summary was not found.');
      }

      return summary;
    },
    listSummaries(userId, subjectId, conversationId, filters = {}) {
      const conversation = conversationService.getConversation(
        userId,
        subjectId,
        conversationId,
      );
      return conversationSummaryRepository.findManyForConversation(
        conversation.userId,
        conversation.subjectId,
        conversation.conversationId,
        normalizeLimit(filters.limit, { fallback: 50, maximum: 100 }),
      );
    },
    listCrossWindowSummaries(userId, subjectId, conversationId, filters = {}) {
      const conversation = conversationService.getConversation(
        userId,
        subjectId,
        conversationId,
      );
      return conversationSummaryRepository.findCrossWindow(
        conversation.userId,
        conversation.subjectId,
        conversation.conversationId,
        normalizeLimit(filters.limit, { fallback: 5, maximum: 20 }),
      );
    },
  };
}
