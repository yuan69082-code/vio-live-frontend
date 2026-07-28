import { ConflictError } from '../../core/errors.js';

function mapMessageVersion(row) {
  if (!row) {
    return null;
  }

  return {
    messageVersionId: row.message_version_id,
    messageId: row.message_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    conversationId: row.conversation_id,
    versionNumber: row.version_number,
    senderType: row.sender_type,
    changeReason: row.change_reason,
    content: row.content,
    parentVersionId: row.parent_version_id,
    createdAt: row.created_at,
    isCurrent: row.is_current === 1,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteMessageVersionRepository(connection) {
  const selection = `
    SELECT
      message_versions.message_version_id,
      message_versions.message_id,
      message_versions.user_id,
      message_versions.subject_id,
      message_versions.conversation_id,
      message_versions.version_number,
      message_versions.sender_type,
      message_versions.change_reason,
      message_versions.content,
      message_versions.parent_version_id,
      message_versions.created_at,
      CASE
        WHEN messages.current_version_id = message_versions.message_version_id THEN 1
        ELSE 0
      END AS is_current
    FROM message_versions
    INNER JOIN messages
      ON messages.user_id = message_versions.user_id
      AND messages.subject_id = message_versions.subject_id
      AND messages.conversation_id = message_versions.conversation_id
      AND messages.message_id = message_versions.message_id
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO message_versions (
      message_version_id,
      user_id,
      subject_id,
      conversation_id,
      message_id,
      version_number,
      sender_type,
      change_reason,
      content,
      parent_version_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE message_versions.user_id = ?
      AND message_versions.subject_id = ?
      AND message_versions.conversation_id = ?
      AND message_versions.message_id = ?
      AND message_versions.message_version_id = ?
  `);
  const findManyStatement = connection.prepare(`
    ${selection}
    WHERE message_versions.user_id = ?
      AND message_versions.subject_id = ?
      AND message_versions.conversation_id = ?
      AND message_versions.message_id = ?
    ORDER BY
      message_versions.version_number,
      message_versions.created_at,
      message_versions.message_version_id
  `);

  return {
    insert(version) {
      try {
        insertStatement.run(
          version.messageVersionId,
          version.userId,
          version.subjectId,
          version.conversationId,
          version.messageId,
          version.versionNumber,
          version.senderType,
          version.changeReason,
          version.content,
          version.parentVersionId ?? null,
          version.createdAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Message version could not be appended to this message.');
        }

        throw error;
      }

      return mapMessageVersion(
        findByIdStatement.get(
          version.userId,
          version.subjectId,
          version.conversationId,
          version.messageId,
          version.messageVersionId,
        ),
      );
    },
    findById(userId, subjectId, conversationId, messageId, messageVersionId) {
      return mapMessageVersion(
        findByIdStatement.get(
          userId,
          subjectId,
          conversationId,
          messageId,
          messageVersionId,
        ),
      );
    },
    findMany(userId, subjectId, conversationId, messageId) {
      return findManyStatement
        .all(userId, subjectId, conversationId, messageId)
        .map(mapMessageVersion);
    },
  };
}
