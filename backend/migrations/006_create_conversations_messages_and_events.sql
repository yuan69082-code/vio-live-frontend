CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('active', 'archived')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, conversation_id)
);

CREATE INDEX idx_conversations_user_subject_activity
  ON conversations (
    user_id,
    subject_id,
    last_activity_at DESC,
    conversation_id
  );

CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (
    sender_type IN ('user', 'subject', 'system')
  ),
  status TEXT NOT NULL CHECK (status = 'active'),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id, subject_id, conversation_id)
    REFERENCES conversations(user_id, subject_id, conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    current_version_id
  ) REFERENCES message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (user_id, subject_id, conversation_id, message_id),
  UNIQUE (user_id, subject_id, conversation_id, sequence_number)
);

CREATE INDEX idx_messages_conversation_sequence
  ON messages (
    user_id,
    subject_id,
    conversation_id,
    sequence_number,
    message_id
  );

CREATE TABLE message_versions (
  message_version_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  sender_type TEXT NOT NULL CHECK (
    sender_type IN ('user', 'subject', 'system')
  ),
  change_reason TEXT NOT NULL CHECK (
    change_reason IN ('original', 'edited', 'regenerated')
  ),
  content TEXT NOT NULL,
  parent_version_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id, subject_id, conversation_id, message_id)
    REFERENCES messages(user_id, subject_id, conversation_id, message_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    parent_version_id
  ) REFERENCES message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ) ON DELETE RESTRICT,
  UNIQUE (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ),
  UNIQUE (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    version_number
  ),
  CHECK (
    (
      change_reason = 'original'
      AND version_number = 1
      AND parent_version_id IS NULL
    ) OR (
      change_reason IN ('edited', 'regenerated')
      AND version_number > 1
      AND parent_version_id IS NOT NULL
    )
  )
);

CREATE INDEX idx_message_versions_message_number
  ON message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    version_number,
    message_version_id
  );

CREATE TRIGGER prevent_message_version_update
BEFORE UPDATE ON message_versions
BEGIN
  SELECT RAISE(ABORT, 'message versions are immutable');
END;

CREATE TRIGGER prevent_message_version_delete
BEFORE DELETE ON message_versions
BEGIN
  SELECT RAISE(ABORT, 'message versions require a governed retention process');
END;

CREATE TABLE events_006 (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'appearance_changed',
      'subject_updated',
      'permission_changed',
      'life_record_created',
      'device_changed',
      'conversation_created',
      'message_created',
      'message_updated',
      'message_regenerated'
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

INSERT INTO events_006 (
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

ALTER TABLE events_006 RENAME TO events;

CREATE INDEX idx_events_user_time
  ON events (user_id, occurred_at DESC);

CREATE INDEX idx_events_user_subject_time
  ON events (user_id, subject_id, occurred_at DESC);

CREATE INDEX idx_events_user_type_status_time
  ON events (user_id, event_type, status, occurred_at DESC);
