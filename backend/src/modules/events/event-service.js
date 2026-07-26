import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import { EVENT_STATUSES, EVENT_TYPES } from './event-types.js';

function requireAllowedValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });

  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues,
    });
  }

  return normalized;
}

function optionalAllowedValue(value, field, allowedValues) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return requireAllowedValue(value, field, allowedValues);
}

function normalizeTimestamp(value, field, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a valid ISO-8601 timestamp.`, { field });
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid ISO-8601 timestamp.`, { field });
  }

  return parsed.toISOString();
}

const secretFieldPattern = /^(api[_-]?key|password|passcode|verification[_-]?code|token|secret|payment[_-]?password|id[_-]?number)$/i;

function rejectSecretFields(value, path = 'data') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`));
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (secretFieldPattern.test(key)) {
      throw new ValidationError('Event data must not contain secret fields.', {
        field: `${path}.${key}`,
      });
    }

    rejectSecretFields(nestedValue, `${path}.${key}`);
  }
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') {
    return 50;
  }

  if (!/^\d+$/.test(String(value))) {
    throw new ValidationError('limit must be an integer between 1 and 200.', {
      field: 'limit',
    });
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ValidationError('limit must be an integer between 1 and 200.', {
      field: 'limit',
    });
  }

  return limit;
}

function normalizeSource(value) {
  const source = requirePlainObject(value, 'source');
  return {
    type: requireString(source.type, 'source.type', { maxLength: 80 }),
    reference: optionalString(source.reference, 'source.reference', { maxLength: 256 }),
  };
}

export function createEventService({
  eventRepository,
  subjectRepository,
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

  function requireSubject(userId, subjectId) {
    if (!subjectRepository.findById(userId, subjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }

    return subjectId;
  }

  return {
    createEvent(userId, input) {
      const normalizedUserId = requireUser(userId);
      const subjectId = optionalString(input?.subjectId, 'subjectId', { maxLength: 128 });

      if (subjectId) {
        requireSubject(normalizedUserId, subjectId);
      }

      const now = clock().toISOString();
      const data = requirePlainObject(input?.data, 'data');
      rejectSecretFields(data);
      const event = {
        eventId: idFactory(),
        userId: normalizedUserId,
        subjectId,
        eventType: requireAllowedValue(input?.eventType, 'eventType', EVENT_TYPES),
        source: normalizeSource(input?.source),
        occurredAt: normalizeTimestamp(input?.occurredAt, 'occurredAt', now),
        recordedAt: now,
        data,
        summary: requireString(input?.summary, 'summary', { maxLength: 500 }),
        status: 'pending',
      };

      return eventRepository.insert(event);
    },
    getEvent(userId, eventId) {
      const normalizedUserId = requireUser(userId);
      const normalizedEventId = requireString(eventId, 'eventId', { maxLength: 128 });
      const event = eventRepository.findById(normalizedUserId, normalizedEventId);

      if (!event) {
        throw new NotFoundError('Event was not found for this user.');
      }

      return event;
    },
    listEvents(userId, filters = {}) {
      const normalizedUserId = requireUser(userId);
      const subjectId = optionalString(filters.subjectId, 'subjectId', { maxLength: 128 });

      if (subjectId) {
        requireSubject(normalizedUserId, subjectId);
      }

      const from = normalizeTimestamp(filters.from, 'from', null);
      const to = normalizeTimestamp(filters.to, 'to', null);

      if (from && to && from > to) {
        throw new ValidationError('from must be earlier than or equal to to.', {
          fields: ['from', 'to'],
        });
      }

      return eventRepository.findMany({
        userId: normalizedUserId,
        subjectId,
        eventType: optionalAllowedValue(filters.eventType, 'eventType', EVENT_TYPES),
        status: optionalAllowedValue(filters.status, 'status', EVENT_STATUSES),
        from,
        to,
        limit: normalizeLimit(filters.limit),
      });
    },
  };
}
