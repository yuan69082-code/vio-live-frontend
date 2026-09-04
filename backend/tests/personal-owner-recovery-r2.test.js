import assert from 'node:assert/strict';
import test from 'node:test';

import { ApplicationError } from '../src/core/errors.js';
import { createContinuityDeliveryService } from '../src/modules/continuity-integration/continuity-delivery-service.js';
import { createContinuityCapabilityService } from '../src/modules/continuity-integration/continuity-capability-service.js';
import { createContinuityConversationTurnService } from '../src/modules/continuity-integration/continuity-conversation-turn-service.js';
import { conformanceRequest, EXPECTED_BINDING_FIXTURE_HASH, fixedSubjectBindingFixture } from '../src/modules/continuity-integration/first-round-contract.js';

// Pure dependency-injection regressions: no database, socket, credential or external runtime.
const suspended = error => error instanceof ApplicationError
  && error.code === 'OWNER_BUSINESS_SUSPENDED' && error.statusCode === 423;
const forbidden = () => assert.fail('Suspended owner must not execute or mutate business facts.');
const transaction = fn => fn();

function deliveryFixture(initialStatus = 'pending') {
  const request = conformanceRequest();
  const state = { allowed: true, calls: 0, mutations: 0, received: 0, finished: 0 };
  let outbox = { requestId: request.requestId, requestHash: request.requestHash, status: initialStatus, operationId: null };
  const dependencies = {
    ownerBusinessAllowed: () => state.allowed,
    requestService: {
      getStoredRequest: () => request,
      loadFixedBindingFixture: () => ({ fixture: fixedSubjectBindingFixture(), bindingFixtureHash: EXPECTED_BINDING_FIXTURE_HASH }),
    },
    resultService: {
      recoverStoredResult: () => null,
      receiveResult() { state.received += 1; forbidden(); },
    },
    deliveryRepository: {
      listRecoverable: () => [outbox],
      ensureOutbox() { state.mutations += 1; return outbox; },
      findOutbox: () => outbox,
      transitionOutbox(value) { state.mutations += 1; outbox = { ...outbox, status: value.status }; return outbox; },
      startAttempt(value) { state.mutations += 1; return value; },
      finishAttempt() { state.finished += 1; forbidden(); },
    },
    transport: {
      checkReady: forbidden,
      async submitCanonicalRequest() { state.calls += 1; state.allowed = false; return { statusCode: 200, payload: {} }; },
      async queryRequest() { state.calls += 1; state.allowed = false; return { kind: 'not_found', statusCode: 404 }; },
    },
    runInTransaction: transaction,
    logger: { error() {} },
  };
  return { state, dependencies, request, outbox: () => outbox };
}

test('R2 suspended owner cannot resume V3 or run startup local/network recovery', async () => {
  const f = deliveryFixture(); f.state.allowed = false;
  f.dependencies.resultService.recoverStoredResult = forbidden;
  const service = createContinuityDeliveryService(f.dependencies);
  assert.deepEqual(await service.initialize(), { status: 'degraded', recovered: 0 });
  await assert.rejects(service.submitStoredRequest(f.request.requestId), suspended);
  assert.deepEqual(f.state, { allowed: false, calls: 0, mutations: 0, received: 0, finished: 0 });
});

test('R2 V3 late POST/query responses cannot persist or retry after owner suspension', async () => {
  for (const status of ['pending', 'outcome_unknown']) {
    const f = deliveryFixture(status);
    const service = createContinuityDeliveryService(f.dependencies);
    await assert.rejects(service.submitStoredRequest(f.request.requestId), suspended);
    assert.equal(f.state.calls, 1);
    assert.equal(f.state.received, 0);
    assert.equal(f.state.finished, 0);
    assert.equal(f.outbox().status, status === 'pending' ? 'in_flight' : 'outcome_unknown');
    const before = f.state.mutations;
    await assert.rejects(service.submitStoredRequest(f.request.requestId), suspended);
    assert.equal(f.state.mutations, before);
    assert.equal(f.state.calls, 1);
  }
});

function capabilityRecord() {
  return {
    userId: 'isolated-owner', assistantId: 'isolated-assistant',
    capabilityRequestId: 'isolated-capability', requestId: 'isolated-request', status: 'received',
    deadlineAt: '2099-01-01T00:00:00Z',
    request: {
      createdAt: '2026-01-01T00:00:00Z', riskLevel: 'LOW', originatingSessionId: 'isolated-session',
      input: { instruction: '', messageContent: '', perceptionSummary: '', currentFocus: '', maximumOutputCharacters: 100 },
    },
  };
}

test('R2 suspended owner cannot persist V4 inbox, normalize executions, or reconcile terminal results', async () => {
  const record = capabilityRecord();
  const service = createContinuityCapabilityService({
    ownerBusinessAllowed: () => false,
    capabilityRepository: {
      findRequest: () => record, findRequestByInteraction: () => record,
      listAmbiguousExecutions: () => [{ capabilityRequestId: record.capabilityRequestId }],
      listRecoverableOutboxes: () => [{ requestId: record.requestId, status: 'in_flight' }],
      insertRequest: forbidden, transitionOutbox: forbidden, insertResult: forbidden,
    },
    modelService: { getModel: forbidden },
  });
  assert.deepEqual(await service.initialize(), { status: 'ready', normalized: 0 });
  await assert.rejects(service.handleCapabilityRequired({}, { identity: { userId: record.userId } }), suspended);
  await assert.rejects(service.resumeCapability(record.capabilityRequestId), suspended);
  assert.throws(() => service.reconcileEngineTerminal(record.requestId, 'completed'), suspended);
});

test('R2 V4 late result POST/query cannot complete attempts, quarantine or send again', async () => {
  for (const initialStatus of ['pending', 'outcome_unknown']) {
    const record = capabilityRecord();
    const result = { capabilityResultId: 'isolated-result', requestId: record.requestId, result: {}, createdAt: '2026-01-01T00:00:00Z' };
    let outbox = { capabilityResultId: result.capabilityResultId, requestId: record.requestId, status: initialStatus };
    let allowed = true; let calls = 0; let finished = 0;
    const late = async () => { calls += 1; allowed = false; return { statusCode: 200, payload: { status: 'completed' } }; };
    const service = createContinuityCapabilityService({
      ownerBusinessAllowed: () => allowed,
      capabilityRepository: {
        findRequest: () => record, findResultByRequest: () => result, findOutbox: () => outbox,
        ensureOutbox: () => outbox,
        transitionOutbox(_id, _from, to) { outbox = { ...outbox, status: to }; return outbox; },
        startAttempt() {}, finishAttempt() { finished += 1; forbidden(); },
        updateRequestStatus: forbidden, insertIncident: forbidden,
      },
      transport: { submitCapabilityResult: late, queryRequest: late },
      runInTransaction: transaction,
    });
    await assert.rejects(service.resumeCapability(record.capabilityRequestId), suspended);
    assert.equal(calls, 1); assert.equal(finished, 0);
    assert.equal(outbox.status, initialStatus === 'pending' ? 'in_flight' : 'outcome_unknown');
    await assert.rejects(service.resumeCapability(record.capabilityRequestId), suspended);
    assert.equal(calls, 1);
  }
});

test('R2 V4 late Provider result cannot create usage/result or callback after owner suspension', async () => {
  const record = capabilityRecord();
  const model = { modelId: 'isolated-model', providerId: 'isolated-provider', provider: {} };
  let allowed = true; let calls = 0;
  const service = createContinuityCapabilityService({
    ownerBusinessAllowed: () => allowed,
    capabilityRepository: {
      findRequest: () => record, findResultByRequest: () => null, findLatestExecutionByRequest: () => null,
      insertDecision() {}, updateRequestStatus() {},
      insertExecution: value => value, markExecutionInFlight: executionId => ({ executionId }),
      completeExecution: forbidden, insertUsage: forbidden, insertResult: forbidden,
    },
    modelRouterService: { selectModel: () => ({ model, selectionSource: 'default' }) },
    permissionChecker: { checkPermission: () => ({ decision: 'allow' }) },
    securityService: { checkSecurity: () => ({ decision: 'allow' }) },
    proactiveInteractionService: { checkTokenBudget: () => ({ decision: 'allow' }) },
    apiProviderService: { getCredentialBindingForExecution: () => ({ resolveApiKey: () => 'isolated-fake-credential' }) },
    modelExecutor: { async execute() { calls += 1; allowed = false; return {}; } },
    transport: { submitCapabilityResult: forbidden },
    runInTransaction: transaction,
  });
  await assert.rejects(service.resumeCapability(record.capabilityRequestId), suspended);
  assert.equal(calls, 1);
  await assert.rejects(service.resumeCapability(record.capabilityRequestId, { retryApproved: true }), suspended);
  assert.equal(calls, 1);
});

test('R2 suspended owner cannot create/resume V5 or publish through startup reconciliation', async () => {
  const service = createContinuityConversationTurnService({
    ownerBusinessAllowed: () => false,
    deliveryService: { enabled: true },
    turnRepository: { listRecoverable: () => [{ userId: 'isolated-owner', requestId: 'isolated-request' }], findById: forbidden, findByRequestId: forbidden },
  });
  assert.deepEqual(await service.initialize(), { status: 'ready', reconciled: 0 });
  await assert.rejects(service.createTurn('isolated-owner'), suspended);
  await assert.rejects(service.resumeTurn('isolated-owner'), suspended);
});

test('R2 V5 late delivery cannot publish a final Message after owner suspension', async () => {
  let allowed = true; let calls = 0;
  const record = { userId: 'isolated-owner', requestId: 'isolated-request', status: 'outcome_unknown' };
  const service = createContinuityConversationTurnService({
    ownerBusinessAllowed: () => allowed,
    conversationService: { getConversation() {} },
    turnRepository: { findById: () => record, findByRequestId: forbidden },
    deliveryService: { enabled: true, async submitStoredRequest() { calls += 1; allowed = false; } },
    messageService: { createMessage: forbidden },
  });
  await assert.rejects(service.resumeTurn('isolated-owner', 'isolated-assistant', 'isolated-conversation', 'isolated-turn', {}), suspended);
  assert.equal(calls, 1);
  await assert.rejects(service.resumeTurn('isolated-owner', 'isolated-assistant', 'isolated-conversation', 'isolated-turn', {}), suspended);
  assert.equal(calls, 1);
});
