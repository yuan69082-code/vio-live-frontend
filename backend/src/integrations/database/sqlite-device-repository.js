import { ConflictError } from '../../core/errors.js';

function isConstraintError(error) {
  return (
    (typeof error?.code === 'string'
      && error.code.startsWith('ERR_SQLITE_CONSTRAINT'))
    || (Number.isInteger(error?.errcode) && (error.errcode & 0xff) === 19)
  );
}

function mapOperationLog(row) {
  if (!row) {
    return null;
  }

  return {
    deviceOperationLogId: row.device_operation_log_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    deviceId: row.device_id,
    capability: row.capability,
    action: row.action,
    permissionDecision: row.permission_decision,
    securityDecision: row.security_decision,
    riskLevel: row.risk_level,
    preparationStatus: row.preparation_status,
    executionStatus: row.execution_status,
    resultSummary: row.result_summary,
    auditLogId: row.audit_log_id,
    eventId: row.event_id,
    requestedAt: row.requested_at,
  };
}

export function createSqliteDeviceRepository(connection) {
  const deviceSelection = `
    SELECT
      device_id,
      owner_user_id,
      device_type,
      brand,
      name,
      status,
      adapter_type,
      created_at,
      updated_at
    FROM device_registry
  `;
  const operationLogSelection = `
    SELECT
      device_operation_log_id,
      user_id,
      subject_id,
      device_id,
      capability,
      action,
      permission_decision,
      security_decision,
      risk_level,
      preparation_status,
      execution_status,
      result_summary,
      audit_log_id,
      event_id,
      requested_at
    FROM device_operation_logs
  `;
  const insertDeviceStatement = connection.prepare(`
    INSERT INTO device_registry (
      device_id,
      owner_user_id,
      device_type,
      brand,
      name,
      status,
      adapter_type,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCapabilityStatement = connection.prepare(`
    INSERT INTO device_capabilities (
      owner_user_id,
      device_id,
      capability
    ) VALUES (?, ?, ?)
  `);
  const findDeviceStatement = connection.prepare(`
    ${deviceSelection}
    WHERE owner_user_id = ? AND device_id = ?
  `);
  const listDevicesStatement = connection.prepare(`
    ${deviceSelection}
    WHERE owner_user_id = ?
    ORDER BY name, device_id
  `);
  const listCapabilitiesStatement = connection.prepare(`
    SELECT capability
    FROM device_capabilities
    WHERE owner_user_id = ? AND device_id = ?
    ORDER BY CASE capability
      WHEN 'view_status' THEN 1
      WHEN 'power' THEN 2
      WHEN 'adjust_parameter' THEN 3
      WHEN 'get_data' THEN 4
      ELSE 99
    END
  `);
  const updateStatusStatement = connection.prepare(`
    UPDATE device_registry
    SET status = ?, updated_at = ?
    WHERE owner_user_id = ? AND device_id = ?
  `);
  const insertOperationLogStatement = connection.prepare(`
    INSERT INTO device_operation_logs (
      device_operation_log_id,
      user_id,
      subject_id,
      device_id,
      capability,
      action,
      permission_decision,
      security_decision,
      risk_level,
      preparation_status,
      execution_status,
      result_summary,
      audit_log_id,
      event_id,
      requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findOperationLogStatement = connection.prepare(`
    ${operationLogSelection}
    WHERE user_id = ?
      AND subject_id = ?
      AND device_operation_log_id = ?
  `);
  const listOperationLogsStatement = connection.prepare(`
    ${operationLogSelection}
    WHERE user_id = ?
      AND subject_id = ?
      AND (? IS NULL OR device_id = ?)
      AND (? IS NULL OR capability = ?)
    ORDER BY requested_at DESC, device_operation_log_id DESC
    LIMIT ?
  `);

  function mapDevice(row) {
    if (!row) {
      return null;
    }

    return {
      deviceId: row.device_id,
      ownerUserId: row.owner_user_id,
      deviceType: row.device_type,
      brand: row.brand,
      name: row.name,
      status: row.status,
      adapterType: row.adapter_type,
      capabilities: listCapabilitiesStatement
        .all(row.owner_user_id, row.device_id)
        .map((capabilityRow) => capabilityRow.capability),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    insertDevice(device) {
      try {
        insertDeviceStatement.run(
          device.deviceId,
          device.ownerUserId,
          device.deviceType,
          device.brand,
          device.name,
          device.status,
          device.adapterType,
          device.createdAt,
          device.updatedAt,
        );
        for (const capability of device.capabilities) {
          insertCapabilityStatement.run(
            device.ownerUserId,
            device.deviceId,
            capability,
          );
        }
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Device registry entry could not be created.');
        }
        throw error;
      }

      return mapDevice(findDeviceStatement.get(device.ownerUserId, device.deviceId));
    },
    findDevice(ownerUserId, deviceId) {
      return mapDevice(findDeviceStatement.get(ownerUserId, deviceId));
    },
    listDevices(ownerUserId) {
      return listDevicesStatement.all(ownerUserId).map(mapDevice);
    },
    updateDeviceStatus(ownerUserId, deviceId, status, updatedAt) {
      const result = updateStatusStatement.run(
        status,
        updatedAt,
        ownerUserId,
        deviceId,
      );
      if (result.changes === 0) {
        return null;
      }
      return mapDevice(findDeviceStatement.get(ownerUserId, deviceId));
    },
    insertOperationLog(log) {
      try {
        insertOperationLogStatement.run(
          log.deviceOperationLogId,
          log.userId,
          log.subjectId,
          log.deviceId,
          log.capability,
          log.action,
          log.permissionDecision,
          log.securityDecision,
          log.riskLevel,
          log.preparationStatus,
          log.executionStatus,
          log.resultSummary,
          log.auditLogId,
          log.eventId,
          log.requestedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('Device operation log could not be created.');
        }
        throw error;
      }

      return mapOperationLog(findOperationLogStatement.get(
        log.userId,
        log.subjectId,
        log.deviceOperationLogId,
      ));
    },
    findOperationLog(userId, subjectId, deviceOperationLogId) {
      return mapOperationLog(findOperationLogStatement.get(
        userId,
        subjectId,
        deviceOperationLogId,
      ));
    },
    listOperationLogs({ userId, subjectId, deviceId, capability, limit }) {
      return listOperationLogsStatement
        .all(
          userId,
          subjectId,
          deviceId,
          deviceId,
          capability,
          capability,
          limit,
        )
        .map(mapOperationLog);
    },
  };
}
