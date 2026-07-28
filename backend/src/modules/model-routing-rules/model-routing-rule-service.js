import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import { requireTaskType } from '../models/model-capabilities.js';

const RULE_STATUSES = Object.freeze(['enabled', 'disabled']);

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

function requireRuleStatus(value) {
  const status = requireString(value, 'status', { maxLength: 40 });
  if (!RULE_STATUSES.includes(status)) {
    throw new ValidationError('status is not supported.', {
      field: 'status',
      allowedValues: RULE_STATUSES,
    });
  }

  return status;
}

export function createModelRoutingRuleService({
  modelRoutingRuleRepository,
  modelRepository,
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

  function requireModel(ownerUserId, modelId, taskType, field) {
    const normalizedModelId = requireString(modelId, field, { maxLength: 128 });
    const model = modelRepository.findById(ownerUserId, normalizedModelId);
    if (!model) {
      throw new NotFoundError(`${field} was not found for this user.`);
    }

    if (!model.capabilities.includes(taskType)) {
      throw new ValidationError(`${field} does not support taskType.`, {
        field,
        taskType,
      });
    }

    return model;
  }

  function presentRule(rule) {
    if (!rule) {
      return null;
    }

    return {
      routingRuleId: rule.routingRuleId,
      userId: rule.ownerUserId,
      taskType: rule.taskType,
      defaultModel: modelRepository.findById(
        rule.ownerUserId,
        rule.defaultModelId,
      ),
      fallbackModel: rule.fallbackModelId
        ? modelRepository.findById(rule.ownerUserId, rule.fallbackModelId)
        : null,
      status: rule.status,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  function validateModels(ownerUserId, taskType, defaultModelId, fallbackModelId) {
    const defaultModel = requireModel(
      ownerUserId,
      defaultModelId,
      taskType,
      'defaultModelId',
    );
    const fallbackModel = fallbackModelId
      ? requireModel(
          ownerUserId,
          fallbackModelId,
          taskType,
          'fallbackModelId',
        )
      : null;

    if (fallbackModel?.modelId === defaultModel.modelId) {
      throw new ValidationError(
        'fallbackModelId must be different from defaultModelId.',
        { fields: ['defaultModelId', 'fallbackModelId'] },
      );
    }
  }

  return {
    createRule(userId, value) {
      const ownerUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'taskType',
        'defaultModelId',
        'fallbackModelId',
        'status',
      ]);
      const taskType = requireTaskType(input.taskType);
      const defaultModelId = requireString(
        input.defaultModelId,
        'defaultModelId',
        { maxLength: 128 },
      );
      const fallbackModelId = optionalString(
        input.fallbackModelId,
        'fallbackModelId',
        { maxLength: 128 },
      );
      if (modelRoutingRuleRepository.findByTaskType(ownerUserId, taskType)) {
        throw new ConflictError('A routing rule already exists for this taskType.');
      }
      validateModels(ownerUserId, taskType, defaultModelId, fallbackModelId);
      const now = clock().toISOString();

      return presentRule(modelRoutingRuleRepository.insert({
        routingRuleId: idFactory(),
        ownerUserId,
        taskType,
        defaultModelId,
        fallbackModelId,
        status: input.status === undefined ? 'enabled' : requireRuleStatus(input.status),
        createdAt: now,
        updatedAt: now,
      }));
    },
    getRule(userId, taskType) {
      const ownerUserId = requireUser(userId);
      const normalizedTaskType = requireTaskType(taskType);
      const rule = modelRoutingRuleRepository.findByTaskType(
        ownerUserId,
        normalizedTaskType,
      );
      if (!rule) {
        throw new NotFoundError('Model routing rule was not found.');
      }

      return presentRule(rule);
    },
    listRules(userId) {
      return modelRoutingRuleRepository
        .findManyByUser(requireUser(userId))
        .map(presentRule);
    },
    updateRule(userId, taskType, value) {
      const ownerUserId = requireUser(userId);
      const normalizedTaskType = requireTaskType(taskType);
      const input = requireOnlyFields(value, [
        'defaultModelId',
        'fallbackModelId',
        'status',
      ]);
      const allowedFields = ['defaultModelId', 'fallbackModelId', 'status'];
      if (!allowedFields.some((field) => Object.hasOwn(input, field))) {
        throw new ValidationError(
          'Model routing rule update must include at least one supported field.',
          { allowedFields },
        );
      }

      const current = modelRoutingRuleRepository.findByTaskType(
        ownerUserId,
        normalizedTaskType,
      );
      if (!current) {
        throw new NotFoundError('Model routing rule was not found.');
      }

      const next = {
        ...current,
        defaultModelId: Object.hasOwn(input, 'defaultModelId')
          ? requireString(input.defaultModelId, 'defaultModelId', { maxLength: 128 })
          : current.defaultModelId,
        fallbackModelId: Object.hasOwn(input, 'fallbackModelId')
          ? optionalString(input.fallbackModelId, 'fallbackModelId', {
              maxLength: 128,
            })
          : current.fallbackModelId,
        status: Object.hasOwn(input, 'status')
          ? requireRuleStatus(input.status)
          : current.status,
      };
      validateModels(
        ownerUserId,
        normalizedTaskType,
        next.defaultModelId,
        next.fallbackModelId,
      );

      if (
        next.defaultModelId === current.defaultModelId
        && next.fallbackModelId === current.fallbackModelId
        && next.status === current.status
      ) {
        return presentRule(current);
      }

      const updated = modelRoutingRuleRepository.update({
        ...next,
        updatedAt: clock().toISOString(),
      });
      if (!updated) {
        throw new NotFoundError('Model routing rule was not found.');
      }

      return presentRule(updated);
    },
  };
}
