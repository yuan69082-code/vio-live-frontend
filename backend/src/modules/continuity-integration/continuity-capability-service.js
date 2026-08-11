import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { ContinuityTransportError } from '../../integrations/continuity-engine/http-continuity-integration-transport.js';
import {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_MODEL_OUTPUT_SCHEMA_VERSION,
  ENGINE_RISK_TO_VIO,
} from './capability-contract.js';
import {
  calculateCapabilityResultHash,
  isStrictUtcDateTime,
  validateCapabilityRequiredEnvelope,
  validateCapabilityResult,
} from './capability-validator.js';
import { canonicalizeJson, sha256Hash } from './first-round-hashing.js';

const TERMINAL_CALLBACK_STATUS = new Set([400, 401, 404, 409, 413, 415]);

function now(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError('Continuity capability clock must return a valid Date.');
  }
  return value.toISOString();
}

function atLeast(value, lowerBound) {
  return Date.parse(value) < Date.parse(lowerBound) ? lowerBound : value;
}

function estimateTokens(request) {
  const input = request.input;
  const inputBytes = Buffer.byteLength([
    input.instruction,
    input.messageContent,
    input.perceptionSummary,
    input.currentFocus,
  ].join('\n'), 'utf8');
  return Math.max(1, inputBytes + input.maximumOutputCharacters);
}

function executionStatus(status) {
  return {
    SUCCEEDED: 'succeeded',
    FAILED_RETRYABLE: 'failed_retryable',
    FAILED_TERMINAL: 'failed_terminal',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
    UNKNOWN: 'unknown',
  }[status];
}

function errorRule(status) {
  return {
    FAILED_RETRYABLE: 'retry',
    FAILED_TERMINAL: 'never',
    CANCELLED: 'never',
    EXPIRED: 'never',
    UNKNOWN: 'query',
  }[status] ?? null;
}

function sanitizeDecision(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/content|secret|token|authorization/i.test(key) && !/estimatedTokens|totalTokens/i.test(key)) {
      return '[redacted]';
    }
    return item;
  }));
}

function normalizeResume(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Capability resume options must be an object.');
  }
  const allowed = new Set([
    'securityConfirmationId',
    'securitySessionId',
    'budgetConfirmationId',
    'retryApproved',
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new ValidationError('Capability resume options contain unknown fields.', { unknown });
  }
  if (Object.hasOwn(value, 'retryApproved') && typeof value.retryApproved !== 'boolean') {
    throw new ValidationError('retryApproved must be a boolean.');
  }
  return value;
}

export function validateCapabilityFailedEnvelope(envelope, request) {
  const fields = [
    'contractVersion', 'schemaVersion', 'status', 'requestId', 'requestHash',
    'operationId', 'subjectId', 'capabilityRequestId', 'failureStatus',
    'errorCode', 'retryClass', 'updatedAt',
  ];
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new ValidationError('capability_failed envelope must be an object.');
  }
  if (Object.keys(envelope).length !== fields.length || fields.some((field) => !Object.hasOwn(envelope, field))) {
    throw new ValidationError('capability_failed envelope has invalid fields.');
  }
  if (
    envelope.contractVersion !== CAPABILITY_CONTRACT_VERSION
    || envelope.schemaVersion !== 'continuity-capability-failed/v1'
    || envelope.status !== 'capability_failed'
    || envelope.requestId !== request.requestId
    || envelope.requestHash !== request.requestHash
    || envelope.operationId !== request.operationId
    || envelope.subjectId !== request.subjectId
    || envelope.capabilityRequestId !== request.capabilityRequestId
    || !['FAILED_TERMINAL', 'CANCELLED', 'EXPIRED'].includes(envelope.failureStatus)
    || envelope.retryClass !== 'never'
    || typeof envelope.errorCode !== 'string'
    || envelope.errorCode.trim().length < 1
    || !isStrictUtcDateTime(envelope.updatedAt)
  ) throw new ConflictError('capability_failed envelope does not match the stored request.');
  return structuredClone(envelope);
}

export function createContinuityCapabilityService({
  requestService,
  resultService,
  capabilityRepository,
  modelRouterService,
  modelService,
  apiProviderService,
  permissionChecker,
  securityService,
  proactiveInteractionService,
  modelExecutor,
  transport,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
  logger = console,
}) {
  function originalFor(requestId) {
    return requestService.getStoredRequest(requestId);
  }

  function incident(record, type, details = {}) {
    const createdAt = now(clock);
    runInTransaction(() => {
      capabilityRepository.insertIncident({
        incidentId: idFactory(),
        capabilityRequestId: record?.capabilityRequestId ?? null,
        capabilityResultId: details.capabilityResultId ?? null,
        requestId: record?.requestId ?? details.requestId,
        incidentType: type,
        detailsJson: canonicalizeJson(sanitizeDecision(details)).toString('utf8'),
        createdAt,
      });
      if (record) capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'quarantined', createdAt);
    });
  }

  function persistInbox(envelope, original) {
    const validated = validateCapabilityRequiredEnvelope(envelope, original);
    const request = validated.capabilityRequest;
    const canonicalRequest = canonicalizeJson(request).toString('utf8');
    const canonicalEnvelope = canonicalizeJson(validated).toString('utf8');
    const existing = capabilityRepository.findRequest(request.capabilityRequestId);
    if (existing) {
      if (
        canonicalizeJson(existing.request).toString('utf8') !== canonicalRequest
        || existing.requestId !== request.requestId
        || existing.operationId !== request.operationId
      ) throw new ConflictError('CapabilityRequest replay conflicts with the immutable inbox.');
      return existing;
    }
    const recordedAt = now(clock);
    return runInTransaction(() => capabilityRepository.insertRequest({
      capabilityRequestId: request.capabilityRequestId,
      requestId: request.requestId,
      requestHash: request.requestHash,
      operationId: request.operationId,
      userId: original.identity.userId,
      assistantId: original.identity.assistantId,
      engineSubjectId: original.identity.subjectId,
      bindingId: request.bindingId,
      bindingVersion: request.bindingVersion,
      originatingSessionId: request.originatingSessionId,
      inputHash: request.inputHash,
      idempotencyKey: request.idempotencyKey,
      riskLevel: request.riskLevel,
      deadlineAt: request.deadlineAt,
      requestJson: canonicalRequest,
      envelopeJson: canonicalEnvelope,
      createdAt: request.createdAt,
      recordedAt,
    }));
  }

  function recordDecision(record, values) {
    const decisionId = idFactory();
    const createdAt = now(clock);
    const snapshot = sanitizeDecision({
      schemaVersion: 'vio-continuity-capability-decision/v1',
      decisionId,
      capabilityRequestId: record.capabilityRequestId,
      externalOperation: {
        operationType: 'privacy_access_request',
        resourceType: 'api',
        action: 'execute',
        sensitiveDataCategories: ['private_record'],
      },
      model: values.model ? {
        modelId: values.model.modelId,
        providerId: values.model.providerId,
        selectionSource: values.selectionSource,
      } : null,
      permission: values.permission,
      security: values.security ? {
        decision: values.security.decision,
        risk: values.security.risk,
        confirmation: values.security.confirmation,
        auditLogId: values.security.auditLogId,
      } : null,
      budget: values.budget ? {
        decision: values.budget.decision,
        operationStatus: values.budget.operationStatus,
        projection: values.budget.projection,
      } : null,
      estimatedTokens: values.estimatedTokens,
      retryApproved: values.retryApproved === true,
      outcome: values.outcome,
      createdAt,
    });
    runInTransaction(() => capabilityRepository.insertDecision({
      decisionId,
      capabilityRequestId: record.capabilityRequestId,
      modelId: values.model?.modelId ?? null,
      providerId: values.model?.providerId ?? null,
      permissionDecision: values.permission?.decision ?? null,
      securityDecision: values.security?.decision ?? null,
      budgetDecision: values.budget?.decision ?? null,
      estimatedTokens: values.estimatedTokens,
      confirmationId: values.security?.confirmation?.confirmationId
        ?? values.budget?.security?.confirmation?.confirmationId
        ?? null,
      auditRef: values.security?.auditLogId ?? values.budget?.security?.auditLogId ?? decisionId,
      decisionJson: canonicalizeJson(snapshot).toString('utf8'),
      createdAt,
    }));
    return { decisionId, auditRef: values.security?.auditLogId ?? values.budget?.security?.auditLogId ?? decisionId };
  }

  function persistResult(record, model, execution, providerResult, auditRef) {
    const request = record.request;
    const completedAt = atLeast(providerResult.completedAt, request.createdAt);
    const startedAt = atLeast(providerResult.startedAt, request.createdAt);
    const output = providerResult.status === 'SUCCEEDED' ? {
      schemaVersion: CAPABILITY_MODEL_OUTPUT_SCHEMA_VERSION,
      responseCandidate: providerResult.output.responseCandidate,
      metadata: { finishReason: providerResult.output.finishReason },
    } : null;
    const usage = providerResult.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const usageLedgerEntryId = idFactory();
    const capabilityResultId = idFactory();
    const result = {
      contractVersion: 'continuity-capability/v1',
      schemaVersion: 'continuity-capability-result/v1',
      capabilityResultId,
      capabilityRequestId: request.capabilityRequestId,
      operationId: request.operationId,
      requestId: request.requestId,
      requestHash: request.requestHash,
      subjectId: request.subjectId,
      bindingId: request.bindingId,
      bindingVersion: request.bindingVersion,
      status: providerResult.status,
      capabilityType: 'model.generate',
      provider: { providerType: 'model', providerId: model.providerId, modelName: model.modelName },
      output,
      contentHash: sha256Hash(canonicalizeJson(output)),
      startedAt,
      completedAt,
      actualUsage: usage,
      vioLedgerEntryId: usageLedgerEntryId,
      errorCode: providerResult.status === 'SUCCEEDED' ? null : providerResult.errorCode,
      retryClass: errorRule(providerResult.status),
      auditRef,
      executionFact: true,
    };
    validateCapabilityResult(result, request);
    const resultHash = calculateCapabilityResultHash(result);
    const usageStatus = providerResult.status === 'SUCCEEDED'
      ? 'provider_reported'
      : providerResult.requestMayHaveBeenSent ? 'unknown' : 'not_incurred';
    return runInTransaction(() => {
      capabilityRepository.completeExecution(
        execution.executionId,
        executionStatus(providerResult.status),
        completedAt,
        providerResult.errorCode,
      );
      capabilityRepository.insertUsage({
        usageLedgerEntryId,
        capabilityRequestId: record.capabilityRequestId,
        executionId: execution.executionId,
        userId: record.userId,
        subjectId: record.assistantId,
        budgetSessionId: request.originatingSessionId,
        modelId: model.modelId,
        ...usage,
        usageStatus,
        costStatus: providerResult.cost?.status ?? (usageStatus === 'not_incurred' ? 'not_incurred' : 'not_reported'),
        costAmountMicros: providerResult.cost?.amountMicros ?? null,
        costCurrency: providerResult.cost?.currency ?? null,
        occurredAt: completedAt,
        recordedAt: now(clock),
      });
      const stored = capabilityRepository.insertResult({
        capabilityResultId,
        capabilityRequestId: record.capabilityRequestId,
        executionId: execution.executionId,
        requestId: record.requestId,
        requestHash: record.requestHash,
        operationId: record.operationId,
        status: result.status,
        contentHash: result.contentHash,
        resultHash,
        resultJson: canonicalizeJson(result).toString('utf8'),
        usageLedgerEntryId,
        createdAt: completedAt,
      });
      capabilityRepository.ensureOutbox(stored.capabilityResultId, stored.requestId, completedAt);
      capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'result_ready', completedAt);
      return stored;
    });
  }

  function preflightResult(record, model, status, errorCode, auditRef) {
    const timestamp = atLeast(now(clock), record.request.createdAt);
    const execution = runInTransaction(() => {
      capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'ready', timestamp);
      return capabilityRepository.insertExecution({
        executionId: idFactory(),
        capabilityRequestId: record.capabilityRequestId,
        providerId: model.providerId,
        modelId: model.modelId,
        startedAt: timestamp,
      });
    });
    return persistResult(record, model, execution, {
      status,
      output: null,
      usage: null,
      errorCode,
      requestMayHaveBeenSent: false,
      startedAt: timestamp,
      completedAt: timestamp,
      cost: { status: 'not_incurred', amountMicros: null, currency: null },
    }, auditRef);
  }

  function transitionOutbox(outbox, status, details = {}) {
    const updated = runInTransaction(() => capabilityRepository.transitionOutbox(
      outbox.capabilityResultId,
      outbox.status,
      status,
      { ...details, updatedAt: now(clock) },
    ));
    if (!updated) throw new ConflictError('CapabilityResult outbox changed concurrently.');
    return updated;
  }

  function attempt(resultId, operationType) {
    const attemptId = idFactory();
    const startedAt = now(clock);
    runInTransaction(() => capabilityRepository.startAttempt({
      attemptId, capabilityResultId: resultId, operationType, startedAt,
    }));
    return { attemptId, startedAt };
  }

  function finishAttempt(entry, outcome, response = {}) {
    runInTransaction(() => capabilityRepository.finishAttempt({
      attemptId: entry.attemptId,
      completedAt: now(clock),
      outcome,
      httpStatus: response.statusCode ?? null,
      errorCode: response.errorCode ?? null,
    }));
  }

  function acceptContinuingResult(record, storedResult, outbox) {
    if (!['FAILED_RETRYABLE', 'UNKNOWN'].includes(storedResult.status)) {
      throw new ConflictError('Engine cannot require capability after this result status.');
    }
    const requestStatus = storedResult.status === 'FAILED_RETRYABLE'
      ? 'waiting_retry'
      : 'provider_outcome_unknown';
    const accepted = transitionOutbox(outbox, 'accepted', {
      httpStatus: 200,
      recoveryReason: storedResult.status === 'FAILED_RETRYABLE'
        ? 'retryable_result_accepted'
        : 'unknown_result_accepted',
    });
    capabilityRepository.updateRequestStatus(
      record.capabilityRequestId,
      requestStatus,
      now(clock),
    );
    return {
      status: storedResult.status === 'FAILED_RETRYABLE'
        ? 'waiting_retry'
        : 'provider_outcome_unknown',
      outbox: accepted,
    };
  }

  async function postResult(record, storedResult, outbox) {
    let current = transitionOutbox(outbox, 'in_flight', { recoveryReason: 'post_started' });
    const entry = attempt(storedResult.capabilityResultId, 'post_result');
    try {
      const response = await transport.submitCapabilityResult(canonicalizeJson(storedResult.result));
      finishAttempt(entry, 'response_received', response);
      const envelope = response.payload;
      if (envelope.status === 'completed') {
        current = transitionOutbox(current, 'completed', { httpStatus: 200 });
        capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'completed', now(clock));
        return { status: 'completed', envelope, outbox: current };
      }
      if (envelope.status === 'capability_failed') {
        validateCapabilityFailedEnvelope(envelope, record.request);
        current = transitionOutbox(current, 'failed', { httpStatus: 200, errorCode: envelope.errorCode });
        capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'failed', now(clock));
        return { status: 'capability_failed', envelope, outbox: current };
      }
      if (envelope.status === 'capability_required') {
        validateCapabilityRequiredEnvelope(envelope, originalFor(record.requestId));
        return acceptContinuingResult(record, storedResult, current);
      }
      throw new ValidationError('Engine CapabilityResult response status is unsupported.');
    } catch (error) {
      if (!(error instanceof ContinuityTransportError)) {
        finishAttempt(entry, 'response_invalid', { errorCode: error.code ?? 'validation_error' });
        incident(record, 'capability_callback_response_invalid', { capabilityResultId: storedResult.capabilityResultId, errorCode: error.code ?? 'validation_error' });
        return { status: 'quarantined', outbox: transitionOutbox(current, 'quarantined', { errorCode: error.code ?? 'validation_error' }) };
      }
      finishAttempt(entry, error.transportCode, { statusCode: error.httpStatus, errorCode: error.transportCode });
      const terminal = TERMINAL_CALLBACK_STATUS.has(error.httpStatus);
      current = transitionOutbox(current, terminal ? 'quarantined' : 'outcome_unknown', {
        httpStatus: error.httpStatus,
        errorCode: error.transportCode,
        recoveryReason: terminal ? 'terminal_http_response' : 'callback_outcome_unknown',
      });
      if (terminal) incident(record, 'capability_callback_terminal_failure', { capabilityResultId: storedResult.capabilityResultId, httpStatus: error.httpStatus });
      logger.error?.('[vio-live-backend] capability callback failed', {
        requestId: record.requestId,
        capabilityRequestId: record.capabilityRequestId,
        transportCode: error.transportCode,
      });
      return { status: terminal ? 'quarantined' : 'waiting', outbox: current };
    }
  }

  async function queryThenRecover(record, storedResult, outbox) {
    const entry = attempt(storedResult.capabilityResultId, 'query_request');
    try {
      const response = await transport.queryRequest(record.requestId);
      if (response.kind === 'not_found') {
        finishAttempt(entry, 'query_not_found', response);
        incident(record, 'engine_request_not_found', { capabilityResultId: storedResult.capabilityResultId });
        return { status: 'quarantined', outbox: transitionOutbox(outbox, 'quarantined', { httpStatus: 404, recoveryReason: 'not_found' }) };
      }
      const envelope = response.payload;
      if (envelope.status === 'completed') {
        const completed = envelope.result ?? envelope;
        finishAttempt(entry, 'query_completed', response);
        const current = transitionOutbox(outbox, 'completed', { httpStatus: 200, recoveryReason: 'query_completed' });
        capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'completed', now(clock));
        return { status: 'completed', envelope: completed, outbox: current };
      }
      if (envelope.status === 'capability_failed') {
        validateCapabilityFailedEnvelope(envelope, record.request);
        finishAttempt(entry, 'query_capability_failed', response);
        const current = transitionOutbox(outbox, 'failed', { httpStatus: 200, errorCode: envelope.errorCode });
        capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'failed', now(clock));
        return { status: 'capability_failed', envelope, outbox: current };
      }
      if (envelope.status === 'capability_required') {
        validateCapabilityRequiredEnvelope(envelope, originalFor(record.requestId));
        finishAttempt(entry, 'query_capability_required', response);
        return postResult(record, storedResult, outbox);
      }
      throw new ValidationError('Engine query status is unsupported for capability recovery.');
    } catch (error) {
      if (error instanceof ContinuityTransportError) {
        finishAttempt(entry, error.transportCode, { statusCode: error.httpStatus, errorCode: error.transportCode });
        return { status: 'waiting', outbox };
      }
      finishAttempt(entry, 'query_invalid', { errorCode: error.code ?? 'validation_error' });
      incident(record, 'capability_query_invalid', { capabilityResultId: storedResult.capabilityResultId, errorCode: error.code ?? 'validation_error' });
      return { status: 'quarantined', outbox: transitionOutbox(outbox, 'quarantined', { errorCode: error.code ?? 'validation_error' }) };
    }
  }

  async function deliver(record, storedResult) {
    let outbox = capabilityRepository.ensureOutbox(
      storedResult.capabilityResultId,
      storedResult.requestId,
      storedResult.createdAt,
    );
    if (outbox.status === 'accepted') {
      return storedResult.status === 'FAILED_RETRYABLE'
        ? { status: 'waiting_retry', outbox }
        : { status: 'provider_outcome_unknown', outbox };
    }
    if (outbox.status === 'completed' || outbox.status === 'failed' || outbox.status === 'quarantined') {
      return { status: outbox.status, outbox };
    }
    if (outbox.status === 'in_flight') {
      outbox = transitionOutbox(outbox, 'outcome_unknown', { recoveryReason: 'process_restart' });
    }
    if (outbox.status === 'outcome_unknown') return queryThenRecover(record, storedResult, outbox);
    return postResult(record, storedResult, outbox);
  }

  async function process(inputRecord, rawResume = {}) {
    const resume = normalizeResume(rawResume);
    let record = capabilityRepository.findRequest(inputRecord.capabilityRequestId) ?? inputRecord;
    let controlledRetry = false;
    const existingResult = capabilityRepository.findResultByRequest(record.capabilityRequestId);
    if (existingResult) {
      const existingOutbox = capabilityRepository.findOutbox(existingResult.capabilityResultId);
      if (!existingOutbox || ['pending', 'in_flight', 'outcome_unknown'].includes(existingOutbox.status)) {
        return deliver(record, existingResult);
      }
      if (existingOutbox.status === 'accepted') {
        if (existingResult.status === 'UNKNOWN') {
          return { status: 'provider_outcome_unknown', outbox: existingOutbox };
        }
        if (existingResult.status === 'FAILED_RETRYABLE' && record.status === 'waiting_retry') {
          if (resume.retryApproved !== true) {
            return { status: 'waiting_retry', outbox: existingOutbox };
          }
          record = capabilityRepository.updateRequestStatus(
            record.capabilityRequestId,
            'ready',
            now(clock),
          );
          controlledRetry = true;
        } else if (existingResult.status !== 'FAILED_RETRYABLE') {
          throw new ConflictError('Accepted CapabilityResult cannot start another execution.');
        }
      } else {
        return deliver(record, existingResult);
      }
    }
    if (['completed', 'failed', 'quarantined', 'provider_outcome_unknown'].includes(record.status)) {
      throw new ConflictError('CapabilityRequest is not eligible for another execution.');
    }
    const existingExecution = capabilityRepository.findLatestExecutionByRequest(record.capabilityRequestId);
    if (existingExecution?.status === 'in_flight') {
      const model = modelService.getModel(record.userId, existingExecution.modelId);
      const unknown = persistResult(record, model, existingExecution, {
        status: 'UNKNOWN', output: null, usage: null,
        errorCode: 'PROVIDER_OUTCOME_UNKNOWN_AFTER_RESTART', requestMayHaveBeenSent: true,
        startedAt: existingExecution.startedAt, completedAt: now(clock),
        cost: { status: 'not_reported', amountMicros: null, currency: null },
      }, `recovery-${record.capabilityRequestId}`);
      return deliver(record, unknown);
    }
    if (existingExecution && !existingResult) {
      throw new ConflictError('Capability execution is terminal without a persisted result.');
    }

    let route;
    try { route = modelRouterService.selectModel(record.userId, 'chat'); } catch (error) {
      incident(record, 'model_route_unavailable', { errorCode: error.code ?? 'not_found' });
      return { status: 'quarantined' };
    }
    const model = route.model;
    const scope = { subjectId: record.assistantId, resourceType: 'api', resourceId: model.providerId, action: 'execute' };
    const estimatedTokens = estimateTokens(record.request);
    if (Date.parse(record.deadlineAt) <= Date.parse(now(clock))) {
      const decision = recordDecision(record, {
        model, selectionSource: route.selectionSource, permission: null,
        security: null, budget: null, estimatedTokens, outcome: 'expired_before_execution',
      });
      return deliver(record, preflightResult(
        record, model, 'EXPIRED', 'CAPABILITY_DEADLINE_EXPIRED', decision.auditRef,
      ));
    }
    const permission = permissionChecker.checkPermission(record.userId, scope, { consumeAllowOnce: false });
    let security;
    try {
      security = securityService.checkSecurity(record.userId, {
        ...scope,
        operationType: 'privacy_access_request',
        sensitiveDataCategories: ['private_record'],
        ...(resume.securityConfirmationId ? { confirmationId: resume.securityConfirmationId } : {}),
        ...(resume.securitySessionId ? { securitySessionId: resume.securitySessionId } : {}),
      }, { minimumRiskLevel: ENGINE_RISK_TO_VIO[record.request.riskLevel] });
    } catch (error) {
      const decision = recordDecision(record, { model, selectionSource: route.selectionSource, permission, security: null, budget: null, estimatedTokens, outcome: 'security_fact_missing' });
      const stored = preflightResult(record, model, 'FAILED_TERMINAL', 'VIO_SECURITY_CHECK_FAILED', decision.auditRef);
      return deliver(record, stored);
    }
    if (security.decision === 'confirm') {
      recordDecision(record, { model, selectionSource: route.selectionSource, permission, security, budget: null, estimatedTokens, outcome: 'waiting_confirmation' });
      capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'waiting_confirmation', now(clock));
      return { status: 'waiting_confirmation', confirmationId: security.confirmation.confirmationId };
    }
    if (security.decision !== 'allow') {
      const decision = recordDecision(record, { model, selectionSource: route.selectionSource, permission, security, budget: null, estimatedTokens, outcome: 'permission_or_security_denied' });
      const code = permission.decision === 'deny' ? 'VIO_PERMISSION_DENIED' : 'VIO_SECURITY_DENIED';
      return deliver(record, preflightResult(record, model, 'FAILED_TERMINAL', code, decision.auditRef));
    }
    let budget;
    try {
      budget = proactiveInteractionService.checkTokenBudget(record.userId, record.assistantId, {
        estimatedTokens,
        budgetSessionId: record.request.originatingSessionId,
        ...(resume.budgetConfirmationId ? { confirmationId: resume.budgetConfirmationId } : {}),
        ...(resume.securitySessionId ? { securitySessionId: resume.securitySessionId } : {}),
      });
    } catch (error) {
      const decision = recordDecision(record, { model, selectionSource: route.selectionSource, permission, security, budget: null, estimatedTokens, outcome: 'budget_fact_missing' });
      return deliver(record, preflightResult(record, model, 'FAILED_TERMINAL', 'VIO_TOKEN_BUDGET_UNAVAILABLE', decision.auditRef));
    }
    if (budget.decision === 'confirm' || budget.decision === 'defer') {
      recordDecision(record, { model, selectionSource: route.selectionSource, permission, security, budget, estimatedTokens, outcome: budget.decision === 'confirm' ? 'waiting_budget_confirmation' : 'waiting_budget_defer' });
      capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'waiting_budget', now(clock));
      return {
        status: budget.decision === 'confirm' ? 'waiting_budget_confirmation' : 'waiting_budget',
        confirmationId: budget.security?.confirmation?.confirmationId ?? null,
      };
    }
    if (budget.decision !== 'allow') {
      const decision = recordDecision(record, { model, selectionSource: route.selectionSource, permission, security, budget, estimatedTokens, outcome: 'budget_denied' });
      return deliver(record, preflightResult(record, model, 'FAILED_TERMINAL', 'VIO_TOKEN_BUDGET_BLOCKED', decision.auditRef));
    }
    const decision = recordDecision(record, {
      model, selectionSource: route.selectionSource, permission, security, budget,
      estimatedTokens, retryApproved: controlledRetry, outcome: 'execution_allowed',
    });
    let credential;
    try { credential = apiProviderService.getCredentialBindingForExecution(record.userId, model.providerId); } catch {
      return deliver(record, preflightResult(record, model, 'FAILED_TERMINAL', 'PROVIDER_CREDENTIAL_UNAVAILABLE', decision.auditRef));
    }
    let apiKey;
    try { apiKey = credential.resolveApiKey(); } catch {
      return deliver(record, preflightResult(record, model, 'FAILED_TERMINAL', 'PROVIDER_CREDENTIAL_UNAVAILABLE', decision.auditRef));
    }
    const startedAt = atLeast(now(clock), record.request.createdAt);
    let execution = runInTransaction(() => {
      capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'ready', startedAt);
      return capabilityRepository.insertExecution({
        executionId: idFactory(), capabilityRequestId: record.capabilityRequestId,
        providerId: model.providerId, modelId: model.modelId, startedAt,
      });
    });
    runInTransaction(() => {
      capabilityRepository.updateRequestStatus(record.capabilityRequestId, 'executing', startedAt);
      execution = capabilityRepository.markExecutionInFlight(execution.executionId);
    });
    const providerResult = await modelExecutor.execute({
      provider: model.provider,
      model,
      apiKey,
      capabilityRequest: record.request,
    });
    const stored = persistResult(record, model, execution, providerResult, decision.auditRef);
    return deliver(record, stored);
  }

  return Object.freeze({
    async handleCapabilityRequired(envelope, originalRequest, resume = {}) {
      const original = originalRequest ?? originalFor(envelope.requestId);
      let record;
      try { record = persistInbox(envelope, original); } catch (error) {
        const existing = capabilityRepository.findRequestByInteraction(envelope?.requestId);
        if (existing) incident(existing, 'capability_request_identity_conflict', { errorCode: error.code ?? 'validation_error' });
        throw error;
      }
      return process(record, resume);
    },
    async resumeCapability(capabilityRequestId, resume = {}) {
      const record = capabilityRepository.findRequest(capabilityRequestId);
      if (!record) throw new NotFoundError('CapabilityRequest was not found.');
      if (!['waiting_confirmation', 'waiting_budget', 'waiting_retry', 'received', 'ready'].includes(record.status)) {
        throw new ConflictError('CapabilityRequest is not waiting for an internal resume.');
      }
      return process(record, resume);
    },
    async initialize() {
      let normalized = 0;
      for (const execution of capabilityRepository.listAmbiguousExecutions()) {
        const record = capabilityRepository.findRequest(execution.capabilityRequestId);
        if (!record) continue;
        const model = modelService.getModel(record.userId, execution.modelId);
        persistResult(record, model, execution, {
          status: 'UNKNOWN', output: null, usage: null,
          errorCode: 'PROVIDER_OUTCOME_UNKNOWN_AFTER_RESTART', requestMayHaveBeenSent: true,
          startedAt: execution.startedAt, completedAt: now(clock),
          cost: { status: 'not_reported', amountMicros: null, currency: null },
        }, `recovery-${record.capabilityRequestId}`);
        normalized += 1;
      }
      for (const outbox of capabilityRepository.listRecoverableOutboxes()) {
        if (outbox.status === 'in_flight') transitionOutbox(outbox, 'outcome_unknown', { recoveryReason: 'process_restart' });
      }
      return { status: 'ready', normalized };
    },
    reconcileEngineTerminal(requestId, engineTerminal) {
      const record = capabilityRepository.findRequestByInteraction(requestId);
      if (!record) return null;
      const status = typeof engineTerminal === 'string'
        ? engineTerminal
        : validateCapabilityFailedEnvelope(engineTerminal, record.request).status;
      const result = capabilityRepository.findResultByRequest(record.capabilityRequestId);
      if (!result) return null;
      const outbox = capabilityRepository.findOutbox(result.capabilityResultId);
      if (!outbox || ['accepted', 'completed', 'failed', 'quarantined'].includes(outbox.status)) return outbox;
      const target = status === 'capability_failed' ? 'failed' : 'completed';
      const updated = transitionOutbox(outbox, target, { recoveryReason: 'engine_terminal_reconciled' });
      capabilityRepository.updateRequestStatus(
        record.capabilityRequestId,
        target === 'completed' ? 'completed' : 'failed',
        now(clock),
      );
      return updated;
    },
    getRequest(id) { return capabilityRepository.findRequest(id); },
    getResult(id) { return capabilityRepository.findResultByRequest(id); },
  });
}
