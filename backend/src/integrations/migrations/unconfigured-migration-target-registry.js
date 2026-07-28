import { MIGRATION_TARGET_TYPES } from '../../modules/data-exports/data-export-types.js';

const contracts = Object.freeze(MIGRATION_TARGET_TYPES.map((targetType) => Object.freeze({
  targetType,
  adapterStatus: 'not_implemented',
  connectionStatus: 'not_connected',
  transferSupported: false,
  restoreSupported: false,
  acceptedSchemaVersions: Object.freeze(['vio-live-export-v1']),
})));

export function createUnconfiguredMigrationTargetRegistry() {
  return {
    listContracts() {
      return contracts.map((contract) => ({
        ...contract,
        acceptedSchemaVersions: [...contract.acceptedSchemaVersions],
      }));
    },
    prepareContract(targetType, schemaVersion) {
      const contract = contracts.find((item) => item.targetType === targetType);
      if (!contract || !contract.acceptedSchemaVersions.includes(schemaVersion)) return null;
      return {
        ...contract,
        acceptedSchemaVersions: [...contract.acceptedSchemaVersions],
        preparationStatus: 'reserved_only',
        migrationStatus: 'not_executed',
        externalTransfer: 'not_performed',
        futureExecutionRequiresNewSecurityCheck: true,
      };
    },
  };
}
