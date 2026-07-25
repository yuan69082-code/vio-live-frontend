import { ConflictError } from '../../core/errors.js';

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    email: row.primary_email,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteUserRepository(connection) {
  const insertStatement = connection.prepare(`
    INSERT INTO users (
      user_id,
      primary_email,
      display_name,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    SELECT user_id, primary_email, display_name, status, created_at, updated_at
    FROM users
    WHERE user_id = ?
  `);
  const findByEmailStatement = connection.prepare(`
    SELECT user_id, primary_email, display_name, status, created_at, updated_at
    FROM users
    WHERE primary_email = ? COLLATE NOCASE
  `);

  return {
    insert(user) {
      try {
        insertStatement.run(
          user.userId,
          user.email,
          user.displayName,
          user.status,
          user.createdAt,
          user.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('A user with this email already exists.');
        }

        throw error;
      }

      return user;
    },
    findById(userId) {
      return mapUser(findByIdStatement.get(userId));
    },
    findByEmail(email) {
      return mapUser(findByEmailStatement.get(email));
    },
  };
}
