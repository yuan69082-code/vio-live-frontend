import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  requireOpaqueResourceId,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import {
  CURRENT_EXPORT_SCHEMA_VERSION,
  EXPORT_SCOPE_TYPES,
  EXPORT_TYPES,
  MIGRATION_TARGET_TYPES,
  requireDataExportValue,
} from './data-export-types.js';
import { requireMigrationTargetRegistry } from './migration-target-port.js';

function requireOnlyFields(value, allowedFields, field = 'body') {
  const input = requirePlainObject(value, field);
  const unexpectedFields = Object.keys(input).filter((name) => !allowedFields.includes(name));
  if (unexpectedFields.length > 0) {
    throw new ValidationError(`${field} contains unsupported fields.`, {
      field,
      unexpectedFields,
    });
  }
  return input;
}

function normalizeRequestedScopes(exportType, value) {
  if (exportType === 'full') {
    if (value !== undefined) {
      throw new ValidationError('scopes must be omitted when exportType is full.', {
        field: 'scopes',
      });
    }
    return [...EXPORT_SCOPE_TYPES];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('scopes must be a non-empty array for this export type.', {
      field: 'scopes',
    });
  }
  const normalized = value.map((scopeType, index) => requireDataExportValue(
    scopeType,
    `scopes[${index}]`,
    EXPORT_SCOPE_TYPES,
  ));
  return EXPORT_SCOPE_TYPES.filter((scopeType) => normalized.includes(scopeType));
}

function securityResultStatus(decision) {
  return {
    allow: 'ready',
    confirm: 'confirmation_required',
    deny: 'denied',
  }[decision];
}

function executionBoundary() {
  return {
    payload: 'not_generated',
    file: 'not_created',
    externalStorage: 'not_connected',
    externalTransfer: 'not_performed',
    migration: 'not_executed',
    robotConnection: 'not_connected',
  };
}

export function createDataExportService({
  dataExportRepository,
  userRepository,
  subjectRepository,
  securityService,
  migrationTargetRegistry,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
}) {
  const targets = requireMigrationTargetRegistry(migrationTargetRegistry);

  function requireScope(userId, subjectId) {
    const normalizedUserId = requireString(userId, 'userId', { maxLength: 128 });
    const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });
    if (!userRepository.findById(normalizedUserId)) {
      throw new NotFoundError('User was not found.');
    }
    if (!subjectRepository.findById(normalizedUserId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }
    return { userId: normalizedUserId, subjectId: normalizedSubjectId };
  }

  function requireExportRecord(scope, exportId) {
    const normalizedExportId = requireOpaqueResourceId(exportId, 'exportId');
    const record = dataExportRepository.findExportRecord(
      scope.userId,
      scope.subjectId,
      normalizedExportId,
    );
    if (!record) throw new NotFoundError('Data export record was not found in this scope.');
    return record;
  }

  return {
    listSchemas() {
      return dataExportRepository.listSchemas();
    },
    listMigrationTargetContracts() {
      return targets.listContracts();
    },
    createExportRecord(userId, subjectId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, ['exportType', 'scopes']);
      const exportType = requireDataExportValue(
        input.exportType,
        'exportType',
        EXPORT_TYPES,
      );
      const requestedScopes = normalizeRequestedScopes(exportType, input.scopes);
      const schema = dataExportRepository.findSchema(
        CURRENT_EXPORT_SCHEMA_VERSION,
        exportType,
      );
      if (!schema) throw new ConflictError('No active export schema supports this export type.');
      const schemaScopes = new Map(schema.scopes.map((item) => [item.scopeType, item]));
      if (requestedScopes.some((scopeType) => !schemaScopes.has(scopeType))) {
        throw new ConflictError('The active export schema does not cover every requested scope.');
      }

      return runInTransaction(() => {
        const inspected = dataExportRepository.inspectScopes(
          scope.userId,
          scope.subjectId,
          requestedScopes,
        );
        const missingRequiredFieldCount = inspected.scopes.reduce(
          (total, item) => total + item.missingRequiredFieldCount,
          0,
        );
        const ownershipStatus = inspected.foreignKeyViolationCount === 0
          ? 'passed'
          : 'failed';
        const fieldStatus = missingRequiredFieldCount === 0 ? 'passed' : 'failed';
        const integrityStatus = ownershipStatus === 'passed' && fieldStatus === 'passed'
          ? 'passed'
          : 'failed';
        const sensitiveCategories = [...new Set(requestedScopes
          .map((scopeType) => schemaScopes.get(scopeType).sensitiveCategory)
          .filter(Boolean))];
        const now = clock().toISOString();
        const report = {
          checkedAt: now,
          scope: { ...scope },
          ownership: {
            status: ownershipStatus,
            queryBoundary: ['user_id', 'subject_id'],
            foreignKeyViolationCount: inspected.foreignKeyViolationCount,
          },
          fields: {
            status: fieldStatus,
            missingRequiredFieldCount,
          },
          scopes: inspected.scopes.map((item) => ({
            ...item,
            requiredFields: schemaScopes.get(item.scopeType).requiredFields,
            relationFields: schemaScopes.get(item.scopeType).relationFields,
          })),
        };
        const record = dataExportRepository.insertExportRecord({
          exportId: idFactory(),
          ...scope,
          schemaVersion: schema.schemaVersion,
          exportType,
          requestedScopes,
          sensitiveCategories,
          integrity: {
            status: integrityStatus,
            ownershipStatus,
            permissionStatus: 'not_checked',
            fieldStatus,
            report,
          },
          result: integrityStatus === 'passed' ? 'preflight_passed' : 'preflight_failed',
          securityAuditLogId: null,
          createdTime: now,
          updatedTime: now,
        });
        return {
          record,
          schema,
          dataIncluded: false,
          execution: executionBoundary(),
        };
      });
    },
    getExportRecord(userId, subjectId, exportId) {
      const scope = requireScope(userId, subjectId);
      return requireExportRecord(scope, exportId);
    },
    listExportRecords(userId, subjectId) {
      const scope = requireScope(userId, subjectId);
      return dataExportRepository.listExportRecords(scope.userId, scope.subjectId);
    },
    prepareExport(userId, subjectId, exportId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, ['confirmationId', 'securitySessionId']);
      const existing = requireExportRecord(scope, exportId);
      if (existing.integrity.status !== 'passed') {
        throw new ConflictError('Data export integrity preflight did not pass.');
      }
      return runInTransaction(() => {
        const security = securityService.checkSecurity(scope.userId, {
          subjectId: scope.subjectId,
          resourceType: 'data_export',
          resourceId: existing.exportId,
          action: 'export',
          operationType: 'privacy_access_request',
          sensitiveDataCategories: existing.sensitiveCategories,
          ...(input.confirmationId ? {
            confirmationId: requireOpaqueResourceId(
              input.confirmationId,
              'confirmationId',
            ),
          } : {}),
          ...(input.securitySessionId ? {
            securitySessionId: requireOpaqueResourceId(
              input.securitySessionId,
              'securitySessionId',
            ),
          } : {}),
        }, { minimumRiskLevel: 'high' });
        const saved = dataExportRepository.updateExportSecurity({
          ...existing,
          integrity: {
            ...existing.integrity,
            permissionStatus: security.permission.decision,
          },
          result: securityResultStatus(security.decision),
          securityAuditLogId: security.auditLogId,
          updatedTime: clock().toISOString(),
        });
        return {
          operationStatus: saved.result,
          record: saved,
          security,
          dataIncluded: false,
          execution: executionBoundary(),
        };
      });
    },
    prepareMigration(userId, subjectId, exportId, value) {
      const scope = requireScope(userId, subjectId);
      const input = requireOnlyFields(value, ['targetType']);
      const record = requireExportRecord(scope, exportId);
      if (record.exportType !== 'migration') {
        throw new ConflictError('Only migration export records can prepare a carrier contract.');
      }
      if (record.result !== 'ready') {
        throw new ConflictError('Data export must be ready before migration can be prepared.');
      }
      const targetType = requireDataExportValue(
        input.targetType,
        'targetType',
        MIGRATION_TARGET_TYPES,
      );
      const contract = targets.prepareContract(targetType, record.schemaVersion);
      if (!contract) throw new ConflictError('Migration target does not accept this schema.');
      return {
        migrationPreparationId: idFactory(),
        exportId: record.exportId,
        userId: record.userId,
        subjectId: record.subjectId,
        schemaVersion: record.schemaVersion,
        target: contract,
        preparedAt: clock().toISOString(),
        dataIncluded: false,
        execution: executionBoundary(),
      };
    },
  };
}
