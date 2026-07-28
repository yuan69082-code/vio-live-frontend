import { ValidationError } from '../../core/errors.js';

const ASSEMBLY_ORDER = Object.freeze([
  'systemSafetyRules',
  'subjectGlobalSettings',
  'currentSubjectState',
  'unresolvedEvents',
  'recentMessages',
  'crossWindowSummaries',
  'longTermMemory',
  'currentUserMessage',
]);

function normalizeLimit(value, field, { fallback, minimum, maximum }) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (!/^\d+$/.test(String(value))) {
    throw new ValidationError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
      { field },
    );
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < minimum || limit > maximum) {
    throw new ValidationError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
      { field },
    );
  }

  return limit;
}

function projectEvent(event) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    summary: event.summary,
    occurredAt: event.occurredAt,
    status: event.status,
  };
}

export function createContextService({
  userService,
  subjectService,
  assistantGlobalSettingsService,
  conversationService,
  messageRepository,
  conversationSummaryService,
  subjectStateService,
  eventRepository,
  clock = () => new Date(),
}) {
  return {
    assembleContext(userId, subjectId, conversationId, options = {}) {
      const user = userService.getUser(userId);
      const subject = subjectService.getSubject(user.userId, subjectId);
      const subjectGlobalSettings = assistantGlobalSettingsService.getSettings(
        user.userId,
        subject.subjectId,
      );
      const conversation = conversationService.getConversation(
        user.userId,
        subject.subjectId,
        conversationId,
      );
      const recentMessageLimit = normalizeLimit(
        options.recentMessageLimit,
        'recentMessageLimit',
        { fallback: 20, minimum: 1, maximum: 50 },
      );
      const crossWindowSummaryLimit = normalizeLimit(
        options.crossWindowSummaryLimit,
        'crossWindowSummaryLimit',
        { fallback: 5, minimum: 0, maximum: 20 },
      );
      const messages = messageRepository.findRecent(
        conversation.userId,
        conversation.subjectId,
        conversation.conversationId,
        recentMessageLimit,
      );
      const currentUserMessage = messages.at(-1)?.senderType === 'user'
        ? messages.pop()
        : null;
      const currentSubjectState = subjectStateService.getCurrentState(
        conversation.userId,
        conversation.subjectId,
      );
      const unresolvedEvents = currentSubjectState
        ? currentSubjectState.unresolvedEventIds
            .map((eventId) => eventRepository.findById(conversation.userId, eventId))
            .filter((event) => event?.subjectId === conversation.subjectId)
            .map(projectEvent)
        : [];
      const crossWindowSummaries = crossWindowSummaryLimit === 0
        ? []
        : conversationSummaryService.listCrossWindowSummaries(
            conversation.userId,
            conversation.subjectId,
            conversation.conversationId,
            { limit: crossWindowSummaryLimit },
          );

      return {
        userId: conversation.userId,
        subjectId: conversation.subjectId,
        conversationId: conversation.conversationId,
        assembledAt: clock().toISOString(),
        assemblyOrder: [...ASSEMBLY_ORDER],
        sections: {
          systemSafetyRules: {
            status: 'reserved',
            items: [],
          },
          subjectGlobalSettings,
          currentSubjectState,
          unresolvedEvents,
          recentMessages: messages,
          crossWindowSummaries,
          longTermMemory: {
            status: 'not_implemented',
            items: [],
          },
          currentUserMessage,
        },
        execution: {
          modelCall: 'not_performed',
          externalApiCall: 'not_performed',
          continuityEngineCall: 'not_performed',
        },
      };
    },
  };
}
