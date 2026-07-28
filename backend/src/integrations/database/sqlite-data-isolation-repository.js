function mapOwnership(row, resourceType) {
  if (!row) {
    return null;
  }

  return {
    resourceType,
    resourceId: row.resource_id,
    userId: row.user_id,
    assistantId: row.assistant_id ?? null,
  };
}

export function createSqliteDataIsolationRepository(connection) {
  const statements = Object.freeze({
    user_space: connection.prepare(`
      SELECT space_id AS resource_id, user_id, NULL AS assistant_id
      FROM user_spaces
      WHERE user_id = ? AND space_id = ?
    `),
    assistant: connection.prepare(`
      SELECT subject_id AS resource_id, owner_user_id AS user_id, subject_id AS assistant_id
      FROM subjects
      WHERE owner_user_id = ? AND subject_id = ? AND subject_id = ?
    `),
    assistant_global_settings: connection.prepare(`
      SELECT subject_id AS resource_id, owner_user_id AS user_id, subject_id AS assistant_id
      FROM assistant_global_settings
      WHERE owner_user_id = ? AND subject_id = ? AND subject_id = ?
    `),
    assistant_private_space: connection.prepare(`
      SELECT space_id AS resource_id, user_id, assistant_id
      FROM assistant_private_spaces
      WHERE user_id = ? AND assistant_id = ? AND space_id = ?
    `),
    subject_state: connection.prepare(`
      SELECT subject_state_id AS resource_id, user_id, subject_id AS assistant_id
      FROM subject_states
      WHERE user_id = ? AND subject_id = ? AND subject_state_id = ?
    `),
    device: connection.prepare(`
      SELECT device_id AS resource_id, owner_user_id AS user_id, NULL AS assistant_id
      FROM device_registry
      WHERE owner_user_id = ? AND device_id = ?
    `),
    life_financial_record: connection.prepare(`
      SELECT financial_record_id AS resource_id, user_id, subject_id AS assistant_id
      FROM life_financial_records
      WHERE user_id = ? AND subject_id = ? AND financial_record_id = ?
    `),
    life_budget: connection.prepare(`
      SELECT budget_id AS resource_id, user_id, subject_id AS assistant_id
      FROM life_budgets
      WHERE user_id = ? AND subject_id = ? AND budget_id = ?
    `),
    life_calendar_entry: connection.prepare(`
      SELECT calendar_entry_id AS resource_id, user_id, subject_id AS assistant_id
      FROM life_calendar_entries
      WHERE user_id = ? AND subject_id = ? AND calendar_entry_id = ?
    `),
    life_body_record: connection.prepare(`
      SELECT body_record_id AS resource_id, user_id, subject_id AS assistant_id
      FROM life_body_records
      WHERE user_id = ? AND subject_id = ? AND body_record_id = ?
    `),
    life_body_goal: connection.prepare(`
      SELECT body_goal_id AS resource_id, user_id, subject_id AS assistant_id
      FROM life_body_goals
      WHERE user_id = ? AND subject_id = ? AND body_goal_id = ?
    `),
    local_memory: connection.prepare(`
      SELECT memory_id AS resource_id, user_id, subject_id AS assistant_id
      FROM local_memories
      WHERE user_id = ? AND subject_id = ? AND memory_id = ?
    `),
    event: connection.prepare(`
      SELECT event_id AS resource_id, user_id, subject_id AS assistant_id
      FROM events
      WHERE user_id = ? AND event_id = ? AND (? IS NULL OR subject_id = ?)
    `),
  });

  const assistantScopedTypes = new Set([
    'assistant',
    'assistant_global_settings',
    'assistant_private_space',
    'subject_state',
    'life_financial_record',
    'life_budget',
    'life_calendar_entry',
    'life_body_record',
    'life_body_goal',
    'local_memory',
  ]);

  return {
    findOwnership({ resourceType, userId, assistantId, resourceId }) {
      let row;

      if (assistantScopedTypes.has(resourceType)) {
        row = statements[resourceType].get(userId, assistantId, resourceId);
      } else if (resourceType === 'event') {
        row = statements.event.get(userId, resourceId, assistantId, assistantId);
      } else {
        row = statements[resourceType].get(userId, resourceId);
      }

      return mapOwnership(row, resourceType);
    },
  };
}
