CREATE TABLE continuity_first_round_delivery_outbox (
  request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 71
    AND substr(request_hash, 1, 7) = 'sha256:'
    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'pending',
    'in_flight',
    'outcome_unknown',
    'result_received',
    'completed',
    'quarantined'
  )),
  operation_id TEXT CHECK (operation_id IS NULL OR length(operation_id) BETWEEN 1 AND 128),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_started_at TEXT,
  last_attempt_completed_at TEXT,
  last_http_status INTEGER CHECK (
    last_http_status IS NULL OR last_http_status BETWEEN 100 AND 599
  ),
  last_transport_result TEXT,
  last_error_code TEXT,
  recovery_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (request_id)
    REFERENCES continuity_first_round_requests(request_id) ON DELETE RESTRICT
);

CREATE TABLE continuity_first_round_delivery_attempts (
  attempt_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('post', 'query', 'local_recovery')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  outcome TEXT,
  http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  operation_id TEXT CHECK (operation_id IS NULL OR length(operation_id) BETWEEN 1 AND 128),
  error_code TEXT,
  recovery_reason TEXT,
  FOREIGN KEY (request_id)
    REFERENCES continuity_first_round_delivery_outbox(request_id) ON DELETE RESTRICT,
  UNIQUE (request_id, attempt_number)
);

CREATE INDEX idx_continuity_delivery_outbox_status
  ON continuity_first_round_delivery_outbox (status, updated_at, request_id);

CREATE INDEX idx_continuity_delivery_attempts_request
  ON continuity_first_round_delivery_attempts (request_id, attempt_number);

CREATE INDEX idx_continuity_delivery_attempts_outcome
  ON continuity_first_round_delivery_attempts (outcome, completed_at, request_id);

CREATE TRIGGER validate_continuity_delivery_outbox_insert
BEFORE INSERT ON continuity_first_round_delivery_outbox
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM continuity_first_round_requests request
    WHERE request.request_id = NEW.request_id
      AND request.request_hash = NEW.request_hash
  ) THEN RAISE(ABORT, 'delivery outbox must match the immutable V1 request') END;
END;

CREATE TRIGGER protect_continuity_delivery_outbox_update
BEFORE UPDATE ON continuity_first_round_delivery_outbox
BEGIN
  SELECT CASE WHEN
    NEW.request_id <> OLD.request_id
    OR NEW.request_hash <> OLD.request_hash
    OR NEW.created_at <> OLD.created_at
  THEN RAISE(ABORT, 'delivery outbox identity is immutable') END;
  SELECT CASE WHEN
    OLD.operation_id IS NOT NULL
    AND NEW.operation_id IS NOT OLD.operation_id
  THEN RAISE(ABORT, 'delivery operationId is immutable once observed') END;
  SELECT CASE WHEN OLD.status IN ('completed', 'quarantined')
  THEN RAISE(ABORT, 'terminal delivery outbox cannot change') END;
  SELECT CASE WHEN NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'pending' AND NEW.status IN (
      'in_flight', 'result_received', 'quarantined'
    ))
    OR (OLD.status = 'in_flight' AND NEW.status IN (
      'pending', 'outcome_unknown', 'result_received', 'quarantined'
    ))
    OR (OLD.status = 'outcome_unknown' AND NEW.status IN (
      'in_flight', 'result_received', 'completed', 'quarantined'
    ))
    OR (OLD.status = 'result_received' AND NEW.status IN ('completed', 'quarantined'))
  ) THEN RAISE(ABORT, 'invalid delivery outbox state transition') END;
END;

CREATE TRIGGER prevent_continuity_delivery_outbox_delete
BEFORE DELETE ON continuity_first_round_delivery_outbox
BEGIN
  SELECT RAISE(ABORT, 'delivery outbox requires governed retention');
END;

CREATE TRIGGER protect_continuity_delivery_attempt_update
BEFORE UPDATE ON continuity_first_round_delivery_attempts
BEGIN
  SELECT CASE WHEN
    NEW.attempt_id <> OLD.attempt_id
    OR NEW.request_id <> OLD.request_id
    OR NEW.attempt_number <> OLD.attempt_number
    OR NEW.operation_type <> OLD.operation_type
    OR NEW.started_at <> OLD.started_at
  THEN RAISE(ABORT, 'delivery attempt identity is immutable') END;
  SELECT CASE WHEN OLD.completed_at IS NOT NULL
  THEN RAISE(ABORT, 'completed delivery attempt is immutable') END;
  SELECT CASE WHEN NEW.completed_at IS NULL OR NEW.outcome IS NULL
  THEN RAISE(ABORT, 'delivery attempt completion requires an outcome') END;
END;

CREATE TRIGGER prevent_continuity_delivery_attempt_delete
BEFORE DELETE ON continuity_first_round_delivery_attempts
BEGIN
  SELECT RAISE(ABORT, 'delivery attempts require governed retention');
END;
