import { isDeepStrictEqual } from 'node:util';

import { NotFoundError, ValidationError } from '../../core/errors.js';
import {
  optionalString,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';

const SETTINGS_FIELDS = Object.freeze([
  'name',
  'avatarRef',
  'personalityDescription',
  'expressionStyle',
  'relationshipDefinition',
  'longTermRequirements',
  'prohibitions',
]);
const SECRET_FIELD_PATTERN = /^(api[_-]?key|password|passcode|verification[_-]?code|token|secret|payment[_-]?password|id[_-]?number)$/i;

function rejectSecretFields(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`));
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new ValidationError(
        'Assistant global settings must not contain secret fields.',
        { field: `${path}.${key}` },
      );
    }

    rejectSecretFields(nestedValue, `${path}.${key}`);
  }
}

function requireText(value, field, maxLength) {
  return requireString(value, field, { minLength: 0, maxLength });
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new ValidationError(`${field} must be an array with at most 100 items.`, {
      field,
    });
  }

  const normalized = value.map((item, index) => requireString(
    item,
    `${field}[${index}]`,
    { maxLength: 1_000 },
  ));

  if (new Set(normalized).size !== normalized.length) {
    throw new ValidationError(`${field} must not contain duplicate items.`, { field });
  }

  return normalized;
}

function projectSettings(subject, settings) {
  return {
    userId: subject.ownerUserId,
    subjectId: subject.subjectId,
    name: subject.name,
    avatarRef: subject.avatarRef,
    personalityDescription: settings.personalityDescription,
    expressionStyle: settings.expressionStyle,
    relationshipDefinition: settings.relationshipDefinition,
    longTermRequirements: settings.longTermRequirements,
    prohibitions: settings.prohibitions,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

export function createAssistantGlobalSettingsService({
  subjectRepository,
  assistantGlobalSettingsRepository,
  eventService,
  runInTransaction,
  clock = () => new Date(),
}) {
  function requireSettings(ownerUserId, subjectId) {
    const normalizedUserId = requireString(ownerUserId, 'userId', { maxLength: 128 });
    const normalizedSubjectId = requireString(subjectId, 'subjectId', {
      maxLength: 128,
    });
    const subject = subjectRepository.findById(normalizedUserId, normalizedSubjectId);

    if (!subject) {
      throw new NotFoundError('Subject was not found for this user.');
    }

    const settings = assistantGlobalSettingsRepository.findBySubject(
      normalizedUserId,
      normalizedSubjectId,
    );
    if (!settings) {
      throw new NotFoundError('Assistant global settings were not found.');
    }

    return { subject, settings };
  }

  return {
    getSettings(ownerUserId, subjectId) {
      const { subject, settings } = requireSettings(ownerUserId, subjectId);
      return projectSettings(subject, settings);
    },
    updateSettings(ownerUserId, subjectId, value) {
      const input = requirePlainObject(value, 'body');
      const unexpectedFields = Object.keys(input).filter(
        (field) => !SETTINGS_FIELDS.includes(field),
      );

      if (unexpectedFields.length > 0) {
        throw new ValidationError(
          'Assistant global settings update contains unsupported fields.',
          { unexpectedFields },
        );
      }

      if (!SETTINGS_FIELDS.some((field) => Object.hasOwn(input, field))) {
        throw new ValidationError(
          'Assistant global settings update must include at least one supported field.',
          { allowedFields: SETTINGS_FIELDS },
        );
      }

      return runInTransaction(() => {
        const { subject: currentSubject, settings: currentSettings } = requireSettings(
          ownerUserId,
          subjectId,
        );
        const nextSubject = {
          ...currentSubject,
          name: Object.hasOwn(input, 'name')
            ? requireString(input.name, 'name', { maxLength: 80 })
            : currentSubject.name,
          avatarRef: Object.hasOwn(input, 'avatarRef')
            ? optionalString(input.avatarRef, 'avatarRef', { maxLength: 2_048 })
            : currentSubject.avatarRef,
        };
        const expressionStyle = Object.hasOwn(input, 'expressionStyle')
          ? requirePlainObject(input.expressionStyle, 'expressionStyle')
          : currentSettings.expressionStyle;
        rejectSecretFields(expressionStyle, 'expressionStyle');
        const nextSettings = {
          ...currentSettings,
          personalityDescription: Object.hasOwn(input, 'personalityDescription')
            ? requireText(input.personalityDescription, 'personalityDescription', 8_000)
            : currentSettings.personalityDescription,
          expressionStyle,
          relationshipDefinition: Object.hasOwn(input, 'relationshipDefinition')
            ? requireText(input.relationshipDefinition, 'relationshipDefinition', 4_000)
            : currentSettings.relationshipDefinition,
          longTermRequirements: Object.hasOwn(input, 'longTermRequirements')
            ? requireStringArray(input.longTermRequirements, 'longTermRequirements')
            : currentSettings.longTermRequirements,
          prohibitions: Object.hasOwn(input, 'prohibitions')
            ? requireStringArray(input.prohibitions, 'prohibitions')
            : currentSettings.prohibitions,
        };
        const current = projectSettings(currentSubject, currentSettings);
        const next = projectSettings(nextSubject, nextSettings);
        const changedFields = SETTINGS_FIELDS.filter(
          (field) => !isDeepStrictEqual(current[field], next[field]),
        );

        if (changedFields.length === 0) {
          return current;
        }

        const now = clock().toISOString();
        let updatedSubject = currentSubject;
        let updatedSettings = currentSettings;

        if (changedFields.includes('name') || changedFields.includes('avatarRef')) {
          updatedSubject = subjectRepository.update({
            ...nextSubject,
            updatedAt: now,
          });
          if (!updatedSubject) {
            throw new NotFoundError('Subject was not found for this user.');
          }
        }

        updatedSettings = assistantGlobalSettingsRepository.update({
          ...nextSettings,
          updatedAt: now,
        });
        if (!updatedSettings) {
          throw new NotFoundError('Assistant global settings were not found.');
        }

        eventService.createEvent(currentSubject.ownerUserId, {
          subjectId: currentSubject.subjectId,
          eventType: 'subject_updated',
          source: {
            type: 'assistant-global-settings-service',
            reference: currentSubject.subjectId,
          },
          data: { changedFields },
          summary: 'AI assistant global settings were updated.',
        });

        return projectSettings(updatedSubject, updatedSettings);
      });
    },
  };
}
