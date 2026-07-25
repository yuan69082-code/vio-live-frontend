import { ConflictError } from '../../core/errors.js';

function mapSubject(row) {
  if (!row) {
    return null;
  }

  return {
    subjectId: row.subject_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    avatarRef: row.avatar_ref,
    basicSettings: JSON.parse(row.basic_settings_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteSubjectRepository(connection) {
  const insertStatement = connection.prepare(`
    INSERT INTO subjects (
      subject_id,
      owner_user_id,
      name,
      avatar_ref,
      basic_settings_json,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    SELECT
      subject_id,
      owner_user_id,
      name,
      avatar_ref,
      basic_settings_json,
      status,
      created_at,
      updated_at
    FROM subjects
    WHERE owner_user_id = ? AND subject_id = ?
  `);

  return {
    insert(subject) {
      try {
        insertStatement.run(
          subject.subjectId,
          subject.ownerUserId,
          subject.name,
          subject.avatarRef,
          JSON.stringify(subject.basicSettings),
          subject.status,
          subject.createdAt,
          subject.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Subject could not be created for this user.');
        }

        throw error;
      }

      return subject;
    },
    findById(ownerUserId, subjectId) {
      return mapSubject(findByIdStatement.get(ownerUserId, subjectId));
    },
  };
}
