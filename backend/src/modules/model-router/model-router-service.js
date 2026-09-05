import { ApplicationError, NotFoundError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';
import { requireTaskType } from '../models/model-capabilities.js';

export function createModelRouterService({
  modelRepository,
  modelRoutingRuleRepository,
  userRepository,
}) {
  function requireUser(userId) {
    const ownerUserId = requireString(userId, 'userId', { maxLength: 128 });

    if (!userRepository.findById(ownerUserId)) {
      throw new NotFoundError('User was not found.');
    }

    return ownerUserId;
  }

  return {
    selectConfiguredDefaultModel(userId, taskType) {
      const ownerUserId = requireUser(userId);
      const normalizedTaskType = requireTaskType(taskType, 'taskType');
      const rule = modelRoutingRuleRepository.findByTaskType(
        ownerUserId,
        normalizedTaskType,
      );

      if (!rule || rule.status !== 'enabled') {
        throw new ApplicationError('No enabled default model is configured for chat.', {
          code: 'DEFAULT_CHAT_MODEL_NOT_CONFIGURED',
          statusCode: 409,
        });
      }

      const model = modelRepository.findById(ownerUserId, rule.defaultModelId);
      if (!model) {
        throw new ApplicationError('The configured default model is unavailable.', {
          code: 'DEFAULT_CHAT_MODEL_NOT_CONFIGURED',
          statusCode: 409,
        });
      }
      if (!model.capabilities.includes(normalizedTaskType)) {
        throw new ApplicationError('The configured default model does not support chat.', {
          code: 'DEFAULT_CHAT_MODEL_NOT_CONFIGURED',
          statusCode: 409,
        });
      }
      if (model.status !== 'enabled') {
        throw new ApplicationError('The configured default model is disabled.', {
          code: 'MODEL_DISABLED',
          statusCode: 409,
        });
      }
      if (model.provider.status !== 'enabled') {
        throw new ApplicationError('The configured Provider is disabled.', {
          code: 'PROVIDER_DISABLED',
          statusCode: 409,
        });
      }

      return {
        taskType: normalizedTaskType,
        selectionRule: 'configured_default_only',
        selectionSource: 'default',
        routingRuleId: rule.routingRuleId,
        model,
        fallbackModel: null,
        execution: {
          modelCall: 'not_performed',
          externalApiCall: 'not_performed',
        },
      };
    },
    selectModel(userId, taskType) {
      const ownerUserId = requireUser(userId);

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
        const defaultEnabled = defaultModel?.provider.status === 'enabled' && defaultModel.status !== 'disabled';
        const fallbackEnabled = fallbackModel?.provider.status === 'enabled' && fallbackModel.status !== 'disabled';
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
