CREATE TABLE continuity_first_round_results (
  request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 71
    AND substr(request_hash, 1, 7) = 'sha256:'
    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  envelope_hash TEXT NOT NULL CHECK (
    length(envelope_hash) = 71
    AND substr(envelope_hash, 1, 7) = 'sha256:'
    AND substr(envelope_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  envelope_type TEXT NOT NULL CHECK (envelope_type IN ('success', 'error')),
  engine_request_id TEXT NOT NULL,
  engine_request_hash TEXT,
  operation_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed_terminal')),
  response_id TEXT,
  envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  state_projection_json TEXT CHECK (
    state_projection_json IS NULL OR json_valid(state_projection_json)
  ),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  consumed_observation_ids_json TEXT CHECK (
    consumed_observation_ids_json IS NULL
    OR json_valid(consumed_observation_ids_json)
  ),
  completed_at TEXT,
  receive_status TEXT NOT NULL CHECK (receive_status = 'received'),
  validation_status TEXT NOT NULL CHECK (validation_status = 'validated'),
  save_status TEXT NOT NULL CHECK (save_status = 'persisted'),
  processing_stage TEXT NOT NULL CHECK (
    processing_stage IN (
      'received',
      'projection_saved',
      'pointer_applied',
      'completed',
      'terminal_error',
      'reconciling',
      'quarantined'
    )
  ),
  publication_status TEXT NOT NULL CHECK (publication_status = 'not_published'),
  reconciliation_status TEXT NOT NULL CHECK (
    reconciliation_status IN ('none', 'reconciling', 'quarantined')
  ),
  disposition TEXT NOT NULL CHECK (
    disposition IN ('none', 'never', 'reassemble', 'reconciling', 'quarantined')
  ),
  reason_code TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (request_id)
    REFERENCES continuity_first_round_requests(request_id) ON DELETE RESTRICT,
  CHECK (
    (
      envelope_type = 'success'
      AND status = 'completed'
      AND engine_request_hash IS NOT NULL
      AND response_json IS NOT NULL
      AND state_projection_json IS NOT NULL
      AND error_json IS NULL
      AND consumed_observation_ids_json IS NOT NULL
      AND completed_at IS NOT NULL
      AND (
        reconciliation_status = 'quarantined'
        OR (operation_id IS NOT NULL AND response_id IS NOT NULL)
      )
    ) OR (
      envelope_type = 'error'
      AND status = 'failed_terminal'
      AND engine_request_hash IS NULL
      AND operation_id IS NULL
      AND response_id IS NULL
      AND response_json IS NULL
      AND state_projection_json IS NULL
      AND error_json IS NOT NULL
      AND consumed_observation_ids_json IS NULL
      AND completed_at IS NULL
    )
  ),
  CHECK (
    (
      reconciliation_status = 'none'
      AND processing_stage NOT IN ('reconciling', 'quarantined')
      AND reason_code IS NULL
    ) OR (
      reconciliation_status = 'reconciling'
      AND processing_stage = 'reconciling'
      AND reason_code IS NOT NULL
    ) OR (
      reconciliation_status = 'quarantined'
      AND processing_stage = 'quarantined'
      AND reason_code IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX idx_continuity_first_round_results_operation
  ON continuity_first_round_results (operation_id)
  WHERE operation_id IS NOT NULL;

CREATE UNIQUE INDEX idx_continuity_first_round_results_response
  ON continuity_first_round_results (response_id)
  WHERE response_id IS NOT NULL;

CREATE INDEX idx_continuity_first_round_results_stage
  ON continuity_first_round_results (
    processing_stage,
    reconciliation_status,
    received_at,
    request_id
  );

CREATE TABLE continuity_engine_state_projection_versions (
  subject_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL CHECK (current_revision >= 0),
  binding_id TEXT NOT NULL,
  binding_version INTEGER NOT NULL CHECK (binding_version = 1),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'engine-subject-state-projection/first-round-v1'
  ),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  state_hash TEXT NOT NULL CHECK (
    length(state_hash) = 71
    AND substr(state_hash, 1, 7) = 'sha256:'
    AND substr(state_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 71
    AND substr(content_hash, 1, 7) = 'sha256:'
    AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  receive_status TEXT NOT NULL CHECK (receive_status = 'validated'),
  first_completed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (subject_id, current_revision),
  FOREIGN KEY (binding_id)
    REFERENCES continuity_first_round_binding_fixtures(binding_id)
      ON DELETE RESTRICT
);

CREATE TABLE continuity_engine_state_projection_receipts (
  request_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  response_id TEXT NOT NULL UNIQUE,
  subject_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL CHECK (current_revision >= 0),
  previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
  changed INTEGER NOT NULL CHECK (changed IN (0, 1)),
  engine_update_id TEXT,
  completed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  FOREIGN KEY (request_id)
    REFERENCES continuity_first_round_results(request_id) ON DELETE RESTRICT,
  FOREIGN KEY (subject_id, current_revision)
    REFERENCES continuity_engine_state_projection_versions(
      subject_id,
      current_revision
    ) ON DELETE RESTRICT,
  CHECK (
    (
      changed = 0
      AND current_revision = previous_revision
      AND engine_update_id IS NULL
    ) OR (
      changed = 1
      AND current_revision = previous_revision + 1
      AND engine_update_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX idx_continuity_projection_receipts_engine_update
  ON continuity_engine_state_projection_receipts (engine_update_id)
  WHERE engine_update_id IS NOT NULL;

CREATE INDEX idx_continuity_projection_receipts_revision
  ON continuity_engine_state_projection_receipts (
    subject_id,
    current_revision,
    completed_at,
    request_id
  );

CREATE TABLE continuity_engine_state_projection_heads (
  subject_id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL,
  binding_version INTEGER NOT NULL CHECK (binding_version = 1),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 0),
  state_hash TEXT NOT NULL CHECK (
    length(state_hash) = 71
    AND substr(state_hash, 1, 7) = 'sha256:'
    AND substr(state_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 71
    AND substr(content_hash, 1, 7) = 'sha256:'
    AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  current_request_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id, current_revision)
    REFERENCES continuity_engine_state_projection_versions(
      subject_id,
      current_revision
    ) ON DELETE RESTRICT,
  FOREIGN KEY (current_request_id)
    REFERENCES continuity_engine_state_projection_receipts(request_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (binding_id)
    REFERENCES continuity_first_round_binding_fixtures(binding_id)
      ON DELETE RESTRICT
);

CREATE TABLE continuity_first_round_result_incidents (
  incident_id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  candidate_envelope_hash TEXT NOT NULL CHECK (
    length(candidate_envelope_hash) = 71
    AND substr(candidate_envelope_hash, 1, 7) = 'sha256:'
    AND substr(candidate_envelope_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  disposition TEXT NOT NULL CHECK (disposition IN ('reconciling', 'quarantined')),
  reason_code TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (request_id)
    REFERENCES continuity_first_round_requests(request_id) ON DELETE RESTRICT,
  UNIQUE (request_id, candidate_envelope_hash, reason_code)
);

CREATE INDEX idx_continuity_result_incidents_request_time
  ON continuity_first_round_result_incidents (
    request_id,
    recorded_at,
    incident_id
  );

CREATE TRIGGER validate_continuity_result_request_hash
BEFORE INSERT ON continuity_first_round_results
WHEN NOT EXISTS (
  SELECT 1
  FROM continuity_first_round_requests
  WHERE request_id = NEW.request_id
    AND request_hash = NEW.request_hash
)
BEGIN
  SELECT RAISE(ABORT, 'continuity result must match its immutable V1 request');
END;

CREATE TRIGGER prevent_continuity_result_identity_update
BEFORE UPDATE ON continuity_first_round_results
WHEN
  OLD.request_id IS NOT NEW.request_id
  OR OLD.request_hash IS NOT NEW.request_hash
  OR OLD.envelope_hash IS NOT NEW.envelope_hash
  OR OLD.envelope_type IS NOT NEW.envelope_type
  OR OLD.engine_request_id IS NOT NEW.engine_request_id
  OR OLD.engine_request_hash IS NOT NEW.engine_request_hash
  OR OLD.operation_id IS NOT NEW.operation_id
  OR OLD.status IS NOT NEW.status
  OR OLD.response_id IS NOT NEW.response_id
  OR OLD.envelope_json IS NOT NEW.envelope_json
  OR OLD.response_json IS NOT NEW.response_json
  OR OLD.state_projection_json IS NOT NEW.state_projection_json
  OR OLD.error_json IS NOT NEW.error_json
  OR OLD.consumed_observation_ids_json IS NOT NEW.consumed_observation_ids_json
  OR OLD.completed_at IS NOT NEW.completed_at
  OR OLD.receive_status IS NOT NEW.receive_status
  OR OLD.validation_status IS NOT NEW.validation_status
  OR OLD.save_status IS NOT NEW.save_status
  OR OLD.received_at IS NOT NEW.received_at
BEGIN
  SELECT RAISE(ABORT, 'first-round result envelope is immutable');
END;

CREATE TRIGGER prevent_continuity_result_delete
BEFORE DELETE ON continuity_first_round_results
BEGIN
  SELECT RAISE(ABORT, 'first-round results require governed retention');
END;

CREATE TRIGGER prevent_continuity_projection_version_update
BEFORE UPDATE ON continuity_engine_state_projection_versions
BEGIN
  SELECT RAISE(ABORT, 'Engine state projection versions are immutable');
END;

CREATE TRIGGER prevent_continuity_projection_version_delete
BEFORE DELETE ON continuity_engine_state_projection_versions
BEGIN
  SELECT RAISE(ABORT, 'Engine state projections require governed retention');
END;

CREATE TRIGGER prevent_continuity_projection_receipt_update
BEFORE UPDATE ON continuity_engine_state_projection_receipts
BEGIN
  SELECT RAISE(ABORT, 'Engine state projection receipts are immutable');
END;

CREATE TRIGGER prevent_continuity_projection_receipt_delete
BEFORE DELETE ON continuity_engine_state_projection_receipts
BEGIN
  SELECT RAISE(ABORT, 'Engine projection receipts require governed retention');
END;

CREATE TRIGGER validate_continuity_projection_head_insert
BEFORE INSERT ON continuity_engine_state_projection_heads
WHEN
  NEW.current_revision != 0
  OR NOT EXISTS (
    SELECT 1
    FROM continuity_engine_state_projection_versions
    WHERE subject_id = NEW.subject_id
      AND current_revision = NEW.current_revision
      AND binding_id = NEW.binding_id
      AND binding_version = NEW.binding_version
      AND state_hash = NEW.state_hash
      AND content_hash = NEW.content_hash
  )
  OR NOT EXISTS (
    SELECT 1
    FROM continuity_engine_state_projection_receipts
    WHERE request_id = NEW.current_request_id
      AND subject_id = NEW.subject_id
      AND current_revision = 0
      AND previous_revision = 0
      AND changed = 0
      AND engine_update_id IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'projection head must initialize from confirmed revision zero');
END;

CREATE TRIGGER validate_continuity_projection_head_update
BEFORE UPDATE ON continuity_engine_state_projection_heads
WHEN
  OLD.subject_id IS NOT NEW.subject_id
  OR OLD.binding_id IS NOT NEW.binding_id
  OR OLD.binding_version IS NOT NEW.binding_version
  OR NEW.current_revision != OLD.current_revision + 1
  OR NOT EXISTS (
    SELECT 1
    FROM continuity_engine_state_projection_versions
    WHERE subject_id = NEW.subject_id
      AND current_revision = NEW.current_revision
      AND binding_id = NEW.binding_id
      AND binding_version = NEW.binding_version
      AND state_hash = NEW.state_hash
      AND content_hash = NEW.content_hash
  )
  OR NOT EXISTS (
    SELECT 1
    FROM continuity_engine_state_projection_receipts
    WHERE request_id = NEW.current_request_id
      AND subject_id = NEW.subject_id
      AND current_revision = NEW.current_revision
      AND previous_revision = OLD.current_revision
      AND changed = 1
      AND engine_update_id IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'projection head update violates Engine projection continuity');
END;

CREATE TRIGGER prevent_continuity_projection_head_delete
BEFORE DELETE ON continuity_engine_state_projection_heads
BEGIN
  SELECT RAISE(ABORT, 'Engine projection heads require governed retention');
END;
