import { ConflictError } from '../../core/errors.js';

function mapSettings(row) {
  if (!row) {
    return null;
  }

  return {
    ownerUserId: row.owner_user_id,
    subjectId: row.subject_id,
    personalityDescription: row.personality_description,
    expressionStyle: JSON.parse(row.expression_style_json),
    relationshipDefinition: row.relationship_definition,
    longTermRequirements: JSON.parse(row.long_term_requirements_json),
    prohibitions: JSON.parse(row.prohibitions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('ERR_SQLITE_CONSTRAINT');
}

export function createSqliteAssistantGlobalSettingsRepository(connection) {
  const selection = `
    SELECT
      owner_user_id,
      subject_id,
      personality_description,
      expression_style_json,
      relationship_definition,
      long_term_requirements_json,
      prohibitions_json,
      created_at,
      updated_at
    FROM assistant_global_settings
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO assistant_global_settings (
      owner_user_id,
      subject_id,
      personality_description,
      expression_style_json,
      relationship_definition,
      long_term_requirements_json,
      prohibitions_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findBySubjectStatement = connection.prepare(`
    ${selection}
    WHERE owner_user_id = ? AND subject_id = ?
  `);
  const updateStatement = connection.prepare(`
    UPDATE assistant_global_settings
    SET
      personality_description = ?,
      expression_style_json = ?,
      relationship_definition = ?,
      long_term_requirements_json = ?,
      prohibitions_json = ?,
      updated_at = ?
    WHERE owner_user_id = ? AND subject_id = ?
  `);

  return {
    insert(settings) {
      try {
        insertStatement.run(
          settings.ownerUserId,
          settings.subjectId,
          settings.personalityDescription,
          JSON.stringify(settings.expressionStyle),
          settings.relationshipDefinition,
          JSON.stringify(settings.longTermRequirements),
          JSON.stringify(settings.prohibitions),
          settings.createdAt,
          settings.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError(
            'Assistant global settings could not be created for this subject.',
          );
        }

        throw error;
      }

      return mapSettings(
        findBySubjectStatement.get(settings.ownerUserId, settings.subjectId),
      );
    },
    findBySubject(ownerUserId, subjectId) {
      return mapSettings(findBySubjectStatement.get(ownerUserId, subjectId));
    },
    update(settings) {
      const result = updateStatement.run(
        settings.personalityDescription,
        JSON.stringify(settings.expressionStyle),
        settings.relationshipDefinition,
        JSON.stringify(settings.longTermRequirements),
        JSON.stringify(settings.prohibitions),
        settings.updatedAt,
        settings.ownerUserId,
        settings.subjectId,
      );

      if (result.changes === 0) {
        return null;
      }

      return mapSettings(
        findBySubjectStatement.get(settings.ownerUserId, settings.subjectId),
      );
    },
  };
}
