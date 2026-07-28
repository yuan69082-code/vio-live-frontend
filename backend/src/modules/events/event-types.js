export const EVENT_TYPES = Object.freeze([
  'appearance_changed',
  'subject_updated',
  'permission_created',
  'permission_changed',
  'permission_revoked',
  'confirmation_required',
  'life_record_created',
  'life_event_created',
  'budget_changed',
  'health_record_updated',
  'device_changed',
  'conversation_created',
  'message_created',
  'message_updated',
  'message_regenerated',
  'private_space_created',
  'private_memory_updated',
  'private_state_changed',
]);

export const EVENT_STATUSES = Object.freeze([
  'pending',
  'consumed',
  'ignored',
  'failed',
]);
