import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requireOpaqueResourceId,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import {
  ASSISTANT_PRIVATE_CONTENT_TYPES,
  ASSISTANT_PRIVATE_SPACE_STATUSES,
  requireAssistantPrivateValue,
} from './assistant-private-space-types.js';

const SECRET_FIELD_PATTERN = /^(api[_-]?key|password|passcode|verification[_-]?code|token|secret|secret[_-]?ref|credential|credentials|payment[_-]?password|id[_-]?number)$/i;

function requireOnlyFields(value, allowedFields, field = 'body') {
  const input = requirePlainObject(value, field);
  const unexpectedFields = Object.keys(input).filter((name) => !allowedFields.includes(name));
  if (unexpectedFields.length > 0) {
    throw new ValidationError(`${field} contains unsupported fields.`, {
      field,
      unexpectedFields,
    });
  }
  return input;
}

function rejectSecretFields(value, path = 'content') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new ValidationError('AI private content must not contain credential or identity-secret fields.', {
        field: `${path}.${key}`,
      });
    }
    rejectSecretFields(nested, `${path}.${key}`);
  }
}

function normalizeContent(value) {
  const content = requirePlainObject(value, 'content');
  if (Object.keys(content).length === 0) {
    throw new ValidationError('content must contain at least one field.', { field: 'content' });
  }
  rejectSecretFields(content);
  return content;
}

function normalizeLimit(value, fallback = 50) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (!/^\d+$/.test(String(value))) {
    throw new ValidationError('limit must be an integer between 1 and 100.', {
      field: 'limit',
    });
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('limit must be an integer between 1 and 100.', {
      field: 'limit',
    });
  }
  return limit;
}

function normalizeContentTypes(value) {
  if (value === undefined) {
    return [...ASSISTANT_PRIVATE_CONTENT_TYPES];
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > ASSISTANT_PRIVATE_CONTENT_TYPES.length) {
    throw new ValidationError('contentTypes must be a non-empty array of supported values.', {
      field: 'contentTypes',
      allowedValues: ASSISTANT_PRIVATE_CONTENT_TYPES,
    });
  }
  const values = value.map((item, index) => requireAssistantPrivateValue(
    item,
    `contentTypes[${index}]`,
    ASSISTANT_PRIVATE_CONTENT_TYPES,
  ));
  if (new Set(values).size !== values.length) {
    throw new ValidationError('contentTypes must not contain duplicates.', {
      field: 'contentTypes',
    });
  }
  return ASSISTANT_PRIVATE_CONTENT_TYPES.filter((item) => values.includes(item));
}

function presentSpace(space) {
  return {
    ...space,
    storageScope: 'assistant_private_space',
    userSpaceIncluded: false,
    assistantMapping: 'assistant_id_maps_to_subject_id',
  };
}

function operationStatus(decision) {
  return {
    allow: 'completed',
    confirm: 'confirmation_required',
    deny: 'denied',
  }[decision];
}

export function createAssistantPrivateSpaceService({
  assistantPrivateSpaceRepository,
  userRepository,
  subjectRepository,
  securityService,
  eventService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireScope(userId, assistantId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    const normalizedAssistantId = requireString(assistantId, 'assistantId', { maxLength: 128 });
    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }
    if (!subjectRepository.findById(normalizedUserId, normalizedAssistantId)) {
      throw new NotFoundError('Assistant was not found for this user.');
    }
    return { userId: normalizedUserId, assistantId: normalizedAssistantId };
  }

  function requireSpace(userId, assistantId, spaceId) {
    const scope = requireScope(userId, assistantId);
    const normalizedSpaceId = requireOpaqueResourceId(spaceId, 'spaceId');
    const space = assistantPrivateSpaceRepository.findSpace(
      scope.userId,
      scope.assistantId,
      normalizedSpaceId,
    );
    if (!space) {
      throw new NotFoundError('AI private space was not found for this assistant.');
    }
    return space;
  }

  function requireCurrentSpace(userId, assistantId) {
    const scope = requireScope(userId, assistantId);
    const space = assistantPrivateSpaceRepository.findSpaceByAssistant(
      scope.userId,
      scope.assistantId,
    );
    if (!space) {
      throw new NotFoundError('AI private space was not found for this assistant.');
    }
    return space;
  }

  function requireActiveSpace(space) {
    if (space.status !== 'active') {
      throw new ConflictError('AI private space is inactive and cannot accept this operation.');
    }
  }

  function checkAccess(space, action, input) {
    return securityService.checkSecurity(space.userId, {
      subjectId: space.assistantId,
      resourceType: 'private_domain',
      resourceId: space.spaceId,
      action,
      operationType: 'privacy_access_request',
      sensitiveDataCategories: ['ai_private_domain'],
      ...(input.confirmationId ? { confirmationId: input.confirmationId } : {}),
      ...(input.securitySessionId ? { securitySessionId: input.securitySessionId } : {}),
    });
  }

  function secured(space, action, input, execute) {
    const access = checkAccess(space, action, input);
    const status = operationStatus(access.decision);
    return {
      operationStatus: status,
      access,
      result: access.decision === 'allow' ? execute() : null,
    };
  }

  function accessFields(input) {
    return {
      confirmationId: optionalString(input.confirmationId, 'confirmationId', { maxLength: 128 }),
      securitySessionId: optionalString(input.securitySessionId, 'securitySessionId', { maxLength: 128 }),
    };
  }

  function requireLatestContent(space, contentId) {
    const normalizedContentId = requireOpaqueResourceId(contentId, 'contentId');
    const content = assistantPrivateSpaceRepository.findLatestContent(
      space.userId,
      space.assistantId,
      space.spaceId,
      normalizedContentId,
    );
    if (!content) {
      throw new NotFoundError('AI private content was not found in this space.');
    }
    return content;
  }

  function recordContentEvent(content) {
    const isState = content.contentType === 'ai_state_record';
    eventService.createEvent(content.userId, {
      subjectId: content.assistantId,
      eventType: isState ? 'private_state_changed' : 'private_memory_updated',
      source: {
        type: 'assistant-private-space-service',
        reference: content.contentVersionId,
      },
      summary: isState
        ? 'AI private state record changed.'
        : 'AI private memory record changed.',
      data: {
        spaceId: content.spaceId,
        contentId: content.contentId,
        contentVersionId: content.contentVersionId,
        contentType: content.contentType,
        versionNumber: content.versionNumber,
        changeReason: content.changeReason,
        storageScope: 'assistant_private_space',
        executionStatus: 'not_executed',
      },
    });
  }

  return {
    createSpace(userId, assistantId, value) {
      const input = requireOnlyFields(value, ['status']);
      const scope = requireScope(userId, assistantId);
      const status = input.status === undefined
        ? 'active'
        : requireAssistantPrivateValue(
            input.status,
            'status',
            ASSISTANT_PRIVATE_SPACE_STATUSES,
          );
      const now = clock().toISOString();
      return runInTransaction(() => {
        const space = assistantPrivateSpaceRepository.insertSpace({
          spaceId: idFactory(),
          ...scope,
          status,
          createdAt: now,
          updatedAt: now,
        });
        eventService.createEvent(space.userId, {
          subjectId: space.assistantId,
          eventType: 'private_space_created',
          source: {
            type: 'assistant-private-space-service',
            reference: space.spaceId,
          },
          summary: 'AI private space was created.',
          data: {
            spaceId: space.spaceId,
            status: space.status,
            storageScope: 'assistant_private_space',
            contentStored: false,
            executionStatus: 'not_executed',
          },
        });
        return presentSpace(space);
      });
    },
    readCurrentSpace(userId, assistantId, value) {
      const input = requireOnlyFields(value, ['confirmationId', 'securitySessionId']);
      return runInTransaction(() => {
        const space = requireCurrentSpace(userId, assistantId);
        return secured(space, 'read', accessFields(input), () => presentSpace(space));
      });
    },
    updateSpaceStatus(userId, assistantId, spaceId, value) {
      const input = requireOnlyFields(value, ['status', 'confirmationId', 'securitySessionId']);
      const status = requireAssistantPrivateValue(
        input.status,
        'status',
        ASSISTANT_PRIVATE_SPACE_STATUSES,
      );
      return runInTransaction(() => {
        const space = requireSpace(userId, assistantId, spaceId);
        return secured(space, 'manage', accessFields(input), () => {
          if (space.status === status) {
            return presentSpace(space);
          }
          const updated = assistantPrivateSpaceRepository.updateSpaceStatus({
            ...space,
            status,
            updatedAt: clock().toISOString(),
          });
          if (!updated) {
            throw new NotFoundError('AI private space was not found for this assistant.');
          }
          eventService.createEvent(updated.userId, {
            subjectId: updated.assistantId,
            eventType: 'private_state_changed',
            source: {
              type: 'assistant-private-space-service',
              reference: updated.spaceId,
            },
            summary: 'AI private space status changed.',
            data: {
              spaceId: updated.spaceId,
              changeType: 'space_status_changed',
              previousStatus: space.status,
              status: updated.status,
              storageScope: 'assistant_private_space',
              executionStatus: 'not_executed',
            },
          });
          return presentSpace(updated);
        });
      });
    },
    createContent(userId, assistantId, spaceId, value) {
      const input = requireOnlyFields(value, [
        'contentType',
        'content',
        'confirmationId',
        'securitySessionId',
      ]);
      const contentType = requireAssistantPrivateValue(
        input.contentType,
        'contentType',
        ASSISTANT_PRIVATE_CONTENT_TYPES,
      );
      const content = normalizeContent(input.content);
      return runInTransaction(() => {
        const space = requireSpace(userId, assistantId, spaceId);
        return secured(space, 'write', accessFields(input), () => {
          requireActiveSpace(space);
          const now = clock().toISOString();
          const version = assistantPrivateSpaceRepository.insertContentVersion({
            contentVersionId: idFactory(),
            contentId: idFactory(),
            userId: space.userId,
            assistantId: space.assistantId,
            spaceId: space.spaceId,
            contentType,
            versionNumber: 1,
            parentVersionId: null,
            content,
            changeReason: 'created',
            sourceType: 'explicit_api_input',
            createdAt: now,
          });
          recordContentEvent(version);
          return version;
        });
      });
    },
    listContent(userId, assistantId, spaceId, value) {
      const input = requireOnlyFields(value, [
        'contentType',
        'limit',
        'confirmationId',
        'securitySessionId',
      ]);
      const contentType = input.contentType === undefined
        ? null
        : requireAssistantPrivateValue(
            input.contentType,
            'contentType',
            ASSISTANT_PRIVATE_CONTENT_TYPES,
          );
      const limit = normalizeLimit(input.limit);
      return runInTransaction(() => {
        const space = requireSpace(userId, assistantId, spaceId);
        return secured(space, 'read', accessFields(input), () => {
          requireActiveSpace(space);
          return assistantPrivateSpaceRepository.listLatestContent({
            userId: space.userId,
            assistantId: space.assistantId,
            spaceId: space.spaceId,
            contentType,
            limit,
          });
        });
      });
    },
    getContent(userId, assistantId, spaceId, contentId, value) {
      const input = requireOnlyFields(value, ['confirmationId', 'securitySessionId']);
      return runInTransaction(() => {
        const space = requireSpace(userId, assistantId, spaceId);
        return secured(space, 'read', accessFields(input), () => {
          requireActiveSpace(space);
          return requireLatestContent(space, contentId);
        });
      });
    },
    updateContent(userId, assistantId, spaceId, contentId, value) {
      const input = requireOnlyFields(value, [
        'baseVersionId',
        'content',
        'confirmationId',
        'securitySessionId',
      ]);
      const baseVersionId = requireOpaqueResourceId(input.baseVersionId, 'baseVersionId');
      const content = normalizeContent(input.content);
      return runInTransaction(() => {
        const space = requireSpace(userId, assistantId, spaceId);
        return secured(space, 'write', accessFields(input), () => {
          requireActiveSpace(space);
          const current = requireLatestContent(space, contentId);
          if (current.contentVersionId !== baseVersionId) {
            throw new ConflictError('baseVersionId is not the current AI private content version.');
          }
          const version = assistantPrivateSpaceRepository.insertContentVersion({
            ...current,
            contentVersionId: idFactory(),
            versionNumber: current.versionNumber + 1,
            parentVersionId: current.contentVersionId,
            content,
            changeReason: 'updated',
            sourceType: 'explicit_api_input',
            createdAt: clock().toISOString(),
          });
          recordContentEvent(version);
          return version;
        });
      });
    },
    listContentVersions(userId, assistantId, spaceId, contentId, value) {
      const input = requireOnlyFields(value, ['confirmationId', 'securitySessionId']);
      return runInTransaction(() => {
        const space = requireSpace(userId, assistantId, spaceId);
        return secured(space, 'read', accessFields(input), () => {
          requireActiveSpace(space);
          requireLatestContent(space, contentId);
          return assistantPrivateSpaceRepository.listContentVersions(
            space.userId,
            space.assistantId,
            space.spaceId,
            requireOpaqueResourceId(contentId, 'contentId'),
          );
        });
      });
    },
    createContextProjection(userId, assistantId, spaceId, value) {
      const input = requireOnlyFields(value, [
        'contentTypes',
        'limit',
        'confirmationId',
        'securitySessionId',
      ]);
      const contentTypes = normalizeContentTypes(input.contentTypes);
      const limit = normalizeLimit(input.limit, 20);
      return runInTransaction(() => {
        const space = requireSpace(userId, assistantId, spaceId);
        return secured(space, 'read', accessFields(input), () => {
          requireActiveSpace(space);
          const records = assistantPrivateSpaceRepository
            .listLatestContent({
              userId: space.userId,
              assistantId: space.assistantId,
              spaceId: space.spaceId,
              contentType: null,
              limit: 100,
            })
            .filter((record) => contentTypes.includes(record.contentType))
            .slice(0, limit);
          return {
            schemaVersion: 'assistant-private-context-v1',
            userId: space.userId,
            assistantId: space.assistantId,
            spaceId: space.spaceId,
            storageScope: 'assistant_private_space',
            userSpaceIncluded: false,
            records,
            generatedAt: clock().toISOString(),
            execution: {
              modelCall: 'not_performed',
              externalApiCall: 'not_performed',
              continuityEngine: 'not_invoked',
            },
          };
        });
      });
    },
    createExportManifest(userId, assistantId, spaceId, value) {
      const input = requireOnlyFields(value, ['confirmationId', 'securitySessionId']);
      return runInTransaction(() => {
        const space = requireSpace(userId, assistantId, spaceId);
        return secured(space, 'export', accessFields(input), () => {
          const versions = assistantPrivateSpaceRepository.listAllContentVersions(
            space.userId,
            space.assistantId,
            space.spaceId,
          );
          const counts = assistantPrivateSpaceRepository.countContent(
            space.userId,
            space.assistantId,
            space.spaceId,
          );
          return {
            schemaVersion: 'assistant-private-export-manifest-v1',
            exportStatus: 'not_generated',
            scope: {
              type: 'assistant_private_space',
              userId: space.userId,
              assistantId: space.assistantId,
              spaceId: space.spaceId,
              userSpaceIncluded: false,
            },
            formatsReserved: ['json', 'human_readable'],
            versionHistoryIncluded: true,
            contentIncluded: false,
            counts,
            versions: versions.map((version) => ({
              contentId: version.contentId,
              contentVersionId: version.contentVersionId,
              contentType: version.contentType,
              versionNumber: version.versionNumber,
              parentVersionId: version.parentVersionId,
              sourceType: version.sourceType,
              createdAt: version.createdAt,
            })),
            generatedAt: clock().toISOString(),
            execution: {
              fileCreated: false,
              externalTransfer: 'not_performed',
            },
          };
        });
      });
    },
  };
}
