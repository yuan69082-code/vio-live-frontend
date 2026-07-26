import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import { MODEL_CAPABILITIES, requireCapability } from './model-capabilities.js';

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    throw new ValidationError('Request body contains unsupported fields.', {
      unexpectedFields,
    });
  }

  return input;
}

function requireCapabilities(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('capabilities must be a non-empty array.', {
      field: 'capabilities',
    });
  }

  const normalized = value.map((capability, index) => (
    requireCapability(capability, `capabilities[${index}]`)
  ));

  return MODEL_CAPABILITIES.filter((capability) => normalized.includes(capability));
}

export function createModelService({
  modelRepository,
  apiProviderRepository,
  userRepository,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireUser(userId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });

    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }

    return normalizedUserId;
  }

  function requireProvider(ownerUserId, providerId) {
    const normalizedProviderId = requireString(providerId, 'providerId', { maxLength: 128 });

    if (!apiProviderRepository.findById(ownerUserId, normalizedProviderId)) {
      throw new NotFoundError('API provider was not found for this user.');
    }

    return normalizedProviderId;
  }

  return {
    createModel(userId, providerId, value) {
      const ownerUserId = requireUser(userId);
      const normalizedProviderId = requireProvider(ownerUserId, providerId);
      const input = requireOnlyFields(value, ['modelName', 'modelType', 'capabilities']);
      const model = {
        modelId: idFactory(),
        ownerUserId,
        providerId: normalizedProviderId,
        modelName: requireString(input.modelName, 'modelName', { maxLength: 160 }),
        modelType: requireString(input.modelType, 'modelType', { maxLength: 80 }),
        capabilities: requireCapabilities(input.capabilities),
        createdAt: clock().toISOString(),
      };

      return modelRepository.insert(model);
    },
    getModel(userId, modelId) {
      const ownerUserId = requireUser(userId);
      const normalizedModelId = requireString(modelId, 'modelId', { maxLength: 128 });
      const model = modelRepository.findById(ownerUserId, normalizedModelId);

      if (!model) {
        throw new NotFoundError('Model was not found for this user.');
      }

      return model;
    },
    findModelsByCapability(userId, capability) {
      return modelRepository.findByCapability({
        ownerUserId: requireUser(userId),
        capability: requireCapability(capability),
        onlyEnabledProviders: false,
      });
    },
  };
}
