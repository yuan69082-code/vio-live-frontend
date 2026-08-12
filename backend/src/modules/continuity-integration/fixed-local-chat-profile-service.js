import { isDeepStrictEqual } from 'node:util';

import { ConflictError } from '../../core/errors.js';

export const FIXED_LOCAL_CHAT_PROFILE = Object.freeze({
  userId: 'user-001',
  assistantId: 'assistant-001',
  engineSubjectId: 'subject-001',
  bindingId: 'binding-001',
  bindingVersion: 1,
  conversationId: 'conversation-001',
});

const PROFILE_CREATED_AT = '2026-07-30T00:00:00Z';

function assertMatch(actual, expected, name) {
  if (!actual || Object.entries(expected).some(([key, value]) => !isDeepStrictEqual(actual[key], value))) {
    throw new ConflictError(`Existing ${name} does not match the fixed local chat profile.`);
  }
}

export function createFixedLocalChatProfileService({
  userRepository,
  userSpaceRepository,
  subjectRepository,
  assistantGlobalSettingsRepository,
  conversationRepository,
  eventService,
  requestService,
  runInTransaction,
}) {
  function prepare() {
    return runInTransaction(() => {
      const expectedUser = {
        userId: FIXED_LOCAL_CHAT_PROFILE.userId,
        email: 'local-chat@vio.invalid',
        displayName: 'Vio Local Chat User',
        status: 'active',
      };
      let user = userRepository.findById(expectedUser.userId);
      if (!user) {
        user = userRepository.insert({
          ...expectedUser,
          createdAt: PROFILE_CREATED_AT,
          updatedAt: PROFILE_CREATED_AT,
        });
      } else {
        assertMatch(user, expectedUser, 'user');
      }

      const expectedAssistant = {
        subjectId: FIXED_LOCAL_CHAT_PROFILE.assistantId,
        ownerUserId: FIXED_LOCAL_CHAT_PROFILE.userId,
        name: 'Vio',
        avatarRef: null,
        basicSettings: { profile: 'fixed-local-chat-v1' },
        status: 'active',
      };
      let assistant = subjectRepository.findById(
        expectedAssistant.ownerUserId,
        expectedAssistant.subjectId,
      );
      if (!assistant) {
        assistant = subjectRepository.insert({
          ...expectedAssistant,
          createdAt: PROFILE_CREATED_AT,
          updatedAt: PROFILE_CREATED_AT,
        });
        assistantGlobalSettingsRepository.insert({
          ownerUserId: expectedAssistant.ownerUserId,
          subjectId: expectedAssistant.subjectId,
          personalityDescription: 'Fixed local chat profile for Continuity integration.',
          expressionStyle: {},
          relationshipDefinition: 'Local development assistant',
          longTermRequirements: [],
          prohibitions: [],
          createdAt: PROFILE_CREATED_AT,
          updatedAt: PROFILE_CREATED_AT,
        });
      } else {
        assertMatch(assistant, expectedAssistant, 'assistant');
        if (!assistantGlobalSettingsRepository.findBySubject(
          expectedAssistant.ownerUserId,
          expectedAssistant.subjectId,
        )) {
          throw new ConflictError('Fixed local assistant global settings are missing.');
        }
      }

      const expectedSpace = {
        spaceId: 'user-space-user-001',
        userId: FIXED_LOCAL_CHAT_PROFILE.userId,
        identityMode: 'development_unverified',
        status: 'active',
        currentAssistantId: FIXED_LOCAL_CHAT_PROFILE.assistantId,
      };
      let userSpace = userSpaceRepository.findByUser(expectedSpace.userId);
      if (!userSpace) {
        userSpace = userSpaceRepository.insert({
          ...expectedSpace,
          createdAt: PROFILE_CREATED_AT,
          updatedAt: PROFILE_CREATED_AT,
        });
      } else {
        assertMatch(userSpace, expectedSpace, 'user space');
      }

      const expectedConversation = {
        conversationId: FIXED_LOCAL_CHAT_PROFILE.conversationId,
        userId: FIXED_LOCAL_CHAT_PROFILE.userId,
        subjectId: FIXED_LOCAL_CHAT_PROFILE.assistantId,
        title: 'Vio Local Chat',
        status: 'active',
      };
      let conversation = conversationRepository.findById(
        expectedConversation.userId,
        expectedConversation.subjectId,
        expectedConversation.conversationId,
      );
      if (!conversation) {
        conversation = conversationRepository.insert({
          ...expectedConversation,
          createdAt: PROFILE_CREATED_AT,
          updatedAt: PROFILE_CREATED_AT,
          lastActivityAt: PROFILE_CREATED_AT,
        });
        eventService.createEvent(expectedConversation.userId, {
          subjectId: expectedConversation.subjectId,
          eventType: 'conversation_created',
          source: {
            type: 'fixed-local-chat-profile',
            reference: expectedConversation.conversationId,
          },
          occurredAt: PROFILE_CREATED_AT,
          data: {
            conversationId: expectedConversation.conversationId,
            status: expectedConversation.status,
          },
          summary: 'The fixed local chat conversation was prepared.',
        });
      } else {
        assertMatch(conversation, expectedConversation, 'conversation');
      }

      const binding = requestService.loadFixedLocalChatProfileBinding();
      return Object.freeze({
        ...FIXED_LOCAL_CHAT_PROFILE,
        userStatus: user.status,
        assistantStatus: assistant.status,
        conversationStatus: conversation.status,
        bindingStatus: binding.fixture.status,
      });
    });
  }

  return Object.freeze({ prepare });
}
