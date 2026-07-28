export const MIGRATION_TARGET_CONTRACT_METHODS = Object.freeze([
  'listContracts',
  'prepareContract',
]);

export function requireMigrationTargetRegistry(registry) {
  for (const method of MIGRATION_TARGET_CONTRACT_METHODS) {
    if (typeof registry?.[method] !== 'function') {
      throw new TypeError(`Migration target registry must implement ${method}().`);
    }
  }
  return registry;
}
