CREATE UNIQUE INDEX idx_subjects_owner_and_subject
  ON subjects (owner_user_id, subject_id);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'appearance_changed',
      'subject_updated',
      'permission_changed',
      'life_record_created',
      'device_changed'
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

CREATE INDEX idx_events_user_time
  ON events (user_id, occurred_at DESC);

CREATE INDEX idx_events_user_subject_time
  ON events (user_id, subject_id, occurred_at DESC);

CREATE INDEX idx_events_user_type_status_time
  ON events (user_id, event_type, status, occurred_at DESC);
