import { ConflictError } from '../../core/errors.js';

function mapRule(row) {
  if (!row) {
    return null;
  }

  return {
    routingRuleId: row.routing_rule_id,
    ownerUserId: row.owner_user_id,
    taskType: row.task_type,
    defaultModelId: row.default_model_id,
    fallbackModelId: row.fallback_model_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteModelRoutingRuleRepository(connection) {
  const selection = `
    SELECT
      routing_rule_id,
      owner_user_id,
      task_type,
      default_model_id,
      fallback_model_id,
      status,
      created_at,
      updated_at
    FROM model_routing_rules
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO model_routing_rules (
      routing_rule_id,
      owner_user_id,
      task_type,
      default_model_id,
      fallback_model_id,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByTaskTypeStatement = connection.prepare(`
    ${selection}
    WHERE owner_user_id = ? AND task_type = ?
  `);
  const findManyByUserStatement = connection.prepare(`
    ${selection}
    WHERE owner_user_id = ?
    ORDER BY CASE task_type
      WHEN 'chat' THEN 1
      WHEN 'long_text' THEN 2
      WHEN 'image' THEN 3
      WHEN 'video' THEN 4
      WHEN 'audio' THEN 5
      WHEN 'search' THEN 6
    END, routing_rule_id
  `);
  const updateStatement = connection.prepare(`
    UPDATE model_routing_rules
    SET
      default_model_id = ?,
      fallback_model_id = ?,
      status = ?,
      updated_at = ?
    WHERE owner_user_id = ? AND task_type = ?
  `);

  return {
    insert(rule) {
      try {
        insertStatement.run(
          rule.routingRuleId,
          rule.ownerUserId,
          rule.taskType,
          rule.defaultModelId,
          rule.fallbackModelId,
          rule.status,
          rule.createdAt,
          rule.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Model routing rule could not be created.');
        }

        throw error;
      }

      return mapRule(
        findByTaskTypeStatement.get(rule.ownerUserId, rule.taskType),
      );
    },
    findByTaskType(ownerUserId, taskType) {
      return mapRule(findByTaskTypeStatement.get(ownerUserId, taskType));
    },
    findManyByUser(ownerUserId) {
      return findManyByUserStatement.all(ownerUserId).map(mapRule);
    },
    update(rule) {
      try {
        const result = updateStatement.run(
          rule.defaultModelId,
          rule.fallbackModelId,
          rule.status,
          rule.updatedAt,
          rule.ownerUserId,
          rule.taskType,
        );

        if (result.changes === 0) {
          return null;
        }
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Model routing rule could not be updated.');
        }

        throw error;
      }

      return mapRule(
        findByTaskTypeStatement.get(rule.ownerUserId, rule.taskType),
      );
    },
  };
}
