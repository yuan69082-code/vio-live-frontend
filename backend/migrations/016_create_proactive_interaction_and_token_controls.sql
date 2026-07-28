-- vio-migration: foreign-keys-off

CREATE TABLE permissions_016 (
  permission_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain',
      'life_data', 'proactive_interaction'
    )
  ),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('read', 'write', 'execute', 'control', 'connect', 'export', 'delete', 'manage')
  ),
  permission_level TEXT NOT NULL CHECK (
    permission_level IN (
      'always_allow', 'ask_every_time', 'allow_once', 'denied', 'forbidden_ask'
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'consumed', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT
);

INSERT INTO permissions_016 SELECT * FROM permissions;
DROP TABLE permissions;
ALTER TABLE permissions_016 RENAME TO permissions;
CREATE UNIQUE INDEX idx_permissions_current_scope
  ON permissions (user_id, subject_id, resource_type, resource_id, action)
  WHERE status IN ('active', 'inactive');
CREATE INDEX idx_permissions_user_subject_status
  ON permissions (user_id, subject_id, status, updated_at DESC, permission_id);
CREATE INDEX idx_permissions_active_check
  ON permissions (user_id, subject_id, resource_type, resource_id, action)
  WHERE status = 'active';
CREATE UNIQUE INDEX idx_permissions_user_and_permission
  ON permissions (user_id, permission_id);

CREATE TABLE security_policies_016 (
  policy_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain',
      'life_data', 'proactive_interaction'
    )
  ),
  action_type TEXT NOT NULL CHECK (
    action_type IN ('read', 'write', 'execute', 'control', 'connect', 'export', 'delete', 'manage')
  ),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  rule TEXT NOT NULL CHECK (
    rule IN ('always_allow', 'session_allow', 'always_confirm', 'deny', 'deny_without_confirm')
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  UNIQUE (user_id, policy_id)
);

INSERT INTO security_policies_016 SELECT * FROM security_policies;
DROP TABLE security_policies;
ALTER TABLE security_policies_016 RENAME TO security_policies;
CREATE UNIQUE INDEX idx_security_policies_active_scope
  ON security_policies (user_id, resource_type, action_type, risk_level)
  WHERE status = 'active';
CREATE INDEX idx_security_policies_user_status_scope
  ON security_policies (
    user_id, status, resource_type, action_type, risk_level, updated_at DESC, policy_id
  );

CREATE TABLE security_confirmations_016 (
  confirmation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN (
      'general_access', 'permission_change', 'security_policy_change',
      'api_configuration_change', 'privacy_access_request', 'payment_operation',
      'device_control', 'sensitive_data_access', 'data_deletion'
    )
  ),
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain',
      'life_data', 'proactive_interaction'
    )
  ),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  permission_level TEXT NOT NULL CHECK (
    permission_level IN (
      'always_allow', 'ask_every_time', 'allow_once', 'denied', 'forbidden_ask'
    )
  ),
  permission_updated_at TEXT NOT NULL,
  policy_fingerprint TEXT NOT NULL,
  confirmation_mode TEXT NOT NULL CHECK (confirmation_mode IN ('every_time', 'user_defined')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  consumed_at TEXT,
  security_policy_id TEXT,
  security_policy_updated_at TEXT,
  security_session_id TEXT,
  confirmation_reason TEXT NOT NULL DEFAULT 'Security confirmation is required.',
  risk_description TEXT NOT NULL DEFAULT 'Review the operation risk before deciding.',
  user_choice TEXT CHECK (user_choice IS NULL OR user_choice IN ('approve', 'reject')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, permission_id)
    REFERENCES permissions(user_id, permission_id) ON DELETE RESTRICT
);

INSERT INTO security_confirmations_016 SELECT * FROM security_confirmations;
DROP TABLE security_confirmations;
ALTER TABLE security_confirmations_016 RENAME TO security_confirmations;
CREATE UNIQUE INDEX idx_security_confirmations_user_and_confirmation
  ON security_confirmations (user_id, confirmation_id);
CREATE INDEX idx_security_confirmations_user_status_time
  ON security_confirmations (user_id, status, requested_at DESC, confirmation_id);

CREATE TABLE audit_logs_016 (
  audit_log_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN (
      'general_access', 'permission_change', 'security_policy_change',
      'api_configuration_change', 'privacy_access_request', 'payment_operation',
      'device_control', 'sensitive_data_access', 'data_deletion'
    )
  ),
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'permission', 'security_policy', 'api_provider', 'memory', 'tool', 'mcp',
      'skill', 'device', 'api', 'private_domain', 'life_data',
      'proactive_interaction', 'identity', 'payment'
    )
  ),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  permission_decision TEXT CHECK (
    permission_decision IS NULL OR permission_decision IN ('allow', 'ask', 'deny')
  ),
  confirmation_mode TEXT CHECK (
    confirmation_mode IS NULL OR confirmation_mode IN ('not_required', 'every_time', 'user_defined')
  ),
  result TEXT NOT NULL CHECK (
    result IN ('allowed', 'denied', 'confirmation_required', 'confirmed', 'rejected', 'succeeded', 'failed')
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'permission_created', 'permission_updated', 'permission_deleted',
      'permission_consumed', 'security_policy_created', 'security_policy_updated',
      'security_policy_deleted', 'security_preference_updated', 'security_policy_denied',
      'api_provider_created', 'api_provider_status_updated', 'permission_denied',
      'confirmation_required', 'confirmation_pending', 'confirmation_approved',
      'confirmation_rejected', 'confirmation_scope_mismatch', 'confirmation_replayed',
      'confirmation_expired', 'security_preflight_allowed', 'allow_once_unavailable'
    )
  ),
  confirmation_id TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, confirmation_id)
    REFERENCES security_confirmations(user_id, confirmation_id) ON DELETE RESTRICT
);

INSERT INTO audit_logs_016 SELECT * FROM audit_logs;
DROP TABLE audit_logs;
ALTER TABLE audit_logs_016 RENAME TO audit_logs;
CREATE INDEX idx_audit_logs_user_time
  ON audit_logs (user_id, occurred_at DESC, audit_log_id);
CREATE INDEX idx_audit_logs_user_subject_time
  ON audit_logs (user_id, subject_id, occurred_at DESC, audit_log_id);
CREATE INDEX idx_audit_logs_user_operation_result_time
  ON audit_logs (user_id, operation_type, result, occurred_at DESC, audit_log_id);
CREATE UNIQUE INDEX idx_audit_logs_user_and_audit_log
  ON audit_logs (user_id, audit_log_id);

CREATE TABLE events_016 (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'appearance_changed', 'subject_updated', 'permission_created',
      'permission_changed', 'permission_revoked', 'confirmation_required',
      'life_record_created', 'life_event_created', 'budget_changed', 'health_record_updated',
      'device_changed', 'conversation_created', 'message_created', 'message_updated',
      'message_regenerated', 'private_space_created', 'private_memory_updated',
      'private_state_changed', 'wake_configuration_changed', 'wake_trigger_prepared',
      'proactive_prompt_prepared', 'token_budget_changed', 'token_usage_recorded',
      'background_policy_changed'
    )
  ),
  source_type TEXT NOT NULL,
  source_ref TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  event_data_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'ignored', 'failed')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT
);

INSERT INTO events_016 SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_016 RENAME TO events;
CREATE INDEX idx_events_user_time ON events (user_id, occurred_at DESC);
CREATE INDEX idx_events_user_subject_time
  ON events (user_id, subject_id, occurred_at DESC);
CREATE INDEX idx_events_user_type_status_time
  ON events (user_id, event_type, status, occurred_at DESC);
CREATE UNIQUE INDEX idx_events_user_subject_and_event
  ON events (user_id, subject_id, event_id);
CREATE UNIQUE INDEX idx_events_user_and_event ON events (user_id, event_id);

CREATE TABLE wake_rules (
  wake_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  wake_type TEXT NOT NULL CHECK (wake_type IN ('voice', 'desktop', 'schedule', 'event')),
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  trigger_condition_json TEXT NOT NULL,
  authorization_status TEXT NOT NULL CHECK (
    authorization_status IN ('not_granted', 'granted', 'revoked')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, wake_id)
);

CREATE INDEX idx_wake_rules_scope_status
  ON wake_rules (user_id, subject_id, status, wake_type, updated_at DESC, wake_id);

CREATE TABLE proactive_prompt_rules (
  prompt_rule_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('urgent', 'important', 'normal', 'silent')),
  trigger_event_type TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  requires_confirmation INTEGER NOT NULL CHECK (requires_confirmation IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, prompt_rule_id)
);

CREATE INDEX idx_proactive_prompt_rules_trigger
  ON proactive_prompt_rules (
    user_id, subject_id, status, trigger_event_type, priority, updated_at DESC, prompt_rule_id
  );

CREATE TABLE proactive_prompt_records (
  prompt_record_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  prompt_rule_id TEXT NOT NULL,
  trigger_event_id TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('urgent', 'important', 'normal', 'silent')),
  status TEXT NOT NULL CHECK (
    status IN ('ready', 'confirmation_required', 'denied', 'suppressed')
  ),
  security_audit_log_id TEXT,
  delivery_status TEXT NOT NULL CHECK (delivery_status = 'not_delivered'),
  model_call_status TEXT NOT NULL CHECK (model_call_status = 'not_performed'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id, subject_id, prompt_rule_id)
    REFERENCES proactive_prompt_rules(user_id, subject_id, prompt_rule_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (user_id, trigger_event_id)
    REFERENCES events(user_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, security_audit_log_id)
    REFERENCES audit_logs(user_id, audit_log_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, prompt_record_id)
);

CREATE INDEX idx_proactive_prompt_records_scope_time
  ON proactive_prompt_records (
    user_id, subject_id, status, priority, created_at DESC, prompt_record_id
  );

CREATE TABLE token_budgets (
  token_budget_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  daily_token_limit INTEGER NOT NULL CHECK (daily_token_limit > 0),
  session_token_limit INTEGER NOT NULL CHECK (session_token_limit > 0),
  overage_policy TEXT NOT NULL CHECK (
    overage_policy IN ('block', 'require_confirmation', 'defer')
  ),
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id),
  UNIQUE (user_id, subject_id, token_budget_id)
);

CREATE INDEX idx_token_budgets_scope_status
  ON token_budgets (user_id, subject_id, status, updated_at DESC, token_budget_id);

CREATE TABLE token_usage_records (
  token_usage_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  token_budget_id TEXT NOT NULL,
  budget_session_id TEXT NOT NULL,
  model_id TEXT,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (
    total_tokens >= 0 AND total_tokens = input_tokens + output_tokens
  ),
  usage_source TEXT NOT NULL CHECK (usage_source = 'explicit_api_input'),
  model_call_status TEXT NOT NULL CHECK (model_call_status = 'not_performed_by_platform'),
  billing_status TEXT NOT NULL CHECK (billing_status = 'not_billed'),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (user_id, subject_id, token_budget_id)
    REFERENCES token_budgets(user_id, subject_id, token_budget_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, model_id)
    REFERENCES models(owner_user_id, model_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, token_usage_id)
);

CREATE INDEX idx_token_usage_scope_day
  ON token_usage_records (
    user_id, subject_id, occurred_at DESC, token_usage_id
  );
CREATE INDEX idx_token_usage_scope_session
  ON token_usage_records (
    user_id, subject_id, budget_session_id, occurred_at DESC, token_usage_id
  );

CREATE TABLE assistant_background_policies (
  background_policy_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  run_state TEXT NOT NULL CHECK (run_state IN ('idle', 'active')),
  background_enabled INTEGER NOT NULL CHECK (background_enabled IN (0, 1)),
  max_wakeups_per_hour INTEGER NOT NULL CHECK (
    max_wakeups_per_hour BETWEEN 0 AND 60
  ),
  max_prompts_per_hour INTEGER NOT NULL CHECK (
    max_prompts_per_hour BETWEEN 0 AND 60
  ),
  allowed_wake_types_json TEXT NOT NULL,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id),
  UNIQUE (user_id, subject_id, background_policy_id)
);

CREATE INDEX idx_assistant_background_policies_state
  ON assistant_background_policies (
    user_id, subject_id, run_state, background_enabled, updated_at DESC
  );
