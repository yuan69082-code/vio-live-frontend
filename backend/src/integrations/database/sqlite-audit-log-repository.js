function mapAuditLog(row) {
  if (!row) {
    return null;
  }

  return {
    auditLogId: row.audit_log_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    operationType: row.operation_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    riskLevel: row.risk_level,
    permissionDecision: row.permission_decision,
    confirmationMode: row.confirmation_mode,
    result: row.result,
    reasonCode: row.reason_code,
    confirmationId: row.confirmation_id,
    occurredAt: row.occurred_at,
  };
}

export function createSqliteAuditLogRepository(connection) {
  const selection = `
    SELECT
      audit_log_id,
      user_id,
      subject_id,
      operation_type,
      resource_type,
      resource_id,
      action,
      risk_level,
      permission_decision,
      confirmation_mode,
      result,
      reason_code,
      confirmation_id,
      occurred_at
    FROM audit_logs
  `;
  const insertStatement = connection.prepare(`
    INSERT INTO audit_logs (
      audit_log_id,
      user_id,
      subject_id,
      operation_type,
      resource_type,
      resource_id,
      action,
      risk_level,
      permission_decision,
      confirmation_mode,
      result,
      reason_code,
      confirmation_id,
      occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStatement = connection.prepare(`
    ${selection}
    WHERE user_id = ? AND audit_log_id = ?
  `);

  return {
    insert(auditLog) {
      insertStatement.run(
        auditLog.auditLogId,
        auditLog.userId,
        auditLog.subjectId,
        auditLog.operationType,
        auditLog.resourceType,
        auditLog.resourceId,
        auditLog.action,
        auditLog.riskLevel,
        auditLog.permissionDecision,
        auditLog.confirmationMode,
        auditLog.result,
        auditLog.reasonCode,
        auditLog.confirmationId,
        auditLog.occurredAt,
      );

      return auditLog;
    },
    findById(userId, auditLogId) {
      return mapAuditLog(findByIdStatement.get(userId, auditLogId));
    },
    findMany({
      userId,
      subjectId,
      operationType,
      resourceType,
      result,
      riskLevel,
      limit,
    }) {
      const conditions = ['user_id = ?'];
      const parameters = [userId];

      if (subjectId) {
        conditions.push('subject_id = ?');
        parameters.push(subjectId);
      }

      if (operationType) {
        conditions.push('operation_type = ?');
        parameters.push(operationType);
      }

      if (resourceType) {
        conditions.push('resource_type = ?');
        parameters.push(resourceType);
      }

      if (result) {
        conditions.push('result = ?');
        parameters.push(result);
      }

      if (riskLevel) {
        conditions.push('risk_level = ?');
        parameters.push(riskLevel);
      }

      parameters.push(limit);
      const statement = connection.prepare(`
        ${selection}
        WHERE ${conditions.join(' AND ')}
        ORDER BY occurred_at DESC, audit_log_id DESC
        LIMIT ?
      `);

      return statement.all(...parameters).map(mapAuditLog);
    },
  };
}
