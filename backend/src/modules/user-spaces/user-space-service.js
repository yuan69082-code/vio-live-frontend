import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { requirePlainObject, requireString } from '../../core/validation.js';

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    throw new ValidationError('User Space update contains unsupported fields.', {
      unexpectedFields,
    });
  }

  return input;
}

function presentUserSpace(userSpace) {
  return {
    ...userSpace,
    identity: {
      userId: userSpace.userId,
      mode: userSpace.identityMode,
      verified: false,
      authenticationStatus: 'not_connected',
    },
    ownership: {
      userSpaceId: userSpace.spaceId,
      userId: userSpace.userId,
    },
  };
}

function presentAssistant(subject, currentAssistantId) {
  return {
    assistantId: subject.subjectId,
    userId: subject.ownerUserId,
    name: subject.name,
    avatarRef: subject.avatarRef,
    status: subject.status,
    current: subject.subjectId === currentAssistantId,
    dataBoundaries: {
      globalSettings: 'assistant_owned',
      privateSpace: 'assistant_private_space',
      subjectState: 'assistant_owned_version_history',
    },
  };
}

export function createUserSpaceService({
  userSpaceRepository,
  userRepository,
  subjectRepository,
  clock = () => new Date(),
}) {
  function requireUserSpace(userId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }

    const userSpace = userSpaceRepository.findByUser(normalizedUserId);
    if (!userSpace) {
      throw new NotFoundError('User Space was not found.');
    }

    return userSpace;
  }

  return {
    getUserSpace(userId) {
      return presentUserSpace(requireUserSpace(userId));
    },
    listAssistants(userId) {
      const userSpace = requireUserSpace(userId);
      return subjectRepository
        .findManyByOwner(userSpace.userId)
        .map((subject) => presentAssistant(subject, userSpace.currentAssistantId));
    },
    getCurrentAssistant(userId) {
      const userSpace = requireUserSpace(userId);
      const assistant = userSpace.currentAssistantId
        ? subjectRepository.findById(userSpace.userId, userSpace.currentAssistantId)
        : null;

      return {
        userSpace: presentUserSpace(userSpace),
        assistant: assistant ? presentAssistant(assistant, userSpace.currentAssistantId) : null,
      };
    },
    switchCurrentAssistant(userId, value) {
      const userSpace = requireUserSpace(userId);
      const input = requireOnlyFields(value, ['assistantId']);
      const assistantId = requireString(input.assistantId, 'assistantId', {
        maxLength: 128,
      });
      const assistant = subjectRepository.findById(userSpace.userId, assistantId);

      if (!assistant) {
        throw new NotFoundError('Assistant was not found in this User Space.');
      }
      if (assistant.status !== 'active') {
        throw new ConflictError('Only an active assistant can become current.');
      }

      if (userSpace.currentAssistantId === assistantId) {
        return {
          userSpace: presentUserSpace(userSpace),
          assistant: presentAssistant(assistant, assistantId),
        };
      }

      const updated = userSpaceRepository.updateCurrentAssistant(
        userSpace.userId,
        assistantId,
        clock().toISOString(),
      );
      if (!updated) {
        throw new NotFoundError('User Space was not found.');
      }

      return {
        userSpace: presentUserSpace(updated),
        assistant: presentAssistant(assistant, assistantId),
      };
    },
  };
}
