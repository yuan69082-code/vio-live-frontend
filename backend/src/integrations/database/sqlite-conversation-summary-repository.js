import { ConflictError } from '../../core/errors.js';

function mapSummary(row) {
  if (!row) {
    return null;
  }

  return {
    summaryId: row.summary_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    conversationId: row.conversation_id,
    summaryVersion: row.summary_version,
    content: row.summary_text,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapSource(row) {
  if (!row) {
    return null;
  }

  const reference = row.source_type === 'message_version'
    ? {
        conversationId: row.conversation_id,
        messageId: row.source_message_id,
        messageVersionId: row.source_message_version_id,
      }
    : { eventId: row.source_event_id };

  return {
    summarySourceId: row.summary_source_id,
    order: row.source_order,
    type: row.source_type,
    reference,
    createdAt: row.created_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteConversationSummaryRepository(connection) {
  const selection = `
    SELECT
      summary_id,
      user_id,
      subject_id,
      conversation_id,
      summary_version,
      summary_text,
      status,
      created_at
    FROM conversation_summaries
  `;
  const insertSummaryStatement = connection.prepare(`
    INSERT INTO conversation_summaries (
      summary_id,
      user_id,
      subject_id,
      conversation_id,
      summary_version,
      summary_text,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSourceStatement = connection.prepare(`
    INSERT INTO conversation_summary_sources (
      summary_source_id,
      summary_id,
      user_id,
      subject_id,
      conversation_id,
      source_order,
      source_type,
      source_message_id,
      source_message_version_id,
      source_event_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ?
      AND subject_id = ?
      AND conversation_id = ?
      AND summary_id = ?
  `);
  const findManyForConversationStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ?
      AND subject_id = ?
      AND conversation_id = ?
      AND status = 'active'
    ORDER BY summary_version DESC, summary_id DESC
    LIMIT ?
  `);
  const findCrossWindowStatement = connection.prepare(`
    ${selection} AS summaries
    WHERE summaries.user_id = ?
      AND summaries.subject_id = ?
      AND summaries.conversation_id <> ?
      AND summaries.status = 'active'
      AND summaries.summary_version = (
        SELECT MAX(latest.summary_version)
        FROM conversation_summaries AS latest
        WHERE latest.user_id = summaries.user_id
          AND latest.subject_id = summaries.subject_id
          AND latest.conversation_id = summaries.conversation_id
          AND latest.status = 'active'
      )
    ORDER BY summaries.created_at DESC, summaries.summary_id DESC
    LIMIT ?
  `);
  const nextVersionStatement = connection.prepare(`
    SELECT COALESCE(MAX(summary_version), 0) + 1 AS next_summary_version
    FROM conversation_summaries
    WHERE user_id = ?
      AND subject_id = ?
      AND conversation_id = ?
  `);
  const findSourcesStatement = connection.prepare(`
    SELECT
      summary_source_id,
      summary_id,
      user_id,
      subject_id,
      conversation_id,
      source_order,
      source_type,
      source_message_id,
      source_message_version_id,
      source_event_id,
      created_at
    FROM conversation_summary_sources
    WHERE user_id = ?
      AND subject_id = ?
      AND conversation_id = ?
      AND summary_id = ?
    ORDER BY source_order, summary_source_id
  `);

  function withSources(summary) {
    if (!summary) {
      return null;
    }

    return {
      ...summary,
      sources: findSourcesStatement
        .all(
          summary.userId,
          summary.subjectId,
          summary.conversationId,
          summary.summaryId,
        )
        .map(mapSource),
    };
  }

  return {
    insert(summary) {
      try {
        insertSummaryStatement.run(
          summary.summaryId,
          summary.userId,
          summary.subjectId,
          summary.conversationId,
          summary.summaryVersion,
          summary.content,
          summary.status,
          summary.createdAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Conversation summary could not be created.');
        }

        throw error;
      }

      return mapSummary(
        findByIdStatement.get(
          summary.userId,
          summary.subjectId,
          summary.conversationId,
          summary.summaryId,
        ),
      );
    },
    insertSource(source) {
      try {
        insertSourceStatement.run(
          source.summarySourceId,
          source.summaryId,
          source.userId,
          source.subjectId,
          source.conversationId,
          source.order,
          source.type,
          source.messageId ?? null,
          source.messageVersionId ?? null,
          source.eventId ?? null,
          source.createdAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Conversation summary source could not be recorded.');
        }

        throw error;
      }

      return source;
    },
    nextVersion(userId, subjectId, conversationId) {
      return nextVersionStatement.get(userId, subjectId, conversationId)
        .next_summary_version;
    },
    findById(userId, subjectId, conversationId, summaryId) {
      return withSources(
        mapSummary(findByIdStatement.get(userId, subjectId, conversationId, summaryId)),
      );
    },
    findManyForConversation(userId, subjectId, conversationId, limit) {
      return findManyForConversationStatement
        .all(userId, subjectId, conversationId, limit)
        .map(mapSummary)
        .map(withSources);
    },
    findCrossWindow(userId, subjectId, excludedConversationId, limit) {
      return findCrossWindowStatement
        .all(userId, subjectId, excludedConversationId, limit)
        .map(mapSummary)
        .map(withSources);
    },
  };
}
