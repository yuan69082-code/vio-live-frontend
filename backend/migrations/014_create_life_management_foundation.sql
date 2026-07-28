-- vio-migration: foreign-keys-off

CREATE TABLE permissions_014 (
  permission_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain', 'life_data'
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

INSERT INTO permissions_014 SELECT * FROM permissions;
DROP TABLE permissions;
ALTER TABLE permissions_014 RENAME TO permissions;

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

CREATE TABLE security_policies_014 (
  policy_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain', 'life_data'
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

INSERT INTO security_policies_014 SELECT * FROM security_policies;
DROP TABLE security_policies;
ALTER TABLE security_policies_014 RENAME TO security_policies;

CREATE UNIQUE INDEX idx_security_policies_active_scope
  ON security_policies (user_id, resource_type, action_type, risk_level)
  WHERE status = 'active';
CREATE INDEX idx_security_policies_user_status_scope
  ON security_policies (
    user_id, status, resource_type, action_type, risk_level, updated_at DESC, policy_id
  );

CREATE TABLE security_confirmations_014 (
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
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain', 'life_data'
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

INSERT INTO security_confirmations_014 (
  confirmation_id, user_id, subject_id, operation_type, resource_type, resource_id,
  action, permission_id, permission_level, permission_updated_at, policy_fingerprint,
  confirmation_mode, risk_level, status, requested_at, expires_at, decided_at,
  consumed_at, security_policy_id, security_policy_updated_at, security_session_id,
  confirmation_reason, risk_description, user_choice
)
SELECT
  confirmation_id, user_id, subject_id, operation_type, resource_type, resource_id,
  action, permission_id, permission_level, permission_updated_at, policy_fingerprint,
  confirmation_mode, risk_level, status, requested_at, expires_at, decided_at,
  consumed_at, security_policy_id, security_policy_updated_at, security_session_id,
  confirmation_reason, risk_description, user_choice
FROM security_confirmations;

DROP TABLE security_confirmations;
ALTER TABLE security_confirmations_014 RENAME TO security_confirmations;
CREATE UNIQUE INDEX idx_security_confirmations_user_and_confirmation
  ON security_confirmations (user_id, confirmation_id);
CREATE INDEX idx_security_confirmations_user_status_time
  ON security_confirmations (user_id, status, requested_at DESC, confirmation_id);

CREATE TABLE audit_logs_014 (
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
      'skill', 'device', 'api', 'private_domain', 'life_data', 'identity', 'payment'
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

INSERT INTO audit_logs_014 SELECT * FROM audit_logs;
DROP TABLE audit_logs;
ALTER TABLE audit_logs_014 RENAME TO audit_logs;
CREATE INDEX idx_audit_logs_user_time
  ON audit_logs (user_id, occurred_at DESC, audit_log_id);
CREATE INDEX idx_audit_logs_user_subject_time
  ON audit_logs (user_id, subject_id, occurred_at DESC, audit_log_id);
CREATE INDEX idx_audit_logs_user_operation_result_time
  ON audit_logs (user_id, operation_type, result, occurred_at DESC, audit_log_id);
CREATE UNIQUE INDEX idx_audit_logs_user_and_audit_log
  ON audit_logs (user_id, audit_log_id);

CREATE TABLE life_financial_records (
  financial_record_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  category TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, financial_record_id)
);

CREATE INDEX idx_life_financial_records_scope_time
  ON life_financial_records (user_id, subject_id, occurred_at DESC, financial_record_id);
CREATE INDEX idx_life_financial_records_scope_category_time
  ON life_financial_records (user_id, subject_id, category, occurred_at DESC);

CREATE TABLE life_budgets (
  budget_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  reminder_rule_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, month, category),
  UNIQUE (user_id, subject_id, budget_id)
);

CREATE INDEX idx_life_budgets_scope_month
  ON life_budgets (user_id, subject_id, month DESC, category);

CREATE TABLE life_calendar_entries (
  calendar_entry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (
    entry_type IN ('anniversary', 'menstrual_period', 'intimate_record', 'ordinary_event')
  ),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  note TEXT,
  reminder_rule_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, calendar_entry_id)
);

CREATE INDEX idx_life_calendar_entries_scope_time
  ON life_calendar_entries (user_id, subject_id, starts_at DESC, calendar_entry_id);

CREATE TABLE life_body_records (
  body_record_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  weight_kg REAL,
  bust_cm REAL,
  waist_cm REAL,
  hip_cm REAL,
  ai_suggestion TEXT,
  measured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (
    weight_kg IS NOT NULL OR bust_cm IS NOT NULL OR waist_cm IS NOT NULL OR hip_cm IS NOT NULL
  ),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, body_record_id)
);

CREATE INDEX idx_life_body_records_scope_time
  ON life_body_records (user_id, subject_id, measured_at DESC, body_record_id);

CREATE TABLE life_body_goals (
  body_goal_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  target_weight_kg REAL,
  target_bust_cm REAL,
  target_waist_cm REAL,
  target_hip_cm REAL,
  target_date TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    target_weight_kg IS NOT NULL OR target_bust_cm IS NOT NULL
      OR target_waist_cm IS NOT NULL OR target_hip_cm IS NOT NULL
  ),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id),
  UNIQUE (user_id, subject_id, body_goal_id)
);

CREATE TABLE local_memories (
  memory_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  participates_in_context INTEGER NOT NULL CHECK (participates_in_context IN (0, 1)),
  export_marked INTEGER NOT NULL CHECK (export_marked IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, memory_id)
);

CREATE INDEX idx_local_memories_scope_context
  ON local_memories (
    user_id, subject_id, participates_in_context, export_marked, updated_at DESC, memory_id
  );

CREATE TABLE events_014 (
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
      'private_state_changed'
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

INSERT INTO events_014 SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_014 RENAME TO events;
CREATE INDEX idx_events_user_time ON events (user_id, occurred_at DESC);
CREATE INDEX idx_events_user_subject_time
  ON events (user_id, subject_id, occurred_at DESC);
CREATE INDEX idx_events_user_type_status_time
  ON events (user_id, event_type, status, occurred_at DESC);
CREATE UNIQUE INDEX idx_events_user_subject_and_event
  ON events (user_id, subject_id, event_id);
CREATE UNIQUE INDEX idx_events_user_and_event ON events (user_id, event_id);
