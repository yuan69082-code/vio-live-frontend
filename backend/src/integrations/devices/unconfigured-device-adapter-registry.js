import { DEVICE_ADAPTER_CONTRACT_METHODS } from '../../modules/devices/device-adapter-port.js';

const descriptors = Object.freeze([
  Object.freeze({
    adapterType: 'xiaomi',
    displayName: 'Xiaomi adapter placeholder',
    supportedBrand: 'xiaomi',
  }),
  Object.freeze({
    adapterType: 'midea',
    displayName: 'Midea adapter placeholder',
    supportedBrand: 'midea',
  }),
  Object.freeze({
    adapterType: 'apple',
    displayName: 'Apple adapter placeholder',
    supportedBrand: 'apple',
  }),
  Object.freeze({
    adapterType: 'android',
    displayName: 'Android adapter placeholder',
    supportedBrand: 'android',
  }),
  Object.freeze({
    adapterType: 'generic',
    displayName: 'Generic device adapter placeholder',
    supportedBrand: null,
  }),
]);

function present(descriptor) {
  return {
    ...descriptor,
    implementationStatus: 'not_implemented',
    connectionSupported: false,
    controlSupported: false,
    externalApiCallsSupported: false,
    contract: DEVICE_ADAPTER_CONTRACT_METHODS.map((method) => ({
      method,
      supported: false,
    })),
  };
}

export function createUnconfiguredDeviceAdapterRegistry() {
  const byBrand = new Map(
    descriptors
      .filter((descriptor) => descriptor.supportedBrand)
      .map((descriptor) => [descriptor.supportedBrand, descriptor]),
  );
  const generic = descriptors.find((descriptor) => descriptor.adapterType === 'generic');

  return {
    listAdapters() {
      return descriptors.map(present);
    },
    resolveAdapter(brand) {
      return present(byBrand.get(brand) ?? generic);
    },
  };
}
