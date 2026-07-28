import { ConflictError } from '../../core/errors.js';

function isConstraintError(error) {
  return (
    (typeof error?.code === 'string'
      && error.code.startsWith('ERR_SQLITE_CONSTRAINT'))
    || (Number.isInteger(error?.errcode) && (error.errcode & 0xff) === 19)
  );
}

function mapPolicy(row) {
  if (!row) {
    return null;
  }
  return {
    policyId: row.policy_id,
    userId: row.user_id,
    resourceType: row.resource_type,
    actionType: row.action_type,
    riskLevel: row.risk_level,
    rule: row.rule,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPreferences(row) {
  if (!row) {
    return null;
  }
  return {
    userId: row.user_id,
    defaultSecurityLevel: row.default_security_level,
    highRiskOperationPolicy: row.high_risk_operation_policy,
    autoConfirmationScopes: JSON.parse(row.auto_confirmation_scopes_json),
    forbiddenScopes: JSON.parse(row.forbidden_scopes_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSessionGrant(row) {
  if (!row) {
    return null;
  }
  return {
    sessionGrantId: row.session_grant_id,
    userId: row.user_id,
    subjectId: row.subject_id,
    policyId: row.policy_id,
    policyUpdatedAt: row.policy_updated_at,
    securitySessionId: row.security_session_id,
    resourceId: row.resource_id,
    actionType: row.action_type,
    riskLevel: row.risk_level,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
  };
}

export function createSqliteSecurityPolicyRepository(connection) {
  const policySelection = `
    SELECT policy_id, user_id, resource_type, action_type, risk_level,
      rule, status, created_at, updated_at
    FROM security_policies
  `;
  const insertPolicyStatement = connection.prepare(`
    INSERT INTO security_policies (
      policy_id, user_id, resource_type, action_type, risk_level,
      rule, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findPolicyStatement = connection.prepare(`
    ${policySelection}
    WHERE user_id = ? AND policy_id = ?
  `);
  const findActivePolicyStatement = connection.prepare(`
    ${policySelection}
    WHERE user_id = ? AND resource_type = ? AND action_type = ?
      AND risk_level = ? AND status = 'active'
  `);
  const listPoliciesStatement = connection.prepare(`
    ${policySelection}
    WHERE user_id = ?
    ORDER BY resource_type, action_type, risk_level, updated_at DESC, policy_id
  `);
  const updatePolicyStatement = connection.prepare(`
    UPDATE security_policies
    SET risk_level = ?, rule = ?, updated_at = ?
    WHERE user_id = ? AND policy_id = ? AND status = 'active'
  `);
  const deletePolicyStatement = connection.prepare(`
    UPDATE security_policies
    SET status = 'deleted', updated_at = ?
    WHERE user_id = ? AND policy_id = ? AND status = 'active'
  `);
  const preferencesSelection = `
    SELECT user_id, default_security_level, high_risk_operation_policy,
      auto_confirmation_scopes_json, forbidden_scopes_json,
      created_at, updated_at
    FROM user_security_preferences
  `;
  const findPreferencesStatement = connection.prepare(`
    ${preferencesSelection}
    WHERE user_id = ?
  `);
  const upsertPreferencesStatement = connection.prepare(`
    INSERT INTO user_security_preferences (
      user_id, default_security_level, high_risk_operation_policy,
      auto_confirmation_scopes_json, forbidden_scopes_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      default_security_level = excluded.default_security_level,
      high_risk_operation_policy = excluded.high_risk_operation_policy,
      auto_confirmation_scopes_json = excluded.auto_confirmation_scopes_json,
      forbidden_scopes_json = excluded.forbidden_scopes_json,
      updated_at = excluded.updated_at
  `);
  const insertSessionGrantStatement = connection.prepare(`
    INSERT INTO security_policy_session_grants (
      session_grant_id, user_id, subject_id, policy_id, policy_updated_at,
      security_session_id, resource_id, action_type, risk_level,
      granted_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findSessionGrantStatement = connection.prepare(`
    SELECT session_grant_id, user_id, subject_id, policy_id, policy_updated_at,
      security_session_id, resource_id, action_type, risk_level,
      granted_at, expires_at
    FROM security_policy_session_grants
    WHERE user_id = ? AND subject_id = ? AND policy_id = ?
      AND policy_updated_at = ? AND security_session_id = ?
      AND resource_id = ? AND action_type = ? AND risk_level = ?
      AND expires_at > ?
    ORDER BY expires_at DESC, session_grant_id DESC
    LIMIT 1
  `);

  return {
    insertPolicy(policy) {
      try {
        insertPolicyStatement.run(
          policy.policyId,
          policy.userId,
          policy.resourceType,
          policy.actionType,
          policy.riskLevel,
          policy.rule,
          policy.status,
          policy.createdAt,
          policy.updatedAt,
        );
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('An active security policy already exists for this scope.');
        }
        throw error;
      }
      return mapPolicy(findPolicyStatement.get(policy.userId, policy.policyId));
    },
    findPolicy(userId, policyId) {
      return mapPolicy(findPolicyStatement.get(userId, policyId));
    },
    findActivePolicy({ userId, resourceType, actionType, riskLevel }) {
      return mapPolicy(findActivePolicyStatement.get(
        userId,
        resourceType,
        actionType,
        riskLevel,
      ));
    },
    listPolicies(userId) {
      return listPoliciesStatement.all(userId).map(mapPolicy);
    },
    updatePolicy(userId, policyId, { riskLevel, rule, updatedAt }) {
      try {
        const result = updatePolicyStatement.run(
          riskLevel,
          rule,
          updatedAt,
          userId,
          policyId,
        );
        if (result.changes === 0) {
          return null;
        }
      } catch (error) {
        if (isConstraintError(error)) {
          throw new ConflictError('An active security policy already exists for this scope.');
        }
        throw error;
      }
      return mapPolicy(findPolicyStatement.get(userId, policyId));
    },
    softDeletePolicy(userId, policyId, updatedAt) {
      const result = deletePolicyStatement.run(updatedAt, userId, policyId);
      return result.changes === 0
        ? null
        : mapPolicy(findPolicyStatement.get(userId, policyId));
    },
    findPreferences(userId) {
      return mapPreferences(findPreferencesStatement.get(userId));
    },
    upsertPreferences(preferences) {
      upsertPreferencesStatement.run(
        preferences.userId,
        preferences.defaultSecurityLevel,
        preferences.highRiskOperationPolicy,
        JSON.stringify(preferences.autoConfirmationScopes),
        JSON.stringify(preferences.forbiddenScopes),
        preferences.createdAt,
        preferences.updatedAt,
      );
      return mapPreferences(findPreferencesStatement.get(preferences.userId));
    },
    insertSessionGrant(grant) {
      insertSessionGrantStatement.run(
        grant.sessionGrantId,
        grant.userId,
        grant.subjectId,
        grant.policyId,
        grant.policyUpdatedAt,
        grant.securitySessionId,
        grant.resourceId,
        grant.actionType,
        grant.riskLevel,
        grant.grantedAt,
        grant.expiresAt,
      );
      return grant;
    },
    findSessionGrant(scope) {
      return mapSessionGrant(findSessionGrantStatement.get(
        scope.userId,
        scope.subjectId,
        scope.policyId,
        scope.policyUpdatedAt,
        scope.securitySessionId,
        scope.resourceId,
        scope.actionType,
        scope.riskLevel,
        scope.now,
      ));
    },
  };
}
