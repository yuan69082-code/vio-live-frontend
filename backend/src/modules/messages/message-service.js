import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import { requireMessageContent, requireMessageSender } from './message-types.js';

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

export function createMessageService({
  conversationService,
  conversationRepository,
  messageRepository,
  messageVersionRepository,
  eventService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function getMessage(userId, subjectId, conversationId, messageId) {
    const conversation = conversationService.getConversation(
      userId,
      subjectId,
      conversationId,
    );
    const normalizedMessageId = requireString(messageId, 'messageId', { maxLength: 128 });
    const message = messageRepository.findById(
      conversation.userId,
      conversation.subjectId,
      conversation.conversationId,
      normalizedMessageId,
    );

    if (!message) {
      throw new NotFoundError('Message was not found for this conversation.');
    }

    return message;
  }

  return {
    createMessage(userId, subjectId, conversationId, value) {
      const input = requireOnlyFields(value, ['senderType', 'content']);

      return runInTransaction(() => {
        const conversation = conversationService.getConversation(
          userId,
          subjectId,
          conversationId,
        );
        const senderType = requireMessageSender(input.senderType);
        const content = requireMessageContent(input.content);
        const now = clock().toISOString();
        const message = {
          messageId: idFactory(),
          conversationId: conversation.conversationId,
          userId: conversation.userId,
          subjectId: conversation.subjectId,
          senderType,
          status: 'active',
          sequenceNumber: messageRepository.nextSequenceNumber(
            conversation.userId,
            conversation.subjectId,
            conversation.conversationId,
          ),
          currentVersionId: null,
          createdAt: now,
          updatedAt: now,
        };
        const version = {
          messageVersionId: idFactory(),
          messageId: message.messageId,
          conversationId: message.conversationId,
          userId: message.userId,
          subjectId: message.subjectId,
          versionNumber: 1,
          senderType,
          content,
          changeReason: 'original',
          parentVersionId: null,
          createdAt: now,
        };

        messageRepository.insert(message);
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
        eventService.createEvent(conversation.userId, {
          subjectId: conversation.subjectId,
          eventType: 'message_created',
          source: {
            type: 'message-service',
            reference: message.messageId,
          },
          data: {
            conversationId: conversation.conversationId,
            messageId: message.messageId,
            messageVersionId: version.messageVersionId,
            senderType,
          },
          summary: 'A conversation message was created.',
        });

        return messageRepository.findById(
          message.userId,
          message.subjectId,
          message.conversationId,
          message.messageId,
        );
      });
    },
    getMessage,
    listMessages(userId, subjectId, conversationId) {
      const conversation = conversationService.getConversation(
        userId,
        subjectId,
        conversationId,
      );
      return messageRepository.findMany(
        conversation.userId,
        conversation.subjectId,
        conversation.conversationId,
      );
    },
  };
}
