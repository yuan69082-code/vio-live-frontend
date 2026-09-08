import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveAndResumeTurn,
  createStandaloneChatFixture,
  responseTurn,
} from '../test-support/standalone-chat-r1-fixtures.js';
import { createStructuredContextSummary } from '../src/modules/contexts/context-assembly-service.js';

async function createConversation(fixture, title, key) {
  const response = await fixture.call('/chat/conversations', 'POST', { title }, {
    'idempotency-key': key,
  });
  assert.equal(response.status, 201, JSON.stringify(response));
  return response.data.conversation;
}

async function submitTurn(fixture, conversation, content, key) {
  return fixture.call(`/chat/conversations/${conversation.conversationId}/turns`, 'POST', {
    branchId: conversation.currentBranchId,
    content,
    attachmentIds: [],
  }, { 'idempotency-key': key });
}

async function completeTurn(fixture, conversation, content, key) {
  const response = await submitTurn(fixture, conversation, content, key);
  assert.equal(response.status, 200, JSON.stringify(response));
  const completed = await approveAndResumeTurn(fixture, response, key);
  assert.equal(completed.turn.status, 'completed', JSON.stringify(completed.response));
  return completed.turn;
}

test('R4 folds long history into one immutable structured summary with exact sources', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: Array.from({ length: 6 }, (_, index) => ({
      type: 'success',
      content: `Controlled long-history answer ${index + 1}.`,
    })),
  });
  const conversation = await createConversation(fixture, 'R4 long history',
    'r4-fold-conversation');
  let finalTurn;
  for (let index = 0; index < 6; index += 1) {
    finalTurn = await completeTurn(fixture, conversation,
      `Decision ${index + 1}: keep task ${index + 1}; unresolved item?`,
      `r4-fold-turn-${index + 1}-0001`);
  }
  assert.equal(finalTurn.context.folding.status, 'ready');
  assert.equal(typeof finalTurn.context.folding.summaryId, 'string');
  const summarySource = finalTurn.context.sources.find((item) => item.sourceType === 'summary');
  assert.ok(summarySource, JSON.stringify(finalTurn.context));
  assert.equal(finalTurn.context.sources.some((item) => item.status === 'summarized'), true);
  const evidence = await fixture.call(
    `/chat/context-sources/${encodeURIComponent(summarySource.sourceRef)}`,
  );
  assert.equal(evidence.status, 200, JSON.stringify(evidence));
  assert.equal(evidence.data.sourceType, 'summary');
  assert.equal(evidence.data.structuredSummary.schemaVersion, 'vio-context-summary/v1');
  assert.equal(evidence.data.sourceRefs.length > 0, true);
  assert.equal(Array.isArray(evidence.data.structuredSummary.decisions), true);
  assert.equal(Array.isArray(evidence.data.structuredSummary.tasks), true);
  assert.equal(Array.isArray(evidence.data.structuredSummary.unresolvedItems), true);
  assert.equal(Array.isArray(evidence.data.structuredSummary.importantRelationships), true);
  assert.equal(evidence.data.structuredSummary.supportingExcerpts.length > 0, true);
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT count(*) AS n FROM personal_context_summaries WHERE status='ready'
  `).get().n, 1);
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT count(*) AS n FROM personal_context_summary_attempts WHERE status='succeeded'
  `).get().n, 1);
  assert.equal(fixture.loopback.requests.length, 6);
});

test('R4 summary failure preserves originals when they fit and restart never rebuilds a locked snapshot', async (t) => {
  let summaryCalls = 0;
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: Array.from({ length: 6 }, (_, index) => ({
      type: 'success', content: `Fallback answer ${index + 1}.`,
    })),
    applicationOptions: {
      contextSummaryBuilder() {
        summaryCalls += 1;
        throw new Error('controlled R4 summary failure');
      },
    },
  });
  const conversation = await createConversation(fixture, 'R4 summary fallback',
    'r4-fallback-conversation');
  let finalTurn;
  for (let index = 0; index < 6; index += 1) {
    finalTurn = await completeTurn(fixture, conversation, `Short source ${index + 1}.`,
      `r4-fallback-turn-${index + 1}`);
  }
  assert.equal(finalTurn.context.folding.status, 'failed_fallback_original');
  assert.equal(finalTurn.context.sources.some((item) => item.status === 'summarized'), false);
  assert.equal(summaryCalls, 1);
  const locked = structuredClone(finalTurn.context);
  await fixture.restart();
  const queried = await fixture.call(`/chat/turns/${finalTurn.turnId}/context`);
  assert.deepEqual(queried.data, locked);
  assert.equal(summaryCalls, 1);
  assert.equal(fixture.loopback.requests.length, 6);
});

test('R4 fold failure is durable and explicit recovery locks one snapshot before one Provider call', async (t) => {
  let failSummary = true;
  let summaryCalls = 0;
  const modelLimit = {
    resolve() {
      return { contextLimitTokens: 9_000, reservedOutputTokens: 4_096,
        source: 'controlled-r4-limit' };
    },
  };
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: Array.from({ length: 6 }, (_, index) => ({
      type: 'success', content: `Recovery answer ${index + 1}.`,
    })),
    applicationOptions: {
      modelContextLimitPort: modelLimit,
      contextSummaryBuilder(sources, options) {
        summaryCalls += 1;
        if (failSummary) throw new Error('controlled first fold failure');
        return createStructuredContextSummary(sources, options);
      },
    },
  });
  const conversation = await createConversation(fixture, 'R4 fold recovery',
    'r4-recovery-conversation');
  for (let index = 0; index < 5; index += 1) {
    await completeTurn(fixture, conversation,
      `Long source ${index + 1}: ${'x'.repeat(700)}`,
      `r4-recovery-history-${index + 1}`);
  }
  const failed = await submitTurn(fixture, conversation,
    `Current instruction must survive: ${'y'.repeat(700)}`,
    'r4-recovery-failed-turn');
  assert.equal(failed.status, 200, JSON.stringify(failed));
  const failedTurn = responseTurn(failed);
  assert.equal(failedTurn.status, 'retryable');
  assert.equal(failedTurn.error.code, 'CONTEXT_FOLDING_FAILED');
  assert.equal(fixture.loopback.requests.length, 5);
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT state FROM personal_context_assemblies WHERE turn_id=?
  `).get(failedTurn.turnId).state, 'fold_failed');
  const failedCandidates = fixture.app.database.connection.prepare(`
    SELECT source_order,source_ref,content_hash,source_json
    FROM personal_context_assembly_sources
    WHERE assembly_id=(SELECT assembly_id FROM personal_context_assemblies WHERE turn_id=?)
      AND source_phase='failed_candidate'
    ORDER BY source_order
  `).all(failedTurn.turnId).map((row) => ({ ...row }));
  assert.equal(failedCandidates.length > 0, true);
  await fixture.restart();
  const stillFailed = await fixture.call(`/chat/turns/${failedTurn.turnId}`);
  assert.equal(responseTurn(stillFailed).status, 'retryable');
  assert.equal(fixture.loopback.requests.length, 5);
  const unlocked = await fixture.call('/vault/unlock', 'POST', {
    passphrase: fixture.passphrase,
  });
  assert.equal(unlocked.status, 200, JSON.stringify(unlocked));

  failSummary = false;
  const recoveredContext = await fixture.call(
    `/chat/turns/${failedTurn.turnId}/context-recovery`,
    'POST',
    { action: 'retry_fold' },
    { 'idempotency-key': 'r4-explicit-fold-recovery' },
  );
  assert.equal(recoveredContext.status, 200, JSON.stringify(recoveredContext));
  assert.equal(recoveredContext.data.context.state, 'locked');
  assert.equal(recoveredContext.data.context.folding.status, 'ready');
  assert.deepEqual(fixture.app.database.connection.prepare(`
    SELECT source_order,source_ref,content_hash,source_json
    FROM personal_context_assembly_sources
    WHERE assembly_id=(SELECT assembly_id FROM personal_context_assemblies WHERE turn_id=?)
      AND source_phase='failed_candidate'
    ORDER BY source_order
  `).all(failedTurn.turnId).map((row) => ({ ...row })), failedCandidates);
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT count(*) AS n FROM personal_context_assembly_sources
    WHERE assembly_id=(SELECT assembly_id FROM personal_context_assemblies WHERE turn_id=?)
      AND source_phase='locked'
  `).get(failedTurn.turnId).n > 0, true);
  const relational = fixture.app.database.connection.prepare(`
    SELECT plan_hash,snapshot_hash,context_limit_tokens,reserved_output_tokens,
      input_budget_tokens,raw_estimated_input_tokens,estimated_input_tokens,
      trimming_applied,trimming_reason,folding_status,summary_id,
      runtime_projection_status,selection_json,provider_messages_hash,created_at,locked_at
    FROM personal_context_assemblies WHERE turn_id=?
  `).get(failedTurn.turnId);
  const recoveredSnapshot = recoveredContext.data.context;
  assert.equal(relational.plan_hash, recoveredSnapshot.planHash);
  assert.equal(relational.snapshot_hash, recoveredSnapshot.snapshotHash);
  assert.equal(relational.context_limit_tokens, recoveredSnapshot.budget.contextLimitTokens);
  assert.equal(relational.reserved_output_tokens, recoveredSnapshot.budget.reservedOutputTokens);
  assert.equal(relational.input_budget_tokens, recoveredSnapshot.budget.inputBudgetTokens);
  assert.equal(relational.raw_estimated_input_tokens,
    recoveredSnapshot.budget.rawEstimatedInputTokens);
  assert.equal(relational.estimated_input_tokens, recoveredSnapshot.budget.estimatedInputTokens);
  assert.equal(Boolean(relational.trimming_applied), recoveredSnapshot.budget.trimmingApplied);
  assert.equal(relational.trimming_reason, recoveredSnapshot.budget.trimmingReason);
  assert.equal(relational.folding_status, recoveredSnapshot.folding.status);
  assert.equal(relational.summary_id, recoveredSnapshot.folding.summaryId);
  assert.equal(relational.runtime_projection_status, recoveredSnapshot.runtimeProjection.status);
  assert.deepEqual(JSON.parse(relational.selection_json), recoveredSnapshot.selection);
  assert.equal(relational.provider_messages_hash, recoveredSnapshot.providerMessagesHash);
  assert.equal(relational.created_at, recoveredSnapshot.createdAt);
  assert.equal(relational.locked_at, recoveredSnapshot.lockedAt);
  let resumed = recoveredContext.data.turn;
  if (resumed.status === 'waiting_confirmation' || resumed.status === 'waiting_budget') {
    const confirmationId = resumed.confirmation.confirmationId;
    assert.equal((await fixture.call(`/confirmations/${confirmationId}/decision`, 'POST', {
      decision: 'approve',
    })).status, 200);
    const response = await fixture.call(`/chat/turns/${failedTurn.turnId}/recovery`, 'POST', {
      action: 'resume', confirmationId,
    }, { 'idempotency-key': 'r4-explicit-fold-provider-resume' });
    assert.equal(response.status, 200, JSON.stringify(response));
    resumed = responseTurn(response);
  }
  assert.equal(resumed.status, 'completed', JSON.stringify(resumed));
  assert.equal(fixture.loopback.requests.length, 6);
  assert.equal(summaryCalls, 2);
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT count(*) AS n FROM personal_context_summary_attempts
  `).get().n, 2);
  assert.deepEqual(fixture.app.database.connection.prepare(`
    SELECT status FROM personal_context_summary_attempts ORDER BY attempt_number
  `).all().map((row) => row.status), ['failed', 'succeeded']);
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT status FROM personal_context_recovery_actions
  `).get().status, 'completed');
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT count(*) AS n FROM standalone_chat_model_executions WHERE turn_id=?
  `).get(failedTurn.turnId).n, 1);
  const replay = await fixture.call(
    `/chat/turns/${failedTurn.turnId}/context-recovery`,
    'POST',
    { action: 'retry_fold' },
    { 'idempotency-key': 'r4-explicit-fold-recovery' },
  );
  assert.deepEqual(replay.data, recoveredContext.data);
  assert.equal(fixture.loopback.requests.length, 6);
});

test('R4 rejects malformed or scope-changing summary builders without a sixth Provider call',
  async (t) => {
    const cases = [
      ['missing required field', (value) => { delete value.sourceRefs; }],
      ['unknown field', (value) => { value.untrusted = true; }],
      ['wrong scope', (value) => { value.scope.conversationId = 'another-conversation'; }],
      ['wrong source references', (value) => { value.sourceRefs[0] = 'message-version:unknown'; }],
      ['attempted source mutation', (_value, sources) => {
        sources[0].source.content = 'mutated by builder';
      }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, async (caseTest) => {
        const fixture = await createStandaloneChatFixture(caseTest, {
          providerResponses: Array.from({ length: 5 }, (_, index) => ({
            type: 'success', content: `Strict builder history ${index + 1}.`,
          })),
          applicationOptions: {
            modelContextLimitPort: {
              resolve() {
                return { contextLimitTokens: 9_000, reservedOutputTokens: 4_096,
                  source: 'controlled-r4-strict-builder-limit' };
              },
            },
            contextSummaryBuilder(sources, options) {
              const value = structuredClone(createStructuredContextSummary(sources, options));
              mutate(value, sources);
              return value;
            },
          },
        });
        const conversation = await createConversation(fixture, `Strict builder ${name}`,
          `r4-strict-builder-conversation-${name.replaceAll(' ', '-')}`);
        for (let index = 0; index < 5; index += 1) {
          await completeTurn(fixture, conversation,
            `Strict builder source ${index + 1}: ${'s'.repeat(700)}`,
            `r4-strict-builder-${name.replaceAll(' ', '-')}-${index + 1}`);
        }
        const failed = await submitTurn(fixture, conversation,
          `Strict builder final: ${'f'.repeat(700)}`,
          `r4-strict-builder-final-${name.replaceAll(' ', '-')}`);
        assert.equal(failed.status, 200, JSON.stringify(failed));
        assert.equal(responseTurn(failed).status, 'retryable');
        assert.equal(responseTurn(failed).error.code, 'CONTEXT_FOLDING_FAILED');
        assert.equal(fixture.loopback.requests.length, 5);
        assert.equal(fixture.app.database.connection.prepare(`
          SELECT count(*) AS n FROM personal_context_summary_attempts WHERE status='failed'
        `).get().n, 1);
      });
    }
  });

test('R4 fold recovery rolls back summary and assembly when locked sources cannot persist',
  async (t) => {
    let failSummary = true;
    const fixture = await createStandaloneChatFixture(t, {
      providerResponses: Array.from({ length: 6 }, (_, index) => ({
        type: 'success', content: `Atomic recovery answer ${index + 1}.`,
      })),
      applicationOptions: {
        modelContextLimitPort: {
          resolve() {
            return { contextLimitTokens: 9_000, reservedOutputTokens: 4_096,
              source: 'controlled-r4-atomic-limit' };
          },
        },
        contextSummaryBuilder(sources, options) {
          if (failSummary) throw new Error('controlled initial fold failure');
          return createStructuredContextSummary(sources, options);
        },
      },
    });
    const conversation = await createConversation(fixture, 'Atomic fold recovery',
      'r4-atomic-recovery-conversation');
    for (let index = 0; index < 5; index += 1) {
      await completeTurn(fixture, conversation,
        `Atomic source ${index + 1}: ${'a'.repeat(700)}`,
        `r4-atomic-recovery-history-${index + 1}`);
    }
    const failed = await submitTurn(fixture, conversation,
      `Atomic final source: ${'b'.repeat(700)}`, 'r4-atomic-recovery-failed-turn');
    const failedTurn = responseTurn(failed);
    assert.equal(failedTurn.status, 'retryable', JSON.stringify(failed));
    const before = fixture.app.database.connection.prepare(`
      SELECT source_order,source_ref,content_hash,source_json
      FROM personal_context_assembly_sources
      WHERE assembly_id=(SELECT assembly_id FROM personal_context_assemblies WHERE turn_id=?)
        AND source_phase='failed_candidate' ORDER BY source_order
    `).all(failedTurn.turnId).map((row) => ({ ...row }));
    fixture.app.database.connection.exec(`
      CREATE TRIGGER controlled_r4_locked_source_failure
      BEFORE INSERT ON personal_context_assembly_sources
      WHEN NEW.source_phase='locked'
      BEGIN SELECT RAISE(ABORT,'controlled locked source failure'); END;
    `);
    failSummary = false;
    const interrupted = await fixture.call(
      `/chat/turns/${failedTurn.turnId}/context-recovery`, 'POST',
      { action: 'retry_fold' }, { 'idempotency-key': 'r4-atomic-recovery-interrupted' },
    );
    assert.equal(interrupted.status, 500, JSON.stringify(interrupted));
    assert.equal(fixture.app.database.connection.prepare(`
      SELECT state FROM personal_context_assemblies WHERE turn_id=?
    `).get(failedTurn.turnId).state, 'fold_failed');
    assert.equal(fixture.app.database.connection.prepare(`
      SELECT count(*) AS n FROM personal_context_assembly_sources
      WHERE assembly_id=(SELECT assembly_id FROM personal_context_assemblies WHERE turn_id=?)
        AND source_phase='locked'
    `).get(failedTurn.turnId).n, 0);
    assert.deepEqual(fixture.app.database.connection.prepare(`
      SELECT source_order,source_ref,content_hash,source_json
      FROM personal_context_assembly_sources
      WHERE assembly_id=(SELECT assembly_id FROM personal_context_assemblies WHERE turn_id=?)
        AND source_phase='failed_candidate' ORDER BY source_order
    `).all(failedTurn.turnId).map((row) => ({ ...row })), before);
    assert.equal(fixture.app.database.connection.prepare(`
      SELECT status FROM personal_context_summaries
      WHERE summary_id=(SELECT summary_id FROM personal_context_assemblies WHERE turn_id=?)
    `).get(failedTurn.turnId).status, 'failed');
    fixture.app.database.connection.exec('DROP TRIGGER controlled_r4_locked_source_failure');

    const recovered = await fixture.call(
      `/chat/turns/${failedTurn.turnId}/context-recovery`, 'POST',
      { action: 'retry_fold' }, { 'idempotency-key': 'r4-atomic-recovery-success' },
    );
    assert.equal(recovered.status, 200, JSON.stringify(recovered));
    assert.equal(recovered.data.context.state, 'locked');
    assert.equal(fixture.app.database.connection.prepare(`
      SELECT count(*) AS n FROM personal_context_assembly_sources
      WHERE assembly_id=(SELECT assembly_id FROM personal_context_assemblies WHERE turn_id=?)
        AND source_phase='locked'
    `).get(failedTurn.turnId).n > 0, true);
    assert.deepEqual(fixture.app.database.connection.prepare(`
      SELECT source_order,source_ref,content_hash,source_json
      FROM personal_context_assembly_sources
      WHERE assembly_id=(SELECT assembly_id FROM personal_context_assemblies WHERE turn_id=?)
        AND source_phase='failed_candidate' ORDER BY source_order
    `).all(failedTurn.turnId).map((row) => ({ ...row })), before);
  });

test('R4 persists one locked snapshot across publication crash and local restart recovery', async (t) => {
  let failPublication = true;
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'success', content: 'One durable R4 result.' }],
    applicationOptions: {
      standaloneChatFaultInjector: {
        afterResultPersisted() {
          if (failPublication) {
            failPublication = false;
            throw new Error('controlled R4 publication crash');
          }
        },
      },
    },
  });
  const conversation = await createConversation(fixture, 'R4 publication recovery',
    'r4-publication-conversation');
  const initial = await submitTurn(fixture, conversation, 'Publish exactly once.',
    'r4-publication-turn');
  const waiting = responseTurn(initial);
  const confirmationId = waiting.confirmation.confirmationId;
  assert.equal((await fixture.call(`/confirmations/${confirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const interrupted = await fixture.call(`/chat/turns/${waiting.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'r4-publication-first-resume' });
  assert.equal(interrupted.status, 500, JSON.stringify(interrupted));
  assert.equal(fixture.loopback.requests.length, 1);
  const beforeRestart = await fixture.call(`/chat/turns/${waiting.turnId}/context`);
  assert.equal(beforeRestart.status, 200, JSON.stringify(beforeRestart));
  const snapshot = structuredClone(beforeRestart.data);
  await fixture.restart();
  const recovered = await fixture.call(`/chat/turns/${waiting.turnId}/recovery`, 'POST', {
    action: 'resume',
  }, { 'idempotency-key': 'r4-publication-local-resume' });
  assert.equal(recovered.status, 200, JSON.stringify(recovered));
  assert.equal(responseTurn(recovered).status, 'completed');
  assert.deepEqual(responseTurn(recovered).context, snapshot);
  assert.equal(fixture.loopback.requests.length, 1);
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT count(*) AS n FROM personal_context_assemblies WHERE turn_id=?
  `).get(waiting.turnId).n, 1);
});

test('R4 outcome_unknown keeps its locked snapshot and never retries the Provider on replay or restart', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'disconnect' }],
  });
  const conversation = await createConversation(fixture, 'R4 unknown outcome',
    'r4-unknown-conversation');
  const initial = await submitTurn(fixture, conversation, 'Do not retry an unknown result.',
    'r4-unknown-turn');
  const waiting = responseTurn(initial);
  const confirmationId = waiting.confirmation.confirmationId;
  assert.equal((await fixture.call(`/confirmations/${confirmationId}/decision`, 'POST', {
    decision: 'approve',
  })).status, 200);
  const unknown = await fixture.call(`/chat/turns/${waiting.turnId}/recovery`, 'POST', {
    action: 'resume', confirmationId,
  }, { 'idempotency-key': 'r4-unknown-resume' });
  assert.equal(unknown.status, 200, JSON.stringify(unknown));
  assert.equal(responseTurn(unknown).status, 'outcome_unknown');
  const snapshot = structuredClone(responseTurn(unknown).context);
  assert.equal(fixture.loopback.requests.length, 1);
  const rejected = await fixture.call(`/chat/turns/${waiting.turnId}/recovery`, 'POST', {
    action: 'retry',
  }, { 'idempotency-key': 'r4-unknown-unsafe-retry' });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.error.code, 'PROVIDER_OUTCOME_UNKNOWN');
  await fixture.restart();
  const queried = await fixture.call(`/chat/turns/${waiting.turnId}`);
  assert.equal(responseTurn(queried).status, 'outcome_unknown');
  assert.deepEqual(responseTurn(queried).context, snapshot);
  assert.equal(fixture.loopback.requests.length, 1);
});
