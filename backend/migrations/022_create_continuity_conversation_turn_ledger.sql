CREATE TABLE continuity_conversation_turns (
  turn_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  input_content_hash TEXT NOT NULL CHECK (
    length(input_content_hash) = 71
    AND substr(input_content_hash, 1, 7) = 'sha256:'
    AND substr(input_content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  engine_subject_id TEXT NOT NULL CHECK (engine_subject_id = 'subject-001'),
  conversation_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL UNIQUE,
  user_message_version_id TEXT NOT NULL UNIQUE,
  source_event_id TEXT NOT NULL UNIQUE,
  planned_request_id TEXT NOT NULL UNIQUE,
  request_id TEXT UNIQUE,
  observation_id TEXT NOT NULL UNIQUE,
  fact_id TEXT NOT NULL UNIQUE,
  expected_engine_revision INTEGER NOT NULL CHECK (expected_engine_revision >= 0),
  capability_request_id TEXT UNIQUE,
  engine_operation_id TEXT,
  engine_response_id TEXT UNIQUE,
  subject_message_id TEXT UNIQUE,
  subject_message_version_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'processing',
    'confirmation_required',
    'budget_confirmation_required',
    'waiting_budget',
    'waiting_retry',
    'outcome_unknown',
    'publishing',
    'completed',
    'failed',
    'quarantined'
  )),
  confirmation_id TEXT,
  public_failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES conversations(user_id, subject_id, conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    assistant_id,
    conversation_id,
    user_message_id,
    user_message_version_id
  ) REFERENCES message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, source_event_id)
    REFERENCES events(user_id, subject_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (request_id)
    REFERENCES continuity_first_round_requests(request_id) ON DELETE RESTRICT,
  FOREIGN KEY (capability_request_id)
    REFERENCES continuity_capability_requests(capability_request_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    assistant_id,
    conversation_id,
    subject_message_id,
    subject_message_version_id
  ) REFERENCES message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ) ON DELETE RESTRICT,
  CHECK (
    (subject_message_id IS NULL AND subject_message_version_id IS NULL)
    OR (subject_message_id IS NOT NULL AND subject_message_version_id IS NOT NULL)
  ),
  CHECK (request_id IS NULL OR request_id = planned_request_id),
  CHECK (
    (status = 'completed'
      AND engine_operation_id IS NOT NULL
      AND engine_response_id IS NOT NULL
      AND subject_message_id IS NOT NULL
      AND subject_message_version_id IS NOT NULL
      AND completed_at IS NOT NULL
      AND public_failure_code IS NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE INDEX idx_continuity_conversation_turns_scope
  ON continuity_conversation_turns (
    user_id,
    assistant_id,
    conversation_id,
    created_at,
    turn_id
  );

CREATE INDEX idx_continuity_conversation_turns_status
  ON continuity_conversation_turns (status, updated_at, turn_id);

CREATE UNIQUE INDEX idx_continuity_conversation_turns_active_engine_subject
  ON continuity_conversation_turns (engine_subject_id)
  WHERE status NOT IN ('completed', 'failed', 'quarantined');

CREATE TRIGGER validate_continuity_conversation_turn_user_message
BEFORE INSERT ON continuity_conversation_turns
WHEN NOT EXISTS (
  SELECT 1
  FROM messages
  WHERE user_id = NEW.user_id
    AND subject_id = NEW.assistant_id
    AND conversation_id = NEW.conversation_id
    AND message_id = NEW.user_message_id
    AND current_version_id = NEW.user_message_version_id
    AND sender_type = 'user'
    AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'conversation turn requires its original active user message');
END;

CREATE TRIGGER validate_continuity_conversation_turn_subject_message
BEFORE UPDATE OF subject_message_id, subject_message_version_id
ON continuity_conversation_turns
WHEN NEW.subject_message_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM messages
  WHERE user_id = NEW.user_id
    AND subject_id = NEW.assistant_id
    AND conversation_id = NEW.conversation_id
    AND message_id = NEW.subject_message_id
    AND current_version_id = NEW.subject_message_version_id
    AND sender_type = 'subject'
    AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'conversation turn reply must be an active subject message');
END;

CREATE TRIGGER protect_continuity_conversation_turn_identity
BEFORE UPDATE ON continuity_conversation_turns
WHEN
  NEW.turn_id IS NOT OLD.turn_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.input_content_hash IS NOT OLD.input_content_hash
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.assistant_id IS NOT OLD.assistant_id
  OR NEW.engine_subject_id IS NOT OLD.engine_subject_id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.user_message_id IS NOT OLD.user_message_id
  OR NEW.user_message_version_id IS NOT OLD.user_message_version_id
  OR NEW.source_event_id IS NOT OLD.source_event_id
  OR NEW.planned_request_id IS NOT OLD.planned_request_id
  OR NEW.observation_id IS NOT OLD.observation_id
  OR NEW.fact_id IS NOT OLD.fact_id
  OR NEW.expected_engine_revision IS NOT OLD.expected_engine_revision
  OR (OLD.request_id IS NOT NULL AND NEW.request_id IS NOT OLD.request_id)
  OR (OLD.request_id IS NULL AND NEW.request_id IS NOT NULL AND NEW.request_id IS NOT OLD.planned_request_id)
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.capability_request_id IS NOT NULL AND NEW.capability_request_id IS NOT OLD.capability_request_id)
  OR (OLD.engine_operation_id IS NOT NULL AND NEW.engine_operation_id IS NOT OLD.engine_operation_id)
  OR (OLD.engine_response_id IS NOT NULL AND NEW.engine_response_id IS NOT OLD.engine_response_id)
  OR (OLD.subject_message_id IS NOT NULL AND NEW.subject_message_id IS NOT OLD.subject_message_id)
  OR (OLD.subject_message_version_id IS NOT NULL AND NEW.subject_message_version_id IS NOT OLD.subject_message_version_id)
BEGIN
  SELECT RAISE(ABORT, 'conversation turn identity and historical links are immutable');
END;

CREATE TRIGGER protect_terminal_continuity_conversation_turn
BEFORE UPDATE ON continuity_conversation_turns
WHEN OLD.status IN ('completed', 'failed', 'quarantined')
BEGIN
  SELECT RAISE(ABORT, 'terminal conversation turn is immutable');
END;

CREATE TRIGGER prevent_continuity_conversation_turn_delete
BEFORE DELETE ON continuity_conversation_turns
BEGIN
  SELECT RAISE(ABORT, 'conversation turns require governed retention');
END;
