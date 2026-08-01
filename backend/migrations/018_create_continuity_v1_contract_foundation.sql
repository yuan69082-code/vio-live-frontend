CREATE TABLE continuity_first_round_binding_fixtures (
  binding_id TEXT PRIMARY KEY CHECK (binding_id = 'binding-001'),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'subject-binding/first-round-v1'
  ),
  user_id TEXT NOT NULL CHECK (user_id = 'user-001'),
  assistant_id TEXT NOT NULL CHECK (assistant_id = 'assistant-001'),
  engine_subject_id TEXT NOT NULL CHECK (engine_subject_id = 'subject-001'),
  binding_version INTEGER NOT NULL CHECK (binding_version = 1),
  status TEXT NOT NULL CHECK (status = 'active'),
  created_at TEXT NOT NULL CHECK (created_at = '2026-07-30T00:00:00Z'),
  effective_at TEXT NOT NULL CHECK (effective_at = '2026-07-30T00:00:00Z'),
  replaced_binding_id TEXT CHECK (replaced_binding_id IS NULL),
  binding_fixture_hash TEXT NOT NULL CHECK (
    binding_fixture_hash = 'sha256:c75b72194c0158a549f3fb30f04a5147ea11a4e777cb1a9cc1a54da6b93359f6'
  ),
  fixture_json TEXT NOT NULL CHECK (json_valid(fixture_json)),
  loaded_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, assistant_id, binding_id, binding_version)
);

CREATE TABLE continuity_first_round_requests (
  request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 71
    AND substr(request_hash, 1, 7) = 'sha256:'
    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  binding_id TEXT NOT NULL CHECK (binding_id = 'binding-001'),
  binding_version INTEGER NOT NULL CHECK (binding_version = 1),
  binding_fixture_hash TEXT NOT NULL CHECK (
    binding_fixture_hash = 'sha256:c75b72194c0158a549f3fb30f04a5147ea11a4e777cb1a9cc1a54da6b93359f6'
  ),
  user_id TEXT NOT NULL CHECK (user_id = 'user-001'),
  assistant_id TEXT NOT NULL CHECK (assistant_id = 'assistant-001'),
  engine_subject_id TEXT NOT NULL CHECK (engine_subject_id = 'subject-001'),
  expected_engine_revision INTEGER NOT NULL CHECK (expected_engine_revision >= 0),
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message_version_id TEXT NOT NULL,
  observation_id TEXT NOT NULL UNIQUE,
  source_event_id TEXT NOT NULL UNIQUE,
  fact_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  logical_request_json TEXT NOT NULL CHECK (json_valid(logical_request_json)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (binding_id)
    REFERENCES continuity_first_round_binding_fixtures(binding_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES conversations(user_id, subject_id, conversation_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (
    user_id,
    assistant_id,
    conversation_id,
    message_id,
    message_version_id
  ) REFERENCES message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, source_event_id)
    REFERENCES events(user_id, subject_id, event_id) ON DELETE RESTRICT
);

CREATE INDEX idx_continuity_first_round_requests_scope
  ON continuity_first_round_requests (
    user_id,
    assistant_id,
    engine_subject_id,
    created_at,
    request_id
  );

CREATE TRIGGER prevent_continuity_first_round_binding_update
BEFORE UPDATE ON continuity_first_round_binding_fixtures
BEGIN
  SELECT RAISE(ABORT, 'first-round SubjectBinding fixture is immutable');
END;

CREATE TRIGGER prevent_continuity_first_round_binding_delete
BEFORE DELETE ON continuity_first_round_binding_fixtures
BEGIN
  SELECT RAISE(ABORT, 'first-round SubjectBinding fixture cannot be deleted');
END;

CREATE TRIGGER prevent_continuity_first_round_request_update
BEFORE UPDATE ON continuity_first_round_requests
BEGIN
  SELECT RAISE(ABORT, 'first-round continuity requests are immutable');
END;

CREATE TRIGGER prevent_continuity_first_round_request_delete
BEFORE DELETE ON continuity_first_round_requests
BEGIN
  SELECT RAISE(ABORT, 'first-round continuity requests require governed retention');
END;
