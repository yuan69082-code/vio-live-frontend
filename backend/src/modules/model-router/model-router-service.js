import { NotFoundError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';
import { requireCapability } from '../models/model-capabilities.js';

export function createModelRouterService({ modelRepository, userRepository }) {
  return {
    selectModel(userId, taskType) {
      const ownerUserId = requireString(userId, 'userId', { maxLength: 128 });

      if (!userRepository.findById(ownerUserId)) {
        throw new NotFoundError('User was not found.');
      }

      const normalizedTaskType = requireCapability(taskType, 'taskType');
      const [model] = modelRepository.findByCapability({
        ownerUserId,
        capability: normalizedTaskType,
        onlyEnabledProviders: true,
      });

      if (!model) {
        throw new NotFoundError('No enabled model supports this task type.');
      }

      return {
        taskType: normalizedTaskType,
        selectionRule: 'first_enabled_capability_match',
        model,
      };
    },
  };
}
