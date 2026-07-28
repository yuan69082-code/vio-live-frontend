import { ConflictError } from '../../core/errors.js';

function mapUserSpace(row) {
  if (!row) {
    return null;
  }

  return {
    spaceId: row.space_id,
    userId: row.user_id,
    identityMode: row.identity_mode,
    status: row.status,
    currentAssistantId: row.current_assistant_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteUserSpaceRepository(connection) {
  const selection = `
    SELECT
      space_id,
      user_id,
      identity_mode,
      status,
      current_assistant_id,
      created_at,
      updated_at
    FROM user_spaces
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO user_spaces (
      space_id,
      user_id,
      identity_mode,
      status,
      current_assistant_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const findByUserStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ?
  `);
  const updateCurrentAssistantStatement = connection.prepare(`
    UPDATE user_spaces
    SET current_assistant_id = ?, updated_at = ?
    WHERE user_id = ?
  `);
  const setCurrentAssistantIfUnsetStatement = connection.prepare(`
    UPDATE user_spaces
    SET current_assistant_id = ?, updated_at = ?
    WHERE user_id = ? AND current_assistant_id IS NULL
  `);

  return {
    insert(userSpace) {
      try {
        insertStatement.run(
          userSpace.spaceId,
          userSpace.userId,
          userSpace.identityMode,
          userSpace.status,
          userSpace.currentAssistantId,
          userSpace.createdAt,
          userSpace.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('User Space could not be created for this user.');
        }

        throw error;
      }

      return mapUserSpace(findByUserStatement.get(userSpace.userId));
    },
    findByUser(userId) {
      return mapUserSpace(findByUserStatement.get(userId));
    },
    updateCurrentAssistant(userId, assistantId, updatedAt) {
      const result = updateCurrentAssistantStatement.run(assistantId, updatedAt, userId);
      return result.changes === 0 ? null : mapUserSpace(findByUserStatement.get(userId));
    },
    setCurrentAssistantIfUnset(userId, assistantId, updatedAt) {
      setCurrentAssistantIfUnsetStatement.run(assistantId, updatedAt, userId);
      return mapUserSpace(findByUserStatement.get(userId));
    },
  };
}
