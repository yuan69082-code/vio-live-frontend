import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import { PERMISSION_LEVELS, requirePermissionValue } from '../permissions/permission-types.js';
import { requireDeviceAdapterRegistry } from './device-adapter-port.js';
import {
  DEVICE_CAPABILITIES,
  DEVICE_REGISTRY_STATUSES,
  DEVICE_TYPES,
  getDeviceCapabilityDefinition,
  optionalDeviceValue,
  requireDeviceValue,
} from './device-types.js';

function requireOnlyFields(value, allowedFields, message = 'Request body contains unsupported fields.') {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpectedFields.length > 0) {
    throw new ValidationError(message, { unexpectedFields });
  }

  return input;
}

function normalizeBrand(value) {
  const brand = requireString(value, 'brand', { maxLength: 80 }).toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(brand)) {
    throw new ValidationError('brand must be a lowercase registry identifier.', {
      field: 'brand',
    });
  }

  return brand;
}

function optionalBrand(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeBrand(value);
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('capabilities must be a non-empty array.', {
      field: 'capabilities',
    });
  }
  if (value.length > DEVICE_CAPABILITIES.length) {
    throw new ValidationError('capabilities contains too many items.', {
      field: 'capabilities',
      maxItems: DEVICE_CAPABILITIES.length,
    });
  }

  const normalized = value.map((capability, index) => requireDeviceValue(
    capability,
    `capabilities[${index}]`,
    DEVICE_CAPABILITIES,
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new ValidationError('capabilities must not contain duplicate items.', {
      field: 'capabilities',
    });
  }

  return DEVICE_CAPABILITIES.filter((capability) => normalized.includes(capability));
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

function preparationStatus(securityDecision) {
  return {
    allow: 'ready',
    confirm: 'confirmation_required',
    deny: 'denied',
  }[securityDecision];
}

function resultSummary(status) {
  return {
    ready: 'Device security preparation completed; no device operation was performed.',
    confirmation_required: 'Device confirmation is required; no device operation was performed.',
    denied: 'Device permission or security denied preparation; no device operation was performed.',
  }[status];
}

export function createDeviceService({
  deviceRepository,
  deviceAdapterRegistry,
  userRepository,
  subjectRepository,
  permissionService,
  securityService,
  eventService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  const adapters = requireDeviceAdapterRegistry(deviceAdapterRegistry);

  function requireUser(userId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }
    return normalizedUserId;
  }

  function requireScope(userId, subjectId) {
    const normalizedUserId = requireUser(userId);
    const normalizedSubjectId = requireString(subjectId, 'subjectId', {
      maxLength: 128,
    });
    if (!subjectRepository.findById(normalizedUserId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }
    return { userId: normalizedUserId, subjectId: normalizedSubjectId };
  }

  function requireDevice(userId, deviceId) {
    const normalizedDeviceId = requireString(deviceId, 'deviceId', { maxLength: 128 });
    const device = deviceRepository.findDevice(userId, normalizedDeviceId);
    if (!device) {
      throw new NotFoundError('Device registry entry was not found for this user.');
    }
    return device;
  }

  function requireCapability(device, value) {
    const capability = requireDeviceValue(value, 'capability', DEVICE_CAPABILITIES);
    if (!device.capabilities.includes(capability)) {
      throw new ConflictError('Device does not declare this capability.');
    }
    return getDeviceCapabilityDefinition(capability);
  }

  function presentDevice(device) {
    const adapter = adapters.resolveAdapter(device.brand);
    return {
      ...device,
      connectionStatus: 'not_connected',
      stateStatus: 'not_observed',
      adapter: {
        ...adapter,
        assignedAdapterType: device.adapterType,
      },
      capabilityDefinitions: device.capabilities.map((capability) => {
        const definition = getDeviceCapabilityDefinition(capability);
        return {
          ...definition,
          permissionRequirement: {
            required: true,
            resourceType: 'device',
            resourceId: device.deviceId,
            action: definition.permissionAction,
          },
          executionSupport: 'not_implemented',
        };
      }),
      controlSupport: 'not_implemented',
    };
  }

  function recordDeviceEvent({ userId, subjectId = null, device, changeType, data }) {
    return eventService.createEvent(userId, {
      ...(subjectId ? { subjectId } : {}),
      eventType: 'device_changed',
      source: {
        type: 'device-service',
        reference: device.deviceId,
      },
      summary: `Device registry event: ${changeType}.`,
      data: {
        deviceId: device.deviceId,
        changeType,
        deviceType: device.deviceType,
        registryStatus: device.status,
        connectionStatus: 'not_connected',
        executionStatus: 'not_executed',
        ...data,
      },
    });
  }

  return {
    listAdapterDescriptors() {
      return adapters.listAdapters();
    },
    createDevice(userId, value) {
      const ownerUserId = requireUser(userId);
      const input = requireOnlyFields(value, [
        'deviceType',
        'brand',
        'name',
        'status',
        'capabilities',
      ]);
      const brand = normalizeBrand(input.brand);
      const adapter = adapters.resolveAdapter(brand);
      const now = clock().toISOString();
      const device = {
        deviceId: idFactory(),
        ownerUserId,
        deviceType: requireDeviceValue(input.deviceType, 'deviceType', DEVICE_TYPES),
        brand,
        name: requireString(input.name, 'name', { maxLength: 120 }),
        status: input.status === undefined
          ? 'disabled'
          : requireDeviceValue(
              input.status,
              'status',
              DEVICE_REGISTRY_STATUSES,
            ),
        adapterType: adapter.adapterType,
        capabilities: normalizeCapabilities(input.capabilities),
        createdAt: now,
        updatedAt: now,
      };

      return runInTransaction(() => {
        const created = deviceRepository.insertDevice(device);
        const event = recordDeviceEvent({
          userId: ownerUserId,
          device: created,
          changeType: 'connection_registered',
          data: {
            brand: created.brand,
            adapterType: created.adapterType,
          },
        });
        return { device: presentDevice(created), event };
      });
    },
    getDevice(userId, deviceId) {
      const ownerUserId = requireUser(userId);
      return presentDevice(requireDevice(ownerUserId, deviceId));
    },
    listDevices(userId, filters = {}) {
      const ownerUserId = requireUser(userId);
      const deviceType = optionalDeviceValue(
        filters.deviceType,
        'deviceType',
        DEVICE_TYPES,
      );
      const status = optionalDeviceValue(
        filters.status,
        'status',
        DEVICE_REGISTRY_STATUSES,
      );
      const brand = optionalBrand(filters.brand);
      return deviceRepository.listDevices(ownerUserId)
        .filter((device) => !deviceType || device.deviceType === deviceType)
        .filter((device) => !status || device.status === status)
        .filter((device) => !brand || device.brand === brand)
        .map(presentDevice);
    },
    updateDeviceStatus(userId, deviceId, value) {
      const ownerUserId = requireUser(userId);
      const input = requireOnlyFields(value, ['status']);
      const status = requireDeviceValue(
        input.status,
        'status',
        DEVICE_REGISTRY_STATUSES,
      );

      return runInTransaction(() => {
        const current = requireDevice(ownerUserId, deviceId);
        if (current.status === status) {
          return { device: presentDevice(current), event: null };
        }
        const updated = deviceRepository.updateDeviceStatus(
          ownerUserId,
          current.deviceId,
          status,
          clock().toISOString(),
        );
        const event = recordDeviceEvent({
          userId: ownerUserId,
          device: updated,
          changeType: 'registry_status_changed',
          data: {
            previousRegistryStatus: current.status,
            currentRegistryStatus: updated.status,
          },
        });
        return { device: presentDevice(updated), event };
      });
    },
    createDeviceAuthorization(userId, deviceId, value) {
      const ownerUserId = requireUser(userId);
      const device = requireDevice(ownerUserId, deviceId);
      const input = requireOnlyFields(value, [
        'subjectId',
        'capability',
        'permissionLevel',
        'status',
      ]);
      const scope = requireScope(ownerUserId, input.subjectId);
      const capability = requireCapability(device, input.capability);
      const permissionLevel = requirePermissionValue(
        input.permissionLevel,
        'permissionLevel',
        PERMISSION_LEVELS,
      );

      return runInTransaction(() => {
        const permission = permissionService.createPermission(ownerUserId, {
          subjectId: scope.subjectId,
          resourceType: 'device',
          resourceId: device.deviceId,
          action: capability.permissionAction,
          permissionLevel,
          ...(input.status === undefined ? {} : { status: input.status }),
        });
        const event = recordDeviceEvent({
          userId: ownerUserId,
          subjectId: scope.subjectId,
          device,
          changeType: 'authorization_changed',
          data: {
            capability: capability.capability,
            action: capability.permissionAction,
            permissionId: permission.permissionId,
            permissionLevel: permission.permissionLevel,
            permissionStatus: permission.status,
          },
        });
        return {
          device: presentDevice(device),
          capability,
          permission,
          event,
        };
      });
    },
    prepareDeviceOperation(userId, subjectId, deviceId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(
        value,
        ['capability', 'confirmationId'],
        'Device operation preparation accepts capability and confirmation metadata only.',
      );
      const device = requireDevice(scope.userId, deviceId);
      if (device.status !== 'enabled') {
        throw new ConflictError('Device registry entry is disabled.');
      }
      const capability = requireCapability(device, input.capability);
      const confirmationId = optionalString(
        input.confirmationId,
        'confirmationId',
        { maxLength: 128 },
      );

      return runInTransaction(() => {
        const security = securityService.checkSecurity(scope.userId, {
          subjectId: scope.subjectId,
          resourceType: 'device',
          resourceId: device.deviceId,
          action: capability.permissionAction,
          operationType: 'device_control',
          sensitiveDataCategories: [],
          ...(confirmationId ? { confirmationId } : {}),
        });
        const status = preparationStatus(security.decision);
        const event = recordDeviceEvent({
          userId: scope.userId,
          subjectId: scope.subjectId,
          device,
          changeType: 'operation_requested',
          data: {
            capability: capability.capability,
            action: capability.permissionAction,
            preparationStatus: status,
            permissionDecision: security.permission.decision,
            securityDecision: security.decision,
          },
        });
        const operationLog = deviceRepository.insertOperationLog({
          deviceOperationLogId: idFactory(),
          userId: scope.userId,
          subjectId: scope.subjectId,
          deviceId: device.deviceId,
          capability: capability.capability,
          action: capability.permissionAction,
          permissionDecision: security.permission.decision,
          securityDecision: security.decision,
          riskLevel: security.risk.level,
          preparationStatus: status,
          executionStatus: 'not_executed',
          resultSummary: resultSummary(status),
          auditLogId: security.auditLogId,
          eventId: event.eventId,
          requestedAt: clock().toISOString(),
        });

        return {
          device: presentDevice(device),
          capability,
          preparationStatus: status,
          security,
          event,
          operationLog,
          execution: {
            supported: false,
            status: 'not_executed',
            deviceCall: 'not_performed',
            vendorApiCall: 'not_performed',
            reason: 'device_adapter_not_implemented',
          },
        };
      });
    },
    listDeviceOperationLogs(userId, subjectId, filters = {}) {
      const scope = requireScope(userId, subjectId);
      const deviceId = optionalString(filters.deviceId, 'deviceId', {
        maxLength: 128,
      });
      if (deviceId) {
        requireDevice(scope.userId, deviceId);
      }
      const capability = optionalDeviceValue(
        filters.capability,
        'capability',
        DEVICE_CAPABILITIES,
      );
      return deviceRepository.listOperationLogs({
        ...scope,
        deviceId,
        capability,
        limit: normalizeLimit(filters.limit),
      });
    },
    getDeviceOperationLog(userId, subjectId, deviceOperationLogId) {
      const scope = requireScope(userId, subjectId);
      const normalizedLogId = requireString(
        deviceOperationLogId,
        'deviceOperationLogId',
        { maxLength: 128 },
      );
      const log = deviceRepository.findOperationLog(
        scope.userId,
        scope.subjectId,
        normalizedLogId,
      );
      if (!log) {
        throw new NotFoundError('Device operation log was not found for this subject.');
      }
      return log;
    },
  };
}
