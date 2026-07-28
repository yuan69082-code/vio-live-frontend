import { ConflictError } from '../../core/errors.js';

function mapSpace(row) {
  if (!row) {
    return null;
  }

  return {
    spaceId: row.space_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContentVersion(row) {
  if (!row) {
    return null;
  }

  return {
    contentVersionId: row.content_version_id,
    contentId: row.content_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    spaceId: row.space_id,
    contentType: row.content_type,
    versionNumber: row.version_number,
    parentVersionId: row.parent_version_id,
    content: JSON.parse(row.content_json),
    changeReason: row.change_reason,
    sourceType: row.source_type,
    createdAt: row.created_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteAssistantPrivateSpaceRepository(connection) {
  const spaceSelection = `
    SELECT space_id, user_id, assistant_id, status, created_at, updated_at
    FROM assistant_private_spaces
  `;
  const contentSelection = `
    SELECT
      content_version_id,
      content_id,
      user_id,
      assistant_id,
      space_id,
      content_type,
      version_number,
      parent_version_id,
      content_json,
      change_reason,
      source_type,
      created_at
    FROM assistant_private_content_versions
  `;
  const insertSpaceStatement = connection.prepare(`
    INSERT INTO assistant_private_spaces (
      space_id, user_id, assistant_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateSpaceStatusStatement = connection.prepare(`
    UPDATE assistant_private_spaces
    SET status = ?, updated_at = ?
    WHERE user_id = ? AND assistant_id = ? AND space_id = ?
  `);
  const findSpaceStatement = connection.prepare(`
    ${spaceSelection}
    WHERE user_id = ? AND assistant_id = ? AND space_id = ?
  `);
  const findSpaceByAssistantStatement = connection.prepare(`
    ${spaceSelection}
    WHERE user_id = ? AND assistant_id = ?
  `);
  const insertContentVersionStatement = connection.prepare(`
    INSERT INTO assistant_private_content_versions (
      content_version_id,
      content_id,
      user_id,
      assistant_id,
      space_id,
      content_type,
      version_number,
      parent_version_id,
      content_json,
      change_reason,
      source_type,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findContentVersionStatement = connection.prepare(`
    ${contentSelection}
    WHERE user_id = ?
      AND assistant_id = ?
      AND space_id = ?
      AND content_version_id = ?
  `);
  const findLatestContentStatement = connection.prepare(`
    ${contentSelection}
    WHERE user_id = ?
      AND assistant_id = ?
      AND space_id = ?
      AND content_id = ?
    ORDER BY version_number DESC
    LIMIT 1
  `);
  const listVersionsStatement = connection.prepare(`
    ${contentSelection}
    WHERE user_id = ?
      AND assistant_id = ?
      AND space_id = ?
      AND content_id = ?
    ORDER BY version_number DESC, content_version_id DESC
  `);
  const listAllVersionsStatement = connection.prepare(`
    ${contentSelection}
    WHERE user_id = ? AND assistant_id = ? AND space_id = ?
    ORDER BY content_id, version_number, content_version_id
  `);
  const countContentStatement = connection.prepare(`
    SELECT COUNT(DISTINCT content_id) AS content_count, COUNT(*) AS version_count
    FROM assistant_private_content_versions
    WHERE user_id = ? AND assistant_id = ? AND space_id = ?
  `);

  return {
    insertSpace(space) {
      try {
        insertSpaceStatement.run(
          space.spaceId,
          space.userId,
          space.assistantId,
          space.status,
          space.createdAt,
          space.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('An AI private space already exists for this assistant.');
        }
        throw error;
      }

      return mapSpace(findSpaceStatement.get(space.userId, space.assistantId, space.spaceId));
    },
    findSpace(userId, assistantId, spaceId) {
      return mapSpace(findSpaceStatement.get(userId, assistantId, spaceId));
    },
    findSpaceByAssistant(userId, assistantId) {
      return mapSpace(findSpaceByAssistantStatement.get(userId, assistantId));
    },
    updateSpaceStatus(space) {
      const result = updateSpaceStatusStatement.run(
        space.status,
        space.updatedAt,
        space.userId,
        space.assistantId,
        space.spaceId,
      );
      return result.changes === 0
        ? null
        : mapSpace(findSpaceStatement.get(space.userId, space.assistantId, space.spaceId));
    },
    insertContentVersion(version) {
      try {
        insertContentVersionStatement.run(
          version.contentVersionId,
          version.contentId,
          version.userId,
          version.assistantId,
          version.spaceId,
          version.contentType,
          version.versionNumber,
          version.parentVersionId,
          JSON.stringify(version.content),
          version.changeReason,
          version.sourceType,
          version.createdAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('AI private content version could not be saved.');
        }
        throw error;
      }

      return mapContentVersion(findContentVersionStatement.get(
        version.userId,
        version.assistantId,
        version.spaceId,
        version.contentVersionId,
      ));
    },
    findLatestContent(userId, assistantId, spaceId, contentId) {
      return mapContentVersion(findLatestContentStatement.get(
        userId,
        assistantId,
        spaceId,
        contentId,
      ));
    },
    findContentVersion(userId, assistantId, spaceId, contentVersionId) {
      return mapContentVersion(findContentVersionStatement.get(
        userId,
        assistantId,
        spaceId,
        contentVersionId,
      ));
    },
    listLatestContent({ userId, assistantId, spaceId, contentType, limit }) {
      const parameters = [userId, assistantId, spaceId];
      const typeFilter = contentType ? 'AND current.content_type = ?' : '';
      if (contentType) {
        parameters.push(contentType);
      }
      parameters.push(limit);
      return connection.prepare(`
        ${contentSelection} AS current
        WHERE current.user_id = ?
          AND current.assistant_id = ?
          AND current.space_id = ?
          ${typeFilter}
          AND NOT EXISTS (
            SELECT 1
            FROM assistant_private_content_versions AS later
            WHERE later.user_id = current.user_id
              AND later.assistant_id = current.assistant_id
              AND later.space_id = current.space_id
              AND later.content_id = current.content_id
              AND later.version_number > current.version_number
          )
        ORDER BY current.created_at DESC, current.content_id DESC
        LIMIT ?
      `).all(...parameters).map(mapContentVersion);
    },
    listContentVersions(userId, assistantId, spaceId, contentId) {
      return listVersionsStatement
        .all(userId, assistantId, spaceId, contentId)
        .map(mapContentVersion);
    },
    listAllContentVersions(userId, assistantId, spaceId) {
      return listAllVersionsStatement
        .all(userId, assistantId, spaceId)
        .map(mapContentVersion);
    },
    countContent(userId, assistantId, spaceId) {
      const row = countContentStatement.get(userId, assistantId, spaceId);
      return {
        contentCount: row.content_count,
        versionCount: row.version_count,
      };
    },
  };
}
