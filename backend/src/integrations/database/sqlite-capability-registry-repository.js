import { ConflictError } from '../../core/errors.js';

function isConstraintError(error) {
  return (
    (typeof error?.code === 'string'
      && error.code.startsWith('ERR_SQLITE_CONSTRAINT'))
    || (Number.isInteger(error?.errcode) && (error.errcode & 0xff) === 19)
  );
}

function mapTool(row) {
  if (!row) {
    return null;
  }

  return {
    toolId: row.tool_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    toolType: row.tool_type,
    inputDefinition: JSON.parse(row.input_definition_json),
    outputDefinition: JSON.parse(row.output_definition_json),
    status: row.status,
    permissionAction: row.permission_action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMcp(row) {
  if (!row) {
    return null;
  }

  return {
    mcpId: row.mcp_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    serviceUrl: row.service_url,
    capabilityDescription: row.capability_description,
    status: row.status,
    permissionAction: row.permission_action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSkill(row) {
  if (!row) {
    return null;
  }

  return {
    skillId: row.skill_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    applicableScenarios: JSON.parse(row.applicable_scenarios_json),
    version: row.version,
    status: row.status,
    permissionAction: row.permission_action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlugin(row) {
  if (!row) {
    return null;
  }

  return {
    pluginId: row.plugin_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    version: row.version,
    dependencies: JSON.parse(row.dependencies_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapToolUsage(row) {
  if (!row) {
    return null;
  }

  return {
    toolUsageId: row.tool_usage_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    toolId: row.tool_id,
    permissionDecision: row.permission_decision,
    securityDecision: row.security_decision,
    preparationStatus: row.preparation_status,
    executionStatus: row.execution_status,
    resultSummary: row.result_summary,
    consumption: JSON.parse(row.consumption_json),
    auditLogId: row.audit_log_id,
    occurredAt: row.occurred_at,
  };
}

function insertOrConflict(statement, parameters, message) {
  try {
    statement.run(...parameters);
  } catch (error) {
    if (isConstraintError(error)) {
      throw new ConflictError(message);
    }

    throw error;
  }
}

export function createSqliteCapabilityRegistryRepository(connection) {
  const toolSelection = `
    SELECT
      tool_id,
      owner_user_id,
      name,
      description,
      tool_type,
      input_definition_json,
      output_definition_json,
      status,
      permission_action,
      created_at,
      updated_at
    FROM tool_registry
  `;
  const mcpSelection = `
    SELECT
      mcp_id,
      owner_user_id,
      name,
      service_url,
      capability_description,
      status,
      permission_action,
      created_at,
      updated_at
    FROM mcp_registry
  `;
  const skillSelection = `
    SELECT
      skill_id,
      owner_user_id,
      name,
      description,
      applicable_scenarios_json,
      version,
      status,
      permission_action,
      created_at,
      updated_at
    FROM skill_registry
  `;
  const pluginSelection = `
    SELECT
      plugin_id,
      owner_user_id,
      name,
      description,
      version,
      dependencies_json,
      status,
      created_at,
      updated_at
    FROM plugin_registry
  `;
  const usageSelection = `
    SELECT
      tool_usage_id,
      user_id,
      subject_id,
      tool_id,
      permission_decision,
      security_decision,
      preparation_status,
      execution_status,
      result_summary,
      consumption_json,
      audit_log_id,
      occurred_at
    FROM tool_usage_records
  `;

  const insertToolStatement = connection.prepare(`
    INSERT INTO tool_registry (
      tool_id,
      owner_user_id,
      name,
      description,
      tool_type,
      input_definition_json,
      output_definition_json,
      status,
      permission_action,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findToolStatement = connection.prepare(`
    ${toolSelection}
    WHERE owner_user_id = ? AND tool_id = ?
  `);
  const listToolsStatement = connection.prepare(`
    ${toolSelection}
    WHERE owner_user_id = ?
    ORDER BY name, tool_id
  `);
  const updateToolStatusStatement = connection.prepare(`
    UPDATE tool_registry
    SET status = ?, updated_at = ?
    WHERE owner_user_id = ? AND tool_id = ?
  `);

  const insertMcpStatement = connection.prepare(`
    INSERT INTO mcp_registry (
      mcp_id,
      owner_user_id,
      name,
      service_url,
      capability_description,
      status,
      permission_action,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findMcpStatement = connection.prepare(`
    ${mcpSelection}
    WHERE owner_user_id = ? AND mcp_id = ?
  `);
  const listMcpsStatement = connection.prepare(`
    ${mcpSelection}
    WHERE owner_user_id = ?
    ORDER BY name, mcp_id
  `);
  const updateMcpStatusStatement = connection.prepare(`
    UPDATE mcp_registry
    SET status = ?, updated_at = ?
    WHERE owner_user_id = ? AND mcp_id = ?
  `);

  const insertSkillStatement = connection.prepare(`
    INSERT INTO skill_registry (
      skill_id,
      owner_user_id,
      name,
      description,
      applicable_scenarios_json,
      version,
      status,
      permission_action,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findSkillStatement = connection.prepare(`
    ${skillSelection}
    WHERE owner_user_id = ? AND skill_id = ?
  `);
  const listSkillsStatement = connection.prepare(`
    ${skillSelection}
    WHERE owner_user_id = ?
    ORDER BY name, skill_id
  `);
  const updateSkillStatusStatement = connection.prepare(`
    UPDATE skill_registry
    SET status = ?, updated_at = ?
    WHERE owner_user_id = ? AND skill_id = ?
  `);

  const insertPluginStatement = connection.prepare(`
    INSERT INTO plugin_registry (
      plugin_id,
      owner_user_id,
      name,
      description,
      version,
      dependencies_json,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findPluginStatement = connection.prepare(`
    ${pluginSelection}
    WHERE owner_user_id = ? AND plugin_id = ?
  `);
  const listPluginsStatement = connection.prepare(`
    ${pluginSelection}
    WHERE owner_user_id = ?
    ORDER BY name, plugin_id
  `);
  const updatePluginStatusStatement = connection.prepare(`
    UPDATE plugin_registry
    SET status = ?, updated_at = ?
    WHERE owner_user_id = ? AND plugin_id = ?
  `);

  const insertToolUsageStatement = connection.prepare(`
    INSERT INTO tool_usage_records (
      tool_usage_id,
      user_id,
      subject_id,
      tool_id,
      permission_decision,
      security_decision,
      preparation_status,
      execution_status,
      result_summary,
      consumption_json,
      audit_log_id,
      occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findToolUsageStatement = connection.prepare(`
    ${usageSelection}
    WHERE user_id = ? AND subject_id = ? AND tool_usage_id = ?
  `);
  const listToolUsageStatement = connection.prepare(`
    ${usageSelection}
    WHERE user_id = ? AND subject_id = ?
      AND (? IS NULL OR tool_id = ?)
    ORDER BY occurred_at DESC, tool_usage_id DESC
    LIMIT ?
  `);
  const findLatestToolUsageStatement = connection.prepare(`
    ${usageSelection}
    WHERE user_id = ? AND subject_id = ? AND tool_id = ?
    ORDER BY occurred_at DESC, tool_usage_id DESC
    LIMIT 1
  `);

  function updateStatus(statement, findStatement, map, ownerUserId, id, status, updatedAt) {
    const result = statement.run(status, updatedAt, ownerUserId, id);
    if (result.changes === 0) {
      return null;
    }

    return map(findStatement.get(ownerUserId, id));
  }

  return {
    insertTool(tool) {
      insertOrConflict(insertToolStatement, [
        tool.toolId,
        tool.ownerUserId,
        tool.name,
        tool.description,
        tool.toolType,
        JSON.stringify(tool.inputDefinition),
        JSON.stringify(tool.outputDefinition),
        tool.status,
        tool.permissionAction,
        tool.createdAt,
        tool.updatedAt,
      ], 'Tool registry entry could not be created.');
      return mapTool(findToolStatement.get(tool.ownerUserId, tool.toolId));
    },
    findTool(ownerUserId, toolId) {
      return mapTool(findToolStatement.get(ownerUserId, toolId));
    },
    listTools(ownerUserId) {
      return listToolsStatement.all(ownerUserId).map(mapTool);
    },
    updateToolStatus(ownerUserId, toolId, status, updatedAt) {
      return updateStatus(
        updateToolStatusStatement,
        findToolStatement,
        mapTool,
        ownerUserId,
        toolId,
        status,
        updatedAt,
      );
    },
    insertMcp(mcp) {
      insertOrConflict(insertMcpStatement, [
        mcp.mcpId,
        mcp.ownerUserId,
        mcp.name,
        mcp.serviceUrl,
        mcp.capabilityDescription,
        mcp.status,
        mcp.permissionAction,
        mcp.createdAt,
        mcp.updatedAt,
      ], 'MCP registry entry could not be created.');
      return mapMcp(findMcpStatement.get(mcp.ownerUserId, mcp.mcpId));
    },
    findMcp(ownerUserId, mcpId) {
      return mapMcp(findMcpStatement.get(ownerUserId, mcpId));
    },
    listMcps(ownerUserId) {
      return listMcpsStatement.all(ownerUserId).map(mapMcp);
    },
    updateMcpStatus(ownerUserId, mcpId, status, updatedAt) {
      return updateStatus(
        updateMcpStatusStatement,
        findMcpStatement,
        mapMcp,
        ownerUserId,
        mcpId,
        status,
        updatedAt,
      );
    },
    insertSkill(skill) {
      insertOrConflict(insertSkillStatement, [
        skill.skillId,
        skill.ownerUserId,
        skill.name,
        skill.description,
        JSON.stringify(skill.applicableScenarios),
        skill.version,
        skill.status,
        skill.permissionAction,
        skill.createdAt,
        skill.updatedAt,
      ], 'Skill registry entry could not be created.');
      return mapSkill(findSkillStatement.get(skill.ownerUserId, skill.skillId));
    },
    findSkill(ownerUserId, skillId) {
      return mapSkill(findSkillStatement.get(ownerUserId, skillId));
    },
    listSkills(ownerUserId) {
      return listSkillsStatement.all(ownerUserId).map(mapSkill);
    },
    updateSkillStatus(ownerUserId, skillId, status, updatedAt) {
      return updateStatus(
        updateSkillStatusStatement,
        findSkillStatement,
        mapSkill,
        ownerUserId,
        skillId,
        status,
        updatedAt,
      );
    },
    insertPlugin(plugin) {
      insertOrConflict(insertPluginStatement, [
        plugin.pluginId,
        plugin.ownerUserId,
        plugin.name,
        plugin.description,
        plugin.version,
        JSON.stringify(plugin.dependencies),
        plugin.status,
        plugin.createdAt,
        plugin.updatedAt,
      ], 'Plugin registry entry could not be created.');
      return mapPlugin(findPluginStatement.get(plugin.ownerUserId, plugin.pluginId));
    },
    findPlugin(ownerUserId, pluginId) {
      return mapPlugin(findPluginStatement.get(ownerUserId, pluginId));
    },
    listPlugins(ownerUserId) {
      return listPluginsStatement.all(ownerUserId).map(mapPlugin);
    },
    updatePluginStatus(ownerUserId, pluginId, status, updatedAt) {
      return updateStatus(
        updatePluginStatusStatement,
        findPluginStatement,
        mapPlugin,
        ownerUserId,
        pluginId,
        status,
        updatedAt,
      );
    },
    insertToolUsage(record) {
      insertOrConflict(insertToolUsageStatement, [
        record.toolUsageId,
        record.userId,
        record.subjectId,
        record.toolId,
        record.permissionDecision,
        record.securityDecision,
        record.preparationStatus,
        record.executionStatus,
        record.resultSummary,
        JSON.stringify(record.consumption),
        record.auditLogId,
        record.occurredAt,
      ], 'Tool usage record could not be created.');
      return mapToolUsage(findToolUsageStatement.get(
        record.userId,
        record.subjectId,
        record.toolUsageId,
      ));
    },
    findToolUsage(userId, subjectId, toolUsageId) {
      return mapToolUsage(findToolUsageStatement.get(
        userId,
        subjectId,
        toolUsageId,
      ));
    },
    listToolUsage({ userId, subjectId, toolId, limit }) {
      return listToolUsageStatement
        .all(userId, subjectId, toolId, toolId, limit)
        .map(mapToolUsage);
    },
    findLatestToolUsage(userId, subjectId, toolId) {
      return mapToolUsage(findLatestToolUsageStatement.get(userId, subjectId, toolId));
    },
  };
}
