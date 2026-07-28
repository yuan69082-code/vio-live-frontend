import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const LIFE_RESOURCE_IDS = Object.freeze({
  finance: 'finance',
  calendar: 'calendar',
  body: 'body',
  localMemory: 'local-memory',
});

export const FINANCIAL_ENTRY_TYPES = Object.freeze(['income', 'expense']);
export const CALENDAR_ENTRY_TYPES = Object.freeze([
  'anniversary',
  'menstrual_period',
  'intimate_record',
  'ordinary_event',
]);

export function requireLifeValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });
  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, { field, allowedValues });
  }
  return normalized;
}
