import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requireOpaqueResourceId,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import {
  CALENDAR_ENTRY_TYPES,
  FINANCIAL_ENTRY_TYPES,
  LIFE_RESOURCE_IDS,
  requireLifeValue,
} from './life-management-types.js';

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

function normalizeTimestamp(value, field, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a valid ISO-8601 timestamp.`, { field });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid ISO-8601 timestamp.`, { field });
  }
  return parsed.toISOString();
}

function normalizeMonth(value, field = 'month') {
  const month = requireString(value, field, { maxLength: 7 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ValidationError(`${field} must use YYYY-MM format.`, { field });
  }
  return month;
}

function normalizeDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = requireString(value, field, { maxLength: 10 });
  if (!/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(date)) {
    throw new ValidationError(`${field} must use YYYY-MM-DD format.`, { field });
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ValidationError(`${field} must be a valid calendar date.`, { field });
  }
  return date;
}

function normalizeLimit(value, fallback = 50) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new ValidationError('limit must be an integer between 1 and 100.', { field: 'limit' });
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('limit must be an integer between 1 and 100.', { field: 'limit' });
  }
  return limit;
}

function normalizeMoney(value, field = 'amount') {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ValidationError(`${field} must be a positive decimal amount.`, { field });
  }
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(text)) {
    throw new ValidationError(`${field} must be a positive decimal with at most two places.`, {
      field,
    });
  }
  const [whole, fraction = ''] = text.split('.');
  const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new ValidationError(`${field} must be greater than zero.`, { field });
  }
  return amountMinor;
}

function normalizeCurrency(value) {
  if (value === undefined || value === null || value === '') return 'CNY';
  const currency = requireString(value, 'currency', { maxLength: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError('currency must be a three-letter code.', { field: 'currency' });
  }
  return currency;
}

function optionalBoolean(value, field, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean.`, { field });
  }
  return value;
}

function optionalMetric(value, field, maximum) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new ValidationError(`${field} must be a positive number no greater than ${maximum}.`, {
      field,
      maximum,
    });
  }
  return Math.round(value * 100) / 100;
}

function ensureAtLeastOneMetric(record, fields) {
  if (fields.every((field) => record[field] === null)) {
    throw new ValidationError('At least one body metric is required.', { fields });
  }
}

function normalizeReminderRule(value, mode) {
  if (value === undefined) return { enabled: false };
  const allowed = mode === 'budget'
    ? ['enabled', 'thresholdPercent']
    : ['enabled', 'remindAt'];
  const input = requireOnlyFields(value, allowed, 'reminderRule');
  const enabled = optionalBoolean(input.enabled, 'reminderRule.enabled', false);
  if (mode === 'budget') {
    const thresholdPercent = input.thresholdPercent === undefined
      ? null
      : Number(input.thresholdPercent);
    if (
      thresholdPercent !== null
      && (!Number.isInteger(thresholdPercent) || thresholdPercent < 1 || thresholdPercent > 100)
    ) {
      throw new ValidationError('reminderRule.thresholdPercent must be an integer from 1 to 100.', {
        field: 'reminderRule.thresholdPercent',
      });
    }
    if (enabled && thresholdPercent === null) {
      throw new ValidationError('Enabled budget reminders require thresholdPercent.', {
        field: 'reminderRule.thresholdPercent',
      });
    }
    return { enabled, thresholdPercent };
  }
  const remindAt = normalizeTimestamp(input.remindAt, 'reminderRule.remindAt');
  if (enabled && remindAt === null) {
    throw new ValidationError('Enabled calendar reminders require remindAt.', {
      field: 'reminderRule.remindAt',
    });
  }
  return { enabled, remindAt };
}

function accessFields(input) {
  return {
    confirmationId: optionalString(input.confirmationId, 'confirmationId', { maxLength: 128 }),
    securitySessionId: optionalString(input.securitySessionId, 'securitySessionId', {
      maxLength: 128,
    }),
  };
}

function operationStatus(decision) {
  return { allow: 'completed', confirm: 'confirmation_required', deny: 'denied' }[decision];
}

export function createLifeManagementService({
  lifeManagementRepository,
  userRepository,
  subjectRepository,
  securityService,
  eventService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  function requireScope(userId, subjectId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });
    if (!userRepository.findById(normalizedUserId)) throw new NotFoundError('User was not found.');
    if (!subjectRepository.findById(normalizedUserId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }
    return { userId: normalizedUserId, subjectId: normalizedSubjectId };
  }

  function secured(scope, resourceId, action, input, execute) {
    const access = securityService.checkSecurity(scope.userId, {
      subjectId: scope.subjectId,
      resourceType: 'life_data',
      resourceId,
      action,
      operationType: 'sensitive_data_access',
      sensitiveDataCategories: ['private_record'],
      ...(input.confirmationId ? { confirmationId: input.confirmationId } : {}),
      ...(input.securitySessionId ? { securitySessionId: input.securitySessionId } : {}),
    });
    return {
      operationStatus: operationStatus(access.decision),
      access,
      result: access.decision === 'allow' ? execute() : null,
    };
  }

  function recordLifeEvent(scope, eventType, reference, module, changeType) {
    return eventService.createEvent(scope.userId, {
      subjectId: scope.subjectId,
      eventType,
      source: { type: 'life-management-service', reference },
      summary: {
        life_event_created: 'A life management record was created or changed.',
        budget_changed: 'A life management budget was changed.',
        health_record_updated: 'A body management record was changed.',
      }[eventType],
      data: {
        module,
        recordId: reference,
        changeType,
        sensitiveContentIncluded: false,
        externalOperation: 'not_performed',
      },
    });
  }

  function normalizeRange(input) {
    const from = normalizeTimestamp(input.from, 'from');
    const to = normalizeTimestamp(input.to, 'to');
    if (from && to && from > to) {
      throw new ValidationError('from must be earlier than or equal to to.', {
        fields: ['from', 'to'],
      });
    }
    return { from, to };
  }

  function securedTransaction(userId, subjectId, resourceId, action, input, execute) {
    return runInTransaction(() => {
      const scope = requireScope(userId, subjectId);
      return secured(scope, resourceId, action, accessFields(input), () => execute(scope));
    });
  }

  return {
    createFinancialRecord(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'entryType', 'category', 'amount', 'currency', 'occurredAt', 'note',
        'confirmationId', 'securitySessionId',
      ]);
      const record = {
        entryType: requireLifeValue(input.entryType, 'entryType', FINANCIAL_ENTRY_TYPES),
        category: requireString(input.category, 'category', { maxLength: 80 }),
        amountMinor: normalizeMoney(input.amount),
        currency: normalizeCurrency(input.currency),
        occurredAt: normalizeTimestamp(input.occurredAt, 'occurredAt', clock().toISOString()),
        note: optionalString(input.note, 'note', { maxLength: 1000 }),
      };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.finance, 'write', input, (scope) => {
          const created = lifeManagementRepository.insertFinancialRecord({
            financialRecordId: idFactory(), ...scope, ...record, createdAt: clock().toISOString(),
          });
          recordLifeEvent(
            scope, 'life_event_created', created.financialRecordId, 'finance', 'record_created',
          );
          return created;
        },
      );
    },
    listFinancialRecords(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'entryType', 'category', 'from', 'to', 'limit', 'confirmationId', 'securitySessionId',
      ]);
      const filters = {
        entryType: input.entryType === undefined
          ? null
          : requireLifeValue(input.entryType, 'entryType', FINANCIAL_ENTRY_TYPES),
        category: optionalString(input.category, 'category', { maxLength: 80 }),
        ...normalizeRange(input),
        limit: normalizeLimit(input.limit),
      };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.finance, 'read', input,
        (scope) => lifeManagementRepository.listFinancialRecords({ ...scope, ...filters }),
      );
    },
    getFinancialCategoryStatistics(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'from', 'to', 'confirmationId', 'securitySessionId',
      ]);
      const { from, to } = normalizeRange(input);
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.finance, 'read', input, (scope) => ({
          from,
          to,
          groups: lifeManagementRepository.summarizeFinancialCategories(
            scope.userId,
            scope.subjectId,
            from ?? '0000-01-01T00:00:00.000Z',
            to ?? '9999-12-31T23:59:59.999Z',
          ),
        }),
      );
    },
    getFinancialMonthlySummary(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'month', 'confirmationId', 'securitySessionId',
      ]);
      const month = normalizeMonth(input.month);
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.finance, 'read', input, (scope) => ({
          month,
          totals: lifeManagementRepository.summarizeFinancialMonth(
            scope.userId, scope.subjectId, month,
          ),
          budgets: lifeManagementRepository.listBudgets({ ...scope, month, limit: 100 }),
          accountingBasis: 'explicit_records_only',
          bankSync: 'not_connected',
          paymentExecution: 'not_supported',
        }),
      );
    },
    upsertBudget(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'month', 'category', 'amount', 'currency', 'reminderRule',
        'confirmationId', 'securitySessionId',
      ]);
      const budget = {
        month: normalizeMonth(input.month),
        category: requireString(input.category, 'category', { maxLength: 80 }),
        amountMinor: normalizeMoney(input.amount),
        currency: normalizeCurrency(input.currency),
        reminderRule: normalizeReminderRule(input.reminderRule, 'budget'),
      };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.finance, 'manage', input, (scope) => {
          const now = clock().toISOString();
          const stored = lifeManagementRepository.upsertBudget({
            budgetId: idFactory(), ...scope, ...budget, createdAt: now, updatedAt: now,
          });
          recordLifeEvent(scope, 'budget_changed', stored.budgetId, 'finance', 'budget_upserted');
          return stored;
        },
      );
    },
    listBudgets(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'month', 'limit', 'confirmationId', 'securitySessionId',
      ]);
      const month = input.month === undefined ? null : normalizeMonth(input.month);
      const limit = normalizeLimit(input.limit);
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.finance, 'read', input,
        (scope) => lifeManagementRepository.listBudgets({ ...scope, month, limit }),
      );
    },
    createCalendarEntry(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'entryType', 'title', 'startsAt', 'endsAt', 'note', 'reminderRule',
        'confirmationId', 'securitySessionId',
      ]);
      const startsAt = normalizeTimestamp(input.startsAt, 'startsAt');
      if (!startsAt) throw new ValidationError('startsAt is required.', { field: 'startsAt' });
      const endsAt = normalizeTimestamp(input.endsAt, 'endsAt');
      if (endsAt && endsAt < startsAt) {
        throw new ValidationError('endsAt must not be earlier than startsAt.', {
          fields: ['startsAt', 'endsAt'],
        });
      }
      const entry = {
        entryType: requireLifeValue(input.entryType, 'entryType', CALENDAR_ENTRY_TYPES),
        title: requireString(input.title, 'title', { maxLength: 200 }),
        startsAt,
        endsAt,
        note: optionalString(input.note, 'note', { maxLength: 2000 }),
        reminderRule: normalizeReminderRule(input.reminderRule, 'calendar'),
      };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.calendar, 'write', input, (scope) => {
          const now = clock().toISOString();
          const created = lifeManagementRepository.insertCalendarEntry({
            calendarEntryId: idFactory(), ...scope, ...entry, createdAt: now, updatedAt: now,
          });
          recordLifeEvent(
            scope, 'life_event_created', created.calendarEntryId, 'calendar', 'entry_created',
          );
          return created;
        },
      );
    },
    listCalendarEntries(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'entryType', 'from', 'to', 'limit', 'confirmationId', 'securitySessionId',
      ]);
      const filters = {
        entryType: input.entryType === undefined
          ? null
          : requireLifeValue(input.entryType, 'entryType', CALENDAR_ENTRY_TYPES),
        ...normalizeRange(input),
        limit: normalizeLimit(input.limit),
      };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.calendar, 'read', input,
        (scope) => lifeManagementRepository.listCalendarEntries({ ...scope, ...filters }),
      );
    },
    updateCalendarEntry(userId, subjectId, calendarEntryId, value) {
      const input = requireOnlyFields(value, [
        'entryType', 'title', 'startsAt', 'endsAt', 'note', 'reminderRule',
        'confirmationId', 'securitySessionId',
      ]);
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.calendar, 'write', input, (scope) => {
          const normalizedId = requireOpaqueResourceId(calendarEntryId, 'calendarEntryId');
          const current = lifeManagementRepository.findCalendarEntry(
            scope.userId, scope.subjectId, normalizedId,
          );
          if (!current) throw new NotFoundError('Calendar entry was not found for this subject.');
          const startsAt = input.startsAt === undefined
            ? current.startsAt
            : normalizeTimestamp(input.startsAt, 'startsAt');
          const endsAt = input.endsAt === undefined
            ? current.endsAt
            : normalizeTimestamp(input.endsAt, 'endsAt');
          if (endsAt && endsAt < startsAt) {
            throw new ValidationError('endsAt must not be earlier than startsAt.', {
              fields: ['startsAt', 'endsAt'],
            });
          }
          const updated = lifeManagementRepository.updateCalendarEntry({
            ...current,
            entryType: input.entryType === undefined
              ? current.entryType
              : requireLifeValue(input.entryType, 'entryType', CALENDAR_ENTRY_TYPES),
            title: input.title === undefined
              ? current.title
              : requireString(input.title, 'title', { maxLength: 200 }),
            startsAt,
            endsAt,
            note: input.note === undefined
              ? current.note
              : optionalString(input.note, 'note', { maxLength: 2000 }),
            reminderRule: input.reminderRule === undefined
              ? current.reminderRule
              : normalizeReminderRule(input.reminderRule, 'calendar'),
            updatedAt: clock().toISOString(),
          });
          recordLifeEvent(
            scope, 'life_event_created', updated.calendarEntryId, 'calendar', 'entry_updated',
          );
          return updated;
        },
      );
    },
    createBodyRecord(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'weightKg', 'bustCm', 'waistCm', 'hipCm', 'aiSuggestion', 'measuredAt',
        'confirmationId', 'securitySessionId',
      ]);
      const record = {
        weightKg: optionalMetric(input.weightKg, 'weightKg', 1000),
        bustCm: optionalMetric(input.bustCm, 'bustCm', 500),
        waistCm: optionalMetric(input.waistCm, 'waistCm', 500),
        hipCm: optionalMetric(input.hipCm, 'hipCm', 500),
        aiSuggestion: optionalString(input.aiSuggestion, 'aiSuggestion', { maxLength: 4000 }),
        measuredAt: normalizeTimestamp(input.measuredAt, 'measuredAt', clock().toISOString()),
      };
      ensureAtLeastOneMetric(record, ['weightKg', 'bustCm', 'waistCm', 'hipCm']);
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.body, 'write', input, (scope) => {
          const created = lifeManagementRepository.insertBodyRecord({
            bodyRecordId: idFactory(), ...scope, ...record, createdAt: clock().toISOString(),
          });
          recordLifeEvent(
            scope, 'health_record_updated', created.bodyRecordId, 'body', 'record_created',
          );
          return {
            ...created,
            medicalUse: 'not_for_diagnosis',
            modelCall: 'not_performed',
            wearableSync: 'not_connected',
          };
        },
      );
    },
    listBodyRecords(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'from', 'to', 'limit', 'confirmationId', 'securitySessionId',
      ]);
      const filters = { ...normalizeRange(input), limit: normalizeLimit(input.limit) };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.body, 'read', input,
        (scope) => lifeManagementRepository.listBodyRecords({ ...scope, ...filters }),
      );
    },
    getBodyTrend(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'from', 'to', 'limit', 'confirmationId', 'securitySessionId',
      ]);
      const filters = { ...normalizeRange(input), limit: normalizeLimit(input.limit, 100) };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.body, 'read', input, (scope) => {
          const records = lifeManagementRepository.listBodyRecords({
            ...scope, ...filters, ascending: true,
          });
          const metrics = ['weightKg', 'bustCm', 'waistCm', 'hipCm'];
          const changes = Object.fromEntries(metrics.map((metric) => {
            const points = records.filter((record) => record[metric] !== null);
            return [metric, points.length < 2
              ? null
              : Math.round((points.at(-1)[metric] - points[0][metric]) * 100) / 100];
          }));
          return {
            records,
            changes,
            analysis: 'deterministic_difference_only',
            medicalDiagnosis: 'not_performed',
          };
        },
      );
    },
    upsertBodyGoal(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'targetWeightKg', 'targetBustCm', 'targetWaistCm', 'targetHipCm',
        'targetDate', 'note', 'confirmationId', 'securitySessionId',
      ]);
      const goal = {
        targetWeightKg: optionalMetric(input.targetWeightKg, 'targetWeightKg', 1000),
        targetBustCm: optionalMetric(input.targetBustCm, 'targetBustCm', 500),
        targetWaistCm: optionalMetric(input.targetWaistCm, 'targetWaistCm', 500),
        targetHipCm: optionalMetric(input.targetHipCm, 'targetHipCm', 500),
        targetDate: normalizeDate(input.targetDate, 'targetDate'),
        note: optionalString(input.note, 'note', { maxLength: 2000 }),
      };
      ensureAtLeastOneMetric(goal, [
        'targetWeightKg', 'targetBustCm', 'targetWaistCm', 'targetHipCm',
      ]);
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.body, 'manage', input, (scope) => {
          const current = lifeManagementRepository.findBodyGoal(scope.userId, scope.subjectId);
          const now = clock().toISOString();
          const stored = lifeManagementRepository.upsertBodyGoal({
            bodyGoalId: current?.bodyGoalId ?? idFactory(),
            ...scope,
            ...goal,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
          });
          recordLifeEvent(
            scope, 'health_record_updated', stored.bodyGoalId, 'body', 'goal_upserted',
          );
          return { ...stored, medicalUse: 'not_for_diagnosis' };
        },
      );
    },
    getBodyGoal(userId, subjectId, value) {
      const input = requireOnlyFields(value, ['confirmationId', 'securitySessionId']);
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.body, 'read', input, (scope) =>
          lifeManagementRepository.findBodyGoal(scope.userId, scope.subjectId),
      );
    },
    createLocalMemory(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'title', 'content', 'participatesInContext', 'exportMarked',
        'confirmationId', 'securitySessionId',
      ]);
      const memory = {
        title: requireString(input.title, 'title', { maxLength: 200 }),
        content: requireString(input.content, 'content', { maxLength: 16_000 }),
        participatesInContext: optionalBoolean(
          input.participatesInContext, 'participatesInContext', false,
        ),
        exportMarked: optionalBoolean(input.exportMarked, 'exportMarked', false),
      };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.localMemory, 'write', input, (scope) => {
          const now = clock().toISOString();
          const created = lifeManagementRepository.insertLocalMemory({
            memoryId: idFactory(), ...scope, ...memory, createdAt: now, updatedAt: now,
          });
          recordLifeEvent(
            scope, 'life_event_created', created.memoryId, 'local_memory', 'memory_created',
          );
          return created;
        },
      );
    },
    listLocalMemories(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'participatesInContext', 'exportMarked', 'limit',
        'confirmationId', 'securitySessionId',
      ]);
      const filters = {
        participatesInContext: optionalBoolean(
          input.participatesInContext, 'participatesInContext', null,
        ),
        exportMarked: optionalBoolean(input.exportMarked, 'exportMarked', null),
        limit: normalizeLimit(input.limit),
      };
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.localMemory, 'read', input,
        (scope) => lifeManagementRepository.listLocalMemories({ ...scope, ...filters }),
      );
    },
    updateLocalMemoryFlags(userId, subjectId, memoryId, value) {
      const input = requireOnlyFields(value, [
        'participatesInContext', 'exportMarked', 'confirmationId', 'securitySessionId',
      ]);
      if (input.participatesInContext === undefined && input.exportMarked === undefined) {
        throw new ValidationError('At least one local memory flag must be provided.', {
          fields: ['participatesInContext', 'exportMarked'],
        });
      }
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.localMemory, 'manage', input, (scope) => {
          const normalizedId = requireOpaqueResourceId(memoryId, 'memoryId');
          const current = lifeManagementRepository.findLocalMemory(
            scope.userId, scope.subjectId, normalizedId,
          );
          if (!current) throw new NotFoundError('Local memory was not found for this subject.');
          const updated = lifeManagementRepository.updateLocalMemoryFlags({
            ...current,
            participatesInContext: optionalBoolean(
              input.participatesInContext,
              'participatesInContext',
              current.participatesInContext,
            ),
            exportMarked: optionalBoolean(
              input.exportMarked, 'exportMarked', current.exportMarked,
            ),
            updatedAt: clock().toISOString(),
          });
          recordLifeEvent(
            scope, 'life_event_created', updated.memoryId, 'local_memory', 'flags_updated',
          );
          return updated;
        },
      );
    },
    createLocalMemoryContextProjection(userId, subjectId, value) {
      const input = requireOnlyFields(value, [
        'limit', 'confirmationId', 'securitySessionId',
      ]);
      const limit = normalizeLimit(input.limit, 20);
      return securedTransaction(
        userId, subjectId, LIFE_RESOURCE_IDS.localMemory, 'read', input, (scope) => ({
          schemaVersion: 'local-memory-context-v1',
          ...scope,
          storageScope: 'user_local_memory',
          memories: lifeManagementRepository.listLocalMemories({
            ...scope,
            participatesInContext: true,
            exportMarked: null,
            limit,
          }),
          generatedAt: clock().toISOString(),
          execution: {
            modelCall: 'not_performed',
            externalApiCall: 'not_performed',
            wearableSync: 'not_connected',
          },
        }),
      );
    },
  };
}
