import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import {
  PERMISSION_ACTIONS,
  requirePermissionValue,
} from '../permissions/permission-types.js';
import {
  REGISTRY_STATUSES,
  optionalRegistryValue,
  requireRegistryValue,
} from './capability-registry-types.js';

const credentialQueryPattern = /^(api[_-]?key|key|token|secret|credential|credentials)$/i;

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpectedFields.length > 0) {
    throw new ValidationError('Request body contains unsupported fields.', {
      unexpectedFields,
    });
  }

  return input;
}

function requireRegistryType(value) {
  const normalized = requireString(value, 'toolType', { maxLength: 80 });
  if (!/^[a-z][a-z0-9_-]*$/.test(normalized)) {
    throw new ValidationError('toolType must be a lowercase registry identifier.', {
      field: 'toolType',
    });
  }

  return normalized;
}

function requireStringList(value, field, { maxItems = 50 } = {}) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array.`, { field });
  }
  if (value.length > maxItems) {
    throw new ValidationError(`${field} must not contain more than ${maxItems} items.`, {
      field,
      maxItems,
    });
  }

  const normalized = value.map((item, index) => (
    requireString(item, `${field}[${index}]`, { maxLength: 160 })
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new ValidationError(`${field} must not contain duplicate items.`, { field });
  }

  return normalized;
}

function normalizeServiceUrl(value) {
  const raw = requireString(value, 'serviceUrl', { maxLength: 2_048 });
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('serviceUrl must be a valid HTTP or HTTPS URL.', {
      field: 'serviceUrl',
    });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ValidationError('serviceUrl must use HTTP or HTTPS.', {
      field: 'serviceUrl',
    });
  }
  if (url.username || url.password || url.hash) {
    throw new ValidationError('serviceUrl must not contain credentials or fragments.', {
      field: 'serviceUrl',
    });
  }
  for (const key of url.searchParams.keys()) {
    if (credentialQueryPattern.test(key)) {
      throw new ValidationError(
        'serviceUrl must not contain credential query parameters.',
        { field: 'serviceUrl' },
      );
    }
  }

  return url.toString();
}

function permissionRequirement(resourceType, resourceId, action) {
  return {
    required: true,
    resourceType,
    resourceId,
    action,
  };
}

function presentTool(tool) {
  return {
    ...tool,
    permissionRequirement: permissionRequirement(
      'tool',
      tool.toolId,
      tool.permissionAction,
    ),
    executionSupport: 'not_implemented',
  };
}

function presentMcp(mcp) {
  return {
    ...mcp,
    permissionConfiguration: permissionRequirement(
      'mcp',
      mcp.mcpId,
      mcp.permissionAction,
    ),
    connectionStatus: 'not_connected',
    connectionSupport: 'not_implemented',
  };
}

function presentSkill(skill) {
  return {
    ...skill,
    permissionRequirement: permissionRequirement(
      'skill',
      skill.skillId,
      skill.permissionAction,
    ),
    executionSupport: 'not_implemented',
  };
}

function presentPlugin(plugin) {
  return {
    ...plugin,
    installationStatus: 'not_installed',
    installationSupport: 'not_implemented',
    permissionRequirement: {
      required: false,
      resourceType: null,
      resourceId: plugin.pluginId,
      action: null,
      reason: 'registry_metadata_only',
    },
  };
}

export function createCapabilityRegistryService({
  capabilityRegistryRepository,
  userRepository,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireUser(userId) {
    const ownerUserId = requireString(userId, 'userId', { maxLength: 128 });
    if (!userRepository.findById(ownerUserId)) {
      throw new NotFoundError('User was not found.');
    }

    return ownerUserId;
  }

  function statusFrom(input) {
    return input.status === undefined
      ? 'disabled'
      : requireRegistryValue(input.status, 'status', REGISTRY_STATUSES);
  }

  function actionFrom(input, defaultAction) {
    return input.permissionAction === undefined
      ? defaultAction
      : requirePermissionValue(
          input.permissionAction,
          'permissionAction',
          PERMISSION_ACTIONS,
        );
  }

  function getEntry(userId, id, field, find, present, notFoundMessage) {
    const ownerUserId = requireUser(userId);
    const normalizedId = requireString(id, field, { maxLength: 128 });
    const entry = find(ownerUserId, normalizedId);
    if (!entry) {
      throw new NotFoundError(notFoundMessage);
    }

    return present(entry);
  }

  function listEntries(userId, filters, list, present) {
    const ownerUserId = requireUser(userId);
    const status = optionalRegistryValue(
      filters.status,
      'status',
      REGISTRY_STATUSES,
    );
    return list(ownerUserId)
      .filter((entry) => !status || entry.status === status)
      .map(present);
  }

  function updateEntryStatus({
    userId,
    id,
    field,
    value,
    find,
    update,
    present,
    notFoundMessage,
  }) {
    const ownerUserId = requireUser(userId);
    const normalizedId = requireString(id, field, { maxLength: 128 });
    const input = requireOnlyFields(value, ['status']);
    const status = requireRegistryValue(input.status, 'status', REGISTRY_STATUSES);
    const current = find(ownerUserId, normalizedId);
    if (!current) {
      throw new NotFoundError(notFoundMessage);
    }
    if (current.status === status) {
      return present(current);
    }

    return present(update(ownerUserId, normalizedId, status, clock().toISOString()));
  }

  return {
    createTool(userId, value) {
      const ownerUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'name',
        'description',
        'toolType',
        'inputDefinition',
        'outputDefinition',
        'status',
        'permissionAction',
      ]);
      const now = clock().toISOString();
      return presentTool(capabilityRegistryRepository.insertTool({
        toolId: idFactory(),
        ownerUserId,
        name: requireString(input.name, 'name', { maxLength: 120 }),
        description: requireString(input.description, 'description', {
          maxLength: 2_000,
        }),
        toolType: requireRegistryType(input.toolType),
        inputDefinition: requirePlainObject(input.inputDefinition, 'inputDefinition'),
        outputDefinition: requirePlainObject(input.outputDefinition, 'outputDefinition'),
        status: statusFrom(input),
        permissionAction: actionFrom(input, 'execute'),
        createdAt: now,
        updatedAt: now,
      }));
    },
    getTool(userId, toolId) {
      return getEntry(
        userId,
        toolId,
        'toolId',
        capabilityRegistryRepository.findTool,
        presentTool,
        'Tool registry entry was not found for this user.',
      );
    },
    listTools(userId, filters = {}) {
      return listEntries(
        userId,
        filters,
        capabilityRegistryRepository.listTools,
        presentTool,
      );
    },
    updateToolStatus(userId, toolId, value) {
      return updateEntryStatus({
        userId,
        id: toolId,
        field: 'toolId',
        value,
        find: capabilityRegistryRepository.findTool,
        update: capabilityRegistryRepository.updateToolStatus,
        present: presentTool,
        notFoundMessage: 'Tool registry entry was not found for this user.',
      });
    },
    createMcp(userId, value) {
      const ownerUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'name',
        'serviceUrl',
        'capabilityDescription',
        'status',
        'permissionAction',
      ]);
      const now = clock().toISOString();
      return presentMcp(capabilityRegistryRepository.insertMcp({
        mcpId: idFactory(),
        ownerUserId,
        name: requireString(input.name, 'name', { maxLength: 120 }),
        serviceUrl: normalizeServiceUrl(input.serviceUrl),
        capabilityDescription: requireString(
          input.capabilityDescription,
          'capabilityDescription',
          { maxLength: 4_000 },
        ),
        status: statusFrom(input),
        permissionAction: actionFrom(input, 'connect'),
        createdAt: now,
        updatedAt: now,
      }));
    },
    getMcp(userId, mcpId) {
      return getEntry(
        userId,
        mcpId,
        'mcpId',
        capabilityRegistryRepository.findMcp,
        presentMcp,
        'MCP registry entry was not found for this user.',
      );
    },
    listMcps(userId, filters = {}) {
      return listEntries(
        userId,
        filters,
        capabilityRegistryRepository.listMcps,
        presentMcp,
      );
    },
    updateMcpStatus(userId, mcpId, value) {
      return updateEntryStatus({
        userId,
        id: mcpId,
        field: 'mcpId',
        value,
        find: capabilityRegistryRepository.findMcp,
        update: capabilityRegistryRepository.updateMcpStatus,
        present: presentMcp,
        notFoundMessage: 'MCP registry entry was not found for this user.',
      });
    },
    createSkill(userId, value) {
      const ownerUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'name',
        'description',
        'applicableScenarios',
        'version',
        'status',
        'permissionAction',
      ]);
      const now = clock().toISOString();
      return presentSkill(capabilityRegistryRepository.insertSkill({
        skillId: idFactory(),
        ownerUserId,
        name: requireString(input.name, 'name', { maxLength: 120 }),
        description: requireString(input.description, 'description', {
          maxLength: 2_000,
        }),
        applicableScenarios: requireStringList(
          input.applicableScenarios,
          'applicableScenarios',
        ),
        version: requireString(input.version, 'version', { maxLength: 80 }),
        status: statusFrom(input),
        permissionAction: actionFrom(input, 'execute'),
        createdAt: now,
        updatedAt: now,
      }));
    },
    getSkill(userId, skillId) {
      return getEntry(
        userId,
        skillId,
        'skillId',
        capabilityRegistryRepository.findSkill,
        presentSkill,
        'Skill registry entry was not found for this user.',
      );
    },
    listSkills(userId, filters = {}) {
      return listEntries(
        userId,
        filters,
        capabilityRegistryRepository.listSkills,
        presentSkill,
      );
    },
    updateSkillStatus(userId, skillId, value) {
      return updateEntryStatus({
        userId,
        id: skillId,
        field: 'skillId',
        value,
        find: capabilityRegistryRepository.findSkill,
        update: capabilityRegistryRepository.updateSkillStatus,
        present: presentSkill,
        notFoundMessage: 'Skill registry entry was not found for this user.',
      });
    },
    createPlugin(userId, value) {
      const ownerUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'name',
        'description',
        'version',
        'dependencies',
        'status',
      ]);
      const now = clock().toISOString();
      return presentPlugin(capabilityRegistryRepository.insertPlugin({
        pluginId: idFactory(),
        ownerUserId,
        name: requireString(input.name, 'name', { maxLength: 120 }),
        description: requireString(input.description, 'description', {
          maxLength: 2_000,
        }),
        version: requireString(input.version, 'version', { maxLength: 80 }),
        dependencies: requireStringList(input.dependencies, 'dependencies'),
        status: statusFrom(input),
        createdAt: now,
        updatedAt: now,
      }));
    },
    getPlugin(userId, pluginId) {
      return getEntry(
        userId,
        pluginId,
        'pluginId',
        capabilityRegistryRepository.findPlugin,
        presentPlugin,
        'Plugin registry entry was not found for this user.',
      );
    },
    listPlugins(userId, filters = {}) {
      return listEntries(
        userId,
        filters,
        capabilityRegistryRepository.listPlugins,
        presentPlugin,
      );
    },
    updatePluginStatus(userId, pluginId, value) {
      return updateEntryStatus({
        userId,
        id: pluginId,
        field: 'pluginId',
        value,
        find: capabilityRegistryRepository.findPlugin,
        update: capabilityRegistryRepository.updatePluginStatus,
        present: presentPlugin,
        notFoundMessage: 'Plugin registry entry was not found for this user.',
      });
    },
  };
}
