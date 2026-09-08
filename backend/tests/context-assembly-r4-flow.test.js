import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeJson, sha256Hash } from '../src/core/canonical-json.js';

import {
  approveAndResumeTurn,
  createStandaloneChatFixture,
  responseTurn,
} from '../test-support/standalone-chat-r1-fixtures.js';
import { createNoneSubjectRuntimeAdapter } from '../src/modules/subject-runtime/none-subject-runtime-adapter.js';
import {
  SUBJECT_RUNTIME_PORT_VERSION,
  createSubjectRuntimeConnectionSnapshot,
  negotiateSubjectRuntimeVersion,
} from '../src/modules/subject-runtime/subject-runtime-port-v1.js';

const SLOT_ORDER = [
  'system_rules',
  'assistant_settings',
  'runtime_projection',
  'unresolved_events',
  'recent_original_text',
  'long_term_memory',
  'current_user_message',
];

const PUBLIC_SELECTION_KEYS = [
  'strategy',
  'status',
  'querySource',
  'crossWindowCandidateCount',
  'crossWindowSelectedCount',
];

const canonicalHash = value => sha256Hash(canonicalizeJson(value));

async function createConversation(fixture, title, key) {
  const response = await fixture.call('/chat/conversations', 'POST', { title }, {
    'idempotency-key': key,
  });
  assert.equal(response.status, 201, JSON.stringify(response));
  return response.data.conversation;
}

async function completeTurn(fixture, conversation, content, key, context) {
  const response = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/turns`,
    'POST',
    {
      branchId: conversation.currentBranchId,
      content,
      attachmentIds: [],
      ...(context === undefined ? {} : { context }),
    },
    { 'idempotency-key': key },
  );
  assert.equal(response.status, 200, JSON.stringify(response));
  const completed = await approveAndResumeTurn(fixture, response, key);
  assert.equal(completed.response.status, 200, JSON.stringify(completed.response));
  assert.equal(completed.turn.status, 'completed', JSON.stringify(completed.response));
  return completed.turn;
}

async function saveCrossWindowExclusion(fixture, sourceConversation, targetConversation, key) {
  const plan = await fixture.call(
    `/chat/conversations/${targetConversation.conversationId}/context-plan?mode=custom`,
  );
  assert.equal(plan.status, 200, JSON.stringify(plan));
  const selected = plan.data.sources.find((item) => item.origin === 'cross_window'
    && item.conversationId === sourceConversation.conversationId
    && item.sourceType === 'message_version');
  assert.ok(selected, JSON.stringify(plan));
  const saved = await fixture.call(
    `/chat/conversations/${targetConversation.conversationId}/context-settings`, 'PATCH',
    { mode: 'custom', excludedSourceRefs: [selected.sourceRef], expectedVersion: 0 },
    { 'idempotency-key': key },
  );
  assert.equal(saved.status, 200, JSON.stringify(saved));
  return selected.sourceRef;
}

async function assertUnavailableExclusion(fixture, targetConversation, sourceRef) {
  const settings = await fixture.call(
    `/chat/conversations/${targetConversation.conversationId}/context-settings`,
  );
  assert.equal(settings.status, 200, JSON.stringify(settings));
  assert.deepEqual(settings.data.conversation.excludedSourceRefs, [sourceRef]);
  assert.deepEqual(settings.data.conversation.unavailableExcludedSourceRefs, [sourceRef]);
  assert.deepEqual(settings.data.effective.excludedSourceRefs, []);
  assert.deepEqual(settings.data.effective.unavailableExcludedSourceRefs, [sourceRef]);
  const plan = await fixture.call(
    `/chat/conversations/${targetConversation.conversationId}/context-plan`,
  );
  assert.equal(plan.status, 200, JSON.stringify(plan));
  assert.deepEqual(plan.data.controls.unavailableExcludedSourceRefs, [sourceRef]);
  assert.equal(plan.data.sources.some((item) => item.sourceRef === sourceRef), false);
}

function dynamicRuntimeAdapter(enabled) {
  const none = createNoneSubjectRuntimeAdapter();
  const externalManifest = () => ({
    portVersion: SUBJECT_RUNTIME_PORT_VERSION,
    adapterId: 'r4-isolated-runtime',
    adapterKind: 'third_party',
    adapterVersion: 'r4-test-adapter/v1',
    runtimeMode: 'external',
    runtimeName: 'Isolated projection fixture',
    runtimeVersion: 'r4-test-runtime/v1',
    supportedPortVersions: [SUBJECT_RUNTIME_PORT_VERSION],
    capabilities: ['observation_input', 'expression_result', 'state_projection'],
    specializedContracts: [],
  });
  const current = () => {
    if (!enabled.value) return none;
    const manifest = externalManifest();
    return {
      getManifest: () => structuredClone(manifest),
      getConnectionStatus: () => createSubjectRuntimeConnectionSnapshot({
        manifest,
        state: 'ready',
        reason: 'isolated_projection_ready',
      }),
      negotiateVersion: (versions) => negotiateSubjectRuntimeVersion({
        vioSupportedVersions: versions,
        adapterManifest: manifest,
      }),
      submitObservation() { throw new Error('R4 must not execute an external runtime.'); },
      cancel() { throw new Error('R4 must not execute an external runtime.'); },
      recover() { throw new Error('R4 must not execute an external runtime.'); },
    };
  };
  return {
    getManifest: () => current().getManifest(),
    getConnectionStatus: () => current().getConnectionStatus(),
    negotiateVersion: (versions) => current().negotiateVersion(versions),
    submitObservation() { throw new Error('R4 must not execute an external runtime.'); },
    cancel() { throw new Error('R4 must not execute an external runtime.'); },
    recover() { throw new Error('R4 must not execute an external runtime.'); },
  };
}

test('R4 locks the fixed context order and binds the immutable snapshot to one R1 execution', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'success', content: 'R4 default conversation answer.' }],
  });
  const created = await fixture.call('/chat/turns', 'POST', {
    content: 'Use the deterministic R4 context.',
  }, { 'idempotency-key': 'r4-r1-default-turn-0001' });
  assert.equal(created.status, 200, JSON.stringify(created));
  const completed = await approveAndResumeTurn(fixture, created, 'r4-r1-default-turn-0001');
  const turn = completed.turn;
  assert.equal(turn.status, 'completed', JSON.stringify(completed.response));
  assert.deepEqual(turn.context.slots.map((item) => item.slot), SLOT_ORDER);
  assert.deepEqual(turn.context.memory, {
    status: 'empty', selectionStrategy: 'lexical-overlap-recency/v1',
    eligibleCount: 0, selectedCount: 0,
  });
  assert.deepEqual(Object.keys(turn.context.selection), PUBLIC_SELECTION_KEYS);
  assert.equal(turn.context.state, 'locked');
  assert.match(turn.context.snapshotHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(turn.context.sources.at(-1).slot, 'current_user_message');
  assert.equal(turn.context.sources.at(-1).status, 'included');
  assert.equal(turn.context.sources.at(-1).origin, 'current_turn');
  const execution = fixture.app.database.connection.prepare(`
    SELECT context_snapshot_hash FROM standalone_chat_model_executions WHERE turn_id=?
  `).get(turn.turnId);
  assert.equal(execution.context_snapshot_hash, turn.context.snapshotHash);
  assert.equal(fixture.loopback.requests.length, 1);
  assert.equal(fixture.loopback.requests[0].body.messages.at(-1).content,
    'Use the deterministic R4 context.');

  const queried = await fixture.call(`/chat/turns/${turn.turnId}/context`);
  assert.equal(queried.status, 200, JSON.stringify(queried));
  assert.deepEqual(queried.data, turn.context);
  assert.deepEqual(Object.keys(queried.data.selection), PUBLIC_SELECTION_KEYS);
  const replay = await fixture.call('/chat/turns', 'POST', {
    content: 'Use the deterministic R4 context.',
  }, { 'idempotency-key': 'r4-r1-default-turn-0001' });
  assert.deepEqual(responseTurn(replay).context, turn.context);
  assert.equal(fixture.loopback.requests.length, 1);
  assert.equal(JSON.stringify(turn.context).includes(fixture.ownerId), false);
  assert.equal(JSON.stringify(turn.context).includes(fixture.testCredential), false);
});

test('R4 context settings, preview, custom exclusions and exact evidence are scoped and side-effect free', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'success', content: 'Source conversation answer.' }],
  });
  const sourceConversation = await createConversation(
    fixture,
    'R4 source conversation',
    'r4-source-conversation-create',
  );
  const sourceTurn = await completeTurn(
    fixture,
    sourceConversation,
    'Exact source content for R4 evidence.',
    'r4-source-turn-0001',
  );
  const target = await createConversation(
    fixture,
    'R4 target conversation',
    'r4-target-conversation-create',
  );
  const beforeCalls = fixture.loopback.requests.length;
  const initialSettings = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-settings`,
  );
  assert.equal(initialSettings.status, 200, JSON.stringify(initialSettings));
  assert.equal(initialSettings.data.conversation, null);
  assert.equal(initialSettings.data.effective.mode, 'balanced');
  const saved = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-settings`,
    'PATCH',
    { mode: 'custom', excludedSourceRefs: [], expectedVersion: 0 },
    { 'idempotency-key': 'r4-context-settings-save' },
  );
  assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal(saved.data.conversation.version, 1);
  const replay = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-settings`,
    'PATCH',
    { mode: 'custom', excludedSourceRefs: [], expectedVersion: 0 },
    { 'idempotency-key': 'r4-context-settings-save' },
  );
  assert.deepEqual(replay.data, saved.data);
  const plan = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-plan?branchId=${target.currentBranchId}&mode=balanced`,
  );
  assert.equal(plan.status, 200, JSON.stringify(plan));
  assert.equal(plan.data.state, 'planned');
  assert.deepEqual(plan.data.slots.map((item) => item.slot), SLOT_ORDER);
  assert.equal(plan.data.slots.at(-1).status, 'pending');
  const crossSource = plan.data.sources.find((item) => item.origin === 'cross_window'
    && item.messageVersionId === sourceTurn.userMessage.messageVersionId);
  assert.ok(crossSource, JSON.stringify(plan));
  const custom = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-plan?branchId=${target.currentBranchId}`
      + `&mode=custom&excludeSourceRef=${encodeURIComponent(crossSource.sourceRef)}`,
  );
  assert.equal(custom.status, 200, JSON.stringify(custom));
  assert.equal(custom.data.sources.find((item) => item.sourceRef === crossSource.sourceRef).status,
    'excluded');
  assert.equal(fixture.loopback.requests.length, beforeCalls);

  const locked = await completeTurn(fixture, target, 'Lock evidence now.',
    'r4-target-turn-0001', { mode: 'balanced', excludedSourceRefs: [] });
  const lockedSource = locked.context.sources.find((item) =>
    item.messageVersionId === sourceTurn.userMessage.messageVersionId);
  assert.ok(lockedSource, JSON.stringify(locked.context));
  const evidence = await fixture.call(
    `/chat/context-sources/${encodeURIComponent(lockedSource.sourceRef)}`,
  );
  assert.equal(evidence.status, 200, JSON.stringify(evidence));
  assert.equal(evidence.data.content, 'Exact source content for R4 evidence.');
  assert.equal(evidence.data.messageVersionId, sourceTurn.userMessage.messageVersionId);
  assert.equal(evidence.data.externalCall, 'not_performed');
});

test('R4 cross-window assembly excludes denied sources and never crosses assistant scope', async (t) => {
  let deniedConversationId = null;
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'success', content: 'Scoped source answer.' }],
    applicationOptions: {
      contextSourceAccessPort: {
        canRead(value) { return value.conversationId !== deniedConversationId; },
      },
    },
  });
  const sourceConversation = await createConversation(
    fixture, 'Permission source', 'r4-permission-source-create',
  );
  await completeTurn(fixture, sourceConversation, 'Permission scoped fact.',
    'r4-permission-source-turn');
  const target = await createConversation(fixture, 'Permission target',
    'r4-permission-target-create');
  let plan = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-plan?mode=balanced`,
  );
  assert.equal(plan.status, 200, JSON.stringify(plan));
  assert.equal(plan.data.sources.some((item) =>
    item.origin === 'cross_window' && item.conversationId === sourceConversation.conversationId), true);
  deniedConversationId = sourceConversation.conversationId;
  plan = await fixture.call(`/chat/conversations/${target.conversationId}/context-plan?mode=balanced`);
  assert.equal(plan.status, 200, JSON.stringify(plan));
  assert.equal(plan.data.sources.some((item) =>
    item.conversationId === sourceConversation.conversationId), false);

  const locked = await completeTurn(fixture, target, 'Build after permission revocation.',
    'r4-permission-revoked-turn');
  assert.equal(locked.context.sources.some((item) =>
    item.conversationId === sourceConversation.conversationId), false);
  assert.equal(fixture.loopback.requests.at(-1).body.messages.some((item) =>
    item.content.includes('Permission scoped fact.')), false);

  await fixture.selectAssistant(fixture.secondAssistantId);
  const other = await createConversation(fixture, 'Other assistant target',
    'r4-other-assistant-create');
  const otherPlan = await fixture.call(
    `/chat/conversations/${other.conversationId}/context-plan?mode=complete`,
  );
  assert.equal(otherPlan.status, 200, JSON.stringify(otherPlan));
  assert.equal(otherPlan.data.sources.some((item) =>
    item.conversationId === sourceConversation.conversationId), false);
});

test('R4 final cross-window selection ranks relevance before recency and reports its basis', async (t) => {
  const fixture = await createStandaloneChatFixture(t);
  const relevant = await createConversation(fixture, 'Older relevant source',
    'r4-relevance-source-create');
  await completeTurn(fixture, relevant,
    'Project Zephyr orbital calibration uses the cobalt checklist.',
    'r4-relevance-source-turn');
  const irrelevant = [];
  for (let index = 0; index < 3; index += 1) {
    const item = await createConversation(fixture, `New unrelated ${index}`,
      `r4-unrelated-source-${index}`);
    await completeTurn(fixture, item, `Recipe garden weather note ${index}.`,
      `r4-unrelated-turn-${index}`);
    irrelevant.push(item);
  }
  const target = await createConversation(fixture, 'Relevance target',
    'r4-relevance-target-create');
  const completed = await completeTurn(fixture, target,
    'What does the Project Zephyr orbital calibration require?',
    'r4-relevance-target-turn');
  const cross = completed.context.sources.filter((item) => item.origin === 'cross_window');
  assert.equal(completed.context.selection.status, 'final');
  assert.equal(completed.context.selection.querySource, 'current_user_message');
  assert.equal(cross.some((item) => item.conversationId === relevant.conversationId), true,
    JSON.stringify(completed.context));
  const selected = cross.find((item) => item.conversationId === relevant.conversationId);
  assert.equal(selected.evidence.selection.strategy, 'lexical-overlap-recency/v1');
  assert.equal(selected.evidence.selection.relevanceScore > 0, true);
  assert.equal(new Set(cross.map((item) => item.conversationId)).size <= 3, true);
  assert.equal(irrelevant.length, 3);
});

test('R4 cross-window selection prefers the latest eligible ready summary and proves exact hashes', async (t) => {
  const fixture = await createStandaloneChatFixture(t);
  const summarized = await createConversation(fixture, 'Summarized source',
    'r4-summary-source-create');
  for (let index = 0; index < 6; index += 1) {
    await completeTurn(fixture, summarized,
      `Zephyr decision ${index}: preserve exact summary evidence and task ${index}.`,
      `r4-summary-source-turn-${index}`);
  }
  const raw = await createConversation(fixture, 'Raw fallback source',
    'r4-raw-source-create');
  await completeTurn(fixture, raw, 'Zephyr raw fallback remains available.',
    'r4-raw-source-turn');
  const target = await createConversation(fixture, 'Summary target',
    'r4-summary-target-create');
  const completed = await completeTurn(fixture, target, 'Review the Zephyr evidence.',
    'r4-summary-target-turn');
  const summary = completed.context.sources.find((item) => item.sourceType === 'summary'
    && item.origin === 'cross_window' && item.conversationId === summarized.conversationId);
  assert.ok(summary, JSON.stringify(completed.context));
  assert.equal(summary.evidence.selection.representation, 'latest_ready_summary');
  assert.equal(completed.context.sources.some((item) => item.origin === 'cross_window'
    && item.sourceType === 'message_version'
    && item.conversationId === summarized.conversationId), false);
  assert.equal(completed.context.sources.some((item) => item.origin === 'cross_window'
    && item.sourceType === 'message_version' && item.conversationId === raw.conversationId), true);
  const evidence = await fixture.call(
    `/chat/context-sources/${encodeURIComponent(summary.sourceRef)}`,
  );
  assert.equal(evidence.status, 200, JSON.stringify(evidence));
  assert.equal(canonicalHash(evidence.data.structuredSummary), evidence.data.contentHash);
  assert.equal(summary.contentHash, evidence.data.contentHash);
  assert.deepEqual(evidence.data.sourceHashes.map((item) => item.sourceRef),
    evidence.data.sourceRefs);
  assert.deepEqual(evidence.data.structuredSummary.sourceRefs, evidence.data.sourceRefs);
  const stored = fixture.app.database.connection.prepare(`
    SELECT provider_messages_json,provider_messages_hash,snapshot_json,snapshot_hash
    FROM personal_context_assemblies WHERE turn_id=?
  `).get(completed.turnId);
  assert.equal(canonicalHash(JSON.parse(stored.provider_messages_json)),
    stored.provider_messages_hash);
  assert.equal(JSON.parse(stored.snapshot_json).providerMessagesHash,
    stored.provider_messages_hash);
  assert.equal(canonicalHash({ ...JSON.parse(stored.snapshot_json), snapshotHash: null }),
    stored.snapshot_hash);
});

test('R4 stale saved exclusions are auditable but ignored after source visibility is revoked', async (t) => {
  const fixture = await createStandaloneChatFixture(t);
  const sourceConversation = await createConversation(fixture, 'Stale exclusion source',
    'r4-stale-exclusion-source-create');
  await completeTurn(fixture, sourceConversation, 'Hidden source must never reach a new turn.',
    'r4-stale-exclusion-source-turn');
  const target = await createConversation(fixture, 'Stale exclusion target',
    'r4-stale-exclusion-target-create');
  const plan = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-plan?mode=custom`,
  );
  const ref = plan.data.sources.find((item) => item.origin === 'cross_window'
    && item.conversationId === sourceConversation.conversationId
    && item.sourceType === 'message_version').sourceRef;
  const auditConversation = await createConversation(fixture, 'Locked evidence audit',
    'r4-stale-exclusion-audit-create');
  const audited = await completeTurn(fixture, auditConversation,
    'Hidden source must stay relevant for this audit lock.',
    'r4-stale-exclusion-audit-turn');
  assert.ok(audited.context.sources.some((item) => item.sourceRef === ref
    && item.status === 'included'));
  const readableBeforeHide = await fixture.call(
    `/chat/context-sources/${encodeURIComponent(ref)}`,
  );
  assert.equal(readableBeforeHide.status, 200, JSON.stringify(readableBeforeHide));
  const saved = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-settings`, 'PATCH',
    { mode: 'custom', excludedSourceRefs: [ref], expectedVersion: 0 },
    { 'idempotency-key': 'r4-save-stale-exclusion' },
  );
  assert.equal(saved.status, 200, JSON.stringify(saved));

  const sourceView = await fixture.call(`/chat/conversations/${sourceConversation.conversationId}`);
  const sourceMessage = sourceView.data.messages.find((item) =>
    `message-version:${item.messageVersionId}` === ref);
  const hidden = await fixture.call(
    `/chat/conversations/${sourceConversation.conversationId}/messages/${sourceMessage.messageId}/deletion`,
    'POST', { branchId: sourceView.data.branch.branchId,
      expectedBranchVersion: sourceView.data.branch.version },
    { 'idempotency-key': 'r4-hide-stale-exclusion-source' },
  );
  assert.equal(hidden.status, 200, JSON.stringify(hidden));
  const unreadableAfterHide = await fixture.call(
    `/chat/context-sources/${encodeURIComponent(ref)}`,
  );
  assert.equal(unreadableAfterHide.status, 404, JSON.stringify(unreadableAfterHide));
  assert.equal(unreadableAfterHide.error.code, 'CONTEXT_SOURCE_NOT_FOUND');
  const settings = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-settings`,
  );
  assert.deepEqual(settings.data.conversation.excludedSourceRefs, [ref]);
  assert.deepEqual(settings.data.conversation.unavailableExcludedSourceRefs, [ref]);
  assert.deepEqual(settings.data.effective.excludedSourceRefs, []);
  assert.deepEqual(settings.data.effective.unavailableExcludedSourceRefs, [ref]);
  const refreshed = await fixture.call(
    `/chat/conversations/${target.conversationId}/context-plan`,
  );
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed));
  assert.deepEqual(refreshed.data.controls.unavailableExcludedSourceRefs, [ref]);
  const completed = await completeTurn(fixture, target, 'Continue despite stale saved exclusion.',
    'r4-stale-exclusion-target-turn');
  assert.deepEqual(completed.context.controls.unavailableExcludedSourceRefs, [ref]);
  assert.equal(fixture.loopback.requests.at(-1).body.messages.some((item) =>
    item.content.includes('Hidden source must never reach')), false);
});

test('R4 reconciles saved exclusions after clear, delete, branch change and access revocation',
  async (t) => {
    const denied = new Set();
    const fixture = await createStandaloneChatFixture(t, {
      applicationOptions: {
        contextSourceAccessPort: {
          canRead(value) { return !denied.has(value.conversationId); },
        },
      },
    });

    const clearSource = await createConversation(fixture, 'Clear source',
      'r4-stale-clear-source');
    await completeTurn(fixture, clearSource, 'Clear-scoped original.',
      'r4-stale-clear-source-turn');
    const clearTarget = await createConversation(fixture, 'Clear target',
      'r4-stale-clear-target');
    const clearRef = await saveCrossWindowExclusion(fixture, clearSource, clearTarget,
      'r4-stale-clear-save');
    const clearView = await fixture.call(`/chat/conversations/${clearSource.conversationId}`);
    const cleared = await fixture.call(`/chat/conversations/${clearSource.conversationId}/clear`,
      'POST', { branchId: clearView.data.branch.branchId,
        expectedBranchVersion: clearView.data.branch.version },
      { 'idempotency-key': 'r4-stale-clear-action' });
    assert.equal(cleared.status, 200, JSON.stringify(cleared));
    await assertUnavailableExclusion(fixture, clearTarget, clearRef);

    const deleteSource = await createConversation(fixture, 'Delete source',
      'r4-stale-delete-source');
    await completeTurn(fixture, deleteSource, 'Delete-scoped original.',
      'r4-stale-delete-source-turn');
    const deleteTarget = await createConversation(fixture, 'Delete target',
      'r4-stale-delete-target');
    const deleteRef = await saveCrossWindowExclusion(fixture, deleteSource, deleteTarget,
      'r4-stale-delete-save');
    const deleted = await fixture.call(`/chat/conversations/${deleteSource.conversationId}/deletion`,
      'POST', { expectedVersion: deleteSource.version, confirmation: 'delete' },
      { 'idempotency-key': 'r4-stale-delete-action' });
    assert.equal(deleted.status, 200, JSON.stringify(deleted));
    await assertUnavailableExclusion(fixture, deleteTarget, deleteRef);

    const branchSource = await createConversation(fixture, 'Branch source',
      'r4-stale-branch-source');
    await completeTurn(fixture, branchSource, 'Branch pivot original.',
      'r4-stale-branch-turn-one');
    await completeTurn(fixture, branchSource, 'Branch-later source becomes unavailable.',
      'r4-stale-branch-turn-two');
    const branchTarget = await createConversation(fixture, 'Branch target',
      'r4-stale-branch-target');
    const branchRef = await saveCrossWindowExclusion(fixture, branchSource, branchTarget,
      'r4-stale-branch-save');
    const branchView = await fixture.call(`/chat/conversations/${branchSource.conversationId}`);
    const pivot = branchView.data.messages[0];
    const branched = await fixture.call(`/chat/conversations/${branchSource.conversationId}/branches`,
      'POST', { sourceBranchId: branchView.data.branch.branchId,
        restartAfterMessageId: pivot.messageId, title: 'Earlier-only branch' },
      { 'idempotency-key': 'r4-stale-branch-action' });
    assert.equal(branched.status, 201, JSON.stringify(branched));
    await assertUnavailableExclusion(fixture, branchTarget, branchRef);

    const deniedSource = await createConversation(fixture, 'Revoked source',
      'r4-stale-revoke-source');
    await completeTurn(fixture, deniedSource, 'Access-revoked source.',
      'r4-stale-revoke-source-turn');
    const deniedTarget = await createConversation(fixture, 'Revoked target',
      'r4-stale-revoke-target');
    const deniedRef = await saveCrossWindowExclusion(fixture, deniedSource, deniedTarget,
      'r4-stale-revoke-save');
    denied.add(deniedSource.conversationId);
    await assertUnavailableExclusion(fixture, deniedTarget, deniedRef);
  });

test('R4 preview simulates folding and trimming before declaring a long turn sendable', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: Array.from({ length: 6 }, (_, index) => ({
      type: 'success', content: `Long preview answer ${index + 1}.`,
    })),
    applicationOptions: {
      modelContextLimitPort: {
        resolve() {
          return { contextLimitTokens: 9_000, reservedOutputTokens: 4_096,
            source: 'controlled-r4-preview-limit' };
        },
      },
    },
  });
  const conversation = await createConversation(fixture, 'Long preview conversation',
    'r4-long-preview-conversation');
  for (let index = 0; index < 5; index += 1) {
    await completeTurn(fixture, conversation,
      `Preview source ${index + 1}: ${'z'.repeat(700)}`,
      `r4-long-preview-history-${index + 1}`);
  }
  const providerCalls = fixture.loopback.requests.length;
  const plan = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/context-plan?mode=balanced`,
  );
  assert.equal(plan.status, 200, JSON.stringify(plan));
  assert.equal(plan.data.budget.rawEstimatedInputTokens > plan.data.budget.inputBudgetTokens, true);
  assert.equal(plan.data.budget.estimatedInputTokens <= plan.data.budget.inputBudgetTokens, true);
  assert.equal(plan.data.budget.withinLimit, true);
  assert.equal(plan.data.budget.foldPlanned, true);
  assert.equal(['planned', 'ready'].includes(plan.data.folding.status), true);
  assert.equal(plan.data.sources.some((item) => item.status === 'summarized'), true);
  assert.equal(fixture.loopback.requests.length, providerCalls);

  const completed = await completeTurn(fixture, conversation,
    `Final long preview request: ${'q'.repeat(700)}`, 'r4-long-preview-final');
  assert.equal(completed.context.state, 'locked');
  assert.equal(completed.context.budget.withinLimit, true);
  assert.equal(completed.context.budget.estimatedInputTokens
    <= completed.context.budget.inputBudgetTokens, true);
  assert.equal(fixture.loopback.requests.length, providerCalls + 1);
});

test('R4 accepts only a verified isolated runtime projection and never invokes runtime execution', async (t) => {
  const enabled = { value: false };
  let projectionReads = 0;
  const fixture = await createStandaloneChatFixture(t, {
    applicationOptions: {
      subjectRuntimeAdapter: dynamicRuntimeAdapter(enabled),
      runtimeProjectionPort: {
        readVerifiedProjection() {
          projectionReads += 1;
          return {
            verified: true,
            projectionId: 'isolated-projection-001',
            content: 'Verified isolated projection content.',
            verifiedAt: '2026-09-06T00:00:00.000Z',
          };
        },
      },
    },
  });
  const conversation = await createConversation(fixture, 'Projection preview',
    'r4-projection-conversation');
  enabled.value = true;
  await fixture.restart();
  const plan = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/context-plan?mode=balanced`,
  );
  assert.equal(plan.status, 200, JSON.stringify(plan));
  assert.deepEqual(Object.keys(plan.data.budget).sort(), [
    'contextLimitTokens',
    'estimatedInputTokens',
    'estimationMethod',
    'foldPlanned',
    'inputBudgetTokens',
    'rawEstimatedInputTokens',
    'reservedOutputTokens',
    'trimmingApplied',
    'trimmingReason',
    'withinLimit',
  ]);
  assert.equal(plan.data.runtimeProjection.status, 'included');
  assert.equal(plan.data.runtimeProjection.sourceRef,
    'runtime-projection:isolated-projection-001');
  assert.equal(projectionReads, 1);
  assert.equal(fixture.loopback.requests.length, 0);
});

test('R4 rejects invalid controls, stale plans and mandatory exclusions before Provider execution', async (t) => {
  const fixture = await createStandaloneChatFixture(t);
  const conversation = await createConversation(fixture, 'Invalid controls',
    'r4-invalid-conversation');
  const invalidMode = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/context-plan?mode=unknown`,
  );
  assert.equal(invalidMode.status, 400);
  assert.equal(invalidMode.error.code, 'CONTEXT_MODE_INVALID');
  const mandatory = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/context-plan?mode=custom`
      + '&excludeSourceRef=system-rules%3Avio-r4',
  );
  assert.equal(mandatory.status, 400);
  assert.equal(mandatory.error.code, 'CONTEXT_EXCLUSIONS_INVALID');
  const stale = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/turns`,
    'POST',
    {
      branchId: conversation.currentBranchId,
      content: 'Reject the stale plan without Provider execution.',
      attachmentIds: [],
      context: {
        mode: 'balanced',
        excludedSourceRefs: [],
        expectedPlanHash: `sha256:${'0'.repeat(64)}`,
      },
    },
    { 'idempotency-key': 'r4-stale-plan-turn' },
  );
  assert.equal(stale.status, 200, JSON.stringify(stale));
  assert.equal(responseTurn(stale).status, 'retryable');
  assert.equal(responseTurn(stale).error.code, 'CONTEXT_PLAN_STALE');
  assert.equal(fixture.loopback.requests.length, 0);
});

test('R4 preview hash remains valid when the current user message follows twenty unresolved events', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    providerResponses: [{ type: 'success', content: 'Stable preview plan answer.' }],
  });
  const conversation = await createConversation(fixture, 'Stable preview plan',
    'r4-stable-preview-conversation');
  const insert = fixture.app.database.connection.prepare(`
    INSERT INTO events (
      event_id, user_id, subject_id, event_type, source_type, source_ref,
      occurred_at, recorded_at, event_data_json, summary, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const occurredAt = new Date().toISOString();
  for (let index = 0; index < 20; index += 1) {
    insert.run(
      `r4-preview-event-${String(index).padStart(2, '0')}`,
      fixture.ownerId,
      fixture.firstAssistantId,
      'wake_trigger_prepared',
      'r4-controlled-test',
      `r4-preview-source-${index}`,
      occurredAt,
      occurredAt,
      '{}',
      `Controlled unresolved event ${index}.`,
      'pending',
    );
  }
  const preview = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/context-plan?branchId=${conversation.currentBranchId}&mode=balanced`,
  );
  assert.equal(preview.status, 200, JSON.stringify(preview));
  assert.equal(preview.data.sources.filter((item) => item.sourceType === 'event').length, 20);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const submitted = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/turns`,
    'POST',
    {
      branchId: conversation.currentBranchId,
      content: 'Keep the exact preview source set stable.',
      attachmentIds: [],
      context: {
        mode: 'balanced',
        excludedSourceRefs: [],
        expectedPlanHash: preview.data.planHash,
      },
    },
    { 'idempotency-key': 'r4-stable-preview-turn' },
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted));
  const completed = await approveAndResumeTurn(fixture, submitted, 'r4-stable-preview-turn');
  assert.equal(completed.turn.status, 'completed', JSON.stringify(completed.response));
  assert.equal(completed.turn.context.planHash, preview.data.planHash);
  assert.equal(completed.turn.context.sources.filter((item) => item.sourceType === 'event').length,
    20);
  assert.equal(fixture.loopback.requests.length, 1);
});

test('R4 persists a fail-closed budget decision when mandatory context cannot fit', async (t) => {
  const fixture = await createStandaloneChatFixture(t, {
    applicationOptions: {
      modelContextLimitPort: {
        resolve() {
          return { contextLimitTokens: 1_024, reservedOutputTokens: 900,
            source: 'controlled-r4-budget-limit' };
        },
      },
    },
  });
  const conversation = await createConversation(fixture, 'Budget blocked context',
    'r4-budget-conversation');
  const submitted = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/turns`,
    'POST',
    {
      branchId: conversation.currentBranchId,
      content: 'This current instruction must remain represented in the durable budget decision.',
      attachmentIds: [],
    },
    { 'idempotency-key': 'r4-budget-blocked-turn' },
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted));
  const turn = responseTurn(submitted);
  assert.equal(turn.status, 'failed');
  assert.equal(turn.error.code, 'CONTEXT_BUDGET_EXCEEDED');
  assert.equal(fixture.loopback.requests.length, 0);

  const queried = await fixture.call(`/chat/turns/${turn.turnId}/context`);
  assert.equal(queried.status, 200, JSON.stringify(queried));
  assert.equal(queried.data.state, 'budget_blocked');
  assert.equal(queried.data.budget.withinLimit, false);
  assert.equal(queried.data.folding.reason, 'CONTEXT_BUDGET_EXCEEDED');
  assert.equal(queried.data.sources.some((item) =>
    item.slot === 'current_user_message' && item.status === 'included'), true);

  const replay = await fixture.call(
    `/chat/conversations/${conversation.conversationId}/turns`,
    'POST',
    {
      branchId: conversation.currentBranchId,
      content: 'This current instruction must remain represented in the durable budget decision.',
      attachmentIds: [],
    },
    { 'idempotency-key': 'r4-budget-blocked-turn' },
  );
  assert.equal(responseTurn(replay).error.code, 'CONTEXT_BUDGET_EXCEEDED');
  assert.equal(fixture.app.database.connection.prepare(`
    SELECT count(*) AS n FROM personal_context_assemblies WHERE turn_id=?
  `).get(turn.turnId).n, 1);
  assert.equal(fixture.loopback.requests.length, 0);
});
