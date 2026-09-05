import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createOpenAiCompatibleModelExecutor } from '../src/integrations/model-providers/openai-compatible-model-executor.js';
import {
  canonicalizeJson,
  sha256Hash,
} from '../src/modules/continuity-integration/first-round-hashing.js';
import {
  approveAndResumeTurn,
  createCompletedTurn,
  createDeferred,
  createStandaloneChatFixture,
  loopbackChatExecutor,
  r1LedgerCounts,
  responseTurn,
} from '../test-support/standalone-chat-r1-fixtures.js';

async function waitUntil(predicate) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out while waiting for the controlled R1 boundary.');
}

async function approveConfirmation(fixture, turn) {
  const confirmationId = turn.confirmation?.confirmationId;
  assert.equal(typeof confirmationId, 'string', JSON.stringify(turn));
  const approved = await fixture.call(`/confirmations/${confirmationId}/decision`, 'POST', {
    decision: 'approve',
  });
  assert.equal(approved.status, 200, JSON.stringify(approved));
  return confirmationId;
}

async function explicitRetry(fixture, turn, key) {
  const preflight = await fixture.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'retry',
  }, { 'idempotency-key': `${key}-preflight` });
  assert.equal(preflight.status, 200, JSON.stringify(preflight));
  const waiting = responseTurn(preflight);
  assert.equal(waiting.status, 'waiting_confirmation', JSON.stringify(waiting));
  const confirmationId = await approveConfirmation(fixture, waiting);
  const resumed = await fixture.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume',
    confirmationId,
  }, { 'idempotency-key': `${key}-resume` });
  assert.equal(resumed.status, 200, JSON.stringify(resumed));
  return { response: resumed, turn: responseTurn(resumed), confirmationId };
}

function seedInterruptedProviderAttempt(fixture, turn, providerCallMayHaveStarted) {
  const connection = fixture.app.database.connection;
  const now = new Date().toISOString();
  const executionId = randomUUID();
  const attemptId = randomUUID();
  const requestHash = `sha256:${'a'.repeat(64)}`;
  const binding = connection.prepare(`
    SELECT credential_binding_id
    FROM api_provider_credential_bindings
    WHERE owner_user_id = ? AND provider_id = ? AND status = 'active'
  `).get(fixture.ownerId, fixture.providerId);
  const budget = connection.prepare(`
    SELECT token_budget_id
    FROM token_budgets
    WHERE user_id = ? AND subject_id = ? AND status = 'enabled'
  `).get(fixture.ownerId, fixture.firstAssistantId);
  const permission = connection.prepare(`
    SELECT permission_id, updated_at
    FROM permissions
    WHERE user_id = ? AND subject_id IS NULL
      AND resource_type = 'api' AND resource_id = ? AND action = 'execute'
      AND status = 'active'
    LIMIT 1
  `).get(fixture.ownerId, fixture.providerId);
  const session = connection.prepare(`
    SELECT session_id
    FROM personal_sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(fixture.ownerId, now);
  assert.ok(binding);
  assert.ok(budget);
  assert.ok(permission);
  assert.ok(session);
  const confirmationId = turn.confirmation?.confirmationId;
  assert.equal(typeof confirmationId, 'string');
  fixture.app.confirmationService.decideConfirmation(
    fixture.ownerId,
    confirmationId,
    { decision: 'approve' },
  );
  const approvedSecurity = fixture.app.securityService.checkSecurity(fixture.ownerId, {
    subjectId: null,
    resourceType: 'api',
    resourceId: fixture.providerId,
    action: 'execute',
    operationType: 'privacy_access_request',
    sensitiveDataCategories: ['private_record'],
    confirmationId,
    securitySessionId: session.session_id,
  }, { minimumRiskLevel: 'high' });
  assert.equal(approvedSecurity.decision, 'allow');
  const securityFactsHash = `sha256:${'b'.repeat(64)}`;
  const budgetFactsHash = `sha256:${'c'.repeat(64)}`;

  connection.exec('BEGIN IMMEDIATE');
  try {
    connection.prepare(`
      UPDATE standalone_chat_turns
      SET status = 'ready', confirmation_id = NULL, confirmation_kind = NULL,
          public_failure_code = NULL, recovery_reason = NULL, updated_at = ?
      WHERE turn_id = ? AND status = 'waiting_confirmation'
    `).run(now, turn.turnId);
    connection.prepare(`
      INSERT INTO standalone_chat_model_executions (
        execution_id, turn_id, user_id, assistant_id, conversation_id,
        provider_id, model_id, credential_binding_id, token_budget_id,
        budget_session_id, provider_type, provider_interface_format, model_name,
        permission_decision, security_decision, budget_decision, estimated_tokens,
        security_audit_log_id, permission_id, permission_updated_at,
        security_facts_hash, budget_facts_hash, budget_approval_id,
        max_output_tokens, request_hash, status,
        provider_call_may_have_started, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'allow', 'allow', 'allow',
        1, ?, ?, ?, ?, ?, NULL, 4096, ?, 'prepared', 0, ?, ?)
    `).run(
      executionId,
      turn.turnId,
      fixture.ownerId,
      fixture.firstAssistantId,
      turn.conversationId,
      fixture.providerId,
      fixture.modelId,
      binding.credential_binding_id,
      budget.token_budget_id,
      turn.conversationId,
      'openai',
      'openai_compatible',
      'controlled-chat-model',
      approvedSecurity.auditLogId,
      permission.permission_id,
      permission.updated_at,
      securityFactsHash,
      budgetFactsHash,
      requestHash,
      now,
      now,
    );
    connection.prepare(`
      INSERT INTO standalone_chat_provider_attempts (
        attempt_id, execution_id, turn_id, user_id, assistant_id, conversation_id,
        attempt_number, security_audit_log_id, permission_id, permission_updated_at,
        security_facts_hash, budget_facts_hash, budget_approval_id,
        request_hash, status,
        provider_call_may_have_started, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, ?, 'prepared', 0, ?)
    `).run(
      attemptId,
      executionId,
      turn.turnId,
      fixture.ownerId,
      fixture.firstAssistantId,
      turn.conversationId,
      approvedSecurity.auditLogId,
      permission.permission_id,
      permission.updated_at,
      securityFactsHash,
      budgetFactsHash,
      requestHash,
      now,
    );
    connection.prepare(`
      UPDATE standalone_chat_turns SET status = 'executing', updated_at = ?
      WHERE turn_id = ? AND status = 'ready'
    `).run(now, turn.turnId);
    connection.prepare(`
      UPDATE standalone_chat_model_executions
      SET status = 'in_flight', provider_call_may_have_started = ?, updated_at = ?
      WHERE execution_id = ? AND status = 'prepared'
    `).run(providerCallMayHaveStarted ? 1 : 0, now, executionId);
    connection.prepare(`
      UPDATE standalone_chat_provider_attempts
      SET status = 'in_flight', provider_call_may_have_started = ?
      WHERE attempt_id = ? AND status = 'prepared'
    `).run(providerCallMayHaveStarted ? 1 : 0, attemptId);
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
  return { executionId, attemptId };
}

function seedPendingRecovery(fixture, turn, {
  idempotencyKey,
  input,
  attemptCountBefore = 0,
}) {
  const persistedTurn = fixture.app.database.connection.prepare(`
    SELECT user_id, assistant_id, conversation_id, status
    FROM standalone_chat_turns WHERE turn_id = ?
  `).get(turn.turnId);
  assert.ok(persistedTurn);
  const inputJson = canonicalizeJson(input).toString('utf8');
  const contentHash = sha256Hash(Buffer.from(inputJson, 'utf8'));
  const recoveryActionId = randomUUID();
  fixture.app.database.connection.prepare(`
    INSERT INTO standalone_chat_recovery_actions (
      recovery_action_id, user_id, assistant_id, conversation_id, turn_id,
      idempotency_key, action_type, content_hash, input_json,
      turn_status_before, attempt_count_before, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    recoveryActionId,
    persistedTurn.user_id,
    persistedTurn.assistant_id,
    persistedTurn.conversation_id,
    turn.turnId,
    idempotencyKey,
    input.action,
    contentHash,
    inputJson,
    persistedTurn.status,
    attemptCountBefore,
    new Date().toISOString(),
  );
  return recoveryActionId;
}

function controlledHttpsRequest(counter) {
  return () => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      counter.sent += 1;
      request.emit('error', new Error('controlled request must not be sent'));
    };
    request.destroy = (error) => {
      if (error) request.emit('error', error);
    };
    return request;
  };
}

async function setFormalProviderUrl(fixture) {
  const provider = (await fixture.call('/providers')).data.items.find(
    ({ providerId }) => providerId === fixture.providerId,
  );
  const updated = await fixture.secured(`/providers/${fixture.providerId}`, 'PATCH', {
    displayName: provider.displayName,
    baseUrl: 'https://controlled-r1-provider.example',
    interfaceFormat: provider.interfaceFormat,
    status: provider.status,
    expectedVersion: provider.version,
  }, `formal-provider-url-${randomUUID()}`);
  assert.equal(updated.provider.baseUrl, 'https://controlled-r1-provider.example/');
}

test('R1 recovery rejects caller securitySessionId and binds confirmation to the verified session', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Recovery security scope is server derived.',
  }, { 'idempotency-key': 'server-bound-recovery-turn-0001' });
  const turn = responseTurn(created);
  assert.equal(turn.status, 'waiting_confirmation', JSON.stringify(created));
  const currentSession = await f.call('/session');
  assert.equal(currentSession.status, 200, JSON.stringify(currentSession));
  const confirmation = f.app.database.connection.prepare(`
    SELECT security_session_id AS securitySessionId
    FROM security_confirmations
    WHERE confirmation_id = ?
  `).get(turn.confirmation.confirmationId);
  assert.equal(confirmation.securitySessionId, currentSession.data.session.sessionId);

  const rejected = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume',
    confirmationId: turn.confirmation.confirmationId,
    securitySessionId: 'caller-forged-session',
  }, { 'idempotency-key': 'server-bound-recovery-resume-0001' });
  assert.equal(rejected.status, 400, JSON.stringify(rejected));
  assert.equal(rejected.error.message, 'Unsupported request fields.');
  assert.equal(rejected.error.details.field, 'body');
  assert.equal(r1LedgerCounts(f.app.database.connection).recoveryActions, 0);
  assert.equal(f.loopback.requests.length, 0);
});

test('R1 invalid confirmation does not consume the recovery key and an exact pending recovery continues once', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const created = await f.call('/chat/turns', 'POST', {
    content: 'The valid recovery may reuse a key rejected before persistence.',
  }, { 'idempotency-key': 'pending-recovery-turn-0001' });
  const turn = responseTurn(created);
  const recoveryKey = 'pending-recovery-resume-0001';
  const wrong = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: randomUUID(),
  }, { 'idempotency-key': recoveryKey });
  assert.equal(wrong.status, 409, JSON.stringify(wrong));
  assert.equal(r1LedgerCounts(f.app.database.connection).recoveryActions, 0);

  const confirmationId = await approveConfirmation(f, turn);
  const input = { action: 'resume', confirmationId };
  const recoveryActionId = seedPendingRecovery(f, turn, {
    idempotencyKey: recoveryKey,
    input,
  });
  const resumed = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', input, {
    'idempotency-key': recoveryKey,
  });
  assert.equal(resumed.status, 200, JSON.stringify(resumed));
  assert.equal(responseTurn(resumed).status, 'completed');
  assert.equal(f.loopback.requests.length, 1);
  assert.equal(f.app.database.connection.prepare(`
    SELECT status FROM standalone_chat_recovery_actions WHERE recovery_action_id = ?
  `).get(recoveryActionId).status, 'completed');

  const replay = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', input, {
    'idempotency-key': recoveryKey,
  });
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.equal(responseTurn(replay).status, 'completed');
  assert.equal(f.loopback.requests.length, 1);
  assert.equal(r1LedgerCounts(f.app.database.connection).attempts, 1);
});

test('R1 pre-send session and credential revocation prevent the actual Provider call', async (t) => {
  await t.test('session revoked before onRequestStart', async (t) => {
    let fixture;
    let providerCalls = 0;
    const f = await createStandaloneChatFixture(t, {
      applicationOptions: {
        modelExecutor: {
          async executeChat(input) {
            assert.equal((await fixture.call('/session', 'DELETE')).status, 200);
            input.onRequestStart();
            providerCalls += 1;
            throw new Error('unreachable Provider boundary');
          },
        },
      },
    });
    fixture = f;
    const created = await f.call('/chat/turns', 'POST', {
      content: 'Revoke this session at the last pre-send boundary.',
    }, { 'idempotency-key': 'pre-send-session-revoke-turn-0001' });
    const turn = responseTurn(created);
    const confirmationId = await approveConfirmation(f, turn);
    const resumed = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
      action: 'resume', confirmationId,
    }, { 'idempotency-key': 'pre-send-session-revoke-resume-0001' });
    assert.equal(resumed.status, 401, JSON.stringify(resumed));
    assert.equal(providerCalls, 0);
    assert.equal(f.loopback.requests.length, 0);
    assert.deepEqual({ ...f.app.database.connection.prepare(`
      SELECT status, provider_call_may_have_started AS providerCallMayHaveStarted
      FROM standalone_chat_provider_attempts
      WHERE turn_id = ?
    `).get(turn.turnId) }, {
      status: 'not_sent',
      providerCallMayHaveStarted: 0,
    });
  });

  await t.test('credential revoked before onRequestStart', async (t) => {
    let fixture;
    let providerCalls = 0;
    const f = await createStandaloneChatFixture(t, {
      applicationOptions: {
        modelExecutor: {
          async executeChat(input) {
            await fixture.secured(
              `/providers/${fixture.providerId}/credential`,
              'DELETE',
              {},
              'pre-send-credential-revoke-0001',
            );
            input.onRequestStart();
            providerCalls += 1;
            throw new Error('unreachable Provider boundary');
          },
        },
      },
    });
    fixture = f;
    const created = await f.call('/chat/turns', 'POST', {
      content: 'Revoke this credential at the last pre-send boundary.',
    }, { 'idempotency-key': 'pre-send-credential-revoke-turn-0001' });
    const turn = responseTurn(created);
    const confirmationId = await approveConfirmation(f, turn);
    const resumed = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
      action: 'resume', confirmationId,
    }, { 'idempotency-key': 'pre-send-credential-revoke-resume-0001' });
    assert.equal(resumed.status, 200, JSON.stringify(resumed));
    assert.equal(responseTurn(resumed).status, 'retryable');
    assert.equal(providerCalls, 0);
    assert.equal(f.loopback.requests.length, 0);
    assert.deepEqual({ ...f.app.database.connection.prepare(`
      SELECT status, provider_call_may_have_started AS providerCallMayHaveStarted
      FROM standalone_chat_provider_attempts
      WHERE turn_id = ?
    `).get(turn.turnId) }, {
      status: 'not_sent',
      providerCallMayHaveStarted: 0,
    });
  });
});

test('R1 deferred DNS boundary rechecks permission and budget before sending', async (t) => {
  for (const scenario of ['permission_revoked', 'budget_disabled', 'budget_tightened']) {
    await t.test(scenario, async (t) => {
      const dnsEntered = createDeferred();
      const releaseDns = createDeferred();
      const counter = { sent: 0 };
      const executor = createOpenAiCompatibleModelExecutor({
        resolveAddresses: async () => {
          dnsEntered.resolve();
          return releaseDns.promise;
        },
        requestHttps: controlledHttpsRequest(counter),
        connectTimeoutMs: 1_000,
        responseTimeoutMs: 1_000,
      });
      const f = await createStandaloneChatFixture(t, {
        applicationOptions: {
          modelExecutor: executor,
          providerConnectionChecker: {
            validateTarget(value) { return new URL(value); },
            async check() { return { status: 'succeeded', reason: 'controlled_test_only' }; },
          },
        },
      });
      await setFormalProviderUrl(f);
      const created = await f.call('/chat/turns', 'POST', {
        content: `Recheck ${scenario} after DNS resolution.`,
      }, { 'idempotency-key': `dns-window-${scenario}-turn-0001` });
      const turn = responseTurn(created);
      const confirmationId = await approveConfirmation(f, turn);
      const pending = f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
        action: 'resume', confirmationId,
      }, { 'idempotency-key': `dns-window-${scenario}-resume-0001` });
      await dnsEntered.promise;

      if (scenario === 'permission_revoked') {
        const permission = f.app.permissionService.listPermissions(f.ownerId, {
          resourceType: 'api',
          resourceId: f.providerId,
          action: 'execute',
          status: 'active',
        }).find(({ subjectId }) => subjectId === null);
        assert.ok(permission);
        f.app.permissionService.updatePermission(f.ownerId, permission.permissionId, {
          permissionLevel: 'denied',
        });
      } else {
        f.app.proactiveInteractionService.upsertTokenBudget(f.ownerId, f.firstAssistantId, {
          dailyTokenLimit: scenario === 'budget_tightened' ? 1 : 100_000,
          sessionTokenLimit: scenario === 'budget_tightened' ? 1 : 50_000,
          overagePolicy: 'block',
          status: scenario === 'budget_disabled' ? 'disabled' : 'enabled',
        });
      }
      releaseDns.resolve([{ address: '93.184.216.34', family: 4 }]);
      const result = await pending;
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(responseTurn(result).status, 'retryable');
      assert.equal(counter.sent, 0, `${scenario} must stop before request.write/end`);
      assert.equal(f.loopback.requests.length, 0);
      const attempt = f.app.database.connection.prepare(`
        SELECT status,provider_call_may_have_started AS mayHaveStarted
        FROM standalone_chat_provider_attempts WHERE turn_id=?
      `).get(turn.turnId);
      assert.deepEqual({ ...attempt }, { status: 'not_sent', mayHaveStarted: 0 });
    });
  }
});

test('R1 deferred DNS boundary rejects a new active deny after allow-once was consumed', async (t) => {
  const dnsEntered = createDeferred();
  const releaseDns = createDeferred();
  const counter = { sent: 0 };
  const executor = createOpenAiCompatibleModelExecutor({
    resolveAddresses: async () => {
      dnsEntered.resolve();
      return releaseDns.promise;
    },
    requestHttps: controlledHttpsRequest(counter),
    connectTimeoutMs: 1_000,
    responseTimeoutMs: 1_000,
  });
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      modelExecutor: executor,
      providerConnectionChecker: {
        validateTarget(value) { return new URL(value); },
        async check() { return { status: 'succeeded', reason: 'controlled_test_only' }; },
      },
    },
  });
  await setFormalProviderUrl(f);
  const originalPermission = f.app.permissionService.listPermissions(f.ownerId, {
    resourceType: 'api',
    resourceId: f.providerId,
    action: 'execute',
    status: 'active',
  }).find(({ subjectId }) => subjectId === null);
  assert.ok(originalPermission);
  f.app.permissionService.updatePermission(f.ownerId, originalPermission.permissionId, {
    permissionLevel: 'allow_once',
  });

  const created = await f.call('/chat/turns', 'POST', {
    content: 'A later deny must win before the Provider request is sent.',
  }, { 'idempotency-key': 'dns-window-consumed-allow-once-turn-0001' });
  const turn = responseTurn(created);
  const confirmationId = await approveConfirmation(f, turn);
  const pending = f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'dns-window-consumed-allow-once-resume-0001' });
  await dnsEntered.promise;

  const consumedPermission = f.app.permissionService.listPermissions(f.ownerId, {
    resourceType: 'api',
    resourceId: f.providerId,
    action: 'execute',
  }).find(({ permissionId }) => permissionId === originalPermission.permissionId);
  assert.equal(consumedPermission.status, 'consumed');
  const denied = f.app.permissionService.createPermission(f.ownerId, {
    subjectId: null,
    resourceType: 'api',
    resourceId: f.providerId,
    action: 'execute',
    permissionLevel: 'denied',
    status: 'active',
  });
  assert.equal(denied.status, 'active');

  releaseDns.resolve([{ address: '93.184.216.34', family: 4 }]);
  const result = await pending;
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(responseTurn(result).status, 'retryable');
  assert.equal(counter.sent, 0, 'the later active deny must stop before request.write/end');
  assert.equal(f.loopback.requests.length, 0);
  assert.deepEqual({ ...f.app.database.connection.prepare(`
    SELECT status,provider_call_may_have_started AS mayHaveStarted
    FROM standalone_chat_provider_attempts WHERE turn_id=?
  `).get(turn.turnId) }, { status: 'not_sent', mayHaveStarted: 0 });
});

test('R1 explicit safe retry keeps one logical execution and immutable Provider attempt facts', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [
      { type: 'rate_limit' },
      { type: 'success', content: 'Succeeded only after explicit retry.', inputTokens: 18, outputTokens: 7 },
    ],
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Retry only with explicit authorization.',
  }, { 'idempotency-key': 'retryable-r1-turn-0001' });
  const first = await approveAndResumeTurn(f, created, 'retryable-r1-turn-0001');
  assert.equal(first.turn.status, 'retryable', JSON.stringify(first.response));
  assert.equal(f.loopback.requests.length, 1);
  const beforeRead = r1LedgerCounts(f.app.database.connection);
  assert.equal((await f.call(`/chat/turns/${first.turn.turnId}`)).status, 200);
  assert.equal((await f.call('/chat/turns/by-idempotency-key/retryable-r1-turn-0001')).status, 200);
  assert.equal(f.loopback.requests.length, 1);
  assert.deepEqual(r1LedgerCounts(f.app.database.connection), beforeRead);

  await f.restart();
  assert.equal(responseTurn(await f.call(`/chat/turns/${first.turn.turnId}`)).status, 'retryable');
  assert.equal(f.loopback.requests.length, 1, 'restart and query must not retry');
  assert.equal((await f.call('/vault/unlock', 'POST', { passphrase: f.passphrase })).status, 200);
  const completed = await explicitRetry(f, first.turn, 'retryable-r1-approved-0001');
  assert.equal(completed.turn.status, 'completed', JSON.stringify(completed.response));
  assert.equal(completed.turn.assistantMessage.content, 'Succeeded only after explicit retry.');
  assert.equal(f.loopback.requests.length, 2);
  const db = f.app.database.connection;
  assert.equal(db.prepare('SELECT count(*) n FROM standalone_chat_model_executions').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM standalone_chat_provider_attempts').get().n, 2);
  assert.deepEqual(db.prepare(
    'SELECT status FROM standalone_chat_provider_attempts ORDER BY attempt_number',
  ).all().map(({ status }) => status), ['retryable', 'response_received']);
  assert.equal(db.prepare('SELECT count(*) n FROM standalone_chat_usage_facts').get().n, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM standalone_chat_provider_results").get().n, 1);
  const replay = await f.call(`/chat/turns/${first.turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: completed.confirmationId,
  }, { 'idempotency-key': 'retryable-r1-approved-0001-resume' });
  assert.equal(replay.status, 200);
  assert.equal(responseTurn(replay).turnId, first.turn.turnId);
  assert.equal(f.loopback.requests.length, 2);
});

test('R1 retry after a known 429 preserves the logical call boundary across a DNS pre-send failure', async (t) => {
  let calls = 0;
  const results = [
    {
      status: 'FAILED_RETRYABLE', output: null, usage: null,
      errorCode: 'PROVIDER_RATE_LIMITED', requestMayHaveBeenSent: true,
      startedAt: '2026-09-05T00:00:01.000Z', completedAt: '2026-09-05T00:00:02.000Z',
      cost: { status: 'not_reported', amountMicros: null, currency: null },
    },
    {
      status: 'FAILED_RETRYABLE', output: null, usage: null,
      errorCode: 'PROVIDER_DNS_FAILED', requestMayHaveBeenSent: false,
      startedAt: '2026-09-05T00:00:03.000Z', completedAt: '2026-09-05T00:00:04.000Z',
      cost: { status: 'not_incurred', amountMicros: null, currency: null },
    },
  ];
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      modelExecutor: { async executeChat() { calls += 1; return results.shift(); } },
    },
  });
  const created = await f.call('/chat/turns', 'POST', { content: 'Known 429 then safe DNS failure.' }, {
    'idempotency-key': 'retry-boundary-monotonic-turn-0001',
  });
  const first = await approveAndResumeTurn(f, created, 'retry-boundary-monotonic-turn-0001');
  assert.equal(first.turn.status, 'retryable');
  assert.equal(calls, 1);
  const second = await explicitRetry(f, first.turn, 'retry-boundary-monotonic-retry-0001');
  assert.equal(second.turn.status, 'retryable', JSON.stringify(second.response));
  assert.equal(calls, 2);
  const db = f.app.database.connection;
  assert.equal(db.prepare(`
    SELECT provider_call_may_have_started AS mayHaveStarted
    FROM standalone_chat_model_executions WHERE turn_id=?
  `).get(first.turn.turnId).mayHaveStarted, 1);
  assert.deepEqual(db.prepare(`
    SELECT status,provider_call_may_have_started AS mayHaveStarted,error_code AS errorCode
    FROM standalone_chat_provider_attempts WHERE turn_id=? ORDER BY attempt_number
  `).all(first.turn.turnId).map((row) => ({ ...row })), [
    { status: 'retryable', mayHaveStarted: 1, errorCode: 'PROVIDER_RATE_LIMITED' },
    { status: 'not_sent', mayHaveStarted: 0, errorCode: 'PROVIDER_DNS_FAILED' },
  ]);
});

test('R1 explicit retry rejects a changed model execution snapshot before another attempt', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'rate_limit' }],
  });
  const created = await f.call('/chat/turns', 'POST', { content: 'Keep the original model snapshot.' }, {
    'idempotency-key': 'changed-snapshot-turn-0001',
  });
  const first = await approveAndResumeTurn(f, created, 'changed-snapshot-turn-0001');
  assert.equal(first.turn.status, 'retryable');
  assert.equal(f.loopback.requests.length, 1);
  const model = (await f.call('/models')).data.items.find(({ modelId }) => modelId === f.modelId);
  await f.secured(`/models/${f.modelId}`, 'PATCH', {
    modelName: 'changed-controlled-chat-model',
    modelType: model.modelType,
    capabilities: model.capabilities,
    status: model.status,
    defaultForChat: true,
    expectedVersion: model.version,
  }, 'changed-snapshot-model-0001');
  const retry = await f.call(`/chat/turns/${first.turn.turnId}/recovery`, 'POST', {
    action: 'retry',
  }, { 'idempotency-key': 'changed-snapshot-retry-0001' });
  const waiting = responseTurn(retry);
  assert.equal(waiting.status, 'waiting_confirmation', JSON.stringify(retry));
  const confirmationId = await approveConfirmation(f, waiting);
  const refused = await f.call(`/chat/turns/${first.turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'changed-snapshot-resume-0001' });
  assert.equal(refused.status, 409, JSON.stringify(refused));
  assert.equal(refused.error.code, 'TURN_RETRY_NOT_ALLOWED');
  assert.equal(f.loopback.requests.length, 1);
  assert.equal(f.app.database.connection.prepare(
    'SELECT count(*) n FROM standalone_chat_provider_attempts WHERE turn_id=?',
  ).get(first.turn.turnId).n, 1);
});

test('R1 allows repeated known retryable responses but never retries without a new explicit action', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [
      { type: 'rate_limit' },
      { type: 'rate_limit' },
      { type: 'success', content: 'Third controlled attempt succeeds.' },
    ],
  });
  const created = await f.call('/chat/turns', 'POST', { content: 'Two known rate limits.' }, {
    'idempotency-key': 'two-retries-r1-turn-0001',
  });
  let current = await approveAndResumeTurn(f, created, 'two-retries-r1-turn-0001');
  assert.equal(current.turn.status, 'retryable');
  current = await explicitRetry(f, current.turn, 'two-retries-r1-first-0001');
  assert.equal(current.turn.status, 'retryable');
  assert.equal(f.loopback.requests.length, 2);
  await f.restart();
  assert.equal((await f.call('/vault/unlock', 'POST', { passphrase: f.passphrase })).status, 200);
  assert.equal(f.loopback.requests.length, 2);
  current = await explicitRetry(f, current.turn, 'two-retries-r1-second-0001');
  assert.equal(current.turn.status, 'completed');
  assert.equal(f.loopback.requests.length, 3);
  assert.equal(f.app.database.connection.prepare(
    'SELECT count(*) n FROM standalone_chat_model_executions',
  ).get().n, 1);
  assert.equal(f.app.database.connection.prepare(
    'SELECT count(*) n FROM standalone_chat_provider_attempts',
  ).get().n, 3);
});

test('R1 Provider outcome_unknown remains fail-closed across reads and restart', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'disconnect' }],
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Response may be lost after sending.',
  }, { 'idempotency-key': 'unknown-r1-turn-0001' });
  const unknown = await approveAndResumeTurn(f, created, 'unknown-r1-turn-0001');
  assert.equal(unknown.turn.status, 'outcome_unknown', JSON.stringify(unknown.response));
  assert.equal(unknown.turn.error.code, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(f.loopback.requests.length, 1);
  const firstCounts = r1LedgerCounts(f.app.database.connection);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(responseTurn(await f.call(`/chat/turns/${unknown.turn.turnId}`)).status, 'outcome_unknown');
    assert.equal(responseTurn(await f.call('/chat/turns/by-idempotency-key/unknown-r1-turn-0001')).status, 'outcome_unknown');
  }
  await f.restart();
  assert.equal(responseTurn(await f.call(`/chat/turns/${unknown.turn.turnId}`)).status, 'outcome_unknown');
  assert.equal(f.loopback.requests.length, 1);
  assert.deepEqual(r1LedgerCounts(f.app.database.connection), firstCounts);
  const retry = await f.call(`/chat/turns/${unknown.turn.turnId}/recovery`, 'POST', {
    action: 'retry',
  }, { 'idempotency-key': 'unknown-r1-retry-refused-0001' });
  assert.equal(retry.status, 409, JSON.stringify(retry));
  assert.equal(retry.error.code, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(f.loopback.requests.length, 1);
});

test('R1 treats an executor throw after the durable request boundary as outcome_unknown', async (t) => {
  let executorCalls = 0;
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      modelExecutor: {
        async executeChat(input) {
          executorCalls += 1;
          input.onRequestStart();
          throw new Error('controlled failure after durable request boundary');
        },
      },
    },
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'The durable boundary must remain conservative.',
  }, { 'idempotency-key': 'boundary-throw-r1-turn-0001' });
  const unknown = await approveAndResumeTurn(f, created, 'boundary-throw-r1-turn-0001');
  assert.equal(unknown.turn.status, 'outcome_unknown', JSON.stringify(unknown.response));
  assert.equal(unknown.turn.error.code, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(unknown.turn.externalCall, 'outcome_unknown');
  assert.equal(executorCalls, 1);
  assert.equal(f.loopback.requests.length, 0);
  const connection = f.app.database.connection;
  assert.deepEqual({ ...connection.prepare(`
    SELECT status, provider_call_may_have_started AS providerCallMayHaveStarted,
           error_code AS errorCode
    FROM standalone_chat_provider_attempts
  `).get() }, {
    status: 'outcome_unknown',
    providerCallMayHaveStarted: 1,
    errorCode: 'PROVIDER_EXECUTION_INTERRUPTED',
  });
  assert.deepEqual({ ...connection.prepare(`
    SELECT usage_status AS usageStatus, cost_status AS costStatus
    FROM standalone_chat_usage_facts
  `).get() }, {
    usageStatus: 'unknown',
    costStatus: 'not_reported',
  });
  const retry = await f.call(`/chat/turns/${unknown.turn.turnId}/recovery`, 'POST', {
    action: 'retry',
  }, { 'idempotency-key': 'boundary-throw-r1-retry-0001' });
  assert.equal(retry.status, 409, JSON.stringify(retry));
  assert.equal(executorCalls, 1);
});

test('R1 response timeout is outcome_unknown and never triggers a hidden retry', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'timeout' }],
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Do not retry a timed-out charged request.',
  }, { 'idempotency-key': 'timeout-r1-turn-0001' });
  const unknown = await approveAndResumeTurn(f, created, 'timeout-r1-turn-0001');
  assert.equal(unknown.turn.status, 'outcome_unknown', JSON.stringify(unknown.response));
  assert.equal(unknown.turn.error.code, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(f.loopback.requests.length, 1);
  await f.restart();
  assert.equal(responseTurn(await f.call(`/chat/turns/${unknown.turn.turnId}`)).status, 'outcome_unknown');
  assert.equal(f.loopback.requests.length, 1);
});

test('R1 startup recovers a durably not-sent in-flight attempt without a Provider call', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Crash before the Provider request starts.',
  }, { 'idempotency-key': 'startup-not-sent-r1-turn-0001' });
  const turn = responseTurn(created);
  assert.equal(turn.status, 'waiting_confirmation');
  const seeded = seedInterruptedProviderAttempt(f, turn, false);
  assert.equal(f.loopback.requests.length, 0);

  await f.restart();
  const recovered = responseTurn(await f.call(`/chat/turns/${turn.turnId}`));
  assert.equal(recovered.status, 'retryable');
  assert.equal(recovered.error.code, 'PROVIDER_REQUEST_NOT_SENT');
  const connection = f.app.database.connection;
  assert.deepEqual({ ...connection.prepare(`
    SELECT status, provider_call_may_have_started AS providerCallMayHaveStarted,
           error_code AS errorCode
    FROM standalone_chat_provider_attempts WHERE attempt_id = ?
  `).get(seeded.attemptId) }, {
    status: 'not_sent',
    providerCallMayHaveStarted: 0,
    errorCode: 'PROCESS_INTERRUPTED',
  });
  assert.deepEqual({ ...connection.prepare(`
    SELECT usage_status AS usageStatus, cost_status AS costStatus,
           input_tokens AS inputTokens, output_tokens AS outputTokens,
           total_tokens AS totalTokens
    FROM standalone_chat_usage_facts WHERE attempt_id = ?
  `).get(seeded.attemptId) }, {
    usageStatus: 'not_incurred',
    costStatus: 'not_incurred',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
  assert.equal(connection.prepare(`
    SELECT status FROM standalone_chat_model_executions WHERE execution_id = ?
  `).get(seeded.executionId).status, 'retryable');
  assert.equal(f.loopback.requests.length, 0);
});

test('R1 startup keeps a possibly-sent in-flight attempt outcome_unknown', async (t) => {
  const f = await createStandaloneChatFixture(t);
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Crash after the Provider request may have started.',
  }, { 'idempotency-key': 'startup-unknown-r1-turn-0001' });
  const turn = responseTurn(created);
  assert.equal(turn.status, 'waiting_confirmation');
  const seeded = seedInterruptedProviderAttempt(f, turn, true);
  assert.equal(f.loopback.requests.length, 0);

  await f.restart();
  const recovered = responseTurn(await f.call(`/chat/turns/${turn.turnId}`));
  assert.equal(recovered.status, 'outcome_unknown');
  assert.equal(recovered.error.code, 'PROVIDER_OUTCOME_UNKNOWN');
  const connection = f.app.database.connection;
  assert.deepEqual({ ...connection.prepare(`
    SELECT status, provider_call_may_have_started AS providerCallMayHaveStarted,
           error_code AS errorCode
    FROM standalone_chat_provider_attempts WHERE attempt_id = ?
  `).get(seeded.attemptId) }, {
    status: 'outcome_unknown',
    providerCallMayHaveStarted: 1,
    errorCode: 'PROCESS_INTERRUPTED',
  });
  assert.deepEqual({ ...connection.prepare(`
    SELECT usage_status AS usageStatus, cost_status AS costStatus,
           input_tokens AS inputTokens, output_tokens AS outputTokens,
           total_tokens AS totalTokens
    FROM standalone_chat_usage_facts WHERE attempt_id = ?
  `).get(seeded.attemptId) }, {
    usageStatus: 'unknown',
    costStatus: 'not_reported',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
  assert.equal(connection.prepare(`
    SELECT status FROM standalone_chat_model_executions WHERE execution_id = ?
  `).get(seeded.executionId).status, 'outcome_unknown');
  assert.equal(f.loopback.requests.length, 0);
});

test('R1 restart publishes one locked result after a crash between result persistence and Message publication', async (t) => {
  let faultEnabled = true;
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      standaloneChatFaultInjector: {
        afterResultPersisted() {
          if (faultEnabled) {
            faultEnabled = false;
            throw new Error('controlled crash after durable standalone result');
          }
        },
      },
    },
    providerResponses: [{ type: 'success', content: 'Durably locked before publication.' }],
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Recover the locked result.',
  }, { 'idempotency-key': 'result-ready-r1-turn-0001' });
  const turn = responseTurn(created);
  const confirmationId = await approveConfirmation(f, turn);
  const interrupted = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'result-ready-r1-initial-resume-0001' });
  assert.equal(interrupted.status, 500, JSON.stringify(interrupted));
  assert.equal(f.loopback.requests.length, 1);
  let row = f.app.database.connection.prepare(
    'SELECT status,assistant_message_id FROM standalone_chat_turns WHERE turn_id=?',
  ).get(turn.turnId);
  assert.deepEqual({ ...row }, { status: 'result_ready', assistant_message_id: null });
  assert.equal(f.app.database.connection.prepare(
    'SELECT count(*) n FROM standalone_chat_provider_results WHERE turn_id=?',
  ).get(turn.turnId).n, 1);
  await f.restart();
  const read = await f.call(`/chat/turns/${turn.turnId}`);
  assert.equal(responseTurn(read).status, 'result_ready');
  assert.equal(f.loopback.requests.length, 1);
  const exactPendingReplay = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'result-ready-r1-initial-resume-0001' });
  assert.equal(exactPendingReplay.status, 200, JSON.stringify(exactPendingReplay));
  assert.equal(responseTurn(exactPendingReplay).status, 'result_ready');
  assert.equal(f.loopback.requests.length, 1);
  assert.equal(f.app.database.connection.prepare(
    'SELECT count(*) n FROM standalone_chat_provider_attempts WHERE turn_id=?',
  ).get(turn.turnId).n, 1);
  assert.equal(f.app.database.connection.prepare(`
    SELECT status FROM standalone_chat_recovery_actions
    WHERE idempotency_key='result-ready-r1-initial-resume-0001'
  `).get().status, 'completed');
  const recovered = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume',
  }, { 'idempotency-key': 'result-ready-r1-recovery-0001' });
  assert.equal(recovered.status, 200, JSON.stringify(recovered));
  assert.equal(responseTurn(recovered).status, 'completed');
  assert.equal(responseTurn(recovered).assistantMessage.content, 'Durably locked before publication.');
  assert.equal(f.loopback.requests.length, 1);
  row = f.app.database.connection.prepare(
    'SELECT status,assistant_message_id FROM standalone_chat_turns WHERE turn_id=?',
  ).get(turn.turnId);
  assert.equal(row.status, 'completed');
  assert.equal(typeof row.assistant_message_id, 'string');
  assert.equal(f.app.database.connection.prepare(
    "SELECT count(*) n FROM messages WHERE sender_type='subject'",
  ).get().n, 1);
});

test('R1 locks one normalized CRLF Provider candidate through result recovery and Message publication', async (t) => {
  const candidate = 'First provider line.\r\nSecond provider line.';
  const normalizedCandidate = 'First provider line.\nSecond provider line.';
  let interrupt = true;
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      standaloneChatFaultInjector: {
        afterResultPersisted() {
          if (interrupt) {
            interrupt = false;
            throw new Error('controlled crash after CRLF result persistence');
          }
        },
      },
    },
    providerResponses: [{ type: 'success', content: candidate }],
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Preserve the provider line endings.',
  }, { 'idempotency-key': 'crlf-result-turn-0001' });
  const turn = responseTurn(created);
  const confirmationId = await approveConfirmation(f, turn);
  const interrupted = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'crlf-result-initial-resume-0001' });
  assert.equal(interrupted.status, 500, JSON.stringify(interrupted));
  assert.equal(f.loopback.requests.length, 1);
  const locked = f.app.database.connection.prepare(`
    SELECT result_json AS resultJson,response_content_hash AS responseContentHash
    FROM standalone_chat_provider_results WHERE turn_id=?
  `).get(turn.turnId);
  assert.equal(JSON.parse(locked.resultJson).responseCandidate, normalizedCandidate);
  assert.equal(locked.responseContentHash, sha256Hash(Buffer.from(normalizedCandidate, 'utf8')));

  await f.restart();
  const recovered = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume',
  }, { 'idempotency-key': 'crlf-result-publication-resume-0001' });
  assert.equal(recovered.status, 200, JSON.stringify(recovered));
  assert.equal(responseTurn(recovered).status, 'completed');
  assert.equal(responseTurn(recovered).assistantMessage.content, normalizedCandidate);
  const version = f.app.database.connection.prepare(`
    SELECT content FROM message_versions WHERE message_version_id=?
  `).get(responseTurn(recovered).assistantMessage.messageVersionId);
  assert.equal(version.content, normalizedCandidate);
  assert.equal(version.content, JSON.parse(locked.resultJson).responseCandidate);
  assert.equal(f.loopback.requests.length, 1);
});

test('R1 overlong Provider finish_reason becomes outcome_unknown without a SQL conflict or retry', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [{
      type: 'success',
      payload: {
        choices: [{ message: { content: 'Unrecoverable metadata response.' }, finish_reason: 'x'.repeat(129) }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      },
    }],
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Reject overlong finish metadata before persistence.',
  }, { 'idempotency-key': 'overlong-finish-reason-turn-0001' });
  const unknown = await approveAndResumeTurn(f, created, 'overlong-finish-reason-turn-0001');
  assert.equal(unknown.response.status, 200, JSON.stringify(unknown.response));
  assert.equal(unknown.turn.status, 'outcome_unknown');
  assert.equal(unknown.turn.error.code, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(f.loopback.requests.length, 1);
  const db = f.app.database.connection;
  assert.equal(db.prepare(
    'SELECT count(*) n FROM standalone_chat_provider_results WHERE turn_id=?',
  ).get(unknown.turn.turnId).n, 0);
  assert.deepEqual({ ...db.prepare(`
    SELECT usage_status AS usageStatus,cost_status AS costStatus
    FROM standalone_chat_usage_facts WHERE turn_id=?
  `).get(unknown.turn.turnId) }, { usageStatus: 'unknown', costStatus: 'not_reported' });
  const retry = await f.call(`/chat/turns/${unknown.turn.turnId}/recovery`, 'POST', {
    action: 'retry',
  }, { 'idempotency-key': 'overlong-finish-reason-retry-0001' });
  assert.equal(retry.status, 409, JSON.stringify(retry));
  assert.equal(f.loopback.requests.length, 1);
});

test('R1 session revocation during a late response locks the result without publishing under stale access', async (t) => {
  const gate = createDeferred();
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [{
      type: 'deferred',
      waitFor: gate.promise,
      content: 'Publish only after a new verified session.',
    }],
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Revoke the session before this response returns.',
  }, { 'idempotency-key': 'revoked-late-r1-turn-0001' });
  const turn = responseTurn(created);
  const confirmationId = await approveConfirmation(f, turn);
  const pending = f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'revoked-late-r1-resume-0001' });
  await waitUntil(() => f.loopback.requests.length === 1);
  assert.equal((await f.call('/session', 'DELETE')).status, 200);
  gate.resolve();
  const stale = await pending;
  assert.equal(stale.status, 401, JSON.stringify(stale));
  assert.equal(f.app.database.connection.prepare(
    'SELECT status FROM standalone_chat_turns WHERE turn_id = ?',
  ).get(turn.turnId).status, 'result_ready');
  assert.equal(f.app.database.connection.prepare(
    "SELECT count(*) AS n FROM messages WHERE sender_type = 'subject'",
  ).get().n, 0);
  assert.equal(f.loopback.requests.length, 1);

  const loggedIn = await f.call('/sessions', 'POST', {
    passphrase: f.passphrase,
    deviceName: 'Controlled R1 recovery session',
  });
  assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn));
  const recovered = await f.call(`/chat/turns/${turn.turnId}/recovery`, 'POST', {
    action: 'resume',
  }, { 'idempotency-key': 'revoked-late-r1-publish-0001' });
  assert.equal(recovered.status, 200, JSON.stringify(recovered));
  assert.equal(responseTurn(recovered).status, 'completed');
  assert.equal(
    responseTurn(recovered).assistantMessage.content,
    'Publish only after a new verified session.',
  );
  assert.equal(f.loopback.requests.length, 1);
});

test('R1 conclusively not-sent failures allow only explicit retry and do not duplicate the user message', async (t) => {
  let calls = 0;
  const results = [
    {
      status: 'FAILED_RETRYABLE', output: null, usage: null,
      errorCode: 'PROVIDER_CONNECTION_FAILED', requestMayHaveBeenSent: false,
      startedAt: '2026-09-05T00:00:01.000Z', completedAt: '2026-09-05T00:00:02.000Z',
      cost: { status: 'not_incurred', amountMicros: null, currency: null },
    },
    {
      status: 'SUCCEEDED', output: { responseCandidate: 'Safe explicit retry result.', finishReason: 'stop' },
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }, errorCode: null,
      requestMayHaveBeenSent: true, startedAt: '2026-09-05T00:00:03.000Z',
      completedAt: '2026-09-05T00:00:04.000Z',
      cost: { status: 'not_reported', amountMicros: null, currency: null },
    },
  ];
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      modelExecutor: { async executeChat() { calls += 1; return results.shift(); } },
    },
  });
  const created = await f.call('/chat/turns', 'POST', { content: 'Conclusive pre-send failure.' }, {
    'idempotency-key': 'not-sent-r1-turn-0001',
  });
  let current = await approveAndResumeTurn(f, created, 'not-sent-r1-turn-0001');
  assert.equal(current.turn.status, 'retryable');
  assert.equal(calls, 1);
  assert.equal(f.app.database.connection.prepare(
    "SELECT count(*) n FROM messages WHERE sender_type='user'",
  ).get().n, 1);
  current = await explicitRetry(f, current.turn, 'not-sent-r1-retry-0001');
  assert.equal(current.turn.status, 'completed');
  assert.equal(calls, 2);
  assert.equal(f.app.database.connection.prepare(
    "SELECT count(*) n FROM messages WHERE sender_type='user'",
  ).get().n, 1);
  assert.equal(f.app.database.connection.prepare(
    "SELECT count(*) n FROM messages WHERE sender_type='subject'",
  ).get().n, 1);
});

test('R1 logout and accepted account deletion prevent any later chat or credential use', async (t) => {
  const f = await createStandaloneChatFixture(t);
  await createCompletedTurn(f, 'Complete before deletion.', 'before-deletion-r1-turn-0001');
  const calls = f.loopback.requests.length;
  const deletion = await f.secured('/deletions', 'POST', {}, 'delete-r1-owner-0001');
  assert.equal(deletion.deletion.status, 'waiting');
  const inventory = JSON.parse(f.app.database.connection.prepare(
    'SELECT inventory_json FROM personal_deletion_tasks WHERE deletion_id=?',
  ).get(deletion.deletion.deletionId).inventory_json);
  for (const table of [
    'standalone_chat_default_conversations',
    'standalone_chat_turns',
    'standalone_chat_model_executions',
    'standalone_chat_provider_attempts',
    'standalone_chat_usage_facts',
    'standalone_chat_provider_results',
    'standalone_chat_recovery_actions',
  ]) assert.equal(inventory.rows.some((entry) => entry.table === table), true, table);
  assert.equal((await f.call('/chat/default')).status, 401);
  assert.equal((await f.call('/chat/turns', 'POST', { content: 'Blocked after deletion.' }, {
    'idempotency-key': 'blocked-after-deletion-0001',
  })).status, 401);
  assert.equal(f.loopback.requests.length, calls);
  assert.equal(f.app.personalVault.status(f.ownerId), 'locked');
});

test('R1 due owner deletion removes the complete standalone ledger and preserves another owner', async (t) => {
  const day = 86_400_000;
  let now = Date.parse('2026-09-05T00:00:00.000Z');
  const f = await createStandaloneChatFixture(t, {
    applicationOptions: {
      personalClock: () => new Date(now),
      modelExecutor: loopbackChatExecutor({ clock: () => new Date(now) }),
    },
  });
  const deletionBudget = f.app.proactiveInteractionService.upsertTokenBudget(
    f.ownerId,
    f.firstAssistantId,
    {
    dailyTokenLimit: 1,
    sessionTokenLimit: 1,
    overagePolicy: 'require_confirmation',
    status: 'enabled',
    },
  );
  f.app.permissionService.createPermission(f.ownerId, {
    subjectId: f.firstAssistantId,
    resourceType: 'proactive_interaction',
    resourceId: deletionBudget.tokenBudgetId,
    action: 'execute',
    permissionLevel: 'always_allow',
    status: 'active',
  });
  const created = await f.call('/chat/turns', 'POST', {
    content: 'Delete every R1 owner fact.',
  }, { 'idempotency-key': 'delete-r1-ledger-turn-0001' });
  const budgetWaiting = responseTurn(created);
  assert.equal(budgetWaiting.status, 'waiting_budget', JSON.stringify(created));
  const budgetConfirmationId = await approveConfirmation(f, budgetWaiting);
  const securityResponse = await f.call(`/chat/turns/${budgetWaiting.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: budgetConfirmationId,
  }, { 'idempotency-key': 'delete-r1-ledger-budget-resume-0001' });
  const securityWaiting = responseTurn(securityResponse);
  assert.equal(securityWaiting.status, 'waiting_confirmation', JSON.stringify(securityResponse));
  const securityConfirmationId = await approveConfirmation(f, securityWaiting);
  const completedTurn = await f.call(`/chat/turns/${securityWaiting.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId: securityConfirmationId,
  }, { 'idempotency-key': 'delete-r1-ledger-security-resume-0001' });
  assert.equal(responseTurn(completedTurn).status, 'completed', JSON.stringify(completedTurn));
  const db = f.app.database.connection;
  assert.equal(db.prepare(
    'SELECT count(*) n FROM standalone_chat_budget_approvals WHERE user_id=?',
  ).get(f.ownerId).n, 1);
  const otherOwner = 'preserved-r1-owner';
  const otherAssistant = 'preserved-r1-assistant';
  const otherConversation = 'preserved-r1-conversation';
  const timestamp = new Date(now).toISOString();
  db.prepare(`
    INSERT INTO users(user_id,primary_email,display_name,status,created_at,updated_at)
    VALUES (?,?,'Preserved R1 owner','active',?,?)
  `).run(otherOwner, 'preserved-r1-owner@example.test', timestamp, timestamp);
  db.prepare(`
    INSERT INTO personal_identities(
      user_id,password_salt,password_verifier,wrapped_vault_key,
      preferences_json,onboarding_completed,profile_version,selection_version,created_at
    ) VALUES (?,?,?,?,'{"storagePreference":"local","contextMode":"balanced"}',1,1,1,?)
  `).run(otherOwner, 'preserved-salt', 'preserved-verifier', 'preserved-wrapped-key', timestamp);
  db.prepare(`
    INSERT INTO subjects(
      subject_id,owner_user_id,name,avatar_ref,basic_settings_json,status,created_at,updated_at
    ) VALUES (?,?,'Preserved assistant',NULL,'{}','active',?,?)
  `).run(otherAssistant, otherOwner, timestamp, timestamp);
  db.prepare(`
    INSERT INTO conversations(
      conversation_id,user_id,subject_id,title,status,created_at,updated_at,last_activity_at
    ) VALUES (?,?,?,'Preserved conversation','active',?,?,?)
  `).run(otherConversation, otherOwner, otherAssistant, timestamp, timestamp, timestamp);
  db.prepare(`
    INSERT INTO standalone_chat_default_conversations(
      user_id,assistant_id,conversation_id,created_at
    ) VALUES (?,?,?,?)
  `).run(otherOwner, otherAssistant, otherConversation, timestamp);

  const deletion = await f.secured('/deletions', 'POST', {}, 'delete-complete-r1-ledger-0001');
  assert.equal(deletion.deletion.status, 'waiting');
  now += 7 * day;
  const completed = f.app.personalDeletionService.sweep();
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, 'completed');
  for (const table of [
    'standalone_chat_default_conversations',
    'standalone_chat_turns',
    'standalone_chat_model_executions',
    'standalone_chat_budget_approvals',
    'standalone_chat_provider_attempts',
    'standalone_chat_usage_facts',
    'standalone_chat_provider_results',
    'standalone_chat_recovery_actions',
  ]) {
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id=?`).get(f.ownerId).n, 0, table);
  }
  assert.deepEqual({ ...db.prepare(`
    SELECT user_id AS userId,assistant_id AS assistantId,conversation_id AS conversationId
    FROM standalone_chat_default_conversations WHERE user_id=?
  `).get(otherOwner) }, {
    userId: otherOwner,
    assistantId: otherAssistant,
    conversationId: otherConversation,
  });
  assert.equal(db.prepare('SELECT status FROM users WHERE user_id=?').get(otherOwner).status, 'active');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
