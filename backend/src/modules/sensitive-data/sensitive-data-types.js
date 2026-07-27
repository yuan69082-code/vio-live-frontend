import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

const definitions = Object.freeze({
  api_key: Object.freeze({
    category: 'api_key',
    displayName: 'API Key',
    riskLevel: 'critical',
    storagePolicy: 'secret_reference_only',
    contentAccepted: false,
  }),
  identity_information: Object.freeze({
    category: 'identity_information',
    displayName: 'Identity information',
    riskLevel: 'high',
    storagePolicy: 'protected_storage_required',
    contentAccepted: false,
  }),
  payment_information: Object.freeze({
    category: 'payment_information',
    displayName: 'Payment information',
    riskLevel: 'critical',
    storagePolicy: 'protected_storage_required',
    contentAccepted: false,
  }),
  private_record: Object.freeze({
    category: 'private_record',
    displayName: 'Private record',
    riskLevel: 'high',
    storagePolicy: 'protected_storage_required',
    contentAccepted: false,
  }),
  ai_private_domain: Object.freeze({
    category: 'ai_private_domain',
    displayName: 'AI Private Domain data',
    riskLevel: 'high',
    storagePolicy: 'private_domain_storage_required',
    contentAccepted: false,
  }),
});

export const SENSITIVE_DATA_CATEGORIES = Object.freeze(Object.keys(definitions));

export function listSensitiveDataClassifications() {
  return SENSITIVE_DATA_CATEGORIES.map((category) => ({ ...definitions[category] }));
}

export function getSensitiveDataClassification(category) {
  return definitions[category] ?? null;
}

export function normalizeSensitiveDataCategories(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ValidationError('sensitiveDataCategories must be an array.', {
      field: 'sensitiveDataCategories',
    });
  }

  const categories = value.map((category, index) => {
    const normalized = requireString(
      category,
      `sensitiveDataCategories[${index}]`,
      { maxLength: 80 },
    );

    if (!SENSITIVE_DATA_CATEGORIES.includes(normalized)) {
      throw new ValidationError('Sensitive data category is not supported.', {
        field: `sensitiveDataCategories[${index}]`,
        allowedValues: SENSITIVE_DATA_CATEGORIES,
      });
    }

    return normalized;
  });

  return [...new Set(categories)];
}
