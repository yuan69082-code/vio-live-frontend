function mapEvent(row) {
  if (!row) {
    return null;
  }

  return {
    eventId: row.event_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    eventType: row.event_type,
    source: {
      type: row.source_type,
      reference: row.source_ref,
    },
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    data: JSON.parse(row.event_data_json),
    summary: row.summary,
    status: row.status,
  };
}

export function createSqliteEventRepository(connection) {
  const insertStatement = connection.prepare(`
    INSERT INTO events (
      event_id,
      user_id,
      subject_id,
      event_type,
      source_type,
      source_ref,
      occurred_at,
      recorded_at,
      event_data_json,
      summary,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    SELECT
      event_id,
      user_id,
      subject_id,
      event_type,
      source_type,
      source_ref,
      occurred_at,
      recorded_at,
      event_data_json,
      summary,
      status
    FROM events
    WHERE user_id = ? AND event_id = ?
  `);

  return {
    insert(event) {
      insertStatement.run(
        event.eventId,
        event.userId,
        event.subjectId,
        event.eventType,
        event.source.type,
        event.source.reference,
        event.occurredAt,
        event.recordedAt,
        JSON.stringify(event.data),
        event.summary,
        event.status,
      );

      return event;
    },
    findById(userId, eventId) {
      return mapEvent(findByIdStatement.get(userId, eventId));
    },
    findMany({ userId, subjectId, eventType, status, from, to, limit }) {
      const conditions = ['user_id = ?'];
      const parameters = [userId];

      if (subjectId) {
        conditions.push('subject_id = ?');
        parameters.push(subjectId);
      }

      if (eventType) {
        conditions.push('event_type = ?');
        parameters.push(eventType);
      }

      if (status) {
        conditions.push('status = ?');
        parameters.push(status);
      }

      if (from) {
        conditions.push('occurred_at >= ?');
        parameters.push(from);
      }

      if (to) {
        conditions.push('occurred_at <= ?');
        parameters.push(to);
      }

      parameters.push(limit);
      const statement = connection.prepare(`
        SELECT
          event_id,
          user_id,
          subject_id,
          event_type,
          source_type,
          source_ref,
          occurred_at,
          recorded_at,
          event_data_json,
          summary,
          status
        FROM events
        WHERE ${conditions.join(' AND ')}
        ORDER BY occurred_at DESC, recorded_at DESC, event_id DESC
        LIMIT ?
      `);

      return statement.all(...parameters).map(mapEvent);
    },
  };
}
