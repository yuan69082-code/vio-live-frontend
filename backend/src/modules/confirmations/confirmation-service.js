import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import {
  optionalString,
  requireOpaqueResourceId,
  requirePlainObject,
  requireString,
} from '../../core/validation.js';
import { PERMISSION_LEVELS } from '../permissions/permission-types.js';
import {
  SECURITY_OPERATION_TYPES,
  SECURITY_RISK_LEVELS,
  STORED_CONFIRMATION_MODES,
  requireSecurityValue,
} from '../security/security-types.js';

function requireOnlyFields(value, allowedFields) {
  const input = requirePlainObject(value, 'body');
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.includes(field));

  if (unexpectedFields.length > 0) {
    throw new ValidationError('Request body contains unsupported fields.', {
      unexpectedFields,
    });
  }

  return input;
}

function sameScope(confirmation, expected) {
  return confirmation.subjectId === expected.subjectId
    && confirmation.operationType === expected.operationType
    && confirmation.resourceType === expected.resourceType
    && confirmation.resourceId === expected.resourceId
    && confirmation.action === expected.action
    && confirmation.permissionId === expected.permissionId
    && confirmation.permissionLevel === expected.permissionLevel
    && confirmation.permissionUpdatedAt === expected.permissionUpdatedAt
    && confirmation.policyFingerprint === expected.policyFingerprint
    && confirmation.securityPolicyId === (expected.securityPolicyId ?? null)
    && confirmation.securityPolicyUpdatedAt === (expected.securityPolicyUpdatedAt ?? null)
    && confirmation.securitySessionId === (expected.securitySessionId ?? null)
    && confirmation.confirmationMode === expected.confirmationMode
    && confirmation.riskLevel === expected.riskLevel;
}

const CONFIRMATION_TTL_MS = 5 * 60 * 1_000;

export function createConfirmationService({
  confirmationRepository,
  auditLogService,
  userRepository,
  subjectRepository,
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

  function requireSubject(userId, subjectId) {
    const normalizedSubjectId = requireString(subjectId, 'subjectId', { maxLength: 128 });

    if (!subjectRepository.findById(userId, normalizedSubjectId)) {
      throw new NotFoundError('Subject was not found for this user.');
    }

    return normalizedSubjectId;
  }

  function requireConfirmation(userId, confirmationId) {
    const normalizedConfirmationId = requireString(
      confirmationId,
      'confirmationId',
      { maxLength: 128 },
    );
    const confirmation = confirmationRepository.findById(userId, normalizedConfirmationId);

    if (!confirmation) {
      throw new NotFoundError('Confirmation was not found for this user.');
    }

    return confirmation;
  }

  return {
    createForSecurityCheck(value) {
      const userId = requireUser(value.userId);
      const currentTime = clock();
      const now = currentTime.toISOString();
      const confirmation = {
        confirmationId: idFactory(),
        userId,
        subjectId: requireSubject(userId, value.subjectId),
        operationType: requireSecurityValue(
          value.operationType,
          'operationType',
          SECURITY_OPERATION_TYPES,
        ),
        resourceType: requireString(value.resourceType, 'resourceType', { maxLength: 80 }),
        resourceId: requireOpaqueResourceId(value.resourceId),
        action: requireString(value.action, 'action', { maxLength: 80 }),
        permissionId: requireString(value.permissionId, 'permissionId', { maxLength: 128 }),
        permissionLevel: requireSecurityValue(
          value.permissionLevel,
          'permissionLevel',
          PERMISSION_LEVELS,
        ),
        permissionUpdatedAt: requireString(
          value.permissionUpdatedAt,
          'permissionUpdatedAt',
          { maxLength: 40 },
        ),
        policyFingerprint: requireString(
          value.policyFingerprint,
          'policyFingerprint',
          { minLength: 64, maxLength: 64 },
        ),
        securityPolicyId: optionalString(
          value.securityPolicyId,
          'securityPolicyId',
          { maxLength: 128 },
        ),
        securityPolicyUpdatedAt: optionalString(
          value.securityPolicyUpdatedAt,
          'securityPolicyUpdatedAt',
          { maxLength: 40 },
        ),
        securitySessionId: optionalString(
          value.securitySessionId,
          'securitySessionId',
          { maxLength: 128 },
        ),
        confirmationMode: requireSecurityValue(
          value.confirmationMode,
          'confirmationMode',
          STORED_CONFIRMATION_MODES,
        ),
        riskLevel: requireSecurityValue(
          value.riskLevel,
          'riskLevel',
          SECURITY_RISK_LEVELS,
        ),
        confirmationReason: requireString(
          value.confirmationReason,
          'confirmationReason',
          { maxLength: 500 },
        ),
        riskDescription: requireString(
          value.riskDescription,
          'riskDescription',
          { maxLength: 1000 },
        ),
        userChoice: null,
        status: 'pending',
        requestedAt: now,
        expiresAt: new Date(currentTime.getTime() + CONFIRMATION_TTL_MS).toISOString(),
        decidedAt: null,
        consumedAt: null,
      };

      return confirmationRepository.insert(confirmation);
    },
    getConfirmation(userId, confirmationId) {
      const confirmation = requireConfirmation(requireUser(userId), confirmationId);

      if (
        ['pending', 'approved'].includes(confirmation.status)
        && confirmation.expiresAt <= clock().toISOString()
      ) {
        return {
          ...confirmation,
          status: 'expired',
        };
      }

      return confirmation;
    },
    decideConfirmation(userId, confirmationId, value) {
      const normalizedUserId = requireUser(userId);
      const input = requireOnlyFields(value, ['decision']);
      const decision = requireSecurityValue(
        input.decision,
        'decision',
        ['approve', 'reject'],
      );

      return runInTransaction(() => {
        const current = requireConfirmation(normalizedUserId, confirmationId);

        if (
          ['pending', 'approved'].includes(current.status)
          && current.expiresAt <= clock().toISOString()
        ) {
          const expired = confirmationRepository.expire(
            normalizedUserId,
            current.confirmationId,
          ) ?? current;
          auditLogService.recordAuditLog({
            userId: expired.userId,
            subjectId: expired.subjectId,
            operationType: expired.operationType,
            resourceType: expired.resourceType,
            resourceId: expired.resourceId,
            action: decision,
            riskLevel: expired.riskLevel,
            confirmationMode: expired.confirmationMode,
            result: 'failed',
            reasonCode: 'confirmation_expired',
            confirmationId: expired.confirmationId,
          });

          return expired;
        }

        if (current.status !== 'pending') {
          throw new ConflictError('Confirmation has already been decided.');
        }

        const status = decision === 'approve' ? 'approved' : 'rejected';
        const updated = confirmationRepository.decide(
          normalizedUserId,
          current.confirmationId,
          status,
          clock().toISOString(),
          decision,
        );
        auditLogService.recordAuditLog({
          userId: updated.userId,
          subjectId: updated.subjectId,
          operationType: updated.operationType,
          resourceType: updated.resourceType,
          resourceId: updated.resourceId,
          action: decision,
          riskLevel: updated.riskLevel,
          confirmationMode: updated.confirmationMode,
          result: decision === 'approve' ? 'confirmed' : 'rejected',
          reasonCode: decision === 'approve'
            ? 'confirmation_approved'
            : 'confirmation_rejected',
          confirmationId: updated.confirmationId,
        });

        return updated;
      });
    },
    useForSecurityCheck(userId, confirmationId, expected) {
      const normalizedUserId = requireUser(userId);
      const confirmation = requireConfirmation(normalizedUserId, confirmationId);

      if (!sameScope(confirmation, expected)) {
        return {
          outcome: 'scope_mismatch',
          confirmation,
        };
      }

      if (confirmation.status === 'consumed') {
        return {
          outcome: 'already_consumed',
          confirmation,
        };
      }

      if (
        ['pending', 'approved'].includes(confirmation.status)
        && confirmation.expiresAt <= clock().toISOString()
      ) {
        return {
          outcome: 'expired',
          confirmation: confirmationRepository.expire(
            normalizedUserId,
            confirmation.confirmationId,
          ) ?? confirmation,
        };
      }

      if (confirmation.status !== 'approved') {
        return {
          outcome: confirmation.status,
          confirmation,
        };
      }

      const consumed = confirmationRepository.consume(
        normalizedUserId,
        confirmation.confirmationId,
        clock().toISOString(),
      );

      if (!consumed) {
        throw new ConflictError('Confirmation is no longer available.');
      }

      return {
        outcome: 'accepted',
        confirmation: consumed,
      };
    },
  };
}
