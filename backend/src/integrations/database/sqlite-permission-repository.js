import { ConflictError } from '../../core/errors.js';

function mapPermission(row) {
  if (!row) {
    return null;
  }

  return {
    permissionId: row.permission_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    permissionLevel: row.permission_level,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqlitePermissionRepository(connection) {
  const selection = `
    SELECT
      permission_id,
      user_id,
      subject_id,
      resource_type,
      resource_id,
      action,
      permission_level,
      status,
      created_at,
      updated_at
    FROM permissions
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO permissions (
      permission_id,
      user_id,
      subject_id,
      resource_type,
      resource_id,
      action,
      permission_level,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ? AND permission_id = ?
  `);
  const findActiveRuleStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ?
      AND subject_id = ?
      AND resource_type = ?
      AND resource_id = ?
      AND action = ?
      AND status = 'active'
  `);
  const updateStatement = connection.prepare(`
    UPDATE permissions
    SET permission_level = ?, status = ?, updated_at = ?
    WHERE user_id = ? AND permission_id = ?
  `);
  const softDeleteStatement = connection.prepare(`
    UPDATE permissions
    SET status = 'deleted', updated_at = ?
    WHERE user_id = ? AND permission_id = ? AND status <> 'deleted'
  `);
  const consumeOnceStatement = connection.prepare(`
    UPDATE permissions
    SET status = 'consumed', updated_at = ?
    WHERE user_id = ?
      AND permission_id = ?
      AND status = 'active'
      AND permission_level = 'allow_once'
  `);

  return {
    insert(permission) {
      try {
        insertStatement.run(
          permission.permissionId,
          permission.userId,
          permission.subjectId,
          permission.resourceType,
          permission.resourceId,
          permission.action,
          permission.permissionLevel,
          permission.status,
          permission.createdAt,
          permission.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('A current permission rule already exists for this scope.');
        }

        throw error;
      }

      return permission;
    },
    findById(userId, permissionId) {
      return mapPermission(findByIdStatement.get(userId, permissionId));
    },
    findActiveRule({ userId, subjectId, resourceType, resourceId, action }) {
      return mapPermission(findActiveRuleStatement.get(
        userId,
        subjectId,
        resourceType,
        resourceId,
        action,
      ));
    },
    findMany({ userId, subjectId, resourceType, resourceId, action, status }) {
      const conditions = ['user_id = ?'];
      const parameters = [userId];

      if (subjectId) {
        conditions.push('subject_id = ?');
        parameters.push(subjectId);
      }

      if (resourceType) {
        conditions.push('resource_type = ?');
        parameters.push(resourceType);
      }

      if (resourceId) {
        conditions.push('resource_id = ?');
        parameters.push(resourceId);
      }

      if (action) {
        conditions.push('action = ?');
        parameters.push(action);
      }

      if (status) {
        conditions.push('status = ?');
        parameters.push(status);
      } else {
        conditions.push("status <> 'deleted'");
      }

      const statement = connection.prepare(`
        ${selection}
        WHERE ${conditions.join(' AND ')}
        ORDER BY updated_at DESC, permission_id
      `);

      return statement.all(...parameters).map(mapPermission);
    },
    update(userId, permissionId, { permissionLevel, status, updatedAt }) {
      const result = updateStatement.run(
        permissionLevel,
        status,
        updatedAt,
        userId,
        permissionId,
      );

      if (result.changes === 0) {
        return null;
      }

      return mapPermission(findByIdStatement.get(userId, permissionId));
    },
    softDelete(userId, permissionId, updatedAt) {
      const result = softDeleteStatement.run(updatedAt, userId, permissionId);

      if (result.changes === 0) {
        return null;
      }

      return mapPermission(findByIdStatement.get(userId, permissionId));
    },
    consumeOnce(userId, permissionId, updatedAt) {
      const result = consumeOnceStatement.run(updatedAt, userId, permissionId);

      if (result.changes === 0) {
        return null;
      }

      return mapPermission(findByIdStatement.get(userId, permissionId));
    },
  };
}
