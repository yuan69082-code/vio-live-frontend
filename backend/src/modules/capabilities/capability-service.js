import { NotFoundError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';
import {
  CAPABILITY_CATEGORIES,
  REGISTRY_STATUSES,
  optionalRegistryValue,
} from '../capability-registries/capability-registry-types.js';

function permissionAvailability(status, permission, category) {
  if (status !== 'enabled') {
    return {
      state: 'disabled',
      availableForSelection: false,
      executionAvailable: false,
    };
  }
  if (category === 'plugin') {
    return {
      state: 'registry_only',
      availableForSelection: false,
      executionAvailable: false,
    };
  }
  if (permission.decision === 'ask') {
    return {
      state: 'confirmation_required',
      availableForSelection: false,
      executionAvailable: false,
    };
  }
  if (permission.decision === 'deny') {
    return {
      state: 'blocked_by_permission',
      availableForSelection: false,
      executionAvailable: false,
    };
  }

  return {
    state: 'registered_only',
    availableForSelection: true,
    executionAvailable: false,
  };
}

export function createCapabilityService({
  capabilityRegistryService,
  capabilityRegistryRepository,
  permissionChecker,
  userRepository,
  subjectRepository,
}) {
  function requireScope(userId, subjectId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    const normalizedSubjectId = requireString(subjectId, 'subjectId', {
      maxLength: 128,
    });
    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }
    if (!subjectRepository.findById(normalizedUserId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }

    return { userId: normalizedUserId, subjectId: normalizedSubjectId };
  }

  function permissionFor(scope, requirement) {
    if (!requirement.required) {
      return {
        decision: 'not_applicable',
        canAsk: false,
        reason: requirement.reason,
        permissionId: null,
        permissionLevel: null,
        permissionStatus: null,
        permissionUpdatedAt: null,
      };
    }

    return permissionChecker.checkPermission(scope.userId, {
      subjectId: scope.subjectId,
      resourceType: requirement.resourceType,
      resourceId: requirement.resourceId,
      action: requirement.action,
    }, { consumeAllowOnce: false });
  }

  function toCapability(scope, category, entry, requirement) {
    const permission = permissionFor(scope, requirement);
    const capabilityId = {
      tool: entry.toolId,
      mcp: entry.mcpId,
      skill: entry.skillId,
      plugin: entry.pluginId,
    }[category];
    const recentUsage = category === 'tool'
      ? capabilityRegistryRepository.findLatestToolUsage(
          scope.userId,
          scope.subjectId,
          capabilityId,
        )
      : null;

    return {
      capabilityId,
      category,
      name: entry.name,
      description: entry.description ?? entry.capabilityDescription,
      version: entry.version ?? null,
      status: entry.status,
      permission,
      availability: permissionAvailability(entry.status, permission, category),
      recentUsage,
      configuration: entry,
    };
  }

  return {
    listCapabilities(userId, subjectId, filters = {}) {
      const scope = requireScope(userId, subjectId);
      const category = optionalRegistryValue(
        filters.category,
        'category',
        CAPABILITY_CATEGORIES,
      );
      const status = optionalRegistryValue(
        filters.status,
        'status',
        REGISTRY_STATUSES,
      );
      const capabilities = [];

      if (!category || category === 'tool') {
        for (const tool of capabilityRegistryService.listTools(scope.userId, { status })) {
          capabilities.push(toCapability(
            scope,
            'tool',
            tool,
            tool.permissionRequirement,
          ));
        }
      }
      if (!category || category === 'mcp') {
        for (const mcp of capabilityRegistryService.listMcps(scope.userId, { status })) {
          capabilities.push(toCapability(
            scope,
            'mcp',
            mcp,
            mcp.permissionConfiguration,
          ));
        }
      }
      if (!category || category === 'skill') {
        for (const skill of capabilityRegistryService.listSkills(scope.userId, { status })) {
          capabilities.push(toCapability(
            scope,
            'skill',
            skill,
            skill.permissionRequirement,
          ));
        }
      }
      if (!category || category === 'plugin') {
        for (const plugin of capabilityRegistryService.listPlugins(scope.userId, { status })) {
          capabilities.push(toCapability(
            scope,
            'plugin',
            plugin,
            plugin.permissionRequirement,
          ));
        }
      }

      const categoryRank = new Map(
        CAPABILITY_CATEGORIES.map((value, index) => [value, index]),
      );
      return capabilities.sort((left, right) => (
        categoryRank.get(left.category) - categoryRank.get(right.category)
        || left.name.localeCompare(right.name)
        || left.capabilityId.localeCompare(right.capabilityId)
      ));
    },
  };
}
