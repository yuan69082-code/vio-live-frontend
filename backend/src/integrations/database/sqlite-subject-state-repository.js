import { ConflictError } from '../../core/errors.js';

function mapSource(row) {
  if (row.source_type === 'message_version') {
    return {
      type: row.source_type,
      reference: {
        conversationId: row.source_conversation_id,
        messageId: row.source_message_id,
        messageVersionId: row.source_message_version_id,
      },
    };
  }

  if (row.source_type === 'conversation_summary') {
    return {
      type: row.source_type,
      reference: {
        conversationId: row.source_conversation_id,
        summaryId: row.source_summary_id,
      },
    };
  }

  return {
    type: row.source_type,
    reference: { eventId: row.source_event_id },
  };
}

function mapSubjectState(row) {
  if (!row) {
    return null;
  }

  return {
    subjectStateId: row.subject_state_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    stateVersion: row.state_version,
    currentState: JSON.parse(row.current_state_json),
    emotion: row.emotion,
    intensity: row.intensity,
    changeReason: row.change_reason,
    unresolvedEventIds: [],
    continuityConstraints: JSON.parse(row.continuity_constraints_json),
    source: mapSource(row),
    isCurrent: row.is_current === 1,
    createdAt: row.created_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteSubjectStateRepository(connection) {
  const selection = `
    SELECT
      subject_states.subject_state_id,
      subject_states.user_id,
      subject_states.subject_id,
      subject_states.state_version,
      subject_states.current_state_json,
      subject_states.emotion,
      subject_states.intensity,
      subject_states.change_reason,
      subject_states.continuity_constraints_json,
      subject_states.source_type,
      subject_states.source_conversation_id,
      subject_states.source_message_id,
      subject_states.source_message_version_id,
      subject_states.source_event_id,
      subject_states.source_summary_id,
      subject_states.created_at,
      CASE
        WHEN subject_state_heads.current_subject_state_id = subject_states.subject_state_id
          THEN 1
        ELSE 0
      END AS is_current
    FROM subject_states
    LEFT JOIN subject_state_heads
      ON subject_state_heads.user_id = subject_states.user_id
      AND subject_state_heads.subject_id = subject_states.subject_id
  `;
  const insertStateStatement = connection.prepare(`
    INSERT INTO subject_states (
      subject_state_id,
      user_id,
      subject_id,
      state_version,
      current_state_json,
      emotion,
      intensity,
      change_reason,
      continuity_constraints_json,
      source_type,
      source_conversation_id,
      source_message_id,
      source_message_version_id,
      source_event_id,
      source_summary_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertUnresolvedEventStatement = connection.prepare(`
    INSERT INTO subject_state_unresolved_events (
      subject_state_event_id,
      subject_state_id,
      user_id,
      subject_id,
      event_order,
      event_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const setCurrentStatement = connection.prepare(`
    INSERT INTO subject_state_heads (
      user_id,
      subject_id,
      current_subject_state_id,
      updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, subject_id) DO UPDATE SET
      current_subject_state_id = excluded.current_subject_state_id,
      updated_at = excluded.updated_at
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE subject_states.user_id = ?
      AND subject_states.subject_id = ?
      AND subject_states.subject_state_id = ?
  `);
  const findCurrentStatement = connection.prepare(`
    ${selection}
    WHERE subject_states.user_id = ?
      AND subject_states.subject_id = ?
      AND subject_state_heads.current_subject_state_id = subject_states.subject_state_id
  `);
  const findManyStatement = connection.prepare(`
    ${selection}
    WHERE subject_states.user_id = ?
      AND subject_states.subject_id = ?
    ORDER BY subject_states.state_version DESC, subject_states.subject_state_id DESC
    LIMIT ?
  `);
  const nextVersionStatement = connection.prepare(`
    SELECT COALESCE(MAX(state_version), 0) + 1 AS next_state_version
    FROM subject_states
    WHERE user_id = ? AND subject_id = ?
  `);
  const findUnresolvedEventsStatement = connection.prepare(`
    SELECT event_id
    FROM subject_state_unresolved_events
    WHERE user_id = ?
      AND subject_id = ?
      AND subject_state_id = ?
    ORDER BY event_order, subject_state_event_id
  `);

  function withUnresolvedEvents(state) {
    if (!state) {
      return null;
    }

    return {
      ...state,
      unresolvedEventIds: findUnresolvedEventsStatement
        .all(state.userId, state.subjectId, state.subjectStateId)
        .map((row) => row.event_id),
    };
  }

  return {
    insert(state) {
      try {
        insertStateStatement.run(
          state.subjectStateId,
          state.userId,
          state.subjectId,
          state.stateVersion,
          JSON.stringify(state.currentState),
          state.emotion,
          state.intensity,
          state.changeReason,
          JSON.stringify(state.continuityConstraints),
          state.source.type,
          state.source.conversationId ?? null,
          state.source.messageId ?? null,
          state.source.messageVersionId ?? null,
          state.source.eventId ?? null,
          state.source.summaryId ?? null,
          state.createdAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Subject state update could not be recorded.');
        }

        throw error;
      }

      return state;
    },
    insertUnresolvedEvent(reference) {
      try {
        insertUnresolvedEventStatement.run(
          reference.subjectStateEventId,
          reference.subjectStateId,
          reference.userId,
          reference.subjectId,
          reference.order,
          reference.eventId,
          reference.createdAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Unresolved event could not be linked to subject state.');
        }

        throw error;
      }

      return reference;
    },
    setCurrent(userId, subjectId, subjectStateId, updatedAt) {
      try {
        setCurrentStatement.run(userId, subjectId, subjectStateId, updatedAt);
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Current subject state pointer could not be updated.');
        }

        throw error;
      }
    },
    nextVersion(userId, subjectId) {
      return nextVersionStatement.get(userId, subjectId).next_state_version;
    },
    findById(userId, subjectId, subjectStateId) {
      return withUnresolvedEvents(
        mapSubjectState(findByIdStatement.get(userId, subjectId, subjectStateId)),
      );
    },
    findCurrent(userId, subjectId) {
      return withUnresolvedEvents(
        mapSubjectState(findCurrentStatement.get(userId, subjectId)),
      );
    },
    findMany(userId, subjectId, limit) {
      return findManyStatement
        .all(userId, subjectId, limit)
        .map(mapSubjectState)
        .map(withUnresolvedEvents);
    },
  };
}
