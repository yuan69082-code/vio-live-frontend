import { NotFoundError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';
import { requireTaskType } from '../models/model-capabilities.js';

export function createModelRouterService({
  modelRepository,
  modelRoutingRuleRepository,
  userRepository,
}) {
  return {
    selectModel(userId, taskType) {
      const ownerUserId = requireString(userId, 'userId', { maxLength: 128 });

      if (!userRepository.findById(ownerUserId)) {
        throw new NotFoundError('User was not found.');
      }

      const normalizedTaskType = requireTaskType(taskType, 'taskType');
      const rule = modelRoutingRuleRepository.findByTaskType(
        ownerUserId,
        normalizedTaskType,
      );

      if (rule?.status === 'enabled') {
        const defaultModel = modelRepository.findById(
          ownerUserId,
          rule.defaultModelId,
        );
        const fallbackModel = rule.fallbackModelId
          ? modelRepository.findById(ownerUserId, rule.fallbackModelId)
          : null;
        const defaultEnabled = defaultModel?.provider.status === 'enabled';
        const fallbackEnabled = fallbackModel?.provider.status === 'enabled';
        const model = defaultEnabled
          ? defaultModel
          : (fallbackEnabled ? fallbackModel : null);

        if (!model) {
          throw new NotFoundError(
            'No enabled model is available for the configured routing rule.',
          );
        }

        return {
          taskType: normalizedTaskType,
          selectionRule: 'configured_default_with_fallback',
          selectionSource: defaultEnabled ? 'default' : 'fallback',
          routingRuleId: rule.routingRuleId,
          model,
          fallbackModel,
          execution: {
            modelCall: 'not_performed',
            externalApiCall: 'not_performed',
          },
        };
      }

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
        selectionSource: 'catalog_fallback',
        routingRuleId: null,
        model,
        fallbackModel: null,
        execution: {
          modelCall: 'not_performed',
          externalApiCall: 'not_performed',
        },
      };
    },
  };
}
