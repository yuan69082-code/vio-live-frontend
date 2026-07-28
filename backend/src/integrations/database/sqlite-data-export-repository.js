function parseJson(value) {
  return JSON.parse(value);
}

function mapSchemaScope(row) {
  return {
    scopeType: row.scope_type,
    dataCategory: row.data_category,
    ownershipScope: row.ownership_scope,
    sensitiveCategory: row.sensitive_category,
    requiredFields: parseJson(row.required_fields_json),
    relationFields: parseJson(row.relation_fields_json),
  };
}

function mapSchema(row, scopes) {
  if (!row) return null;
  return {
    schemaVersion: row.schema_version,
    exportType: row.export_type,
    status: row.status,
    createdTime: row.created_at,
    scopes,
  };
}

function mapExportRecord(row) {
  if (!row) return null;
  return {
    exportId: row.export_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    requestedBy: {
      actorType: 'user',
      userId: row.user_id,
      authenticationStatus: 'development_unverified',
    },
    schemaVersion: row.schema_version,
    exportType: row.export_type,
    requestedScopes: parseJson(row.requested_scopes_json),
    sensitiveCategories: parseJson(row.sensitive_categories_json),
    integrity: {
      status: row.integrity_status,
      ownershipStatus: row.ownership_status,
      permissionStatus: row.permission_status,
      fieldStatus: row.field_status,
      report: parseJson(row.integrity_report_json),
    },
    result: row.result_status,
    securityAuditLogId: row.security_audit_log_id,
    execution: {
      payload: row.payload_status,
      file: row.file_status,
      externalStorage: row.external_storage_status,
      migration: row.migration_status,
    },
    createdTime: row.created_at,
    updatedTime: row.updated_at,
  };
}

const sources = Object.freeze({
  user_data: Object.freeze([
    Object.freeze({
      name: 'users',
      where: 'user_id = ?',
      parameters: ({ userId }) => [userId],
      missing: `
        TRIM(user_id) = '' OR TRIM(primary_email) = '' OR TRIM(status) = ''
        OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
    Object.freeze({
      name: 'user_spaces',
      where: 'user_id = ?',
      parameters: ({ userId }) => [userId],
      missing: `
        TRIM(space_id) = '' OR TRIM(user_id) = '' OR TRIM(identity_mode) = ''
        OR TRIM(status) = '' OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
    Object.freeze({
      name: 'subjects',
      where: 'owner_user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(subject_id) = '' OR TRIM(owner_user_id) = '' OR TRIM(name) = ''
        OR json_valid(basic_settings_json) = 0 OR TRIM(status) = ''
        OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
  ]),
  subject_state: Object.freeze([Object.freeze({
    name: 'subject_states',
    where: 'user_id = ? AND subject_id = ?',
    parameters: ({ userId, subjectId }) => [userId, subjectId],
    missing: `
      TRIM(subject_state_id) = '' OR state_version < 1
      OR json_valid(current_state_json) = 0 OR json_valid(continuity_constraints_json) = 0
      OR TRIM(source_type) = '' OR TRIM(created_at) = ''
    `,
  })]),
  event: Object.freeze([Object.freeze({
    name: 'events',
    where: 'user_id = ? AND (subject_id IS NULL OR subject_id = ?)',
    parameters: ({ userId, subjectId }) => [userId, subjectId],
    missing: `
      TRIM(event_id) = '' OR TRIM(event_type) = '' OR TRIM(source_type) = ''
      OR TRIM(occurred_at) = '' OR TRIM(recorded_at) = ''
      OR json_valid(event_data_json) = 0 OR TRIM(summary) = '' OR TRIM(status) = ''
    `,
  })]),
  message_version: Object.freeze([Object.freeze({
    name: 'message_versions',
    where: 'user_id = ? AND subject_id = ?',
    parameters: ({ userId, subjectId }) => [userId, subjectId],
    missing: `
      TRIM(message_version_id) = '' OR TRIM(conversation_id) = ''
      OR TRIM(message_id) = '' OR version_number < 1 OR TRIM(sender_type) = ''
      OR content IS NULL OR TRIM(created_at) = ''
    `,
  })]),
  conversation_summary: Object.freeze([
    Object.freeze({
      name: 'conversation_summaries',
      where: 'user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(summary_id) = '' OR TRIM(conversation_id) = ''
        OR summary_version < 1 OR summary_text IS NULL OR TRIM(created_at) = ''
      `,
    }),
    Object.freeze({
      name: 'conversation_summary_sources',
      where: 'user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(summary_source_id) = '' OR TRIM(summary_id) = ''
        OR TRIM(conversation_id) = '' OR source_order < 1
        OR TRIM(source_type) = '' OR TRIM(created_at) = ''
      `,
    }),
  ]),
  assistant_private_space: Object.freeze([
    Object.freeze({
      name: 'assistant_private_spaces',
      where: 'user_id = ? AND assistant_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(space_id) = '' OR TRIM(status) = ''
        OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
    Object.freeze({
      name: 'assistant_private_content_versions',
      where: 'user_id = ? AND assistant_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(content_version_id) = '' OR TRIM(content_id) = '' OR TRIM(space_id) = ''
        OR TRIM(content_type) = '' OR version_number < 1 OR json_valid(content_json) = 0
        OR TRIM(source_type) = '' OR TRIM(created_at) = ''
      `,
    }),
  ]),
  assistant_global_settings: Object.freeze([Object.freeze({
    name: 'assistant_global_settings',
    where: 'owner_user_id = ? AND subject_id = ?',
    parameters: ({ userId, subjectId }) => [userId, subjectId],
    missing: `
      json_valid(expression_style_json) = 0
      OR json_valid(long_term_requirements_json) = 0
      OR json_valid(prohibitions_json) = 0
      OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
    `,
  })]),
  permission: Object.freeze([Object.freeze({
    name: 'permissions',
    where: 'user_id = ? AND subject_id = ?',
    parameters: ({ userId, subjectId }) => [userId, subjectId],
    missing: `
      TRIM(permission_id) = '' OR TRIM(resource_type) = '' OR TRIM(resource_id) = ''
      OR TRIM(action) = '' OR TRIM(permission_level) = '' OR TRIM(status) = ''
      OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
    `,
  })]),
  security_policy: Object.freeze([Object.freeze({
    name: 'security_policies',
    where: 'user_id = ?',
    parameters: ({ userId }) => [userId],
    missing: `
      TRIM(policy_id) = '' OR TRIM(resource_type) = '' OR TRIM(action_type) = ''
      OR TRIM(risk_level) = '' OR TRIM(rule) = '' OR TRIM(status) = ''
      OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
    `,
  })]),
  tool: Object.freeze([Object.freeze({
    name: 'tool_registry',
    where: 'owner_user_id = ?',
    parameters: ({ userId }) => [userId],
    missing: `
      TRIM(tool_id) = '' OR TRIM(name) = '' OR TRIM(tool_type) = ''
      OR json_valid(input_definition_json) = 0 OR json_valid(output_definition_json) = 0
      OR TRIM(status) = '' OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
    `,
  })]),
  device: Object.freeze([
    Object.freeze({
      name: 'device_registry',
      where: 'owner_user_id = ?',
      parameters: ({ userId }) => [userId],
      missing: `
        TRIM(device_id) = '' OR TRIM(device_type) = '' OR TRIM(name) = ''
        OR TRIM(status) = '' OR TRIM(adapter_type) = ''
        OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
    Object.freeze({
      name: 'device_capabilities',
      where: 'owner_user_id = ?',
      parameters: ({ userId }) => [userId],
      missing: `TRIM(device_id) = '' OR TRIM(capability) = ''`,
    }),
  ]),
  life_data: Object.freeze([
    Object.freeze({
      name: 'life_financial_records',
      where: 'user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(financial_record_id) = '' OR TRIM(entry_type) = '' OR TRIM(category) = ''
        OR TRIM(currency) = '' OR TRIM(occurred_at) = '' OR TRIM(created_at) = ''
      `,
    }),
    Object.freeze({
      name: 'life_budgets',
      where: 'user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(budget_id) = '' OR TRIM(month) = '' OR TRIM(category) = ''
        OR TRIM(currency) = '' OR json_valid(reminder_rule_json) = 0
        OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
    Object.freeze({
      name: 'life_calendar_entries',
      where: 'user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(calendar_entry_id) = '' OR TRIM(entry_type) = '' OR TRIM(title) = ''
        OR TRIM(starts_at) = '' OR json_valid(reminder_rule_json) = 0
        OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
    Object.freeze({
      name: 'life_body_records',
      where: 'user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(body_record_id) = '' OR TRIM(measured_at) = '' OR TRIM(created_at) = ''
      `,
    }),
    Object.freeze({
      name: 'life_body_goals',
      where: 'user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(body_goal_id) = '' OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
    Object.freeze({
      name: 'local_memories',
      where: 'user_id = ? AND subject_id = ?',
      parameters: ({ userId, subjectId }) => [userId, subjectId],
      missing: `
        TRIM(memory_id) = '' OR TRIM(title) = '' OR content IS NULL
        OR TRIM(created_at) = '' OR TRIM(updated_at) = ''
      `,
    }),
  ]),
});

export function createSqliteDataExportRepository(connection) {
  const listSchemaTypes = connection.prepare(`
    SELECT t.schema_version, t.export_type, v.status, t.created_at
    FROM export_schema_types t
    JOIN export_schema_versions v ON v.schema_version = t.schema_version
    WHERE v.status = 'active'
    ORDER BY t.schema_version DESC, t.export_type
  `);
  const findSchemaType = connection.prepare(`
    SELECT t.schema_version, t.export_type, v.status, t.created_at
    FROM export_schema_types t
    JOIN export_schema_versions v ON v.schema_version = t.schema_version
    WHERE t.schema_version = ? AND t.export_type = ? AND v.status = 'active'
  `);
  const listSchemaScopes = connection.prepare(`
    SELECT * FROM export_schema_scopes
    WHERE schema_version = ? ORDER BY scope_type
  `);
  const findExport = connection.prepare(`
    SELECT * FROM data_export_records
    WHERE user_id = ? AND subject_id = ? AND export_id = ?
  `);
  const insertExport = connection.prepare(`
    INSERT INTO data_export_records (
      export_id, user_id, subject_id, schema_version, export_type,
      requested_scopes_json, sensitive_categories_json, ownership_status,
      permission_status, field_status, integrity_status, integrity_report_json,
      result_status, security_audit_log_id, payload_status, file_status,
      external_storage_status, migration_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateExportSecurity = connection.prepare(`
    UPDATE data_export_records SET
      permission_status = ?, result_status = ?, security_audit_log_id = ?, updated_at = ?
    WHERE user_id = ? AND subject_id = ? AND export_id = ?
  `);
  const foreignKeyCheck = connection.prepare('PRAGMA foreign_key_check');

  const inspectionStatements = Object.fromEntries(
    Object.entries(sources).map(([scopeType, scopeSources]) => [
      scopeType,
      scopeSources.map((source) => ({
        ...source,
        statement: connection.prepare(`
          SELECT COUNT(*) AS record_count,
            COALESCE(SUM(CASE WHEN ${source.missing} THEN 1 ELSE 0 END), 0)
              AS missing_required_field_count
          FROM ${source.name}
          WHERE ${source.where}
        `),
      })),
    ]),
  );

  function schemaWithScopes(row) {
    if (!row) return null;
    const scopes = listSchemaScopes.all(row.schema_version).map(mapSchemaScope);
    return mapSchema(row, scopes);
  }

  return {
    listSchemas() {
      return listSchemaTypes.all().map(schemaWithScopes);
    },
    findSchema(schemaVersion, exportType) {
      return schemaWithScopes(findSchemaType.get(schemaVersion, exportType));
    },
    inspectScopes(userId, subjectId, scopeTypes) {
      const scopeReports = scopeTypes.map((scopeType) => {
        const sourceReports = inspectionStatements[scopeType].map((source) => {
          const result = source.statement.get(...source.parameters({ userId, subjectId }));
          return {
            source: source.name,
            recordCount: Number(result.record_count),
            missingRequiredFieldCount: Number(result.missing_required_field_count),
          };
        });
        return {
          scopeType,
          recordCount: sourceReports.reduce((total, item) => total + item.recordCount, 0),
          missingRequiredFieldCount: sourceReports.reduce(
            (total, item) => total + item.missingRequiredFieldCount,
            0,
          ),
          sources: sourceReports,
        };
      });
      return {
        foreignKeyViolationCount: foreignKeyCheck.all().length,
        scopes: scopeReports,
      };
    },
    insertExportRecord(record) {
      insertExport.run(
        record.exportId,
        record.userId,
        record.subjectId,
        record.schemaVersion,
        record.exportType,
        JSON.stringify(record.requestedScopes),
        JSON.stringify(record.sensitiveCategories),
        record.integrity.ownershipStatus,
        record.integrity.permissionStatus,
        record.integrity.fieldStatus,
        record.integrity.status,
        JSON.stringify(record.integrity.report),
        record.result,
        record.securityAuditLogId,
        'not_generated',
        'not_created',
        'not_connected',
        'not_executed',
        record.createdTime,
        record.updatedTime,
      );
      return mapExportRecord(findExport.get(
        record.userId,
        record.subjectId,
        record.exportId,
      ));
    },
    findExportRecord(userId, subjectId, exportId) {
      return mapExportRecord(findExport.get(userId, subjectId, exportId));
    },
    listExportRecords(userId, subjectId) {
      return connection.prepare(`
        SELECT * FROM data_export_records
        WHERE user_id = ? AND subject_id = ?
        ORDER BY created_at DESC, export_id DESC LIMIT 100
      `).all(userId, subjectId).map(mapExportRecord);
    },
    updateExportSecurity(record) {
      updateExportSecurity.run(
        record.integrity.permissionStatus,
        record.result,
        record.securityAuditLogId,
        record.updatedTime,
        record.userId,
        record.subjectId,
        record.exportId,
      );
      return mapExportRecord(findExport.get(
        record.userId,
        record.subjectId,
        record.exportId,
      ));
    },
  };
}
