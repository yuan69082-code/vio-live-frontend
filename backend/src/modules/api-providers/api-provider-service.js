import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import { requireApiKeySecretRef } from '../../integrations/secrets/environment-api-credential-store.js';
import {
  API_INTERFACE_FORMATS,
  API_PROVIDER_STATUSES,
  API_PROVIDER_TYPES,
} from './api-provider-types.js';

const secretFieldPattern = /^(api[_-]?key|key|token|secret|secret[_-]?ref|credential|credentials)$/i;

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    const containsSecretField = unexpectedFields.some((field) => secretFieldPattern.test(field));
    throw new ValidationError(
      containsSecretField
        ? 'API credentials are not accepted in the current stage.'
        : 'Request body contains unsupported fields.',
      { unexpectedFields },
    );
  }

  return input;
}

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

function normalizeBaseUrl(value) {
  const rawValue = requireString(value, 'baseUrl', { maxLength: 2_048 });
  let url;

  try {
    url = new URL(rawValue);
  } catch {
    throw new ValidationError('baseUrl must be a valid HTTP or HTTPS URL.', {
      field: 'baseUrl',
    });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ValidationError('baseUrl must use HTTP or HTTPS.', { field: 'baseUrl' });
  }

  if (url.username || url.password) {
    throw new ValidationError('baseUrl must not contain credentials.', { field: 'baseUrl' });
  }

  if (url.hash) {
    throw new ValidationError('baseUrl must not contain a fragment.', { field: 'baseUrl' });
  }

  for (const key of url.searchParams.keys()) {
    if (secretFieldPattern.test(key)) {
      throw new ValidationError('baseUrl must not contain credential query parameters.', {
        field: 'baseUrl',
      });
    }
  }

  return url.toString();
}

function defaultInterfaceFormat(providerType) {
  return {
    openai: 'openai_compatible',
    claude: 'anthropic_messages',
    glm: 'glm_compatible',
    custom: 'custom_http',
  }[providerType];
}

function presentProvider(provider, credentialStore, credentialBindingRepository) {
  if (!provider) {
    return null;
  }

  const { apiKeySecretRef, ...publicProvider } = provider;
  const activeBinding = credentialBindingRepository?.findActive(
    provider.ownerUserId,
    provider.providerId,
  );
  return {
    ...publicProvider,
    credentials: {
      apiKey: credentialStore.describeApiKey({
        providerId: provider.providerId,
        secretRef: activeBinding?.secretRef ?? apiKeySecretRef,
      }),
    },
  };
}

export function createApiProviderService({
  apiProviderRepository,
  userRepository,
  auditLogService,
  credentialStore,
  credentialBindingRepository = null,
  securityService = null,
  runInTransaction,
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

  function recordChange(provider, action) {
    auditLogService.recordAuditLog({
      userId: provider.ownerUserId,
      operationType: 'api_configuration_change',
      resourceType: 'api_provider',
      resourceId: provider.providerId,
      action,
      riskLevel: 'high',
      result: 'succeeded',
      reasonCode: `api_provider_${action}`,
    });
  }

  return {
    createProvider(userId, value) {
      const ownerUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'displayName',
        'providerType',
        'baseUrl',
        'interfaceFormat',
        'status',
      ]);
      const now = clock().toISOString();
      const providerType = requireAllowedValue(
        input.providerType,
        'providerType',
        API_PROVIDER_TYPES,
      );
      const provider = {
        providerId: idFactory(),
        ownerUserId,
        displayName: requireString(input.displayName, 'displayName', { maxLength: 120 }),
        providerType,
        baseUrl: normalizeBaseUrl(input.baseUrl),
        interfaceFormat: input.interfaceFormat === undefined
          ? defaultInterfaceFormat(providerType)
          : requireAllowedValue(
              input.interfaceFormat,
              'interfaceFormat',
              API_INTERFACE_FORMATS,
            ),
        status: input.status === undefined
          ? 'enabled'
          : requireAllowedValue(input.status, 'status', API_PROVIDER_STATUSES),
        apiKeySecretRef: null,
        testStatus: 'not_tested',
        createdAt: now,
        updatedAt: now,
      };

      return runInTransaction(() => {
        const created = apiProviderRepository.insert(provider);
        recordChange(created, 'created');
        return presentProvider(created, credentialStore, credentialBindingRepository);
      });
    },
    getProvider(userId, providerId) {
      const ownerUserId = requireUser(userId);
      const normalizedProviderId = requireString(providerId, 'providerId', { maxLength: 128 });
      const provider = apiProviderRepository.findById(ownerUserId, normalizedProviderId);

      if (!provider) {
        throw new NotFoundError('API provider was not found for this user.');
      }

      return presentProvider(provider, credentialStore, credentialBindingRepository);
    },
    listProviders(userId) {
      return apiProviderRepository
        .findManyByUser(requireUser(userId))
        .map((provider) => presentProvider(provider, credentialStore, credentialBindingRepository));
    },
    updateProviderStatus(userId, providerId, value) {
      const ownerUserId = requireUser(userId);
      const normalizedProviderId = requireString(providerId, 'providerId', { maxLength: 128 });
      const input = requireOnlyFields(value, ['status']);
      const status = requireAllowedValue(input.status, 'status', API_PROVIDER_STATUSES);
      return runInTransaction(() => {
        const provider = apiProviderRepository.updateStatus(
          ownerUserId,
          normalizedProviderId,
          status,
          clock().toISOString(),
        );

        if (!provider) {
          throw new NotFoundError('API provider was not found for this user.');
        }

        recordChange(provider, 'status_updated');
        return presentProvider(provider, credentialStore, credentialBindingRepository);
      });
    },
    bindCredentialReference(userId, providerId, value) {
      const ownerUserId = requireUser(userId);
      const normalizedProviderId = requireString(providerId, 'providerId', { maxLength: 128 });
      if (!credentialBindingRepository || !securityService) {
        throw new ValidationError('Secure credential reference binding is not configured.');
      }
      const provider = apiProviderRepository.findById(ownerUserId, normalizedProviderId);
      if (!provider) throw new NotFoundError('API provider was not found for this user.');
      const input = requireOnlyFields(value, ['secretRef', 'subjectId', 'confirmationId', 'securitySessionId']);
      const { secretRef } = requireApiKeySecretRef(input.secretRef);
      const subjectId = requireString(input.subjectId, 'subjectId', { maxLength: 128 });
      const security = securityService.checkSecurity(ownerUserId, {
        subjectId,
        resourceType: 'api',
        resourceId: normalizedProviderId,
        action: 'manage',
        operationType: 'api_configuration_change',
        sensitiveDataCategories: ['api_key'],
        ...(input.confirmationId ? { confirmationId: input.confirmationId } : {}),
        ...(input.securitySessionId ? { securitySessionId: input.securitySessionId } : {}),
      }, { minimumRiskLevel: 'high' });
      if (security.decision !== 'allow') {
        return {
          operationStatus: security.decision === 'confirm' ? 'confirmation_required' : 'denied',
          credentials: { status: 'not_changed' },
          security,
        };
      }
      const now = clock().toISOString();
      const binding = runInTransaction(() => credentialBindingRepository.replaceActive({
        credentialBindingId: idFactory(),
        ownerUserId,
        providerId: normalizedProviderId,
        secretRef,
        securityAuditLogId: security.auditLogId,
        createdAt: now,
      }));
      return {
        operationStatus: 'completed',
        providerId: normalizedProviderId,
        credentialBindingId: binding.credentialBindingId,
        credentials: credentialStore.describeApiKey({ providerId: normalizedProviderId, secretRef }),
        security,
      };
    },
    getCredentialBindingForExecution(userId, providerId) {
      const ownerUserId = requireUser(userId);
      const normalizedProviderId = requireString(providerId, 'providerId', { maxLength: 128 });
      const provider = apiProviderRepository.findById(ownerUserId, normalizedProviderId);
      if (!provider) throw new NotFoundError('API provider was not found for this user.');
      const binding = credentialBindingRepository?.findActive(ownerUserId, normalizedProviderId);
      if (!binding) throw new NotFoundError('API provider credential is not configured.');
      return Object.freeze({
        credentialBindingId: binding.credentialBindingId,
        resolveApiKey: () => credentialStore.resolveApiKey({ secretRef: binding.secretRef }),
      });
    },
  };
}
