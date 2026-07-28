import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    throw new ValidationError('Request body contains unsupported fields.', {
      unexpectedFields,
    });
  }

  return input;
}

export function createConversationService({
  conversationRepository,
  userRepository,
  subjectRepository,
  eventService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireScope(userId, subjectId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });

    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }

    if (!subjectRepository.findById(normalizedUserId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }

    return {
      userId: normalizedUserId,
      subjectId: normalizedSubjectId,
    };
  }

  function getConversation(userId, subjectId, conversationId) {
    const scope = requireScope(userId, subjectId);
    const normalizedConversationId = requireString(
      conversationId,
      'conversationId',
      { maxLength: 128 },
    );
    const conversation = conversationRepository.findById(
      scope.userId,
      scope.subjectId,
      normalizedConversationId,
    );

    if (!conversation) {
      throw new NotFoundError('Conversation was not found for this user and subject.');
    }

    return conversation;
  }

  return {
    createConversation(userId, subjectId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, ['title']);
      const now = clock().toISOString();
      const conversation = {
        conversationId: idFactory(),
        userId: scope.userId,
        subjectId: scope.subjectId,
        title: requireString(input.title, 'title', { maxLength: 200 }),
        status: 'active',
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      };

      return runInTransaction(() => {
        const created = conversationRepository.insert(conversation);
        eventService.createEvent(scope.userId, {
          subjectId: scope.subjectId,
          eventType: 'conversation_created',
          source: {
            type: 'conversation-service',
            reference: created.conversationId,
          },
          data: {
            conversationId: created.conversationId,
            status: created.status,
          },
          summary: 'A conversation was created.',
        });
        return created;
      });
    },
    getConversation,
    listConversations(userId, subjectId) {
      const scope = requireScope(userId, subjectId);
      return conversationRepository.findMany(scope.userId, scope.subjectId);
    },
  };
}
