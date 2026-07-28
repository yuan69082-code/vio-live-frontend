import { isDeepStrictEqual } from 'node:util';

import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';

export function createSubjectService({
  subjectRepository,
  assistantGlobalSettingsRepository,
  userSpaceRepository,
  userRepository,
  eventService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  return {
    createSubject(ownerUserId, input) {
      const normalizedUserId = requireString(ownerUserId, 'userId', { maxLength: 128 });

      if (!userRepository.findById(normalizedUserId)) {
        throw new NotFoundError('Owner user was not found.');
      }

      const name = requireString(input?.name, 'name', { maxLength: 80 });
      const avatarRef = optionalString(input?.avatarRef, 'avatarRef', { maxLength: 2_048 });
      const basicSettings = requirePlainObject(input?.basicSettings, 'basicSettings');
      const now = clock().toISOString();
      const subject = {
        subjectId: idFactory(),
        ownerUserId: normalizedUserId,
        name,
        avatarRef,
        basicSettings,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      return runInTransaction(() => {
        const created = subjectRepository.insert(subject);
        assistantGlobalSettingsRepository.insert({
          ownerUserId: created.ownerUserId,
          subjectId: created.subjectId,
          personalityDescription: '',
          expressionStyle: {},
          relationshipDefinition: '',
          longTermRequirements: [],
          prohibitions: [],
          createdAt: now,
          updatedAt: now,
        });
        const userSpace = userSpaceRepository.setCurrentAssistantIfUnset(
          created.ownerUserId,
          created.subjectId,
          now,
        );
        if (!userSpace) {
          throw new NotFoundError('User Space was not found for the owner user.');
        }

        return created;
      });
    },
    getSubject(ownerUserId, subjectId) {
      const normalizedUserId = requireString(ownerUserId, 'userId', { maxLength: 128 });
      const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });
      const subject = subjectRepository.findById(normalizedUserId, normalizedSubjectId);

      if (!subject) {
        throw new NotFoundError('Subject was not found for this user.');
      }

      return subject;
    },
    listSubjects(ownerUserId) {
      const normalizedUserId = requireString(ownerUserId, 'userId', { maxLength: 128 });

      if (!userRepository.findById(normalizedUserId)) {
        throw new NotFoundError('Owner user was not found.');
      }

      return subjectRepository.findManyByOwner(normalizedUserId);
    },
    updateSubject(ownerUserId, subjectId, value) {
      const normalizedUserId = requireString(ownerUserId, 'userId', { maxLength: 128 });
      const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });
      const input = requirePlainObject(value, 'body');
      const allowedFields = ['name', 'avatarRef', 'basicSettings'];
      const unexpectedFields = Object.keys(input).filter(
        (field) => !allowedFields.includes(field),
      );

      if (unexpectedFields.length > 0) {
        throw new ValidationError('Subject update contains unsupported fields.', {
          unexpectedFields,
        });
      }

      if (!allowedFields.some((field) => Object.hasOwn(input, field))) {
        throw new ValidationError('Subject update must include at least one supported field.', {
          allowedFields,
        });
      }

      return runInTransaction(() => {
        const current = subjectRepository.findById(normalizedUserId, normalizedSubjectId);

        if (!current) {
          throw new NotFoundError('Subject was not found for this user.');
        }

        const next = {
          ...current,
          name: Object.hasOwn(input, 'name')
            ? requireString(input.name, 'name', { maxLength: 80 })
            : current.name,
          avatarRef: Object.hasOwn(input, 'avatarRef')
            ? optionalString(input.avatarRef, 'avatarRef', { maxLength: 2_048 })
            : current.avatarRef,
          basicSettings: Object.hasOwn(input, 'basicSettings')
            ? requirePlainObject(input.basicSettings, 'basicSettings')
            : current.basicSettings,
        };
        const changedFields = allowedFields.filter(
          (field) => !isDeepStrictEqual(current[field], next[field]),
        );

        if (changedFields.length === 0) {
          return current;
        }

        next.updatedAt = clock().toISOString();
        const updated = subjectRepository.update(next);

        if (!updated) {
          throw new NotFoundError('Subject was not found for this user.');
        }

        if (changedFields.includes('name') || changedFields.includes('avatarRef')) {
          const settings = assistantGlobalSettingsRepository.findBySubject(
            normalizedUserId,
            normalizedSubjectId,
          );
          if (!settings) {
            throw new NotFoundError('Assistant global settings were not found.');
          }

          const updatedSettings = assistantGlobalSettingsRepository.update({
            ...settings,
            updatedAt: next.updatedAt,
          });
          if (!updatedSettings) {
            throw new NotFoundError('Assistant global settings were not found.');
          }
        }

        eventService.createEvent(normalizedUserId, {
          subjectId: normalizedSubjectId,
          eventType: 'subject_updated',
          source: {
            type: 'subject-service',
            reference: normalizedSubjectId,
          },
          data: { changedFields },
          summary: 'AI subject basic information was updated.',
        });

        return updated;
      });
    },
  };
}
