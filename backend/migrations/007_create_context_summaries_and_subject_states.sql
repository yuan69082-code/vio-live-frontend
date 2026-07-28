CREATE UNIQUE INDEX idx_events_user_subject_event
  ON events (user_id, subject_id, event_id);

CREATE TABLE conversation_summaries (
  summary_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  summary_version INTEGER NOT NULL CHECK (summary_version > 0),
  summary_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'active'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id, subject_id, conversation_id)
    REFERENCES conversations(user_id, subject_id, conversation_id)
      ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, conversation_id, summary_id),
  UNIQUE (user_id, subject_id, conversation_id, summary_version)
);

CREATE INDEX idx_conversation_summaries_scope_version
  ON conversation_summaries (
    user_id,
    subject_id,
    conversation_id,
    summary_version DESC,
    summary_id
  );

CREATE TABLE conversation_summary_sources (
  summary_source_id TEXT PRIMARY KEY,
  summary_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  source_order INTEGER NOT NULL CHECK (source_order > 0),
  source_type TEXT NOT NULL CHECK (
    source_type IN ('message_version', 'event')
  ),
  source_message_id TEXT,
  source_message_version_id TEXT,
  source_event_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id, subject_id, conversation_id, summary_id)
    REFERENCES conversation_summaries(
      user_id,
      subject_id,
      conversation_id,
      summary_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    subject_id,
    conversation_id,
    source_message_id,
    source_message_version_id
  ) REFERENCES message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id, source_event_id)
    REFERENCES events(user_id, subject_id, event_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, conversation_id, summary_id, source_order),
  CHECK (
    (
      source_type = 'message_version'
      AND source_message_id IS NOT NULL
      AND source_message_version_id IS NOT NULL
      AND source_event_id IS NULL
    ) OR (
      source_type = 'event'
      AND source_message_id IS NULL
      AND source_message_version_id IS NULL
      AND source_event_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX idx_summary_sources_message_version
  ON conversation_summary_sources (
    user_id,
    subject_id,
    conversation_id,
    summary_id,
    source_message_id,
    source_message_version_id
  )
  WHERE source_type = 'message_version';

CREATE UNIQUE INDEX idx_summary_sources_event
  ON conversation_summary_sources (
    user_id,
    subject_id,
    conversation_id,
    summary_id,
    source_event_id
  )
  WHERE source_type = 'event';

CREATE INDEX idx_summary_sources_summary_order
  ON conversation_summary_sources (
    user_id,
    subject_id,
    conversation_id,
    summary_id,
    source_order
  );

CREATE TRIGGER prevent_conversation_summary_update
BEFORE UPDATE ON conversation_summaries
BEGIN
  SELECT RAISE(ABORT, 'conversation summaries are immutable');
END;

CREATE TRIGGER prevent_conversation_summary_delete
BEFORE DELETE ON conversation_summaries
BEGIN
  SELECT RAISE(ABORT, 'conversation summaries require a governed retention process');
END;

CREATE TRIGGER prevent_conversation_summary_source_update
BEFORE UPDATE ON conversation_summary_sources
BEGIN
  SELECT RAISE(ABORT, 'conversation summary sources are immutable');
END;

CREATE TRIGGER prevent_conversation_summary_source_delete
BEFORE DELETE ON conversation_summary_sources
BEGIN
  SELECT RAISE(ABORT, 'conversation summary sources require a governed retention process');
END;

CREATE TABLE subject_states (
  subject_state_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK (state_version > 0),
  current_state_json TEXT NOT NULL,
  emotion TEXT NOT NULL,
  intensity REAL NOT NULL CHECK (intensity >= 0 AND intensity <= 1),
  change_reason TEXT NOT NULL,
  continuity_constraints_json TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('message_version', 'event', 'conversation_summary')
  ),
  source_conversation_id TEXT,
  source_message_id TEXT,
  source_message_version_id TEXT,
  source_event_id TEXT,
  source_summary_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    subject_id,
    source_conversation_id,
    source_message_id,
    source_message_version_id
  ) REFERENCES message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id, source_event_id)
    REFERENCES events(user_id, subject_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    subject_id,
    source_conversation_id,
    source_summary_id
  ) REFERENCES conversation_summaries (
    user_id,
    subject_id,
    conversation_id,
    summary_id
  ) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, subject_state_id),
  UNIQUE (user_id, subject_id, state_version),
  CHECK (
    (
      source_type = 'message_version'
      AND source_conversation_id IS NOT NULL
      AND source_message_id IS NOT NULL
      AND source_message_version_id IS NOT NULL
      AND source_event_id IS NULL
      AND source_summary_id IS NULL
    ) OR (
      source_type = 'event'
      AND source_conversation_id IS NULL
      AND source_message_id IS NULL
      AND source_message_version_id IS NULL
      AND source_event_id IS NOT NULL
      AND source_summary_id IS NULL
    ) OR (
      source_type = 'conversation_summary'
      AND source_conversation_id IS NOT NULL
      AND source_message_id IS NULL
      AND source_message_version_id IS NULL
      AND source_event_id IS NULL
      AND source_summary_id IS NOT NULL
    )
  )
);

CREATE INDEX idx_subject_states_scope_version
  ON subject_states (
    user_id,
    subject_id,
    state_version DESC,
    subject_state_id
  );

CREATE TABLE subject_state_heads (
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  current_subject_state_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, subject_id),
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id, current_subject_state_id)
    REFERENCES subject_states(user_id, subject_id, subject_state_id)
      ON DELETE RESTRICT
);

CREATE TABLE subject_state_unresolved_events (
  subject_state_event_id TEXT PRIMARY KEY,
  subject_state_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  event_order INTEGER NOT NULL CHECK (event_order > 0),
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id, subject_id, subject_state_id)
    REFERENCES subject_states(user_id, subject_id, subject_state_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id, event_id)
    REFERENCES events(user_id, subject_id, event_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, subject_state_id, event_order),
  UNIQUE (user_id, subject_id, subject_state_id, event_id)
);

CREATE INDEX idx_subject_state_unresolved_events_state_order
  ON subject_state_unresolved_events (
    user_id,
    subject_id,
    subject_state_id,
    event_order
  );

CREATE TRIGGER prevent_subject_state_update
BEFORE UPDATE ON subject_states
BEGIN
  SELECT RAISE(ABORT, 'subject states are immutable');
END;

CREATE TRIGGER prevent_subject_state_delete
BEFORE DELETE ON subject_states
BEGIN
  SELECT RAISE(ABORT, 'subject states require a governed retention process');
END;

CREATE TRIGGER prevent_subject_state_event_update
BEFORE UPDATE ON subject_state_unresolved_events
BEGIN
  SELECT RAISE(ABORT, 'subject state event references are immutable');
END;

CREATE TRIGGER prevent_subject_state_event_delete
BEFORE DELETE ON subject_state_unresolved_events
BEGIN
  SELECT RAISE(ABORT, 'subject state event references require a governed retention process');
END;
