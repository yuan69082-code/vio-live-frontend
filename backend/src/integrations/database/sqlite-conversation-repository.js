import { ConflictError } from '../../core/errors.js';

function mapConversation(row) {
  if (!row) {
    return null;
  }

  return {
    conversationId: row.conversation_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteConversationRepository(connection) {
  const selection = `
    SELECT
      conversation_id,
      user_id,
      subject_id,
      title,
      status,
      created_at,
      updated_at,
      last_activity_at
    FROM conversations
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO conversations (
      conversation_id,
      user_id,
      subject_id,
      title,
      status,
      created_at,
      updated_at,
      last_activity_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ?
      AND subject_id = ?
      AND conversation_id = ?
  `);
  const findManyStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ? AND subject_id = ?
    ORDER BY last_activity_at DESC, conversation_id
  `);
  const touchStatement = connection.prepare(`
    UPDATE conversations
    SET updated_at = ?, last_activity_at = ?
    WHERE user_id = ?
      AND subject_id = ?
      AND conversation_id = ?
  `);

  return {
    insert(conversation) {
      const lastActivityAt = conversation.lastActivityAt ?? conversation.createdAt;

      try {
        insertStatement.run(
          conversation.conversationId,
          conversation.userId,
          conversation.subjectId,
          conversation.title,
          conversation.status,
          conversation.createdAt,
          conversation.updatedAt,
          lastActivityAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Conversation could not be created for this subject.');
        }

        throw error;
      }

      return mapConversation(
        findByIdStatement.get(
          conversation.userId,
          conversation.subjectId,
          conversation.conversationId,
        ),
      );
    },
    findById(userId, subjectId, conversationId) {
      return mapConversation(findByIdStatement.get(userId, subjectId, conversationId));
    },
    findMany(userId, subjectId) {
      return findManyStatement.all(userId, subjectId).map(mapConversation);
    },
    touch(userId, subjectId, conversationId, { lastActivityAt, updatedAt }) {
      const result = touchStatement.run(
        updatedAt,
        lastActivityAt,
        userId,
        subjectId,
        conversationId,
      );

      if (result.changes === 0) {
        return null;
      }

      return mapConversation(findByIdStatement.get(userId, subjectId, conversationId));
    },
  };
}
