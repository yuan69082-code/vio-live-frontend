import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

const definitions = Object.freeze({
  user_space: Object.freeze({
    resourceType: 'user_space',
    dataCategory: 'user_data',
    ownershipScope: 'user',
    assistantRequired: false,
    allowedActions: Object.freeze(['read', 'manage']),
    queryFilter: Object.freeze(['user_id', 'space_id']),
    permissionRequirement: null,
  }),
  assistant: Object.freeze({
    resourceType: 'assistant',
    dataCategory: 'ai_data',
    ownershipScope: 'assistant',
    assistantRequired: true,
    allowedActions: Object.freeze(['read', 'manage']),
    queryFilter: Object.freeze(['owner_user_id', 'subject_id']),
    permissionRequirement: null,
  }),
  assistant_global_settings: Object.freeze({
    resourceType: 'assistant_global_settings',
    dataCategory: 'ai_data',
    ownershipScope: 'assistant',
    assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write']),
    queryFilter: Object.freeze(['owner_user_id', 'subject_id']),
    permissionRequirement: null,
  }),
  assistant_private_space: Object.freeze({
    resourceType: 'assistant_private_space',
    dataCategory: 'ai_data',
    ownershipScope: 'assistant_private',
    assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write', 'manage', 'export']),
    queryFilter: Object.freeze(['user_id', 'assistant_id', 'space_id']),
    permissionRequirement: Object.freeze({
      resourceType: 'private_domain',
      resourceIdSource: 'resource',
      operationType: 'privacy_access_request',
      sensitiveDataCategories: Object.freeze(['ai_private_domain']),
    }),
  }),
  subject_state: Object.freeze({
    resourceType: 'subject_state',
    dataCategory: 'ai_data',
    ownershipScope: 'assistant',
    assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write']),
    queryFilter: Object.freeze(['user_id', 'subject_id', 'subject_state_id']),
    permissionRequirement: null,
  }),
  device: Object.freeze({
    resourceType: 'device',
    dataCategory: 'device_data',
    ownershipScope: 'user_with_assistant_authorization',
    assistantRequired: true,
    allowedActions: Object.freeze(['read', 'control', 'manage']),
    queryFilter: Object.freeze(['owner_user_id', 'device_id']),
    permissionRequirement: Object.freeze({
      resourceType: 'device',
      resourceIdSource: 'resource',
      operationType: 'device_control',
      sensitiveDataCategories: Object.freeze([]),
    }),
  }),
  life_financial_record: Object.freeze({
    resourceType: 'life_financial_record',
    dataCategory: 'life_data',
    ownershipScope: 'user_and_assistant',
    assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write', 'export']),
    queryFilter: Object.freeze(['user_id', 'subject_id', 'financial_record_id']),
    permissionRequirement: Object.freeze({
      resourceType: 'life_data', resourceId: 'finance',
      operationType: 'sensitive_data_access', sensitiveDataCategories: Object.freeze(['private_record']),
    }),
  }),
  life_budget: Object.freeze({
    resourceType: 'life_budget', dataCategory: 'life_data',
    ownershipScope: 'user_and_assistant', assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write', 'manage']),
    queryFilter: Object.freeze(['user_id', 'subject_id', 'budget_id']),
    permissionRequirement: Object.freeze({
      resourceType: 'life_data', resourceId: 'finance',
      operationType: 'sensitive_data_access', sensitiveDataCategories: Object.freeze(['private_record']),
    }),
  }),
  life_calendar_entry: Object.freeze({
    resourceType: 'life_calendar_entry', dataCategory: 'life_data',
    ownershipScope: 'user_and_assistant', assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write', 'export']),
    queryFilter: Object.freeze(['user_id', 'subject_id', 'calendar_entry_id']),
    permissionRequirement: Object.freeze({
      resourceType: 'life_data', resourceId: 'calendar',
      operationType: 'sensitive_data_access', sensitiveDataCategories: Object.freeze(['private_record']),
    }),
  }),
  life_body_record: Object.freeze({
    resourceType: 'life_body_record', dataCategory: 'life_data',
    ownershipScope: 'user_and_assistant', assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write', 'export']),
    queryFilter: Object.freeze(['user_id', 'subject_id', 'body_record_id']),
    permissionRequirement: Object.freeze({
      resourceType: 'life_data', resourceId: 'body',
      operationType: 'sensitive_data_access', sensitiveDataCategories: Object.freeze(['private_record']),
    }),
  }),
  life_body_goal: Object.freeze({
    resourceType: 'life_body_goal', dataCategory: 'life_data',
    ownershipScope: 'user_and_assistant', assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write', 'manage']),
    queryFilter: Object.freeze(['user_id', 'subject_id', 'body_goal_id']),
    permissionRequirement: Object.freeze({
      resourceType: 'life_data', resourceId: 'body',
      operationType: 'sensitive_data_access', sensitiveDataCategories: Object.freeze(['private_record']),
    }),
  }),
  local_memory: Object.freeze({
    resourceType: 'local_memory', dataCategory: 'life_data',
    ownershipScope: 'user_and_assistant', assistantRequired: true,
    allowedActions: Object.freeze(['read', 'write', 'export']),
    queryFilter: Object.freeze(['user_id', 'subject_id', 'memory_id']),
    permissionRequirement: Object.freeze({
      resourceType: 'life_data', resourceId: 'local-memory',
      operationType: 'sensitive_data_access', sensitiveDataCategories: Object.freeze(['private_record']),
    }),
  }),
  event: Object.freeze({
    resourceType: 'event',
    dataCategory: 'event_data',
    ownershipScope: 'user_or_assistant',
    assistantRequired: false,
    allowedActions: Object.freeze(['read']),
    queryFilter: Object.freeze(['user_id', 'optional_subject_id', 'event_id']),
    permissionRequirement: null,
  }),
});

export const DATA_ISOLATION_RESOURCE_TYPES = Object.freeze(Object.keys(definitions));

export function getDataIsolationDefinition(value) {
  const resourceType = requireString(value, 'resourceType', { maxLength: 80 });
  const definition = definitions[resourceType];

  if (!definition) {
    throw new ValidationError('resourceType is not supported by the data isolation layer.', {
      field: 'resourceType',
      allowedValues: DATA_ISOLATION_RESOURCE_TYPES,
    });
  }

  return definition;
}

export function listDataIsolationDefinitions() {
  return DATA_ISOLATION_RESOURCE_TYPES.map((resourceType) => {
    const definition = definitions[resourceType];
    return {
      resourceType,
      dataCategory: definition.dataCategory,
      ownershipScope: definition.ownershipScope,
      assistantRequired: definition.assistantRequired,
      allowedActions: [...definition.allowedActions],
      queryFilter: [...definition.queryFilter],
      permissionRequired: Boolean(definition.permissionRequirement),
      permissionResourceType: definition.permissionRequirement?.resourceType ?? null,
    };
  });
}
