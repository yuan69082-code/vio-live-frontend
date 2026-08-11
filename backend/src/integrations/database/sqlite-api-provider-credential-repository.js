import { ConflictError } from '../../core/errors.js';

function constraint(operation, message) {
  try { return operation(); } catch (error) {
    if (String(error?.code ?? '').startsWith('ERR_SQLITE_CONSTRAINT')) {
      throw new ConflictError(message);
    }
    throw error;
  }
}

function map(row) {
  if (!row) return null;
  return {
    credentialBindingId: row.credential_binding_id,
    ownerUserId: row.owner_user_id,
    providerId: row.provider_id,
    secretRef: row.secret_ref,
    status: row.status,
    securityAuditLogId: row.security_audit_log_id,
    createdAt: row.created_at,
    supersededAt: row.superseded_at,
  };
}

export function createSqliteApiProviderCredentialRepository(connection) {
  const findActive = connection.prepare(`
    SELECT * FROM api_provider_credential_bindings
    WHERE owner_user_id = ? AND provider_id = ? AND status = 'active'
  `);
  const findById = connection.prepare(`
    SELECT * FROM api_provider_credential_bindings
    WHERE owner_user_id = ? AND provider_id = ? AND credential_binding_id = ?
  `);
  const supersede = connection.prepare(`
    UPDATE api_provider_credential_bindings
    SET status = 'superseded', superseded_at = ?
    WHERE owner_user_id = ? AND provider_id = ? AND status = 'active'
  `);
  const insert = connection.prepare(`
    INSERT INTO api_provider_credential_bindings (
      credential_binding_id, owner_user_id, provider_id, secret_ref, status,
      security_audit_log_id, created_at, superseded_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL)
  `);
  return Object.freeze({
    findActive(ownerUserId, providerId) {
      return map(findActive.get(ownerUserId, providerId));
    },
    replaceActive(binding) {
      return constraint(() => {
        supersede.run(binding.createdAt, binding.ownerUserId, binding.providerId);
        insert.run(
          binding.credentialBindingId,
          binding.ownerUserId,
          binding.providerId,
          binding.secretRef,
          binding.securityAuditLogId,
          binding.createdAt,
        );
        return map(findById.get(
          binding.ownerUserId,
          binding.providerId,
          binding.credentialBindingId,
        ));
      }, 'API Provider credential binding conflicts with existing history.');
    },
  });
}
