CREATE TABLE api_provider_credential_bindings (
  credential_binding_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  secret_ref TEXT NOT NULL CHECK (
    length(secret_ref) BETWEEN 23 AND 160
    AND substr(secret_ref, 1, 22) = 'env:VIO_MODEL_API_KEY_'
    AND substr(secret_ref, 23) NOT GLOB '*[^A-Z0-9_]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
  security_audit_log_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  superseded_at TEXT,
  CHECK (
    (status = 'active' AND superseded_at IS NULL)
    OR (status = 'superseded' AND superseded_at IS NOT NULL)
  ),
  FOREIGN KEY (owner_user_id, provider_id) REFERENCES api_providers(owner_user_id, api_provider_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id, security_audit_log_id) REFERENCES audit_logs(user_id, audit_log_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_api_provider_credential_active ON api_provider_credential_bindings(owner_user_id, provider_id) WHERE status = 'active';
CREATE INDEX idx_api_provider_credential_history ON api_provider_credential_bindings(owner_user_id, provider_id, created_at, credential_binding_id);

CREATE TABLE continuity_capability_requests (
  capability_request_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash)=71 AND request_hash GLOB 'sha256:*' AND substr(request_hash,8) NOT GLOB '*[^0-9a-f]*'),
  operation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  engine_subject_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  binding_version INTEGER NOT NULL CHECK (binding_version = 1),
  originating_session_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=71 AND input_hash GLOB 'sha256:*' AND substr(input_hash,8) NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key)=71 AND idempotency_key GLOB 'sha256:*' AND substr(idempotency_key,8) NOT GLOB '*[^0-9a-f]*'),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  deadline_at TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
  status TEXT NOT NULL CHECK (status IN ('received','waiting_confirmation','waiting_budget','waiting_retry','ready','executing','result_ready','result_outcome_unknown','provider_outcome_unknown','completed','failed','quarantined')),
  created_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES continuity_first_round_requests(request_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id) REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_id) REFERENCES continuity_first_round_binding_fixtures(binding_id) ON DELETE RESTRICT,
  UNIQUE (capability_request_id, request_id, request_hash)
);
CREATE INDEX idx_continuity_capability_requests_status ON continuity_capability_requests(status, updated_at, capability_request_id);
CREATE INDEX idx_continuity_capability_requests_scope ON continuity_capability_requests(user_id, assistant_id, engine_subject_id, created_at);

CREATE TABLE continuity_capability_decisions (
  decision_id TEXT PRIMARY KEY,
  capability_request_id TEXT NOT NULL,
  model_id TEXT,
  provider_id TEXT,
  permission_decision TEXT,
  security_decision TEXT,
  budget_decision TEXT,
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens >= 0),
  confirmation_id TEXT,
  audit_ref TEXT NOT NULL,
  decision_json TEXT NOT NULL CHECK (json_valid(decision_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (capability_request_id) REFERENCES continuity_capability_requests(capability_request_id) ON DELETE RESTRICT,
  FOREIGN KEY (model_id) REFERENCES models(model_id) ON DELETE RESTRICT,
  FOREIGN KEY (provider_id) REFERENCES api_providers(api_provider_id) ON DELETE RESTRICT
);
CREATE INDEX idx_continuity_capability_decisions_request ON continuity_capability_decisions(capability_request_id, created_at, decision_id);

CREATE TABLE continuity_capability_model_executions (
  execution_id TEXT PRIMARY KEY,
  capability_request_id TEXT NOT NULL,
  execution_number INTEGER NOT NULL CHECK (execution_number > 0),
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','in_flight','succeeded','failed_retryable','failed_terminal','cancelled','expired','unknown')),
  provider_call_may_have_started INTEGER NOT NULL CHECK (provider_call_may_have_started IN (0,1)),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  FOREIGN KEY (capability_request_id) REFERENCES continuity_capability_requests(capability_request_id) ON DELETE RESTRICT,
  FOREIGN KEY (provider_id) REFERENCES api_providers(api_provider_id) ON DELETE RESTRICT,
  FOREIGN KEY (model_id) REFERENCES models(model_id) ON DELETE RESTRICT,
  UNIQUE (execution_id, capability_request_id),
  UNIQUE (capability_request_id, execution_number)
);
CREATE INDEX idx_continuity_capability_executions_status ON continuity_capability_model_executions(status, started_at, execution_id);

CREATE TABLE continuity_capability_usage_facts (
  usage_ledger_entry_id TEXT PRIMARY KEY,
  capability_request_id TEXT NOT NULL,
  execution_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  budget_session_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens = input_tokens + output_tokens),
  usage_status TEXT NOT NULL CHECK (usage_status IN ('provider_reported','unknown','not_incurred')),
  cost_status TEXT NOT NULL CHECK (cost_status IN ('provider_reported','calculated','not_reported','not_incurred')),
  cost_amount_micros INTEGER CHECK (cost_amount_micros IS NULL OR cost_amount_micros >= 0),
  cost_currency TEXT CHECK (cost_currency IS NULL OR length(cost_currency) BETWEEN 3 AND 8),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (execution_id, capability_request_id) REFERENCES continuity_capability_model_executions(execution_id, capability_request_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id) REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (model_id) REFERENCES models(model_id) ON DELETE RESTRICT
  ,CHECK (usage_status = 'provider_reported' OR total_tokens = 0)
  ,CHECK (
    (cost_status IN ('not_reported','not_incurred') AND cost_amount_micros IS NULL AND cost_currency IS NULL)
    OR (cost_status IN ('provider_reported','calculated') AND cost_amount_micros IS NOT NULL AND cost_currency IS NOT NULL)
  )
);
CREATE INDEX idx_continuity_capability_usage_day ON continuity_capability_usage_facts(user_id, subject_id, occurred_at, usage_ledger_entry_id);
CREATE INDEX idx_continuity_capability_usage_session ON continuity_capability_usage_facts(user_id, subject_id, budget_session_id, occurred_at);

CREATE TABLE continuity_capability_results (
  capability_result_id TEXT PRIMARY KEY,
  capability_request_id TEXT NOT NULL,
  execution_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED','FAILED_RETRYABLE','FAILED_TERMINAL','CANCELLED','EXPIRED','UNKNOWN')),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=71 AND content_hash GLOB 'sha256:*' AND substr(content_hash,8) NOT GLOB '*[^0-9a-f]*'),
  result_hash TEXT NOT NULL CHECK (length(result_hash)=71 AND result_hash GLOB 'sha256:*' AND substr(result_hash,8) NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  usage_ledger_entry_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (capability_request_id, request_id, request_hash) REFERENCES continuity_capability_requests(capability_request_id, request_id, request_hash) ON DELETE RESTRICT,
  FOREIGN KEY (execution_id, capability_request_id) REFERENCES continuity_capability_model_executions(execution_id, capability_request_id) ON DELETE RESTRICT,
  FOREIGN KEY (usage_ledger_entry_id) REFERENCES continuity_capability_usage_facts(usage_ledger_entry_id) ON DELETE RESTRICT,
  UNIQUE (capability_result_id, capability_request_id)
);
CREATE INDEX idx_continuity_capability_results_request ON continuity_capability_results(request_id, created_at);
CREATE UNIQUE INDEX idx_continuity_capability_one_success ON continuity_capability_results(capability_request_id) WHERE status = 'SUCCEEDED';

CREATE TABLE continuity_capability_result_outbox (
  capability_result_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','in_flight','outcome_unknown','accepted','completed','failed','quarantined')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_http_status INTEGER,
  last_error_code TEXT,
  recovery_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (capability_result_id) REFERENCES continuity_capability_results(capability_result_id) ON DELETE RESTRICT,
  FOREIGN KEY (request_id) REFERENCES continuity_first_round_requests(request_id) ON DELETE RESTRICT
);
CREATE INDEX idx_continuity_capability_result_outbox_status ON continuity_capability_result_outbox(status, updated_at, capability_result_id);

CREATE TABLE continuity_capability_result_attempts (
  attempt_id TEXT PRIMARY KEY,
  capability_result_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('post_result','query_request','local_recovery')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  outcome TEXT,
  http_status INTEGER,
  error_code TEXT,
  FOREIGN KEY (capability_result_id) REFERENCES continuity_capability_result_outbox(capability_result_id) ON DELETE RESTRICT,
  UNIQUE (capability_result_id, attempt_number)
);
CREATE INDEX idx_continuity_capability_result_attempts_result ON continuity_capability_result_attempts(capability_result_id, attempt_number);

CREATE TABLE continuity_capability_incidents (
  incident_id TEXT PRIMARY KEY,
  capability_request_id TEXT,
  capability_result_id TEXT,
  request_id TEXT NOT NULL,
  incident_type TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (capability_request_id) REFERENCES continuity_capability_requests(capability_request_id) ON DELETE RESTRICT,
  FOREIGN KEY (capability_result_id) REFERENCES continuity_capability_results(capability_result_id) ON DELETE RESTRICT,
  FOREIGN KEY (request_id) REFERENCES continuity_first_round_requests(request_id) ON DELETE RESTRICT
);
CREATE INDEX idx_continuity_capability_incidents_request ON continuity_capability_incidents(request_id, created_at, incident_id);

CREATE TRIGGER protect_api_provider_credential_binding_identity BEFORE UPDATE ON api_provider_credential_bindings
BEGIN SELECT CASE WHEN NEW.credential_binding_id<>OLD.credential_binding_id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.provider_id<>OLD.provider_id OR NEW.secret_ref<>OLD.secret_ref OR NEW.security_audit_log_id<>OLD.security_audit_log_id OR NEW.created_at<>OLD.created_at THEN RAISE(ABORT,'credential binding facts are immutable') END; SELECT CASE WHEN NOT (OLD.status='active' AND OLD.superseded_at IS NULL AND NEW.status='superseded' AND NEW.superseded_at IS NOT NULL) THEN RAISE(ABORT,'credential binding lifecycle is immutable') END; END;
CREATE TRIGGER prevent_api_provider_credential_binding_delete BEFORE DELETE ON api_provider_credential_bindings BEGIN SELECT RAISE(ABORT,'credential binding history requires governed retention'); END;
CREATE TRIGGER protect_continuity_capability_request_identity BEFORE UPDATE ON continuity_capability_requests
BEGIN SELECT CASE WHEN NEW.capability_request_id<>OLD.capability_request_id OR NEW.request_id<>OLD.request_id OR NEW.request_hash<>OLD.request_hash OR NEW.operation_id<>OLD.operation_id OR NEW.user_id<>OLD.user_id OR NEW.assistant_id<>OLD.assistant_id OR NEW.engine_subject_id<>OLD.engine_subject_id OR NEW.binding_id<>OLD.binding_id OR NEW.binding_version<>OLD.binding_version OR NEW.originating_session_id<>OLD.originating_session_id OR NEW.input_hash<>OLD.input_hash OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.risk_level<>OLD.risk_level OR NEW.deadline_at<>OLD.deadline_at OR NEW.request_json<>OLD.request_json OR NEW.envelope_json<>OLD.envelope_json OR NEW.created_at<>OLD.created_at OR NEW.recorded_at<>OLD.recorded_at THEN RAISE(ABORT,'capability request facts are immutable') END; SELECT CASE WHEN OLD.status IN ('completed','failed','quarantined') AND NEW.status<>OLD.status THEN RAISE(ABORT,'terminal capability request is immutable') END; END;
CREATE TRIGGER prevent_continuity_capability_request_delete BEFORE DELETE ON continuity_capability_requests BEGIN SELECT RAISE(ABORT,'capability requests require governed retention'); END;
CREATE TRIGGER prevent_continuity_capability_decision_update BEFORE UPDATE ON continuity_capability_decisions BEGIN SELECT RAISE(ABORT,'capability decisions are immutable'); END;
CREATE TRIGGER prevent_continuity_capability_decision_delete BEFORE DELETE ON continuity_capability_decisions BEGIN SELECT RAISE(ABORT,'capability decisions require governed retention'); END;
CREATE TRIGGER protect_continuity_capability_execution_identity BEFORE UPDATE ON continuity_capability_model_executions
BEGIN SELECT CASE WHEN NEW.execution_id<>OLD.execution_id OR NEW.capability_request_id<>OLD.capability_request_id OR NEW.execution_number<>OLD.execution_number OR NEW.provider_id<>OLD.provider_id OR NEW.model_id<>OLD.model_id OR NEW.started_at<>OLD.started_at THEN RAISE(ABORT,'model execution identity is immutable') END; SELECT CASE WHEN OLD.status IN ('succeeded','failed_retryable','failed_terminal','cancelled','expired','unknown') THEN RAISE(ABORT,'terminal model execution is immutable') END; END;
CREATE TRIGGER prevent_continuity_capability_execution_delete BEFORE DELETE ON continuity_capability_model_executions BEGIN SELECT RAISE(ABORT,'model executions require governed retention'); END;
CREATE TRIGGER prevent_continuity_capability_usage_update BEFORE UPDATE ON continuity_capability_usage_facts BEGIN SELECT RAISE(ABORT,'capability usage facts are immutable'); END;
CREATE TRIGGER prevent_continuity_capability_usage_delete BEFORE DELETE ON continuity_capability_usage_facts BEGIN SELECT RAISE(ABORT,'capability usage facts require governed retention'); END;
CREATE TRIGGER prevent_continuity_capability_result_update BEFORE UPDATE ON continuity_capability_results BEGIN SELECT RAISE(ABORT,'capability results are immutable'); END;
CREATE TRIGGER prevent_continuity_capability_result_delete BEFORE DELETE ON continuity_capability_results BEGIN SELECT RAISE(ABORT,'capability results require governed retention'); END;
CREATE TRIGGER guard_continuity_capability_execution_sequence BEFORE INSERT ON continuity_capability_model_executions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM continuity_capability_requests
    WHERE capability_request_id=NEW.capability_request_id AND status='ready'
  ) THEN RAISE(ABORT,'capability execution requires explicit ready state') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM continuity_capability_results
    WHERE capability_request_id=NEW.capability_request_id
      AND status IN ('SUCCEEDED','FAILED_TERMINAL','CANCELLED','EXPIRED','UNKNOWN')
  ) THEN RAISE(ABORT,'terminal capability result forbids another execution') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM continuity_capability_model_executions
    WHERE capability_request_id=NEW.capability_request_id AND status IN ('prepared','in_flight')
  ) THEN RAISE(ABORT,'capability execution is already active') END;
END;
CREATE TRIGGER guard_continuity_capability_result_sequence BEFORE INSERT ON continuity_capability_results
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM continuity_capability_results
    WHERE capability_request_id=NEW.capability_request_id
      AND status IN ('SUCCEEDED','FAILED_TERMINAL','CANCELLED','EXPIRED','UNKNOWN')
  ) THEN RAISE(ABORT,'terminal capability result cannot be followed by another result') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM continuity_capability_model_executions
    WHERE execution_id=NEW.execution_id
      AND capability_request_id=NEW.capability_request_id
      AND status=lower(NEW.status)
  ) THEN RAISE(ABORT,'capability result does not match its completed execution') END;
END;
CREATE TRIGGER protect_continuity_capability_result_outbox_identity BEFORE UPDATE ON continuity_capability_result_outbox
BEGIN SELECT CASE WHEN NEW.capability_result_id<>OLD.capability_result_id OR NEW.request_id<>OLD.request_id OR NEW.created_at<>OLD.created_at THEN RAISE(ABORT,'capability result outbox identity is immutable') END; SELECT CASE WHEN OLD.status IN ('accepted','completed','failed','quarantined') THEN RAISE(ABORT,'terminal capability result outbox is immutable') END; END;
CREATE TRIGGER prevent_continuity_capability_result_outbox_delete BEFORE DELETE ON continuity_capability_result_outbox BEGIN SELECT RAISE(ABORT,'capability result outbox requires governed retention'); END;
CREATE TRIGGER protect_continuity_capability_attempt_update BEFORE UPDATE ON continuity_capability_result_attempts
BEGIN SELECT CASE WHEN NEW.attempt_id<>OLD.attempt_id OR NEW.capability_result_id<>OLD.capability_result_id OR NEW.attempt_number<>OLD.attempt_number OR NEW.operation_type<>OLD.operation_type OR NEW.started_at<>OLD.started_at THEN RAISE(ABORT,'capability result attempt identity is immutable') END; SELECT CASE WHEN OLD.completed_at IS NOT NULL THEN RAISE(ABORT,'completed capability result attempt is immutable') END; END;
CREATE TRIGGER prevent_continuity_capability_attempt_delete BEFORE DELETE ON continuity_capability_result_attempts BEGIN SELECT RAISE(ABORT,'capability result attempts require governed retention'); END;
CREATE TRIGGER prevent_continuity_capability_incident_update BEFORE UPDATE ON continuity_capability_incidents BEGIN SELECT RAISE(ABORT,'capability incidents are immutable'); END;
CREATE TRIGGER prevent_continuity_capability_incident_delete BEFORE DELETE ON continuity_capability_incidents BEGIN SELECT RAISE(ABORT,'capability incidents require governed retention'); END;
