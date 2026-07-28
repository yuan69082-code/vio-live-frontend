export const DEVICE_ADAPTER_CONTRACT_METHODS = Object.freeze([
  'connect',
  'disconnect',
  'readStatus',
  'executeCapability',
]);

export function requireDeviceAdapterRegistry(registry) {
  for (const method of ['listAdapters', 'resolveAdapter']) {
    if (typeof registry?.[method] !== 'function') {
      throw new TypeError(`Device adapter registry must implement ${method}().`);
    }
  }

  return registry;
}
