-- R1 independent chat is owned entirely by Vio. These tables do not contain
-- Continuity Engine request, operation, Binding, revision, or projection facts.

CREATE TABLE standalone_chat_default_conversations (
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, assistant_id),
  UNIQUE (conversation_id),
  UNIQUE (user_id, assistant_id, conversation_id),
  FOREIGN KEY (user_id) REFERENCES personal_identities(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES conversations(user_id, subject_id, conversation_id) ON DELETE RESTRICT
);

CREATE TABLE standalone_chat_turns (
  turn_id TEXT PRIMARY KEY CHECK (length(turn_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_by_session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  input_content_hash TEXT NOT NULL CHECK (
    length(input_content_hash) = 71
    AND substr(input_content_hash, 1, 7) = 'sha256:'
    AND substr(input_content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  user_message_id TEXT NOT NULL UNIQUE,
  user_message_version_id TEXT NOT NULL UNIQUE,
  source_event_id TEXT NOT NULL UNIQUE,
  assistant_message_id TEXT UNIQUE,
  assistant_message_version_id TEXT UNIQUE,
  confirmation_id TEXT,
  confirmation_kind TEXT CHECK (
    confirmation_kind IS NULL OR confirmation_kind IN ('security', 'budget')
  ),
  status TEXT NOT NULL CHECK (status IN (
    'processing',
    'waiting_confirmation',
    'waiting_budget',
    'ready',
    'executing',
    'retryable',
    'outcome_unknown',
    'result_ready',
    'publishing',
    'completed',
    'failed',
    'cancelled',
    'quarantined'
  )),
  public_failure_code TEXT,
  recovery_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, idempotency_key),
  UNIQUE (user_id, assistant_id, conversation_id, turn_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES standalone_chat_default_conversations(
      user_id, assistant_id, conversation_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_session_id)
    REFERENCES personal_sessions(session_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, confirmation_id)
    REFERENCES security_confirmations(user_id, confirmation_id) ON DELETE RESTRICT,
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
  FOREIGN KEY (
    user_id,
    assistant_id,
    conversation_id,
    assistant_message_id,
    assistant_message_version_id
  ) REFERENCES message_versions (
    user_id,
    subject_id,
    conversation_id,
    message_id,
    message_version_id
  ) ON DELETE RESTRICT,
  CHECK (
    (assistant_message_id IS NULL AND assistant_message_version_id IS NULL)
    OR (assistant_message_id IS NOT NULL AND assistant_message_version_id IS NOT NULL)
  ),
  CHECK (
    (status = 'waiting_confirmation'
      AND confirmation_id IS NOT NULL
      AND confirmation_kind = 'security')
    OR (status = 'waiting_budget'
      AND confirmation_id IS NOT NULL
      AND confirmation_kind = 'budget')
    OR (status NOT IN ('waiting_confirmation', 'waiting_budget')
      AND confirmation_id IS NULL
      AND confirmation_kind IS NULL)
  ),
  CHECK (
    (status = 'completed'
      AND assistant_message_id IS NOT NULL
      AND assistant_message_version_id IS NOT NULL
      AND completed_at IS NOT NULL
      AND public_failure_code IS NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE INDEX idx_standalone_chat_turns_scope
  ON standalone_chat_turns (
    user_id, assistant_id, conversation_id, created_at, turn_id
  );

CREATE INDEX idx_standalone_chat_turns_recovery
  ON standalone_chat_turns (status, updated_at, turn_id);

CREATE UNIQUE INDEX idx_standalone_chat_one_active_turn
  ON standalone_chat_turns (user_id, assistant_id, conversation_id)
  WHERE status NOT IN ('completed', 'failed', 'cancelled', 'quarantined');

CREATE TABLE standalone_chat_model_executions (
  execution_id TEXT PRIMARY KEY CHECK (length(execution_id) BETWEEN 1 AND 128),
  turn_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  credential_binding_id TEXT NOT NULL,
  token_budget_id TEXT NOT NULL,
  budget_session_id TEXT NOT NULL CHECK (length(budget_session_id) BETWEEN 1 AND 128),
  provider_type TEXT NOT NULL CHECK (length(provider_type) BETWEEN 1 AND 80),
  provider_interface_format TEXT NOT NULL CHECK (
    provider_interface_format IN (
      'openai_compatible',
      'anthropic_messages',
      'glm_compatible',
      'custom_http'
    )
  ),
  model_name TEXT NOT NULL CHECK (length(model_name) BETWEEN 1 AND 256),
  permission_decision TEXT NOT NULL CHECK (permission_decision = 'allow'),
  security_decision TEXT NOT NULL CHECK (security_decision = 'allow'),
  budget_decision TEXT NOT NULL CHECK (budget_decision = 'allow'),
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens > 0),
  security_audit_log_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  permission_updated_at TEXT NOT NULL,
  security_facts_hash TEXT NOT NULL CHECK (
    length(security_facts_hash) = 71
    AND substr(security_facts_hash, 1, 7) = 'sha256:'
    AND substr(security_facts_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  budget_facts_hash TEXT NOT NULL CHECK (
    length(budget_facts_hash) = 71
    AND substr(budget_facts_hash, 1, 7) = 'sha256:'
    AND substr(budget_facts_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  budget_approval_id TEXT,
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 16384),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 71
    AND substr(request_hash, 1, 7) = 'sha256:'
    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'prepared',
    'in_flight',
    'retryable',
    'succeeded',
    'failed_terminal',
    'outcome_unknown',
    'cancelled'
  )),
  provider_call_may_have_started INTEGER NOT NULL CHECK (
    provider_call_may_have_started IN (0, 1)
  ),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  UNIQUE (execution_id, turn_id, user_id, assistant_id, conversation_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id, turn_id)
    REFERENCES standalone_chat_turns(
      user_id, assistant_id, conversation_id, turn_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, provider_id)
    REFERENCES api_providers(owner_user_id, api_provider_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, model_id)
    REFERENCES models(owner_user_id, model_id) ON DELETE RESTRICT,
  FOREIGN KEY (credential_binding_id)
    REFERENCES api_provider_credential_bindings(credential_binding_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, token_budget_id)
    REFERENCES token_budgets(user_id, subject_id, token_budget_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, security_audit_log_id)
    REFERENCES audit_logs(user_id, audit_log_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, permission_id)
    REFERENCES permissions(user_id, permission_id) ON DELETE RESTRICT,
  FOREIGN KEY (budget_approval_id)
    REFERENCES standalone_chat_budget_approvals(budget_approval_id) ON DELETE RESTRICT,
  CHECK (
    (status IN ('prepared', 'in_flight', 'retryable') AND completed_at IS NULL)
    OR (status IN ('succeeded', 'failed_terminal', 'outcome_unknown', 'cancelled')
      AND completed_at IS NOT NULL)
  ),
  CHECK (
    provider_call_may_have_started = 1
    OR status IN ('prepared', 'in_flight', 'retryable', 'failed_terminal', 'cancelled')
  )
);

CREATE INDEX idx_standalone_chat_executions_recovery
  ON standalone_chat_model_executions(status, updated_at, execution_id);

CREATE TABLE standalone_chat_budget_approvals (
  budget_approval_id TEXT PRIMARY KEY CHECK (
    length(budget_approval_id) BETWEEN 1 AND 128
  ),
  turn_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  target_attempt_number INTEGER NOT NULL CHECK (target_attempt_number > 0),
  token_budget_id TEXT NOT NULL,
  budget_session_id TEXT NOT NULL CHECK (length(budget_session_id) BETWEEN 1 AND 128),
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens > 0),
  daily_token_limit INTEGER NOT NULL CHECK (daily_token_limit > 0),
  session_token_limit INTEGER NOT NULL CHECK (session_token_limit > 0),
  overage_policy TEXT NOT NULL CHECK (overage_policy = 'require_confirmation'),
  budget_updated_at TEXT NOT NULL,
  daily_projected INTEGER NOT NULL CHECK (daily_projected >= 0),
  session_projected INTEGER NOT NULL CHECK (session_projected >= 0),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 71
    AND substr(request_hash, 1, 7) = 'sha256:'
    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  budget_facts_hash TEXT NOT NULL CHECK (
    length(budget_facts_hash) = 71
    AND substr(budget_facts_hash, 1, 7) = 'sha256:'
    AND substr(budget_facts_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  confirmation_id TEXT NOT NULL UNIQUE,
  security_audit_log_id TEXT NOT NULL,
  approved_by_session_id TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  UNIQUE (turn_id, target_attempt_number, budget_facts_hash),
  UNIQUE (
    budget_approval_id, turn_id, user_id, assistant_id, conversation_id,
    target_attempt_number, budget_facts_hash
  ),
  FOREIGN KEY (user_id, assistant_id, conversation_id, turn_id)
    REFERENCES standalone_chat_turns(
      user_id, assistant_id, conversation_id, turn_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, token_budget_id)
    REFERENCES token_budgets(user_id, subject_id, token_budget_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, confirmation_id)
    REFERENCES security_confirmations(user_id, confirmation_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, security_audit_log_id)
    REFERENCES audit_logs(user_id, audit_log_id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_session_id)
    REFERENCES personal_sessions(session_id) ON DELETE RESTRICT
);

CREATE INDEX idx_standalone_chat_budget_approval_lookup
  ON standalone_chat_budget_approvals(
    turn_id, target_attempt_number, budget_facts_hash, approved_at
  );

CREATE TABLE standalone_chat_provider_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (length(attempt_id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  security_audit_log_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  permission_updated_at TEXT NOT NULL,
  security_facts_hash TEXT NOT NULL CHECK (
    length(security_facts_hash) = 71
    AND substr(security_facts_hash, 1, 7) = 'sha256:'
    AND substr(security_facts_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  budget_facts_hash TEXT NOT NULL CHECK (
    length(budget_facts_hash) = 71
    AND substr(budget_facts_hash, 1, 7) = 'sha256:'
    AND substr(budget_facts_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  budget_approval_id TEXT,
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 71
    AND substr(request_hash, 1, 7) = 'sha256:'
    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'prepared',
    'in_flight',
    'not_sent',
    'retryable',
    'response_received',
    'outcome_unknown',
    'failed_terminal',
    'cancelled'
  )),
  provider_call_may_have_started INTEGER NOT NULL CHECK (
    provider_call_may_have_started IN (0, 1)
  ),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  UNIQUE (execution_id, attempt_number),
  UNIQUE (attempt_id, execution_id, turn_id, user_id, assistant_id, conversation_id),
  FOREIGN KEY (execution_id, turn_id, user_id, assistant_id, conversation_id)
    REFERENCES standalone_chat_model_executions(
      execution_id, turn_id, user_id, assistant_id, conversation_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, security_audit_log_id)
    REFERENCES audit_logs(user_id, audit_log_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, permission_id)
    REFERENCES permissions(user_id, permission_id) ON DELETE RESTRICT,
  FOREIGN KEY (budget_approval_id)
    REFERENCES standalone_chat_budget_approvals(budget_approval_id) ON DELETE RESTRICT,
  CHECK (
    (status IN ('prepared', 'in_flight') AND completed_at IS NULL)
    OR (status IN (
      'not_sent', 'retryable', 'response_received', 'outcome_unknown',
      'failed_terminal', 'cancelled'
    ) AND completed_at IS NOT NULL)
  ),
  CHECK (
    provider_call_may_have_started = 1
    OR status IN (
      'prepared', 'in_flight', 'not_sent', 'retryable', 'failed_terminal', 'cancelled'
    )
  ),
  CHECK (status <> 'not_sent' OR provider_call_may_have_started = 0)
);

CREATE UNIQUE INDEX idx_standalone_chat_one_active_attempt
  ON standalone_chat_provider_attempts(execution_id)
  WHERE status IN ('prepared', 'in_flight');

CREATE TABLE standalone_chat_usage_facts (
  usage_ledger_entry_id TEXT PRIMARY KEY CHECK (
    length(usage_ledger_entry_id) BETWEEN 1 AND 128
  ),
  execution_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  token_budget_id TEXT NOT NULL,
  budget_session_id TEXT NOT NULL CHECK (length(budget_session_id) BETWEEN 1 AND 128),
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (
    total_tokens >= 0 AND total_tokens = input_tokens + output_tokens
  ),
  usage_status TEXT NOT NULL CHECK (
    usage_status IN ('provider_reported', 'unknown', 'not_incurred')
  ),
  cost_status TEXT NOT NULL CHECK (
    cost_status IN ('provider_reported', 'calculated', 'not_reported', 'not_incurred')
  ),
  cost_amount_micros INTEGER CHECK (
    cost_amount_micros IS NULL OR cost_amount_micros >= 0
  ),
  cost_currency TEXT CHECK (
    cost_currency IS NULL OR length(cost_currency) BETWEEN 3 AND 8
  ),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (
    usage_ledger_entry_id, attempt_id, execution_id, turn_id,
    user_id, assistant_id, conversation_id
  ),
  FOREIGN KEY (execution_id, turn_id, user_id, assistant_id, conversation_id)
    REFERENCES standalone_chat_model_executions(
      execution_id, turn_id, user_id, assistant_id, conversation_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id, execution_id, turn_id, user_id, assistant_id, conversation_id)
    REFERENCES standalone_chat_provider_attempts(
      attempt_id, execution_id, turn_id, user_id, assistant_id, conversation_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, token_budget_id)
    REFERENCES token_budgets(user_id, subject_id, token_budget_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, model_id)
    REFERENCES models(owner_user_id, model_id) ON DELETE RESTRICT,
  CHECK (usage_status = 'provider_reported' OR total_tokens = 0),
  CHECK (
    (usage_status = 'provider_reported'
      AND cost_status IN ('provider_reported', 'calculated', 'not_reported'))
    OR (usage_status = 'unknown' AND cost_status = 'not_reported')
    OR (usage_status = 'not_incurred' AND cost_status = 'not_incurred')
  ),
  CHECK (
    (cost_status IN ('not_reported', 'not_incurred')
      AND cost_amount_micros IS NULL
      AND cost_currency IS NULL)
    OR (cost_status IN ('provider_reported', 'calculated')
      AND cost_amount_micros IS NOT NULL
      AND cost_currency IS NOT NULL)
  )
);

CREATE INDEX idx_standalone_chat_usage_day
  ON standalone_chat_usage_facts(
    user_id, assistant_id, occurred_at, usage_ledger_entry_id
  );

CREATE INDEX idx_standalone_chat_usage_session
  ON standalone_chat_usage_facts(
    user_id, assistant_id, budget_session_id, occurred_at, usage_ledger_entry_id
  );

CREATE INDEX idx_standalone_chat_usage_execution
  ON standalone_chat_usage_facts(execution_id, occurred_at, usage_ledger_entry_id);

CREATE TABLE standalone_chat_provider_results (
  provider_result_id TEXT PRIMARY KEY CHECK (
    length(provider_result_id) BETWEEN 1 AND 128
  ),
  execution_id TEXT NOT NULL UNIQUE,
  turn_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  usage_ledger_entry_id TEXT NOT NULL UNIQUE,
  result_hash TEXT NOT NULL CHECK (
    length(result_hash) = 71
    AND substr(result_hash, 1, 7) = 'sha256:'
    AND substr(result_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  response_content_hash TEXT NOT NULL CHECK (
    length(response_content_hash) = 71
    AND substr(response_content_hash, 1, 7) = 'sha256:'
    AND substr(response_content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  finish_reason TEXT NOT NULL CHECK (length(finish_reason) BETWEEN 1 AND 128),
  received_at TEXT NOT NULL,
  UNIQUE (provider_result_id, execution_id, turn_id, user_id, assistant_id, conversation_id),
  FOREIGN KEY (execution_id, turn_id, user_id, assistant_id, conversation_id)
    REFERENCES standalone_chat_model_executions(
      execution_id, turn_id, user_id, assistant_id, conversation_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id, execution_id, turn_id, user_id, assistant_id, conversation_id)
    REFERENCES standalone_chat_provider_attempts(
      attempt_id, execution_id, turn_id, user_id, assistant_id, conversation_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (
    usage_ledger_entry_id, attempt_id, execution_id, turn_id,
    user_id, assistant_id, conversation_id
  )
    REFERENCES standalone_chat_usage_facts(
      usage_ledger_entry_id, attempt_id, execution_id, turn_id,
      user_id, assistant_id, conversation_id
    ) ON DELETE RESTRICT
);

CREATE TABLE standalone_chat_recovery_actions (
  recovery_action_id TEXT PRIMARY KEY CHECK (
    length(recovery_action_id) BETWEEN 1 AND 128
  ),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  action_type TEXT NOT NULL CHECK (action_type IN ('resume', 'retry', 'cancel')),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 71
    AND substr(content_hash, 1, 7) = 'sha256:'
    AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  turn_status_before TEXT NOT NULL CHECK (turn_status_before IN (
    'processing',
    'waiting_confirmation',
    'waiting_budget',
    'ready',
    'retryable',
    'result_ready',
    'publishing'
  )),
  attempt_count_before INTEGER NOT NULL CHECK (attempt_count_before >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, assistant_id, idempotency_key),
  UNIQUE (
    recovery_action_id, user_id, assistant_id, conversation_id, turn_id
  ),
  FOREIGN KEY (user_id, assistant_id, conversation_id, turn_id)
    REFERENCES standalone_chat_turns(
      user_id, assistant_id, conversation_id, turn_id
  ) ON DELETE RESTRICT,
  CHECK (
    (status = 'pending' AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_standalone_chat_recovery_turn
  ON standalone_chat_recovery_actions(
    user_id, assistant_id, turn_id, created_at, recovery_action_id
  );

CREATE TRIGGER validate_standalone_default_conversation
BEFORE INSERT ON standalone_chat_default_conversations
WHEN NOT EXISTS (
  SELECT 1
  FROM conversations
  WHERE user_id = NEW.user_id
    AND subject_id = NEW.assistant_id
    AND conversation_id = NEW.conversation_id
    AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'standalone chat requires an active owned conversation');
END;

CREATE TRIGGER validate_standalone_chat_user_message
BEFORE INSERT ON standalone_chat_turns
WHEN NOT EXISTS (
  SELECT 1
  FROM messages
  JOIN message_versions
    ON message_versions.user_id = messages.user_id
    AND message_versions.subject_id = messages.subject_id
    AND message_versions.conversation_id = messages.conversation_id
    AND message_versions.message_id = messages.message_id
    AND message_versions.message_version_id = messages.current_version_id
  WHERE messages.user_id = NEW.user_id
    AND messages.subject_id = NEW.assistant_id
    AND messages.conversation_id = NEW.conversation_id
    AND messages.message_id = NEW.user_message_id
    AND messages.current_version_id = NEW.user_message_version_id
    AND messages.sender_type = 'user'
    AND messages.status = 'active'
    AND message_versions.sender_type = 'user'
    AND message_versions.change_reason = 'original'
    AND message_versions.version_number = 1
)
BEGIN
  SELECT RAISE(ABORT, 'standalone turn requires its original active user message');
END;

CREATE TRIGGER validate_standalone_chat_source_event
BEFORE INSERT ON standalone_chat_turns
WHEN NOT EXISTS (
  SELECT 1
  FROM events
  WHERE user_id = NEW.user_id
    AND subject_id = NEW.assistant_id
    AND event_id = NEW.source_event_id
    AND event_type = 'message_created'
    AND source_type = 'message-service'
    AND source_ref = NEW.user_message_id
)
BEGIN
  SELECT RAISE(ABORT, 'standalone turn requires its user message event');
END;

CREATE TRIGGER validate_standalone_chat_session
BEFORE INSERT ON standalone_chat_turns
WHEN NOT EXISTS (
  SELECT 1
  FROM personal_sessions
  WHERE session_id = NEW.created_by_session_id
    AND user_id = NEW.user_id
    AND revoked_at IS NULL
    AND created_at <= NEW.created_at
    AND expires_at > NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'standalone turn requires its verified personal session');
END;

CREATE TRIGGER guard_standalone_chat_turn_insert
BEFORE INSERT ON standalone_chat_turns
WHEN
  NEW.status IS NOT 'processing'
  OR NEW.assistant_message_id IS NOT NULL
  OR NEW.assistant_message_version_id IS NOT NULL
  OR NEW.confirmation_id IS NOT NULL
  OR NEW.confirmation_kind IS NOT NULL
  OR NEW.public_failure_code IS NOT NULL
  OR NEW.recovery_reason IS NOT NULL
  OR NEW.completed_at IS NOT NULL
  OR NEW.updated_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'standalone turn must begin in its empty processing state');
END;

CREATE TRIGGER validate_standalone_chat_assistant_message
BEFORE UPDATE OF assistant_message_id, assistant_message_version_id
ON standalone_chat_turns
WHEN NEW.assistant_message_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM messages
  JOIN message_versions
    ON message_versions.user_id = messages.user_id
    AND message_versions.subject_id = messages.subject_id
    AND message_versions.conversation_id = messages.conversation_id
    AND message_versions.message_id = messages.message_id
    AND message_versions.message_version_id = messages.current_version_id
  WHERE messages.user_id = NEW.user_id
    AND messages.subject_id = NEW.assistant_id
    AND messages.conversation_id = NEW.conversation_id
    AND messages.message_id = NEW.assistant_message_id
    AND messages.current_version_id = NEW.assistant_message_version_id
    AND messages.sender_type = 'subject'
    AND messages.status = 'active'
    AND message_versions.sender_type = 'subject'
    AND message_versions.change_reason = 'original'
    AND message_versions.version_number = 1
)
BEGIN
  SELECT RAISE(ABORT, 'standalone reply must be its original active subject message');
END;

CREATE TRIGGER guard_standalone_chat_turn_transition
BEFORE UPDATE OF status ON standalone_chat_turns
WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'processing' AND NEW.status IN (
    'waiting_confirmation', 'waiting_budget', 'ready', 'retryable',
    'failed', 'cancelled', 'quarantined'
  ))
  OR (OLD.status = 'waiting_confirmation' AND NEW.status IN (
    'waiting_budget', 'ready', 'retryable', 'failed', 'cancelled', 'quarantined'
  ))
  OR (OLD.status = 'waiting_budget' AND NEW.status IN (
    'waiting_confirmation', 'ready', 'retryable', 'failed', 'cancelled', 'quarantined'
  ))
  OR (OLD.status = 'ready' AND NEW.status IN (
    'executing', 'failed', 'cancelled', 'quarantined'
  ))
  OR (OLD.status = 'executing' AND NEW.status IN (
    'retryable', 'outcome_unknown', 'result_ready', 'failed', 'cancelled', 'quarantined'
  ))
  OR (OLD.status = 'retryable' AND NEW.status IN (
    'waiting_confirmation', 'waiting_budget', 'ready', 'failed', 'cancelled', 'quarantined'
  ))
  OR (OLD.status = 'outcome_unknown' AND NEW.status IN ('failed', 'quarantined'))
  OR (OLD.status = 'result_ready' AND NEW.status IN ('publishing', 'quarantined'))
  OR (OLD.status = 'publishing' AND NEW.status IN ('completed', 'quarantined'))
)
BEGIN
  SELECT RAISE(ABORT, 'standalone turn state transition is not allowed');
END;

CREATE TRIGGER guard_standalone_chat_result_state
BEFORE UPDATE OF status ON standalone_chat_turns
WHEN NEW.status IN ('result_ready', 'publishing', 'completed') AND NOT EXISTS (
  SELECT 1
  FROM standalone_chat_provider_results
  WHERE turn_id = NEW.turn_id
    AND user_id = NEW.user_id
    AND assistant_id = NEW.assistant_id
    AND conversation_id = NEW.conversation_id
)
BEGIN
  SELECT RAISE(ABORT, 'standalone result must be durably recorded before publication');
END;

CREATE TRIGGER guard_standalone_chat_terminal_execution_state
BEFORE UPDATE OF status ON standalone_chat_turns
WHEN
  (NEW.status = 'completed' AND NOT EXISTS (
    SELECT 1 FROM standalone_chat_model_executions
    WHERE turn_id = NEW.turn_id AND status = 'succeeded'
  ))
  OR (NEW.status = 'failed' AND EXISTS (
    SELECT 1 FROM standalone_chat_model_executions
    WHERE turn_id = NEW.turn_id AND status <> 'failed_terminal'
  ))
  OR (NEW.status = 'cancelled' AND EXISTS (
    SELECT 1 FROM standalone_chat_model_executions
    WHERE turn_id = NEW.turn_id AND status <> 'cancelled'
  ))
BEGIN
  SELECT RAISE(ABORT, 'standalone turn and execution terminal states must agree');
END;

CREATE TRIGGER protect_standalone_chat_turn_identity
BEFORE UPDATE ON standalone_chat_turns
WHEN
  NEW.turn_id IS NOT OLD.turn_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.assistant_id IS NOT OLD.assistant_id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.created_by_session_id IS NOT OLD.created_by_session_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.input_content_hash IS NOT OLD.input_content_hash
  OR NEW.user_message_id IS NOT OLD.user_message_id
  OR NEW.user_message_version_id IS NOT OLD.user_message_version_id
  OR NEW.source_event_id IS NOT OLD.source_event_id
  OR (OLD.assistant_message_id IS NOT NULL
    AND NEW.assistant_message_id IS NOT OLD.assistant_message_id)
  OR (OLD.assistant_message_version_id IS NOT NULL
    AND NEW.assistant_message_version_id IS NOT OLD.assistant_message_version_id)
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'standalone turn identity and historical links are immutable');
END;

CREATE TRIGGER protect_terminal_standalone_chat_turn
BEFORE UPDATE ON standalone_chat_turns
WHEN OLD.status IN ('completed', 'failed', 'cancelled', 'quarantined')
BEGIN
  SELECT RAISE(ABORT, 'terminal standalone turn is immutable');
END;

CREATE TRIGGER validate_standalone_chat_execution
BEFORE INSERT ON standalone_chat_model_executions
WHEN
  NEW.status IS NOT 'prepared'
  OR NEW.provider_call_may_have_started <> 0
  OR NEW.completed_at IS NOT NULL
  OR NEW.error_code IS NOT NULL
  OR NEW.updated_at IS NOT NEW.started_at
  OR NOT EXISTS (
    SELECT 1 FROM standalone_chat_turns
    WHERE turn_id = NEW.turn_id
      AND user_id = NEW.user_id
      AND assistant_id = NEW.assistant_id
      AND conversation_id = NEW.conversation_id
      AND status = 'ready'
  )
  OR NOT EXISTS (
    SELECT 1 FROM models
    WHERE owner_user_id = NEW.user_id
      AND model_id = NEW.model_id
      AND provider_id = NEW.provider_id
      AND model_name = NEW.model_name
      AND status = 'enabled'
  )
  OR NOT EXISTS (
    SELECT 1 FROM model_capabilities
    WHERE model_id = NEW.model_id AND capability = 'chat'
  )
  OR NOT EXISTS (
    SELECT 1 FROM api_providers
    WHERE owner_user_id = NEW.user_id
      AND api_provider_id = NEW.provider_id
      AND provider_type = NEW.provider_type
      AND interface_format = NEW.provider_interface_format
      AND status = 'enabled'
  )
  OR NOT EXISTS (
    SELECT 1 FROM api_provider_credential_bindings
    WHERE credential_binding_id = NEW.credential_binding_id
      AND owner_user_id = NEW.user_id
      AND provider_id = NEW.provider_id
      AND status = 'active'
  )
  OR NOT EXISTS (
    SELECT 1 FROM token_budgets
    WHERE user_id = NEW.user_id
      AND subject_id = NEW.assistant_id
      AND token_budget_id = NEW.token_budget_id
      AND status = 'enabled'
  )
  OR NOT EXISTS (
    SELECT 1 FROM permissions
    WHERE user_id = NEW.user_id
      AND permission_id = NEW.permission_id
      AND subject_id IS NULL
      AND resource_type = 'api'
      AND resource_id = NEW.provider_id
      AND action = 'execute'
      AND updated_at = NEW.permission_updated_at
      AND (
        status = 'active'
        OR (status = 'consumed' AND permission_level = 'allow_once')
      )
  )
  OR NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE user_id = NEW.user_id
      AND audit_log_id = NEW.security_audit_log_id
      AND subject_id IS NULL
      AND operation_type = 'privacy_access_request'
      AND resource_type = 'api'
      AND resource_id = NEW.provider_id
      AND action = 'execute'
      AND result = 'allowed'
  )
  OR (
    NEW.budget_approval_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM standalone_chat_budget_approvals
      WHERE budget_approval_id = NEW.budget_approval_id
        AND turn_id = NEW.turn_id
        AND user_id = NEW.user_id
        AND assistant_id = NEW.assistant_id
        AND conversation_id = NEW.conversation_id
        AND target_attempt_number = 1
        AND token_budget_id = NEW.token_budget_id
        AND budget_session_id = NEW.budget_session_id
        AND estimated_tokens = NEW.estimated_tokens
        AND request_hash = NEW.request_hash
        AND budget_facts_hash = NEW.budget_facts_hash
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'standalone execution requires an approved current configuration');
END;

CREATE TRIGGER guard_standalone_execution_transition
BEFORE UPDATE OF status ON standalone_chat_model_executions
WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'prepared' AND NEW.status IN (
    'in_flight', 'retryable', 'failed_terminal', 'cancelled'
  ))
  OR (OLD.status = 'in_flight' AND NEW.status IN (
    'succeeded', 'retryable', 'outcome_unknown', 'failed_terminal', 'cancelled'
  ))
  OR (OLD.status = 'retryable' AND NEW.status IN (
    'prepared', 'failed_terminal', 'cancelled'
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'standalone execution state transition is not allowed');
END;

CREATE TRIGGER protect_standalone_execution_identity
BEFORE UPDATE ON standalone_chat_model_executions
WHEN
  NEW.execution_id IS NOT OLD.execution_id
  OR NEW.turn_id IS NOT OLD.turn_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.assistant_id IS NOT OLD.assistant_id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.provider_id IS NOT OLD.provider_id
  OR NEW.model_id IS NOT OLD.model_id
  OR NEW.credential_binding_id IS NOT OLD.credential_binding_id
  OR NEW.token_budget_id IS NOT OLD.token_budget_id
  OR NEW.budget_session_id IS NOT OLD.budget_session_id
  OR NEW.provider_type IS NOT OLD.provider_type
  OR NEW.provider_interface_format IS NOT OLD.provider_interface_format
  OR NEW.model_name IS NOT OLD.model_name
  OR NEW.permission_decision IS NOT OLD.permission_decision
  OR NEW.security_decision IS NOT OLD.security_decision
  OR NEW.budget_decision IS NOT OLD.budget_decision
  OR NEW.estimated_tokens IS NOT OLD.estimated_tokens
  OR NEW.security_audit_log_id IS NOT OLD.security_audit_log_id
  OR NEW.permission_id IS NOT OLD.permission_id
  OR NEW.permission_updated_at IS NOT OLD.permission_updated_at
  OR NEW.security_facts_hash IS NOT OLD.security_facts_hash
  OR NEW.budget_facts_hash IS NOT OLD.budget_facts_hash
  OR NEW.budget_approval_id IS NOT OLD.budget_approval_id
  OR NEW.max_output_tokens IS NOT OLD.max_output_tokens
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.started_at IS NOT OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'standalone execution identity and decision snapshot are immutable');
END;

CREATE TRIGGER validate_standalone_budget_approval
BEFORE INSERT ON standalone_chat_budget_approvals
WHEN
  NOT EXISTS (
    SELECT 1 FROM standalone_chat_turns
    WHERE turn_id = NEW.turn_id
      AND user_id = NEW.user_id
      AND assistant_id = NEW.assistant_id
      AND conversation_id = NEW.conversation_id
      AND status = 'waiting_budget'
      AND confirmation_id = NEW.confirmation_id
      AND confirmation_kind = 'budget'
  )
  OR NOT EXISTS (
    SELECT 1 FROM token_budgets
    WHERE user_id = NEW.user_id
      AND subject_id = NEW.assistant_id
      AND token_budget_id = NEW.token_budget_id
      AND daily_token_limit = NEW.daily_token_limit
      AND session_token_limit = NEW.session_token_limit
      AND overage_policy = NEW.overage_policy
      AND status = 'enabled'
      AND updated_at = NEW.budget_updated_at
  )
  OR NOT (
    NEW.daily_projected > NEW.daily_token_limit
    OR NEW.session_projected > NEW.session_token_limit
  )
  OR NOT EXISTS (
    SELECT 1 FROM security_confirmations
    WHERE user_id = NEW.user_id
      AND confirmation_id = NEW.confirmation_id
      AND subject_id = NEW.assistant_id
      AND operation_type = 'general_access'
      AND resource_type = 'proactive_interaction'
      AND resource_id = NEW.token_budget_id
      AND action = 'execute'
      AND status = 'consumed'
      AND security_session_id = NEW.approved_by_session_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE user_id = NEW.user_id
      AND audit_log_id = NEW.security_audit_log_id
      AND subject_id = NEW.assistant_id
      AND operation_type = 'general_access'
      AND resource_type = 'proactive_interaction'
      AND resource_id = NEW.token_budget_id
      AND action = 'execute'
      AND result = 'allowed'
      AND confirmation_id = NEW.confirmation_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM personal_sessions
    WHERE session_id = NEW.approved_by_session_id
      AND user_id = NEW.user_id
      AND revoked_at IS NULL
      AND created_at <= NEW.approved_at
      AND expires_at > NEW.approved_at
  )
BEGIN
  SELECT RAISE(ABORT, 'standalone budget approval requires matching consumed facts');
END;

CREATE TRIGGER prevent_standalone_budget_approval_update
BEFORE UPDATE ON standalone_chat_budget_approvals
BEGIN
  SELECT RAISE(ABORT, 'standalone budget approvals are immutable');
END;

CREATE TRIGGER protect_terminal_standalone_execution
BEFORE UPDATE ON standalone_chat_model_executions
WHEN OLD.status IN ('succeeded', 'failed_terminal', 'outcome_unknown', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'terminal standalone execution is immutable');
END;

CREATE TRIGGER guard_standalone_attempt_insert
BEFORE INSERT ON standalone_chat_provider_attempts
WHEN
  NEW.status IS NOT 'prepared'
  OR NEW.provider_call_may_have_started <> 0
  OR NEW.completed_at IS NOT NULL
  OR NEW.error_code IS NOT NULL
  OR NEW.attempt_number <> COALESCE((
    SELECT MAX(attempt_number) + 1
    FROM standalone_chat_provider_attempts
    WHERE execution_id = NEW.execution_id
  ), 1)
  OR
  NOT EXISTS (
    SELECT 1 FROM standalone_chat_model_executions
    WHERE execution_id = NEW.execution_id
      AND turn_id = NEW.turn_id
      AND user_id = NEW.user_id
      AND assistant_id = NEW.assistant_id
      AND conversation_id = NEW.conversation_id
      AND status = 'prepared'
      AND request_hash = NEW.request_hash
      AND max_output_tokens > 0
  )
  OR NOT EXISTS (
    SELECT 1 FROM permissions
    WHERE user_id = NEW.user_id
      AND permission_id = NEW.permission_id
      AND subject_id IS NULL
      AND resource_type = 'api'
      AND resource_id = (
        SELECT provider_id FROM standalone_chat_model_executions
        WHERE execution_id = NEW.execution_id
      )
      AND action = 'execute'
      AND updated_at = NEW.permission_updated_at
      AND (
        status = 'active'
        OR (status = 'consumed' AND permission_level = 'allow_once')
      )
  )
  OR NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE user_id = NEW.user_id
      AND audit_log_id = NEW.security_audit_log_id
      AND subject_id IS NULL
      AND operation_type = 'privacy_access_request'
      AND resource_type = 'api'
      AND resource_id = (
        SELECT provider_id FROM standalone_chat_model_executions
        WHERE execution_id = NEW.execution_id
      )
      AND action = 'execute'
      AND result = 'allowed'
  )
  OR (
    NEW.attempt_number = 1
    AND NOT EXISTS (
      SELECT 1 FROM standalone_chat_model_executions
      WHERE execution_id = NEW.execution_id
        AND permission_id = NEW.permission_id
        AND permission_updated_at = NEW.permission_updated_at
        AND security_facts_hash = NEW.security_facts_hash
        AND budget_facts_hash = NEW.budget_facts_hash
        AND budget_approval_id IS NEW.budget_approval_id
    )
  )
  OR (
    NEW.budget_approval_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM standalone_chat_budget_approvals
      WHERE budget_approval_id = NEW.budget_approval_id
        AND turn_id = NEW.turn_id
        AND user_id = NEW.user_id
        AND assistant_id = NEW.assistant_id
        AND conversation_id = NEW.conversation_id
        AND target_attempt_number = NEW.attempt_number
        AND request_hash = NEW.request_hash
        AND budget_facts_hash = NEW.budget_facts_hash
    )
  )
  OR EXISTS (
    SELECT 1 FROM standalone_chat_provider_attempts
    WHERE execution_id = NEW.execution_id
      AND status NOT IN ('not_sent', 'retryable')
  )
BEGIN
  SELECT RAISE(ABORT, 'standalone provider attempt is not safely retryable');
END;

CREATE TRIGGER guard_standalone_attempt_transition
BEFORE UPDATE OF status ON standalone_chat_provider_attempts
WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'prepared' AND NEW.status IN (
    'in_flight', 'not_sent', 'retryable', 'failed_terminal', 'cancelled'
  ))
  OR (OLD.status = 'in_flight' AND NEW.status IN (
    'not_sent', 'response_received', 'retryable', 'outcome_unknown',
    'failed_terminal', 'cancelled'
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'standalone provider attempt state transition is not allowed');
END;

CREATE TRIGGER protect_standalone_attempt_identity
BEFORE UPDATE ON standalone_chat_provider_attempts
WHEN
  NEW.attempt_id IS NOT OLD.attempt_id
  OR NEW.execution_id IS NOT OLD.execution_id
  OR NEW.turn_id IS NOT OLD.turn_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.assistant_id IS NOT OLD.assistant_id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.attempt_number IS NOT OLD.attempt_number
  OR NEW.security_audit_log_id IS NOT OLD.security_audit_log_id
  OR NEW.permission_id IS NOT OLD.permission_id
  OR NEW.permission_updated_at IS NOT OLD.permission_updated_at
  OR NEW.security_facts_hash IS NOT OLD.security_facts_hash
  OR NEW.budget_facts_hash IS NOT OLD.budget_facts_hash
  OR NEW.budget_approval_id IS NOT OLD.budget_approval_id
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.started_at IS NOT OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'standalone provider attempt identity is immutable');
END;

CREATE TRIGGER protect_terminal_standalone_attempt
BEFORE UPDATE ON standalone_chat_provider_attempts
WHEN OLD.status NOT IN ('prepared', 'in_flight')
BEGIN
  SELECT RAISE(ABORT, 'terminal standalone provider attempt is immutable');
END;

CREATE TRIGGER prevent_standalone_execution_call_reset
BEFORE UPDATE OF provider_call_may_have_started ON standalone_chat_model_executions
WHEN OLD.provider_call_may_have_started = 1 AND NEW.provider_call_may_have_started = 0
BEGIN
  SELECT RAISE(ABORT, 'standalone execution call boundary cannot be reset');
END;

CREATE TRIGGER prevent_standalone_attempt_call_reset
BEFORE UPDATE OF provider_call_may_have_started ON standalone_chat_provider_attempts
WHEN OLD.provider_call_may_have_started = 1 AND NEW.provider_call_may_have_started = 0
BEGIN
  SELECT RAISE(ABORT, 'standalone provider attempt call boundary cannot be reset');
END;

CREATE TRIGGER validate_standalone_usage_attempt
BEFORE INSERT ON standalone_chat_usage_facts
WHEN
  NOT EXISTS (
    SELECT 1
    FROM standalone_chat_model_executions
    WHERE execution_id = NEW.execution_id
      AND turn_id = NEW.turn_id
      AND user_id = NEW.user_id
      AND assistant_id = NEW.assistant_id
      AND conversation_id = NEW.conversation_id
      AND token_budget_id = NEW.token_budget_id
      AND budget_session_id = NEW.budget_session_id
      AND model_id = NEW.model_id
  )
  OR NOT EXISTS (
  SELECT 1
  FROM standalone_chat_provider_attempts
  WHERE attempt_id = NEW.attempt_id
    AND execution_id = NEW.execution_id
    AND turn_id = NEW.turn_id
    AND user_id = NEW.user_id
    AND assistant_id = NEW.assistant_id
    AND conversation_id = NEW.conversation_id
    AND (
      (NEW.usage_status = 'provider_reported'
        AND status = 'response_received'
        AND provider_call_may_have_started = 1)
      OR (NEW.usage_status = 'unknown'
        AND provider_call_may_have_started = 1
        AND status IN ('retryable', 'outcome_unknown', 'failed_terminal', 'cancelled'))
      OR (NEW.usage_status = 'not_incurred'
        AND provider_call_may_have_started = 0
        AND status IN ('not_sent', 'retryable', 'failed_terminal', 'cancelled'))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'standalone usage requires a matching terminal attempt fact');
END;

CREATE TRIGGER validate_standalone_provider_result
BEFORE INSERT ON standalone_chat_provider_results
WHEN
  NOT EXISTS (
    SELECT 1 FROM standalone_chat_model_executions
    WHERE execution_id = NEW.execution_id
      AND turn_id = NEW.turn_id
      AND user_id = NEW.user_id
      AND assistant_id = NEW.assistant_id
      AND conversation_id = NEW.conversation_id
      AND status = 'succeeded'
  )
  OR NOT EXISTS (
    SELECT 1 FROM standalone_chat_provider_attempts
    WHERE attempt_id = NEW.attempt_id
      AND execution_id = NEW.execution_id
      AND status = 'response_received'
  )
  OR NOT EXISTS (
    SELECT 1 FROM standalone_chat_usage_facts
    WHERE usage_ledger_entry_id = NEW.usage_ledger_entry_id
      AND execution_id = NEW.execution_id
      AND attempt_id = NEW.attempt_id
      AND turn_id = NEW.turn_id
      AND user_id = NEW.user_id
      AND assistant_id = NEW.assistant_id
      AND conversation_id = NEW.conversation_id
      AND usage_status = 'provider_reported'
  )
  OR json_type(NEW.result_json, '$') IS NOT 'object'
  OR (SELECT COUNT(*) FROM json_each(NEW.result_json)) <> 4
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.result_json)
    WHERE key NOT IN ('schemaVersion', 'responseCandidate', 'finishReason', 'usage')
  )
  OR json_type(NEW.result_json, '$.schemaVersion') IS NOT 'text'
  OR json_extract(NEW.result_json, '$.schemaVersion') <> 'vio-standalone-model-result/v1'
  OR json_type(NEW.result_json, '$.responseCandidate') IS NOT 'text'
  OR length(json_extract(NEW.result_json, '$.responseCandidate')) NOT BETWEEN 1 AND 4096
  OR json_type(NEW.result_json, '$.finishReason') IS NOT 'text'
  OR length(json_extract(NEW.result_json, '$.finishReason')) NOT BETWEEN 1 AND 128
  OR json_extract(NEW.result_json, '$.finishReason') <> NEW.finish_reason
  OR json_type(NEW.result_json, '$.usage') IS NOT 'object'
  OR (SELECT COUNT(*) FROM json_each(NEW.result_json, '$.usage')) <> 3
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.result_json, '$.usage')
    WHERE key NOT IN ('inputTokens', 'outputTokens', 'totalTokens')
  )
  OR json_type(NEW.result_json, '$.usage.inputTokens') IS NOT 'integer'
  OR json_type(NEW.result_json, '$.usage.outputTokens') IS NOT 'integer'
  OR json_type(NEW.result_json, '$.usage.totalTokens') IS NOT 'integer'
  OR NOT EXISTS (
    SELECT 1 FROM standalone_chat_usage_facts
    WHERE usage_ledger_entry_id = NEW.usage_ledger_entry_id
      AND input_tokens = json_extract(NEW.result_json, '$.usage.inputTokens')
      AND output_tokens = json_extract(NEW.result_json, '$.usage.outputTokens')
      AND total_tokens = json_extract(NEW.result_json, '$.usage.totalTokens')
  )
BEGIN
  SELECT RAISE(ABORT, 'standalone provider result requires matching completed facts');
END;

CREATE TRIGGER prevent_standalone_default_conversation_update
BEFORE UPDATE ON standalone_chat_default_conversations
BEGIN
  SELECT RAISE(ABORT, 'standalone default conversation mapping is immutable');
END;

CREATE TRIGGER prevent_standalone_usage_update
BEFORE UPDATE ON standalone_chat_usage_facts
BEGIN
  SELECT RAISE(ABORT, 'standalone usage facts are immutable');
END;

CREATE TRIGGER prevent_standalone_budget_approval_delete
BEFORE DELETE ON standalone_chat_budget_approvals
WHEN vio_owner_deletion_authorized('standalone_chat_budget_approvals', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone budget approvals require governed retention');
END;

CREATE TRIGGER prevent_standalone_result_update
BEFORE UPDATE ON standalone_chat_provider_results
BEGIN
  SELECT RAISE(ABORT, 'standalone provider results are immutable');
END;

CREATE TRIGGER protect_standalone_recovery_identity
BEFORE UPDATE ON standalone_chat_recovery_actions
WHEN
  NEW.recovery_action_id IS NOT OLD.recovery_action_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.assistant_id IS NOT OLD.assistant_id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.turn_id IS NOT OLD.turn_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.action_type IS NOT OLD.action_type
  OR NEW.content_hash IS NOT OLD.content_hash
  OR NEW.input_json IS NOT OLD.input_json
  OR NEW.turn_status_before IS NOT OLD.turn_status_before
  OR NEW.attempt_count_before IS NOT OLD.attempt_count_before
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'standalone recovery action identity is immutable');
END;

CREATE TRIGGER protect_terminal_standalone_recovery
BEFORE UPDATE ON standalone_chat_recovery_actions
WHEN OLD.status = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'completed standalone recovery action is immutable');
END;

CREATE TRIGGER guard_standalone_recovery_insert
BEFORE INSERT ON standalone_chat_recovery_actions
WHEN NEW.status IS NOT 'pending' OR NEW.completed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'standalone recovery action must begin pending');
END;

CREATE TRIGGER prevent_standalone_default_conversation_delete
BEFORE DELETE ON standalone_chat_default_conversations
WHEN vio_owner_deletion_authorized('standalone_chat_default_conversations', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone default conversations require governed retention');
END;

CREATE TRIGGER prevent_standalone_turn_delete
BEFORE DELETE ON standalone_chat_turns
WHEN vio_owner_deletion_authorized('standalone_chat_turns', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone turns require governed retention');
END;

CREATE TRIGGER prevent_standalone_execution_delete
BEFORE DELETE ON standalone_chat_model_executions
WHEN vio_owner_deletion_authorized('standalone_chat_model_executions', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone executions require governed retention');
END;

CREATE TRIGGER prevent_standalone_attempt_delete
BEFORE DELETE ON standalone_chat_provider_attempts
WHEN vio_owner_deletion_authorized('standalone_chat_provider_attempts', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone provider attempts require governed retention');
END;

CREATE TRIGGER prevent_standalone_usage_delete
BEFORE DELETE ON standalone_chat_usage_facts
WHEN vio_owner_deletion_authorized('standalone_chat_usage_facts', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone usage facts require governed retention');
END;

CREATE TRIGGER prevent_standalone_result_delete
BEFORE DELETE ON standalone_chat_provider_results
WHEN vio_owner_deletion_authorized('standalone_chat_provider_results', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone provider results require governed retention');
END;


CREATE TRIGGER prevent_standalone_recovery_delete
BEFORE DELETE ON standalone_chat_recovery_actions
WHEN vio_owner_deletion_authorized('standalone_chat_recovery_actions', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone recovery actions require governed retention');
END;
