import {
  ApplicationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../core/errors.js';
import { createId } from '../../core/ids.js';
import { requirePlainObject, requireString } from '../../core/validation.js';
import { requireMessageContent } from '../messages/message-types.js';
import { calculateContentHash } from './first-round-hashing.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'quarantined']);
const ENGINE_SUBJECT_ID = 'subject-001';
const FIXED_ASSISTANT_ID = 'assistant-001';

function instant(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError('Conversation turn clock must return a valid Date.');
  }
  return value.toISOString();
}

function onlyFields(value, fields) {
  const input = requirePlainObject(value, 'body');
  const unknown = Object.keys(input).filter((key) => !fields.includes(key));
  if (unknown.length) {
    throw new ValidationError('Request body contains unsupported fields.', { unknown });
  }
  return input;
}

function requireIdempotencyKey(value) {
  const key = requireString(value, 'Idempotency-Key', { minLength: 8, maxLength: 128 });
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new ValidationError('Idempotency-Key contains unsupported characters.', {
      field: 'Idempotency-Key',
    });
  }
  return key;
}

function mapCapabilityStatus(state) {
  if (!state) return null;
  if (state.resultOutboxStatus === 'outcome_unknown') {
    return { status: 'outcome_unknown', confirmationId: null };
  }
  if (state.status === 'waiting_confirmation') {
    return { status: 'confirmation_required', confirmationId: state.confirmationId };
  }
  if (state.status === 'waiting_budget') {
    return state.decisionOutcome === 'waiting_budget_confirmation'
      ? { status: 'budget_confirmation_required', confirmationId: state.confirmationId }
      : { status: 'waiting_budget', confirmationId: null };
  }
  if (state.status === 'waiting_retry') {
    return { status: 'waiting_retry', confirmationId: null };
  }
  if (state.status === 'provider_outcome_unknown') {
    return { status: 'outcome_unknown', confirmationId: null };
  }
  if (state.status === 'quarantined') {
    return { status: 'quarantined', confirmationId: null, failureCode: 'capability_quarantined' };
  }
  if (state.status === 'failed') {
    return {
      status: 'failed',
      confirmationId: null,
      failureCode: state.errorCode ?? 'capability_failed',
    };
  }
  return null;
}

export function createContinuityConversationTurnService({
  turnRepository,
  conversationService,
  messageService,
  eventRepository,
  requestService,
  resultService,
  deliveryService,
  capabilityService,
  confirmationService,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
  faultInjector = null,
}) {
  function fault(stage, turn) {
    faultInjector?.(stage, structuredClone(turn));
  }

  function requireTurn(userId, assistantId, conversationId, turnId) {
    conversationService.getConversation(userId, assistantId, conversationId);
    const record = turnRepository.findById(
      requireString(userId, 'userId', { maxLength: 128 }),
      requireString(assistantId, 'subjectId', { maxLength: 128 }),
      requireString(conversationId, 'conversationId', { maxLength: 128 }),
      requireString(turnId, 'turnId', { maxLength: 128 }),
    );
    if (!record) throw new NotFoundError('Conversation turn was not found.');
    return record;
  }

  function messageFor(record, kind) {
    const messageId = kind === 'user' ? record.userMessageId : record.subjectMessageId;
    if (!messageId) return null;
    const message = messageService.getMessage(
      record.userId,
      record.assistantId,
      record.conversationId,
      messageId,
    );
    return {
      messageId: message.messageId,
      messageVersionId: message.currentVersionId,
      senderType: message.senderType,
      content: message.content,
      sequenceNumber: message.sequenceNumber,
      createdAt: message.createdAt,
    };
  }

  function publicTurn(record) {
    return Object.freeze({
      turnId: record.turnId,
      userId: record.userId,
      subjectId: record.assistantId,
      conversationId: record.conversationId,
      status: record.status === 'publishing' ? 'processing' : record.status,
      userMessage: messageFor(record, 'user'),
      subjectMessage: messageFor(record, 'subject'),
      confirmation: record.confirmationId
        ? { confirmationId: record.confirmationId }
        : null,
      failure: record.publicFailureCode
        ? { code: record.publicFailureCode }
        : null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
    });
  }

  function transition(record, status, details = {}) {
    if (record.status === status
      && record.capabilityRequestId === (details.capabilityRequestId ?? record.capabilityRequestId)
      && record.engineOperationId === (details.engineOperationId ?? record.engineOperationId)
      && record.confirmationId === (details.confirmationId ?? null)
      && record.publicFailureCode === (details.publicFailureCode ?? null)) {
      return record;
    }
    const updated = turnRepository.transition(record, record.status, status, {
      ...details,
      updatedAt: instant(clock),
    });
    if (!updated) throw new ConflictError('Conversation turn changed concurrently.');
    return updated;
  }

  function publishCompleted(record, stored) {
    const envelope = stored?.envelope;
    if (!stored || stored.processingStage !== 'completed' || envelope?.status !== 'completed') {
      return record;
    }
    if (envelope.requestId !== record.requestId) {
      return transition(record, 'quarantined', { publicFailureCode: 'engine_request_mismatch' });
    }
    const original = requestService.getStoredRequest(record.requestId);
    if (
      envelope.requestHash !== original.requestHash
      || envelope.subjectId !== record.engineSubjectId
      || envelope.bindingId !== original.identity.bindingId
      || envelope.bindingVersion !== original.identity.bindingVersion
      || envelope.response?.role !== 'subject'
    ) {
      return transition(record, 'quarantined', { publicFailureCode: 'engine_result_mismatch' });
    }
    if (record.subjectMessageId) {
      if (
        record.engineOperationId !== envelope.operationId
        || record.engineResponseId !== envelope.response.responseId
      ) {
        return transition(record, 'quarantined', { publicFailureCode: 'engine_reply_conflict' });
      }
      if (record.status === 'publishing') {
        const completedAt = instant(clock);
        const completed = turnRepository.complete(record, completedAt);
        if (!completed) throw new ConflictError('Conversation turn completion changed concurrently.');
        return completed;
      }
      return record;
    }

    fault('before_subject_message_saved', record);
    const attached = runInTransaction(() => {
      const current = turnRepository.findByRequestId(record.requestId);
      if (current.subjectMessageId) return current;
      const subjectMessage = messageService.createMessage(
        current.userId,
        current.assistantId,
        current.conversationId,
        { senderType: 'subject', content: envelope.response.content },
      );
      const saved = turnRepository.attachReply(current, {
        capabilityRequestId: current.capabilityRequestId,
        engineOperationId: envelope.operationId,
        engineResponseId: envelope.response.responseId,
        subjectMessageId: subjectMessage.messageId,
        subjectMessageVersionId: subjectMessage.currentVersionId,
        updatedAt: instant(clock),
      });
      if (!saved) throw new ConflictError('Conversation turn reply changed concurrently.');
      return saved;
    });
    fault('after_subject_message_saved', attached);
    const completedAt = instant(clock);
    const completed = turnRepository.complete(attached, completedAt);
    if (!completed) throw new ConflictError('Conversation turn completion changed concurrently.');
    return completed;
  }

  function synchronize(record) {
    let current = turnRepository.findByRequestId(record.requestId) ?? record;
    if (current.status === 'publishing') {
      const stored = resultService.getStoredResult(current.requestId);
      return publishCompleted(current, stored);
    }
    if (TERMINAL_STATUSES.has(current.status)) return current;

    const stored = resultService.getStoredResult(current.requestId);
    if (stored?.processingStage === 'completed') return publishCompleted(current, stored);
    if (stored?.processingStage === 'terminal_error') {
      return transition(current, 'failed', {
        publicFailureCode: stored.envelope?.error?.code ?? 'engine_contract_error',
      });
    }
    if (stored && ['quarantined', 'reconciling'].includes(stored.reconciliationStatus)) {
      return transition(current, 'quarantined', {
        publicFailureCode: stored.reasonCode ?? 'engine_result_quarantined',
      });
    }

    const capability = capabilityService?.getExecutionStateByInteraction(current.requestId);
    if (capability) {
      const mapped = mapCapabilityStatus(capability);
      if (mapped) {
        return transition(current, mapped.status, {
          capabilityRequestId: capability.capabilityRequestId,
          engineOperationId: capability.operationId,
          confirmationId: mapped.confirmationId,
          publicFailureCode: mapped.failureCode,
        });
      }
      if (!current.capabilityRequestId) {
        current = transition(current, current.status, {
          capabilityRequestId: capability.capabilityRequestId,
          engineOperationId: capability.operationId,
          confirmationId: null,
        });
      }
    }

    const delivery = deliveryService.getOutbox(current.requestId);
    if (delivery?.status === 'quarantined') {
      return transition(current, 'quarantined', {
        publicFailureCode: delivery.errorCode ?? 'delivery_quarantined',
      });
    }
    if (delivery?.status === 'completed' && !stored) {
      return transition(current, 'failed', {
        publicFailureCode: delivery.errorCode ?? 'engine_capability_failed',
      });
    }
    if (delivery?.status === 'outcome_unknown' && !capability) {
      return transition(current, 'outcome_unknown');
    }
    return current;
  }

  async function drive(record, resume = null) {
    try {
      if (resume) {
        await deliveryService.resumeCapability(record.capabilityRequestId, resume);
      } else {
        await deliveryService.submitStoredRequest(record.requestId);
      }
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ValidationError) throw error;
    }
    return synchronize(record);
  }

  return Object.freeze({
    enabled: deliveryService.enabled,
    async createTurn(userId, assistantId, conversationId, idempotencyKey, value) {
      if (!deliveryService.enabled) {
        throw new ApplicationError('Continuity Engine integration is not configured.', {
          code: 'continuity_engine_unavailable',
          statusCode: 503,
        });
      }
      const normalizedKey = requireIdempotencyKey(idempotencyKey);
      const input = onlyFields(value, ['content']);
      const content = requireMessageContent(input.content);
      const inputContentHash = calculateContentHash(content);
      const scope = conversationService.getConversation(userId, assistantId, conversationId);
      if (scope.subjectId !== FIXED_ASSISTANT_ID) {
        throw new ValidationError('Conversation is not bound to the fixed local chat assistant.');
      }
      const existing = turnRepository.findByIdempotencyKey(normalizedKey);
      if (existing) {
        if (
          existing.userId !== scope.userId
          || existing.assistantId !== scope.subjectId
          || existing.conversationId !== scope.conversationId
          || existing.inputContentHash !== inputContentHash
        ) throw new ConflictError('Idempotency-Key is already bound to a different turn.');
        let replay = existing;
        if (!replay.requestId) {
          requestService.constructAndStoreRequest({
            requestId: replay.plannedRequestId,
            userId: replay.userId,
            assistantId: replay.assistantId,
            conversationId: replay.conversationId,
            messageId: replay.userMessageId,
            messageVersionId: replay.userMessageVersionId,
            observationId: replay.observationId,
            sourceEventId: replay.sourceEventId,
            factId: replay.factId,
            expectedEngineRevision: replay.expectedEngineRevision,
          });
          replay = runInTransaction(() => turnRepository.attachRequest(replay, instant(clock)));
        }
        replay = ['processing', 'outcome_unknown'].includes(replay.status)
          ? await drive(replay)
          : synchronize(replay);
        return { turn: publicTurn(replay), created: false };
      }

      let created = runInTransaction(() => {
        const userMessage = messageService.createMessage(
          scope.userId,
          scope.subjectId,
          scope.conversationId,
          { senderType: 'user', content },
        );
        const sourceEvent = eventRepository.findMessageCreatedByMessage(
          scope.userId,
          scope.subjectId,
          userMessage.messageId,
        );
        if (!sourceEvent) throw new ConflictError('User message Event was not persisted.');
        const requestId = idFactory();
        const head = resultService.getProjectionHead(ENGINE_SUBJECT_ID);
        return turnRepository.insert({
          turnId: idFactory(),
          idempotencyKey: normalizedKey,
          inputContentHash,
          userId: scope.userId,
          assistantId: scope.subjectId,
          engineSubjectId: ENGINE_SUBJECT_ID,
          conversationId: scope.conversationId,
          userMessageId: userMessage.messageId,
          userMessageVersionId: userMessage.currentVersionId,
          sourceEventId: sourceEvent.eventId,
          plannedRequestId: requestId,
          observationId: idFactory(),
          factId: idFactory(),
          expectedEngineRevision: head?.currentRevision ?? 0,
          createdAt: instant(clock),
        });
      });
      fault('after_turn_created', created);
      if (!created.requestId) {
        requestService.constructAndStoreRequest({
          requestId: created.plannedRequestId,
          userId: created.userId,
          assistantId: created.assistantId,
          conversationId: created.conversationId,
          messageId: created.userMessageId,
          messageVersionId: created.userMessageVersionId,
          observationId: created.observationId,
          sourceEventId: created.sourceEventId,
          factId: created.factId,
          expectedEngineRevision: created.expectedEngineRevision,
        });
        created = runInTransaction(() => turnRepository.attachRequest(created, instant(clock)));
      }
      fault('after_request_saved', created);
      const finalRecord = await drive(created);
      return { turn: publicTurn(finalRecord), created: true };
    },
    getTurn(userId, assistantId, conversationId, turnId) {
      return publicTurn(requireTurn(userId, assistantId, conversationId, turnId));
    },
    async resumeTurn(userId, assistantId, conversationId, turnId, value) {
      let record = requireTurn(userId, assistantId, conversationId, turnId);
      const input = onlyFields(value, ['confirmationId', 'retryApproved']);
      if (record.status === 'completed') return publicTurn(record);
      if (['failed', 'quarantined'].includes(record.status)) {
        throw new ConflictError('Terminal conversation turn cannot be resumed.');
      }
      let resume = null;
      if (['confirmation_required', 'budget_confirmation_required'].includes(record.status)) {
        const confirmationId = requireString(
          input.confirmationId,
          'confirmationId',
          { maxLength: 128 },
        );
        if (confirmationId !== record.confirmationId) {
          throw new ConflictError('Confirmation does not belong to this conversation turn.');
        }
        const decided = confirmationService.decideConfirmation(record.userId, confirmationId, {
          decision: 'approve',
        });
        if (decided.status !== 'approved') {
          throw new ConflictError('Confirmation was not approved.');
        }
        resume = record.status === 'confirmation_required'
          ? { securityConfirmationId: confirmationId }
          : { budgetConfirmationId: confirmationId };
      } else if (record.status === 'waiting_retry') {
        if (input.retryApproved !== true) {
          throw new ValidationError('retryApproved must be true for a Provider retry.');
        }
        resume = { retryApproved: true };
      } else if (record.status === 'waiting_budget') {
        resume = {};
      }
      record = await drive(record, resume);
      return publicTurn(record);
    },
    async initialize() {
      let reconciled = 0;
      for (const record of turnRepository.listRecoverable()) {
        try {
          // V4 and V3/V2 recovery run before V5. V5 startup only reconciles
          // durable local facts and must never originate an Engine/Provider call.
          const current = record.requestId ? synchronize(record) : record;
          if (current.status !== record.status || current.subjectMessageId !== record.subjectMessageId) {
            reconciled += 1;
          }
        } catch {
          // The turn remains recoverable; startup must not fabricate a terminal result.
        }
      }
      return { status: deliveryService.enabled ? 'ready' : 'disabled', reconciled };
    },
  });
}
