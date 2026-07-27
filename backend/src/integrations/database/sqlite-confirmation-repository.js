function mapConfirmation(row) {
  if (!row) {
    return null;
  }

  return {
    confirmationId: row.confirmation_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    operationType: row.operation_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    permissionId: row.permission_id,
    permissionLevel: row.permission_level,
    permissionUpdatedAt: row.permission_updated_at,
    policyFingerprint: row.policy_fingerprint,
    confirmationMode: row.confirmation_mode,
    riskLevel: row.risk_level,
    status: row.status,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    consumedAt: row.consumed_at,
  };
}

export function createSqliteConfirmationRepository(connection) {
  const selection = `
    SELECT
      confirmation_id,
      user_id,
      subject_id,
      operation_type,
      resource_type,
      resource_id,
      action,
      permission_id,
      permission_level,
      permission_updated_at,
      policy_fingerprint,
      confirmation_mode,
      risk_level,
      status,
      requested_at,
      expires_at,
      decided_at,
      consumed_at
    FROM security_confirmations
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO security_confirmations (
      confirmation_id,
      user_id,
      subject_id,
      operation_type,
      resource_type,
      resource_id,
      action,
      permission_id,
      permission_level,
      permission_updated_at,
      policy_fingerprint,
      confirmation_mode,
      risk_level,
      status,
      requested_at,
      expires_at,
      decided_at,
      consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ? AND confirmation_id = ?
  `);
  const decideStatement = connection.prepare(`
    UPDATE security_confirmations
    SET status = ?, decided_at = ?
    WHERE user_id = ? AND confirmation_id = ? AND status = 'pending'
  `);
  const consumeStatement = connection.prepare(`
    UPDATE security_confirmations
    SET status = 'consumed', consumed_at = ?
    WHERE user_id = ? AND confirmation_id = ? AND status = 'approved'
  `);
  const expireStatement = connection.prepare(`
    UPDATE security_confirmations
    SET status = 'expired'
    WHERE user_id = ?
      AND confirmation_id = ?
      AND status IN ('pending', 'approved')
  `);

  return {
    insert(confirmation) {
      insertStatement.run(
        confirmation.confirmationId,
        confirmation.userId,
        confirmation.subjectId,
        confirmation.operationType,
        confirmation.resourceType,
        confirmation.resourceId,
        confirmation.action,
        confirmation.permissionId,
        confirmation.permissionLevel,
        confirmation.permissionUpdatedAt,
        confirmation.policyFingerprint,
        confirmation.confirmationMode,
        confirmation.riskLevel,
        confirmation.status,
        confirmation.requestedAt,
        confirmation.expiresAt,
        confirmation.decidedAt,
        confirmation.consumedAt,
      );

      return confirmation;
    },
    findById(userId, confirmationId) {
      return mapConfirmation(findByIdStatement.get(userId, confirmationId));
    },
    decide(userId, confirmationId, status, decidedAt) {
      const result = decideStatement.run(status, decidedAt, userId, confirmationId);

      if (result.changes === 0) {
        return null;
      }

      return mapConfirmation(findByIdStatement.get(userId, confirmationId));
    },
    consume(userId, confirmationId, consumedAt) {
      const result = consumeStatement.run(consumedAt, userId, confirmationId);

      if (result.changes === 0) {
        return null;
      }

      return mapConfirmation(findByIdStatement.get(userId, confirmationId));
    },
    expire(userId, confirmationId) {
      const result = expireStatement.run(userId, confirmationId);

      if (result.changes === 0) {
        return null;
      }

      return mapConfirmation(findByIdStatement.get(userId, confirmationId));
    },
  };
}
