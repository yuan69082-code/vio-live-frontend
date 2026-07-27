import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTestDatabasePath,
  getJson,
  patchJson,
  postJson,
  startTestApplication,
} from '../test-support/test-application.js';

async function createUserAndSubject(baseUrl, email) {
  const userResult = await postJson(baseUrl, '/api/v1/users', { email });
  assert.equal(userResult.response.status, 201);
  const userId = userResult.body.data.userId;
  const subjectResult = await postJson(baseUrl, `/api/v1/users/${userId}/subjects`, {
    name: 'Security Subject',
    basicSettings: {},
  });
  assert.equal(subjectResult.response.status, 201);

  return {
    userId,
    subjectId: subjectResult.body.data.subjectId,
  };
}

async function createPermission(baseUrl, userId, input) {
  const result = await postJson(baseUrl, `/api/v1/users/${userId}/permissions`, input);
  assert.equal(result.response.status, 201);
  return result.body.data;
}

async function checkSecurity(baseUrl, userId, input) {
  return postJson(baseUrl, `/api/v1/users/${userId}/security-checks`, input);
}

function securityInput(subjectId, overrides = {}) {
  return {
    subjectId,
    resourceType: 'memory',
    resourceId: 'memory-security',
    action: 'read',
    operationType: 'general_access',
    ...overrides,
  };
}

test('security checks classify risk, support no-confirm and user-defined flows, and write audit logs', async () => {
  const testDatabase = createTestDatabasePath();
  let context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'security-risk@example.com',
    );
    await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'tool',
      resourceId: 'memory-security',
      action: 'read',
      permissionLevel: 'always_allow',
    });

    const lowRisk = await checkSecurity(
      context.baseUrl,
      userId,
      securityInput(subjectId, { resourceType: 'tool' }),
    );
    assert.equal(lowRisk.response.status, 200);
    assert.equal(lowRisk.body.data.decision, 'allow');
    assert.equal(lowRisk.body.data.preflightPassed, true);
    assert.equal(lowRisk.body.data.executionAllowed, false);
    assert.equal(lowRisk.body.data.executionStatus, 'not_executed');
    assert.equal(lowRisk.body.data.risk.level, 'low');
    assert.equal(lowRisk.body.data.risk.sensitiveOperation, false);
    assert.deepEqual(lowRisk.body.data.confirmation, {
      mode: 'not_required',
      required: false,
      status: 'not_required',
      confirmationId: null,
    });

    const auditRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/audit-logs/${lowRisk.body.data.auditLogId}`,
    );
    assert.equal(auditRead.response.status, 200);
    assert.equal(auditRead.body.data.operationType, 'general_access');
    assert.equal(auditRead.body.data.result, 'allowed');
    assert.equal(auditRead.body.data.permissionDecision, 'allow');
    assert.equal(auditRead.body.data.confirmationMode, 'not_required');
    assert.equal(auditRead.body.data.reasonCode, 'security_preflight_allowed');
    assert.equal(auditRead.body.data.subjectId, subjectId);
    assert.equal('details' in auditRead.body.data, false);

    await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'memory',
      resourceId: 'memory-write',
      action: 'write',
      permissionLevel: 'always_allow',
    });
    const mediumScope = securityInput(subjectId, {
      resourceId: 'memory-write',
      action: 'write',
    });
    const defaultUserDefined = await checkSecurity(context.baseUrl, userId, mediumScope);
    assert.equal(defaultUserDefined.response.status, 200);
    assert.equal(defaultUserDefined.body.data.decision, 'confirm');
    assert.equal(defaultUserDefined.body.data.risk.level, 'medium');
    assert.equal(defaultUserDefined.body.data.confirmation.mode, 'user_defined');
    assert.equal(defaultUserDefined.body.data.confirmation.status, 'pending');

    const userDefinedConfirmationId = defaultUserDefined.body.data.confirmation.confirmationId;
    const approvedUserDefined = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${userDefinedConfirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(approvedUserDefined.response.status, 200);
    const confirmedUserDefined = await checkSecurity(context.baseUrl, userId, {
      ...mediumScope,
      confirmationId: userDefinedConfirmationId,
    });
    assert.equal(confirmedUserDefined.response.status, 200);
    assert.equal(confirmedUserDefined.body.data.decision, 'allow');
    assert.equal(confirmedUserDefined.body.data.executionAllowed, false);
    assert.equal(confirmedUserDefined.body.data.confirmation.mode, 'user_defined');
    assert.equal(confirmedUserDefined.body.data.confirmation.status, 'consumed');

    const classifications = await getJson(
      context.baseUrl,
      '/api/v1/security/sensitive-data-categories',
    );
    assert.equal(classifications.response.status, 200);
    assert.deepEqual(
      new Set(classifications.body.data.map((item) => item.category)),
      new Set([
        'api_key',
        'identity_information',
        'payment_information',
        'private_record',
        'ai_private_domain',
      ]),
    );
    assert.ok(classifications.body.data.every((item) => item.contentAccepted === false));

    const secretInput = await checkSecurity(context.baseUrl, userId, {
      ...securityInput(subjectId),
      apiKey: 'not-a-real-key',
    });
    assert.equal(secretInput.response.status, 400);

    const confirmationBypass = await checkSecurity(context.baseUrl, userId, {
      ...mediumScope,
      userConfirmationRequired: false,
    });
    assert.equal(confirmationBypass.response.status, 400);

    const auditList = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/audit-logs?operationType=general_access&limit=20`,
    );
    assert.equal(auditList.response.status, 200);
    assert.equal(auditList.body.meta.count, 4);

    await context.application.stop();
    context = await startTestApplication(testDatabase.databasePath);
    const persistedAudit = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/audit-logs/${lowRisk.body.data.auditLogId}`,
    );
    assert.equal(persistedAudit.response.status, 200);
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('high-risk and permission-request confirmations are scoped, auditable and single-use', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const first = await createUserAndSubject(context.baseUrl, 'security-confirm@example.com');
    const second = await createUserAndSubject(context.baseUrl, 'security-other@example.com');
    await createPermission(context.baseUrl, first.userId, {
      subjectId: first.subjectId,
      resourceType: 'private_domain',
      resourceId: 'private-alpha',
      action: 'read',
      permissionLevel: 'always_allow',
    });
    const privateScope = securityInput(first.subjectId, {
      resourceType: 'private_domain',
      resourceId: 'private-alpha',
      operationType: 'privacy_access_request',
      sensitiveDataCategories: ['ai_private_domain'],
    });

    const firstCheck = await checkSecurity(context.baseUrl, first.userId, privateScope);
    assert.equal(firstCheck.response.status, 200);
    assert.equal(firstCheck.body.data.decision, 'confirm');
    assert.equal(firstCheck.body.data.executionAllowed, false);
    assert.equal(firstCheck.body.data.risk.level, 'high');
    assert.equal(firstCheck.body.data.risk.sensitiveOperation, true);
    assert.equal(firstCheck.body.data.confirmation.mode, 'every_time');
    const confirmationId = firstCheck.body.data.confirmation.confirmationId;

    const confirmationRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/confirmations/${confirmationId}`,
    );
    assert.equal(confirmationRead.response.status, 200);
    assert.match(confirmationRead.body.data.policyFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(confirmationRead.body.data.expiresAt > confirmationRead.body.data.requestedAt);

    const crossUserRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/confirmations/${confirmationId}`,
    );
    assert.equal(crossUserRead.response.status, 404);
    const crossUserAuditRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${second.userId}/audit-logs/${firstCheck.body.data.auditLogId}`,
    );
    assert.equal(crossUserAuditRead.response.status, 404);

    const approved = await patchJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.data.status, 'approved');

    const confirmedCheck = await checkSecurity(context.baseUrl, first.userId, {
      ...privateScope,
      confirmationId,
    });
    assert.equal(confirmedCheck.response.status, 200);
    assert.equal(confirmedCheck.body.data.decision, 'allow');
    assert.equal(confirmedCheck.body.data.executionStatus, 'not_executed');
    assert.equal(confirmedCheck.body.data.confirmation.status, 'consumed');

    const replay = await checkSecurity(context.baseUrl, first.userId, {
      ...privateScope,
      confirmationId,
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.data.decision, 'deny');
    assert.equal(replay.body.data.confirmation.status, 'already_consumed');

    const everyTimeAgain = await checkSecurity(context.baseUrl, first.userId, privateScope);
    assert.equal(everyTimeAgain.response.status, 200);
    assert.equal(everyTimeAgain.body.data.decision, 'confirm');
    assert.notEqual(everyTimeAgain.body.data.confirmation.confirmationId, confirmationId);
    const secondConfirmationId = everyTimeAgain.body.data.confirmation.confirmationId;
    const secondApproval = await patchJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/confirmations/${secondConfirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(secondApproval.response.status, 200);

    const changedClassification = await checkSecurity(context.baseUrl, first.userId, {
      ...privateScope,
      sensitiveDataCategories: ['private_record'],
      confirmationId: secondConfirmationId,
    });
    assert.equal(changedClassification.response.status, 200);
    assert.equal(changedClassification.body.data.decision, 'deny');
    assert.equal(changedClassification.body.data.confirmation.status, 'scope_mismatch');

    const correctlyScoped = await checkSecurity(context.baseUrl, first.userId, {
      ...privateScope,
      confirmationId: secondConfirmationId,
    });
    assert.equal(correctlyScoped.response.status, 200);
    assert.equal(correctlyScoped.body.data.decision, 'allow');

    const expiringCheck = await checkSecurity(context.baseUrl, first.userId, privateScope);
    const expiringConfirmationId = expiringCheck.body.data.confirmation.confirmationId;
    context.application.database.connection
      .prepare('UPDATE security_confirmations SET expires_at = ? WHERE confirmation_id = ?')
      .run('2000-01-01T00:00:00.000Z', expiringConfirmationId);
    const expiredRead = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/confirmations/${expiringConfirmationId}`,
    );
    assert.equal(expiredRead.response.status, 200);
    assert.equal(expiredRead.body.data.status, 'expired');
    const storedBeforeDecision = context.application.database.connection
      .prepare('SELECT status FROM security_confirmations WHERE confirmation_id = ?')
      .get(expiringConfirmationId);
    assert.equal(storedBeforeDecision.status, 'pending');
    const expiredDecision = await patchJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/confirmations/${expiringConfirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(expiredDecision.response.status, 200);
    assert.equal(expiredDecision.body.data.status, 'expired');
    const expiredUse = await checkSecurity(context.baseUrl, first.userId, {
      ...privateScope,
      confirmationId: expiringConfirmationId,
    });
    assert.equal(expiredUse.response.status, 200);
    assert.equal(expiredUse.body.data.decision, 'deny');
    assert.equal(expiredUse.body.data.confirmation.status, 'expired');

    await createPermission(context.baseUrl, first.userId, {
      subjectId: first.subjectId,
      resourceType: 'memory',
      resourceId: 'memory-ask',
      action: 'read',
      permissionLevel: 'ask_every_time',
    });
    const askScope = securityInput(first.subjectId, { resourceId: 'memory-ask' });
    const permissionAsk = await checkSecurity(context.baseUrl, first.userId, askScope);
    assert.equal(permissionAsk.response.status, 200);
    assert.equal(permissionAsk.body.data.permission.decision, 'ask');
    assert.equal(permissionAsk.body.data.decision, 'confirm');
    assert.equal(permissionAsk.body.data.confirmation.mode, 'every_time');

    const askConfirmationId = permissionAsk.body.data.confirmation.confirmationId;
    await patchJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/confirmations/${askConfirmationId}`,
      { decision: 'approve' },
    );
    const askConfirmed = await checkSecurity(context.baseUrl, first.userId, {
      ...askScope,
      confirmationId: askConfirmationId,
    });
    assert.equal(askConfirmed.response.status, 200);
    assert.equal(askConfirmed.body.data.decision, 'allow');

    await createPermission(context.baseUrl, first.userId, {
      subjectId: first.subjectId,
      resourceType: 'memory',
      resourceId: 'memory-denied',
      action: 'read',
      permissionLevel: 'forbidden_ask',
    });
    const denied = await checkSecurity(context.baseUrl, first.userId, securityInput(
      first.subjectId,
      { resourceId: 'memory-denied' },
    ));
    assert.equal(denied.response.status, 200);
    assert.equal(denied.body.data.decision, 'deny');
    assert.equal(denied.body.data.confirmation.status, 'blocked_by_permission');

    const privacyAudit = await getJson(
      context.baseUrl,
      `/api/v1/users/${first.userId}/audit-logs?operationType=privacy_access_request&limit=20`,
    );
    assert.equal(privacyAudit.response.status, 200);
    assert.ok(privacyAudit.body.data.some((item) => item.result === 'confirmation_required'));
    assert.ok(privacyAudit.body.data.some((item) => item.result === 'confirmed'));
    assert.ok(privacyAudit.body.data.some((item) => item.result === 'allowed'));
    assert.ok(privacyAudit.body.data.some((item) => (
      item.reasonCode === 'confirmation_scope_mismatch'
    )));
    assert.ok(privacyAudit.body.data.some((item) => (
      item.reasonCode === 'confirmation_expired'
    )));
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});

test('allow-once waits for final security approval and configuration changes are audited', async () => {
  const testDatabase = createTestDatabasePath();
  const context = await startTestApplication(testDatabase.databasePath);

  try {
    const { userId, subjectId } = await createUserAndSubject(
      context.baseUrl,
      'security-once@example.com',
    );
    const permission = await createPermission(context.baseUrl, userId, {
      subjectId,
      resourceType: 'device',
      resourceId: 'device-placeholder',
      action: 'control',
      permissionLevel: 'allow_once',
    });
    const deviceScope = securityInput(subjectId, {
      resourceType: 'device',
      resourceId: 'device-placeholder',
      action: 'control',
      operationType: 'device_control',
    });

    const preview = await checkSecurity(context.baseUrl, userId, deviceScope);
    assert.equal(preview.response.status, 200);
    assert.equal(preview.body.data.decision, 'confirm');
    assert.equal(preview.body.data.risk.level, 'critical');
    assert.equal(preview.body.data.permission.reason, 'allow_once_available');

    const beforeConfirmation = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permission.permissionId}`,
    );
    assert.equal(beforeConfirmation.body.data.status, 'active');

    const confirmationId = preview.body.data.confirmation.confirmationId;
    const approved = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/confirmations/${confirmationId}`,
      { decision: 'approve' },
    );
    assert.equal(approved.response.status, 200);

    const finalCheck = await checkSecurity(context.baseUrl, userId, {
      ...deviceScope,
      confirmationId,
    });
    assert.equal(finalCheck.response.status, 200);
    assert.equal(finalCheck.body.data.decision, 'allow');
    assert.equal(finalCheck.body.data.permission.permissionStatus, 'consumed');

    const afterConfirmation = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions/${permission.permissionId}`,
    );
    assert.equal(afterConfirmation.body.data.status, 'consumed');

    const unavailable = await checkSecurity(context.baseUrl, userId, deviceScope);
    assert.equal(unavailable.response.status, 200);
    assert.equal(unavailable.body.data.decision, 'deny');
    assert.equal(unavailable.body.data.permission.reason, 'no_active_rule');

    const credentialLikeResourceIds = [
      'api_key:not-real',
      `ghp_${'a'.repeat(36)}`,
      `xoxb-${'a'.repeat(24)}`,
      `AKIA${'A'.repeat(16)}`,
      '4'.repeat(16),
    ];

    for (const resourceId of credentialLikeResourceIds) {
      const credentialLikeResource = await postJson(
        context.baseUrl,
        `/api/v1/users/${userId}/permissions`,
        {
          subjectId,
          resourceType: 'api',
          resourceId,
          action: 'manage',
          permissionLevel: 'always_allow',
        },
      );
      assert.equal(credentialLikeResource.response.status, 400, resourceId);
    }

    const namespacedNumericResource = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/permissions`,
      {
        subjectId,
        resourceType: 'api',
        resourceId: 'device:1234567890123',
        action: 'manage',
        permissionLevel: 'always_allow',
      },
    );
    assert.equal(namespacedNumericResource.response.status, 201);

    const provider = await postJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers`,
      {
        displayName: 'Security Audit Provider',
        providerType: 'custom',
        baseUrl: 'https://example.invalid/v1',
      },
    );
    assert.equal(provider.response.status, 201);
    const providerId = provider.body.data.providerId;
    const providerUpdate = await patchJson(
      context.baseUrl,
      `/api/v1/users/${userId}/api-providers/${providerId}/status`,
      { status: 'disabled' },
    );
    assert.equal(providerUpdate.response.status, 200);

    const permissionAudit = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/audit-logs?operationType=permission_change&resourceType=permission&limit=20`,
    );
    assert.equal(permissionAudit.response.status, 200);
    assert.ok(permissionAudit.body.data.some((item) => item.action === 'created'));
    assert.ok(permissionAudit.body.data.some((item) => item.action === 'consumed'));

    const providerAudit = await getJson(
      context.baseUrl,
      `/api/v1/users/${userId}/audit-logs?operationType=api_configuration_change&resourceType=api_provider`,
    );
    assert.equal(providerAudit.response.status, 200);
    assert.equal(providerAudit.body.meta.count, 2);
    assert.deepEqual(
      new Set(providerAudit.body.data.map((item) => item.action)),
      new Set(['created', 'status_updated']),
    );
  } finally {
    await context.application.stop();
    testDatabase.remove();
  }
});
