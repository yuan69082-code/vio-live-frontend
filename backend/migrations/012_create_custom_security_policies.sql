-- vio-migration: foreign-keys-off

CREATE TABLE security_policies (
  policy_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory',
      'tool',
      'mcp',
      'skill',
      'device',
      'api',
      'private_domain'
    )
  ),
  action_type TEXT NOT NULL CHECK (
    action_type IN ('read', 'write', 'execute', 'control', 'connect', 'export', 'delete', 'manage')
  ),
  risk_level TEXT NOT NULL CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  ),
  rule TEXT NOT NULL CHECK (
    rule IN (
      'always_allow',
      'session_allow',
      'always_confirm',
      'deny',
      'deny_without_confirm'
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  UNIQUE (user_id, policy_id)
);

CREATE UNIQUE INDEX idx_security_policies_active_scope
  ON security_policies (user_id, resource_type, action_type, risk_level)
  WHERE status = 'active';

CREATE INDEX idx_security_policies_user_status_scope
  ON security_policies (
    user_id,
    status,
    resource_type,
    action_type,
    risk_level,
    updated_at DESC,
    policy_id
  );

CREATE TABLE user_security_preferences (
  user_id TEXT PRIMARY KEY,
  default_security_level TEXT NOT NULL CHECK (
    default_security_level IN ('low', 'medium', 'high', 'critical')
  ),
  high_risk_operation_policy TEXT NOT NULL CHECK (
    high_risk_operation_policy IN ('always_confirm', 'deny', 'deny_without_confirm')
  ),
  auto_confirmation_scopes_json TEXT NOT NULL DEFAULT '[]',
  forbidden_scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT
);

CREATE TABLE security_policy_session_grants (
  session_grant_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_updated_at TEXT NOT NULL,
  security_session_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  ),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, policy_id)
    REFERENCES security_policies(user_id, policy_id) ON DELETE RESTRICT
);

CREATE INDEX idx_security_policy_session_grants_lookup
  ON security_policy_session_grants (
    user_id,
    subject_id,
    policy_id,
    security_session_id,
    resource_id,
    action_type,
    risk_level,
    expires_at DESC
  );

ALTER TABLE security_confirmations
  ADD COLUMN security_policy_id TEXT;

ALTER TABLE security_confirmations
  ADD COLUMN security_policy_updated_at TEXT;

ALTER TABLE security_confirmations
  ADD COLUMN security_session_id TEXT;

ALTER TABLE security_confirmations
  ADD COLUMN confirmation_reason TEXT NOT NULL DEFAULT 'Security confirmation is required.';

ALTER TABLE security_confirmations
  ADD COLUMN risk_description TEXT NOT NULL DEFAULT 'Review the operation risk before deciding.';

ALTER TABLE security_confirmations
  ADD COLUMN user_choice TEXT CHECK (
    user_choice IS NULL OR user_choice IN ('approve', 'reject')
  );

CREATE TABLE events_012 (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'appearance_changed',
      'subject_updated',
      'permission_created',
      'permission_changed',
      'permission_revoked',
      'confirmation_required',
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

INSERT INTO events_012 (
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
ALTER TABLE events_012 RENAME TO events;

CREATE INDEX idx_events_user_time
  ON events (user_id, occurred_at DESC);

CREATE INDEX idx_events_user_subject_time
  ON events (user_id, subject_id, occurred_at DESC);

CREATE INDEX idx_events_user_type_status_time
  ON events (user_id, event_type, status, occurred_at DESC);

CREATE UNIQUE INDEX idx_events_user_subject_and_event
  ON events (user_id, subject_id, event_id);

CREATE UNIQUE INDEX idx_events_user_and_event
  ON events (user_id, event_id);

CREATE TABLE audit_logs_012 (
  audit_log_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN (
      'general_access',
      'permission_change',
      'security_policy_change',
      'api_configuration_change',
      'privacy_access_request',
      'payment_operation',
      'device_control',
      'sensitive_data_access',
      'data_deletion'
    )
  ),
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'permission',
      'security_policy',
      'api_provider',
      'memory',
      'tool',
      'mcp',
      'skill',
      'device',
      'api',
      'private_domain',
      'identity',
      'payment'
    )
  ),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  ),
  permission_decision TEXT CHECK (
    permission_decision IS NULL OR permission_decision IN ('allow', 'ask', 'deny')
  ),
  confirmation_mode TEXT CHECK (
    confirmation_mode IS NULL
      OR confirmation_mode IN ('not_required', 'every_time', 'user_defined')
  ),
  result TEXT NOT NULL CHECK (
    result IN (
      'allowed',
      'denied',
      'confirmation_required',
      'confirmed',
      'rejected',
      'succeeded',
      'failed'
    )
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'permission_created',
      'permission_updated',
      'permission_deleted',
      'permission_consumed',
      'security_policy_created',
      'security_policy_updated',
      'security_policy_deleted',
      'security_preference_updated',
      'security_policy_denied',
      'api_provider_created',
      'api_provider_status_updated',
      'permission_denied',
      'confirmation_required',
      'confirmation_pending',
      'confirmation_approved',
      'confirmation_rejected',
      'confirmation_scope_mismatch',
      'confirmation_replayed',
      'confirmation_expired',
      'security_preflight_allowed',
      'allow_once_unavailable'
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

INSERT INTO audit_logs_012 (
  audit_log_id,
  user_id,
  subject_id,
  operation_type,
  resource_type,
  resource_id,
  action,
  risk_level,
  permission_decision,
  confirmation_mode,
  result,
  reason_code,
  confirmation_id,
  occurred_at
)
SELECT
  audit_log_id,
  user_id,
  subject_id,
  operation_type,
  resource_type,
  resource_id,
  action,
  risk_level,
  permission_decision,
  confirmation_mode,
  result,
  reason_code,
  confirmation_id,
  occurred_at
FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_012 RENAME TO audit_logs;

CREATE INDEX idx_audit_logs_user_time
  ON audit_logs (user_id, occurred_at DESC, audit_log_id);

CREATE INDEX idx_audit_logs_user_subject_time
  ON audit_logs (user_id, subject_id, occurred_at DESC, audit_log_id);

CREATE INDEX idx_audit_logs_user_operation_result_time
  ON audit_logs (user_id, operation_type, result, occurred_at DESC, audit_log_id);

CREATE UNIQUE INDEX idx_audit_logs_user_and_audit_log
  ON audit_logs (user_id, audit_log_id);
