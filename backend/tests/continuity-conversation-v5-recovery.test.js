import assert from 'node:assert/strict';
import test from 'node:test';

import { ContinuityTransportError } from '../src/integrations/continuity-engine/http-continuity-integration-transport.js';
import {
  configureV4Execution,
  createV4Application,
  createEngineTransportDouble,
} from '../test-support/continuity-capability-v4-fixtures.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

const SCOPE = ['user-001', 'assistant-001', 'conversation-001'];

function providerSequence(statuses, counter) {
  return {
    async execute() {
      counter.calls += 1;
      const status = statuses.shift() ?? 'SUCCEEDED';
      const startedAt = '2026-08-10T00:00:03Z';
      const completedAt = '2026-08-10T00:00:04Z';
      if (status === 'SUCCEEDED') {
        return {
          status,
          output: { responseCandidate: 'Provider candidate.', finishReason: 'stop' },
          usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
          errorCode: null,
          requestMayHaveBeenSent: true,
          startedAt,
          completedAt,
          cost: { status: 'not_reported', amountMicros: null, currency: null },
        };
      }
      return {
        status,
        output: null,
        usage: null,
        errorCode: status === 'FAILED_RETRYABLE' ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNKNOWN',
        requestMayHaveBeenSent: true,
        startedAt,
        completedAt,
        cost: { status: 'not_reported', amountMicros: null, currency: null },
      };
    },
  };
}

function setup(databasePath, statuses = ['SUCCEEDED'], options = {}) {
  const counter = options.counter ?? { calls: 0 };
  const environment = createV4Application(databasePath, {
    modelExecutor: providerSequence(statuses, counter),
    conversationTurnFaultInjector: options.faultInjector,
  });
  environment.application.fixedLocalChatProfileService.prepare();
  configureV4Execution(environment.application, options.executionOptions);
  return { ...environment, counter };
}

async function createWaitingTurn(application, key = 'turn-recovery-001') {
  return application.continuityConversationTurnService.createTurn(
    ...SCOPE,
    key,
    { content: `content ${key}` },
  );
}

async function approve(application, turn) {
  return application.continuityConversationTurnService.resumeTurn(
    ...SCOPE,
    turn.turn.turnId,
    { confirmationId: turn.turn.confirmation.confirmationId },
  );
}

test('FAILED_RETRYABLE is public waiting_retry and explicit resumption alone recalls Provider', async () => {
  const testDatabase = createTestDatabasePath();
  const environment = setup(testDatabase.databasePath, ['FAILED_RETRYABLE', 'SUCCEEDED']);
  try {
    const created = await createWaitingTurn(environment.application);
    const first = await approve(environment.application, created);
    assert.equal(first.status, 'waiting_retry');
    assert.equal(environment.counter.calls, 1);
    const read = environment.application.continuityConversationTurnService.getTurn(
      ...SCOPE,
      created.turn.turnId,
    );
    assert.equal(read.status, 'waiting_retry');
    assert.equal(environment.counter.calls, 1);
    await assert.rejects(
      () => environment.application.continuityConversationTurnService.resumeTurn(
        ...SCOPE,
        created.turn.turnId,
        {},
      ),
      /retryApproved/,
    );
    assert.equal(environment.counter.calls, 1);
    const retryPreflight = await environment.application.continuityConversationTurnService.resumeTurn(
      ...SCOPE,
      created.turn.turnId,
      { retryApproved: true },
    );
    assert.equal(retryPreflight.status, 'confirmation_required');
    assert.equal(environment.counter.calls, 1);
    const completed = await environment.application.continuityConversationTurnService.resumeTurn(
      ...SCOPE,
      created.turn.turnId,
      { confirmationId: retryPreflight.confirmation.confirmationId },
    );
    assert.equal(completed.status, 'completed');
    assert.equal(environment.counter.calls, 2);
    assert.equal(environment.application.database.connection.prepare(
      'SELECT COUNT(*) count FROM continuity_capability_model_executions',
    ).get().count, 2);
    assert.equal(environment.application.database.connection.prepare(
      'SELECT COUNT(*) count FROM continuity_capability_results',
    ).get().count, 2);
    assert.equal(environment.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='subject'",
    ).get().count, 1);
  } finally {
    await environment.application.stop();
    testDatabase.remove();
  }
});

test('UNKNOWN stays outcome_unknown across public resume and restart without another Provider call', async () => {
  const testDatabase = createTestDatabasePath();
  const counter = { calls: 0 };
  const first = setup(testDatabase.databasePath, ['UNKNOWN'], { counter });
  let turnId;
  try {
    const created = await createWaitingTurn(first.application, 'turn-unknown-001');
    turnId = created.turn.turnId;
    const unknown = await approve(first.application, created);
    assert.equal(unknown.status, 'outcome_unknown');
    assert.equal(counter.calls, 1);
    const resumed = await first.application.continuityConversationTurnService.resumeTurn(
      ...SCOPE,
      turnId,
      {},
    );
    assert.equal(resumed.status, 'outcome_unknown');
    assert.equal(counter.calls, 1);
  } finally {
    await first.application.stop();
  }

  const second = createV4Application(testDatabase.databasePath, {
    modelExecutor: providerSequence(['SUCCEEDED'], counter),
  });
  try {
    await second.application.continuityCapabilityService.initialize();
    await second.application.continuityDeliveryService.initialize();
    await second.application.continuityConversationTurnService.initialize();
    const recovered = second.application.continuityConversationTurnService.getTurn(
      ...SCOPE,
      turnId,
    );
    assert.equal(recovered.status, 'outcome_unknown');
    assert.equal(counter.calls, 1);
  } finally {
    await second.application.stop();
    testDatabase.remove();
  }
});

test('lost Engine callback response recovers query-first without a second Provider call', async () => {
  const testDatabase = createTestDatabasePath();
  const counter = { calls: 0 };
  const base = createEngineTransportDouble();
  let loseFirst = true;
  const transport = {
    ...base,
    async submitCapabilityResult(body) {
      if (loseFirst) {
        loseFirst = false;
        base.state.resultPosts += 1;
        base.state.capabilityResult = JSON.parse(body.toString('utf8'));
        throw new ContinuityTransportError('lost callback response', {
          transportCode: 'response_timeout',
          outcomeUnknown: true,
        });
      }
      return base.submitCapabilityResult(body);
    },
  };
  const environment = createV4Application(testDatabase.databasePath, {
    transport,
    modelExecutor: providerSequence(['SUCCEEDED'], counter),
  });
  environment.application.fixedLocalChatProfileService.prepare();
  configureV4Execution(environment.application);
  try {
    const created = await createWaitingTurn(environment.application, 'turn-callback-lost-001');
    const unknown = await approve(environment.application, created);
    assert.equal(unknown.status, 'outcome_unknown');
    assert.equal(counter.calls, 1);
    const completed = await environment.application.continuityConversationTurnService.resumeTurn(
      ...SCOPE,
      created.turn.turnId,
      {},
    );
    assert.equal(completed.status, 'completed');
    assert.equal(counter.calls, 1);
    assert.equal(base.state.queries, 1);
    assert.equal(environment.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='subject'",
    ).get().count, 1);
  } finally {
    await environment.application.stop();
    testDatabase.remove();
  }
});

test('V2 completed before subject Message is recovered locally without another Provider call', async () => {
  const testDatabase = createTestDatabasePath();
  const counter = { calls: 0 };
  let fail = true;
  const first = setup(testDatabase.databasePath, ['SUCCEEDED'], {
    counter,
    faultInjector(stage) {
      if (fail && stage === 'before_subject_message_saved') {
        fail = false;
        throw new Error('simulated-vio-process-exit-before-subject-message');
      }
    },
  });
  let turnId;
  try {
    const created = await createWaitingTurn(first.application, 'turn-before-reply-crash-001');
    turnId = created.turn.turnId;
    await assert.rejects(() => approve(first.application, created), /before-subject-message/);
    assert.equal(first.application.database.connection.prepare(
      'SELECT COUNT(*) count FROM continuity_first_round_results',
    ).get().count, 1);
    assert.equal(first.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='subject'",
    ).get().count, 0);
  } finally {
    await first.application.stop();
  }

  const second = createV4Application(testDatabase.databasePath, {
    modelExecutor: providerSequence(['SUCCEEDED'], counter),
  });
  try {
    await second.application.continuityCapabilityService.initialize();
    await second.application.continuityDeliveryService.initialize();
    await second.application.continuityConversationTurnService.initialize();
    const completed = second.application.continuityConversationTurnService.getTurn(
      ...SCOPE,
      turnId,
    );
    assert.equal(completed.status, 'completed');
    assert.equal(counter.calls, 1);
    assert.equal(second.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='subject'",
    ).get().count, 1);
  } finally {
    await second.application.stop();
    testDatabase.remove();
  }
});

test('restart completes a turn after the Engine reply was saved but before turn completion', async () => {
  const testDatabase = createTestDatabasePath();
  const counter = { calls: 0 };
  let fail = true;
  const first = setup(testDatabase.databasePath, ['SUCCEEDED'], {
    counter,
    faultInjector(stage) {
      if (fail && stage === 'after_subject_message_saved') {
        fail = false;
        throw new Error('simulated-vio-process-exit-after-subject-message');
      }
    },
  });
  let turnId;
  try {
    const created = await createWaitingTurn(first.application, 'turn-publish-crash-001');
    turnId = created.turn.turnId;
    await assert.rejects(() => approve(first.application, created), /simulated-vio-process-exit/);
    assert.equal(first.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='subject'",
    ).get().count, 1);
    assert.equal(first.application.database.connection.prepare(
      'SELECT status FROM continuity_conversation_turns WHERE turn_id=?',
    ).get(turnId).status, 'publishing');
  } finally {
    await first.application.stop();
  }

  const second = createV4Application(testDatabase.databasePath, {
    modelExecutor: providerSequence(['SUCCEEDED'], counter),
  });
  try {
    await second.application.continuityCapabilityService.initialize();
    await second.application.continuityDeliveryService.initialize();
    const recovery = await second.application.continuityConversationTurnService.initialize();
    assert.equal(recovery.reconciled, 1);
    const completed = second.application.continuityConversationTurnService.getTurn(
      ...SCOPE,
      turnId,
    );
    assert.equal(completed.status, 'completed');
    assert.equal(counter.calls, 1);
    assert.equal(second.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='subject'",
    ).get().count, 1);
  } finally {
    await second.application.stop();
    testDatabase.remove();
  }
});

test('restart recovers the durable user-message turn before V1 request creation without duplication', async () => {
  const testDatabase = createTestDatabasePath();
  let fail = true;
  const first = setup(testDatabase.databasePath, ['SUCCEEDED'], {
    faultInjector(stage) {
      if (fail && stage === 'after_turn_created') {
        fail = false;
        throw new Error('simulated-vio-process-exit-before-v1');
      }
    },
  });
  let turnId;
  try {
    await assert.rejects(
      () => createWaitingTurn(first.application, 'turn-before-v1-crash-001'),
      /simulated-vio-process-exit-before-v1/,
    );
    const row = first.application.database.connection.prepare(
      'SELECT turn_id, request_id FROM continuity_conversation_turns',
    ).get();
    turnId = row.turn_id;
    assert.equal(row.request_id, null);
    assert.equal(first.application.database.connection.prepare(
      'SELECT COUNT(*) count FROM continuity_first_round_requests',
    ).get().count, 0);
  } finally {
    await first.application.stop();
  }

  const second = createV4Application(testDatabase.databasePath, {
    modelExecutor: providerSequence(['SUCCEEDED'], { calls: 0 }),
  });
  try {
    await second.application.continuityConversationTurnService.initialize();
    const beforeReplay = second.application.database.connection.prepare(
      'SELECT request_id FROM continuity_conversation_turns WHERE turn_id=?',
    ).get(turnId);
    assert.equal(beforeReplay.request_id, null);
    assert.equal(second.transport.state.posts, 0);
    const recovered = await second.application.continuityConversationTurnService.createTurn(
      ...SCOPE,
      'turn-before-v1-crash-001',
      { content: 'content turn-before-v1-crash-001' },
    );
    assert.equal(recovered.created, false);
    assert.equal(recovered.turn.turnId, turnId);
    assert.equal(recovered.turn.status, 'confirmation_required');
    assert.equal(second.application.database.connection.prepare(
      'SELECT COUNT(*) count FROM continuity_first_round_requests',
    ).get().count, 1);
    assert.equal(second.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='user'",
    ).get().count, 1);
    assert.equal(second.transport.state.posts, 1);
  } finally {
    await second.application.stop();
    testDatabase.remove();
  }
});

test('restart after V1 persistence resumes the original request without a second user message', async () => {
  const testDatabase = createTestDatabasePath();
  let fail = true;
  const first = setup(testDatabase.databasePath, ['SUCCEEDED'], {
    faultInjector(stage) {
      if (fail && stage === 'after_request_saved') {
        fail = false;
        throw new Error('simulated-vio-process-exit-after-v1');
      }
    },
  });
  let turnId;
  let requestId;
  try {
    await assert.rejects(
      () => createWaitingTurn(first.application, 'turn-after-v1-crash-001'),
      /simulated-vio-process-exit-after-v1/,
    );
    const row = first.application.database.connection.prepare(
      'SELECT turn_id, request_id FROM continuity_conversation_turns',
    ).get();
    turnId = row.turn_id;
    requestId = row.request_id;
    assert.ok(requestId);
  } finally {
    await first.application.stop();
  }

  const second = createV4Application(testDatabase.databasePath, {
    modelExecutor: providerSequence(['SUCCEEDED'], { calls: 0 }),
  });
  try {
    await second.application.continuityCapabilityService.initialize();
    await second.application.continuityDeliveryService.initialize();
    await second.application.continuityConversationTurnService.initialize();
    const beforeReplay = second.application.continuityConversationTurnService.getTurn(
      ...SCOPE,
      turnId,
    );
    assert.equal(beforeReplay.status, 'processing');
    assert.equal(second.transport.state.posts, 0);
    const recovered = await second.application.continuityConversationTurnService.createTurn(
      ...SCOPE,
      'turn-after-v1-crash-001',
      { content: 'content turn-after-v1-crash-001' },
    );
    assert.equal(recovered.created, false);
    assert.equal(recovered.turn.turnId, turnId);
    assert.equal(recovered.turn.status, 'confirmation_required');
    assert.equal(second.application.database.connection.prepare(
      'SELECT request_id FROM continuity_conversation_turns WHERE turn_id=?',
    ).get(turnId).request_id, requestId);
    assert.equal(second.application.database.connection.prepare(
      'SELECT COUNT(*) count FROM continuity_first_round_requests',
    ).get().count, 1);
    assert.equal(second.application.database.connection.prepare(
      "SELECT COUNT(*) count FROM messages WHERE sender_type='user'",
    ).get().count, 1);
    assert.equal(second.transport.state.posts, 1);
  } finally {
    await second.application.stop();
    testDatabase.remove();
  }
});

test('budget defer and budget confirmation are distinct public states and never call Provider early', async () => {
  for (const [policy, expected] of [
    ['defer', 'waiting_budget'],
    ['require_confirmation', 'budget_confirmation_required'],
  ]) {
    const testDatabase = createTestDatabasePath();
    const counter = { calls: 0 };
    const environment = createV4Application(testDatabase.databasePath, {
      modelExecutor: providerSequence(['SUCCEEDED'], counter),
    });
    try {
      environment.application.fixedLocalChatProfileService.prepare();
      configureV4Execution(environment.application, {
        dailyTokenLimit: 10,
        sessionTokenLimit: 10,
        overagePolicy: policy,
      });
      if (policy === 'require_confirmation') {
        const budget = environment.application.proactiveInteractionService.getTokenBudget(
          'user-001',
          'assistant-001',
        );
        environment.application.permissionService.createPermission('user-001', {
          subjectId: 'assistant-001', resourceType: 'proactive_interaction',
          resourceId: budget.tokenBudgetId, action: 'execute',
          permissionLevel: 'always_allow', status: 'active',
        });
      }
      const created = await createWaitingTurn(
        environment.application,
        `turn-budget-${policy}-001`,
      );
      const publicState = await approve(environment.application, created);
      assert.equal(publicState.status, expected);
      assert.equal(counter.calls, 0);
      if (policy === 'require_confirmation') assert.ok(publicState.confirmation?.confirmationId);
    } finally {
      await environment.application.stop();
      testDatabase.remove();
    }
  }
});

test('permission deny and budget block fail closed without Provider or subject Message', async () => {
  for (const [label, executionOptions] of [
    ['permission-deny', { executePermission: 'denied' }],
    ['budget-block', { dailyTokenLimit: 10, sessionTokenLimit: 10, overagePolicy: 'block' }],
  ]) {
    const testDatabase = createTestDatabasePath();
    const counter = { calls: 0 };
    const environment = setup(testDatabase.databasePath, ['SUCCEEDED'], {
      counter,
      executionOptions,
    });
    try {
      const created = await createWaitingTurn(environment.application, `turn-${label}-001`);
      const result = created.turn.status === 'confirmation_required'
        ? await approve(environment.application, created)
        : created.turn;
      assert.equal(result.status, 'failed');
      assert.equal(counter.calls, 0);
      assert.equal(environment.application.database.connection.prepare(
        "SELECT COUNT(*) count FROM messages WHERE sender_type='subject'",
      ).get().count, 0);
    } finally {
      await environment.application.stop();
      testDatabase.remove();
    }
  }
});

test('terminal, cancelled and expired Capability results never create a subject Message', async () => {
  for (const status of ['FAILED_TERMINAL', 'CANCELLED', 'EXPIRED']) {
    const testDatabase = createTestDatabasePath();
    const counter = { calls: 0 };
    const environment = setup(testDatabase.databasePath, [status], { counter });
    try {
      const created = await createWaitingTurn(
        environment.application,
        `turn-${status.toLowerCase()}-001`,
      );
      const failed = await approve(environment.application, created);
      assert.equal(failed.status, 'failed');
      assert.equal(counter.calls, 1);
      assert.equal(environment.application.database.connection.prepare(
        "SELECT COUNT(*) count FROM messages WHERE sender_type='subject'",
      ).get().count, 0);
    } finally {
      await environment.application.stop();
      testDatabase.remove();
    }
  }
});
