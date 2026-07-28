export function createUnconfiguredApiCredentialStore() {
  return Object.freeze({
    describeApiKey() {
      return Object.freeze({
        status: 'not_configured',
        storage: 'secure_store_required',
        writeSupported: false,
      });
    },
  });
}
