import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import { requireMessageContent } from '../messages/message-types.js';

function requireVersionInput(value) {
  const input = requirePlainObject(value, 'body');
  const allowedFields = ['baseVersionId', 'content'];
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    throw new ValidationError('Request body contains unsupported fields.', {
      unexpectedFields,
    });
  }

  return {
    baseVersionId: requireString(input.baseVersionId, 'baseVersionId', { maxLength: 128 }),
    content: requireMessageContent(input.content),
  };
}

export function createMessageVersionService({
  conversationService,
  conversationRepository,
  messageService,
  messageRepository,
  messageVersionRepository,
  eventService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function appendVersion(
    userId,
    subjectId,
    conversationId,
    messageId,
    value,
    { requiredSenderType, changeReason, eventType },
  ) {
    const input = requireVersionInput(value);

    return runInTransaction(() => {
      const conversation = conversationService.getConversation(
        userId,
        subjectId,
        conversationId,
      );
      const message = messageService.getMessage(
        conversation.userId,
        conversation.subjectId,
        conversation.conversationId,
        messageId,
      );

      if (message.senderType !== requiredSenderType) {
        throw new ConflictError(
          changeReason === 'edited'
            ? 'Only user messages can be edited.'
            : 'Only subject messages can be regenerated.',
        );
      }

      if (message.currentVersionId !== input.baseVersionId) {
        throw new ConflictError('baseVersionId is no longer the current message version.');
      }

      if (message.content === input.content) {
        throw new ConflictError('New message content must differ from the current version.');
      }

      const currentVersion = messageVersionRepository.findById(
        message.userId,
        message.subjectId,
        message.conversationId,
        message.messageId,
        message.currentVersionId,
      );

      if (!currentVersion) {
        throw new NotFoundError('Current message version was not found.');
      }

      const now = clock().toISOString();
      const version = {
        messageVersionId: idFactory(),
        messageId: message.messageId,
        conversationId: message.conversationId,
        userId: message.userId,
        subjectId: message.subjectId,
        versionNumber: currentVersion.versionNumber + 1,
        senderType: message.senderType,
        content: input.content,
        changeReason,
        parentVersionId: currentVersion.messageVersionId,
        createdAt: now,
      };

      messageVersionRepository.insert(version);
      messageRepository.setCurrentVersion(
        message.userId,
        message.subjectId,
        message.conversationId,
        message.messageId,
        {
          currentVersionId: version.messageVersionId,
          updatedAt: now,
        },
      );
      conversationRepository.touch(
        conversation.userId,
        conversation.subjectId,
        conversation.conversationId,
        {
          lastActivityAt: now,
          updatedAt: now,
        },
      );
      eventService.createEvent(message.userId, {
        subjectId: message.subjectId,
        eventType,
        source: {
          type: 'message-version-service',
          reference: version.messageVersionId,
        },
        data: {
          conversationId: message.conversationId,
          messageId: message.messageId,
          messageVersionId: version.messageVersionId,
          parentVersionId: version.parentVersionId,
          versionNumber: version.versionNumber,
        },
        summary: changeReason === 'edited'
          ? 'A user message was edited.'
          : 'A subject message regeneration was recorded.',
      });

      return messageVersionRepository.findById(
        message.userId,
        message.subjectId,
        message.conversationId,
        message.messageId,
        version.messageVersionId,
      );
    });
  }

  return {
    editUserMessage(userId, subjectId, conversationId, messageId, value) {
      return appendVersion(userId, subjectId, conversationId, messageId, value, {
        requiredSenderType: 'user',
        changeReason: 'edited',
        eventType: 'message_updated',
      });
    },
    regenerateSubjectMessage(userId, subjectId, conversationId, messageId, value) {
      return appendVersion(userId, subjectId, conversationId, messageId, value, {
        requiredSenderType: 'subject',
        changeReason: 'regenerated',
        eventType: 'message_regenerated',
      });
    },
    getMessageVersion(userId, subjectId, conversationId, messageId, messageVersionId) {
      const message = messageService.getMessage(
        userId,
        subjectId,
        conversationId,
        messageId,
      );
      const normalizedVersionId = requireString(
        messageVersionId,
        'messageVersionId',
        { maxLength: 128 },
      );
      const version = messageVersionRepository.findById(
        message.userId,
        message.subjectId,
        message.conversationId,
        message.messageId,
        normalizedVersionId,
      );

      if (!version) {
        throw new NotFoundError('Message version was not found for this message.');
      }

      return version;
    },
    listMessageVersions(userId, subjectId, conversationId, messageId) {
      const message = messageService.getMessage(
        userId,
        subjectId,
        conversationId,
        messageId,
      );
      return messageVersionRepository.findMany(
        message.userId,
        message.subjectId,
        message.conversationId,
        message.messageId,
      );
    },
  };
}
