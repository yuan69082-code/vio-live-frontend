-- vio-migration: foreign-keys-off

CREATE TABLE assistant_private_spaces (
  space_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, assistant_id),
  UNIQUE (user_id, assistant_id, space_id)
);

CREATE INDEX idx_assistant_private_spaces_user_status
  ON assistant_private_spaces (user_id, status, updated_at DESC, space_id);

CREATE TABLE assistant_private_content_versions (
  content_version_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (
    content_type IN (
      'ai_state_record',
      'ai_cognition_record',
      'ai_long_term_preference',
      'ai_work_record',
      'ai_private_note'
    )
  ),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  parent_version_id TEXT,
  content_json TEXT NOT NULL,
  change_reason TEXT NOT NULL CHECK (change_reason IN ('created', 'updated')),
  source_type TEXT NOT NULL CHECK (source_type = 'explicit_api_input'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id, assistant_id, space_id)
    REFERENCES assistant_private_spaces(user_id, assistant_id, space_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    assistant_id,
    space_id,
    content_id,
    parent_version_id
  ) REFERENCES assistant_private_content_versions(
    user_id,
    assistant_id,
    space_id,
    content_id,
    content_version_id
  ) ON DELETE RESTRICT,
  UNIQUE (user_id, assistant_id, space_id, content_id, version_number),
  UNIQUE (
    user_id,
    assistant_id,
    space_id,
    content_id,
    content_version_id
  )
);

CREATE INDEX idx_assistant_private_content_latest
  ON assistant_private_content_versions (
    user_id,
    assistant_id,
    space_id,
    content_type,
    content_id,
    version_number DESC
  );

CREATE TRIGGER assistant_private_content_versions_no_update
BEFORE UPDATE ON assistant_private_content_versions
BEGIN
  SELECT RAISE(ABORT, 'assistant private content versions are immutable');
END;

CREATE TRIGGER assistant_private_content_versions_no_delete
BEFORE DELETE ON assistant_private_content_versions
BEGIN
  SELECT RAISE(ABORT, 'assistant private content versions are immutable');
END;

CREATE TABLE events_013 (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'appearance_changed',
      'subject_updated',
      'permission_created',
      'permission_changed',
      'permission_revoked',
      'confirmation_required',
      'life_record_created',
      'device_changed',
      'conversation_created',
      'message_created',
      'message_updated',
      'message_regenerated',
      'private_space_created',
      'private_memory_updated',
      'private_state_changed'
    )
  ),
  source_type TEXT NOT NULL,
  source_ref TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  event_data_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'consumed', 'ignored', 'failed')
  ),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT
);

INSERT INTO events_013 (
  event_id,
  user_id,
  subject_id,
  event_type,
  source_type,
  source_ref,
  occurred_at,
  recorded_at,
  event_data_json,
  summary,
  status
)
SELECT
  event_id,
  user_id,
  subject_id,
  event_type,
  source_type,
  source_ref,
  occurred_at,
  recorded_at,
  event_data_json,
  summary,
  status
FROM events;

DROP TABLE events;
ALTER TABLE events_013 RENAME TO events;

CREATE INDEX idx_events_user_time
  ON events (user_id, occurred_at DESC);

CREATE INDEX idx_events_user_subject_time
  ON events (user_id, subject_id, occurred_at DESC);

CREATE INDEX idx_events_user_type_status_time
  ON events (user_id, event_type, status, occurred_at DESC);

CREATE UNIQUE INDEX idx_events_user_subject_and_event
  ON events (user_id, subject_id, event_id);

CREATE UNIQUE INDEX idx_events_user_and_event
  ON events (user_id, event_id);
