import { ConflictError } from '../../core/errors.js';

function mapMessage(row) {
  if (!row) {
    return null;
  }

  return {
    messageId: row.message_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    status: row.status,
    sequenceNumber: row.sequence_number,
    currentVersionId: row.current_version_id,
    currentVersionNumber: row.current_version_number,
    content: row.current_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteMessageRepository(connection) {
  const selection = `
    SELECT
      messages.message_id,
      messages.user_id,
      messages.subject_id,
      messages.conversation_id,
      messages.sender_type,
      messages.status,
      messages.sequence_number,
      messages.current_version_id,
      current_version.version_number AS current_version_number,
      current_version.content AS current_content,
      messages.created_at,
      messages.updated_at
    FROM messages
    LEFT JOIN message_versions AS current_version
      ON current_version.user_id = messages.user_id
      AND current_version.subject_id = messages.subject_id
      AND current_version.conversation_id = messages.conversation_id
      AND current_version.message_id = messages.message_id
      AND current_version.message_version_id = messages.current_version_id
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO messages (
      message_id,
      user_id,
      subject_id,
      conversation_id,
      sender_type,
      status,
      sequence_number,
      current_version_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE messages.user_id = ?
      AND messages.subject_id = ?
      AND messages.conversation_id = ?
      AND messages.message_id = ?
  `);
  const findManyStatement = connection.prepare(`
    ${selection}
    WHERE messages.user_id = ?
      AND messages.subject_id = ?
      AND messages.conversation_id = ?
    ORDER BY messages.sequence_number, messages.message_id
  `);
  const findRecentStatement = connection.prepare(`
    ${selection}
    WHERE messages.user_id = ?
      AND messages.subject_id = ?
      AND messages.conversation_id = ?
    ORDER BY messages.sequence_number DESC, messages.message_id DESC
    LIMIT ?
  `);
  const nextSequenceNumberStatement = connection.prepare(`
    SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence_number
    FROM messages
    WHERE user_id = ?
      AND subject_id = ?
      AND conversation_id = ?
  `);
  const setCurrentVersionStatement = connection.prepare(`
    UPDATE messages
    SET current_version_id = ?, updated_at = ?
    WHERE user_id = ?
      AND subject_id = ?
      AND conversation_id = ?
      AND message_id = ?
  `);

  return {
    insert(message) {
      try {
        insertStatement.run(
          message.messageId,
          message.userId,
          message.subjectId,
          message.conversationId,
          message.senderType,
          message.status,
          message.sequenceNumber,
          message.currentVersionId ?? null,
          message.createdAt,
          message.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Message could not be created for this conversation.');
        }

        throw error;
      }

      return mapMessage(
        findByIdStatement.get(
          message.userId,
          message.subjectId,
          message.conversationId,
          message.messageId,
        ),
      );
    },
    findById(userId, subjectId, conversationId, messageId) {
      return mapMessage(
        findByIdStatement.get(userId, subjectId, conversationId, messageId),
      );
    },
    findMany(userId, subjectId, conversationId) {
      return findManyStatement.all(userId, subjectId, conversationId).map(mapMessage);
    },
    findRecent(userId, subjectId, conversationId, limit) {
      return findRecentStatement
        .all(userId, subjectId, conversationId, limit)
        .map(mapMessage)
        .reverse();
    },
    nextSequenceNumber(userId, subjectId, conversationId) {
      return nextSequenceNumberStatement.get(userId, subjectId, conversationId)
        .next_sequence_number;
    },
    setCurrentVersion(
      userId,
      subjectId,
      conversationId,
      messageId,
      { currentVersionId, updatedAt },
    ) {
      try {
        const result = setCurrentVersionStatement.run(
          currentVersionId,
          updatedAt,
          userId,
          subjectId,
          conversationId,
          messageId,
        );

        if (result.changes === 0) {
          return null;
        }
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Current version must belong to this message.');
        }

        throw error;
      }

      return mapMessage(
        findByIdStatement.get(userId, subjectId, conversationId, messageId),
      );
    },
  };
}
