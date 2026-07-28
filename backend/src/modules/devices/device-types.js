import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/validation.js';

export const DEVICE_TYPES = Object.freeze([
  'phone',
  'watch',
  'air_conditioner',
  'robot_vacuum',
  'washing_machine',
  'camera',
  'appliance',
]);

export const DEVICE_REGISTRY_STATUSES = Object.freeze(['enabled', 'disabled']);

export const DEVICE_CAPABILITIES = Object.freeze([
  'view_status',
  'power',
  'adjust_parameter',
  'get_data',
]);

export const DEVICE_ADAPTER_TYPES = Object.freeze([
  'xiaomi',
  'midea',
  'apple',
  'android',
  'generic',
]);

const capabilityDefinitions = Object.freeze({
  view_status: Object.freeze({
    capability: 'view_status',
    description: 'Read a future device status projection.',
    permissionAction: 'read',
  }),
  power: Object.freeze({
    capability: 'power',
    description: 'Prepare a future power on or off operation.',
    permissionAction: 'control',
  }),
  adjust_parameter: Object.freeze({
    capability: 'adjust_parameter',
    description: 'Prepare a future device parameter adjustment.',
    permissionAction: 'control',
  }),
  get_data: Object.freeze({
    capability: 'get_data',
    description: 'Read future data made available by a device adapter.',
    permissionAction: 'read',
  }),
});

export function requireDeviceValue(value, field, allowedValues) {
  const normalized = requireString(value, field, { maxLength: 80 });
  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(`${field} is not supported.`, {
      field,
      allowedValues,
    });
  }

  return normalized;
}

export function optionalDeviceValue(value, field, allowedValues) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return requireDeviceValue(value, field, allowedValues);
}

export function getDeviceCapabilityDefinition(capability) {
  return capabilityDefinitions[requireDeviceValue(
    capability,
    'capability',
    DEVICE_CAPABILITIES,
  )];
}

export function listDeviceCapabilityDefinitions() {
  return DEVICE_CAPABILITIES.map((capability) => capabilityDefinitions[capability]);
}
