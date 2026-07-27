CREATE UNIQUE INDEX idx_permissions_user_and_permission
  ON permissions (user_id, permission_id);

CREATE TABLE security_confirmations (
  confirmation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN (
      'general_access',
      'permission_change',
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
      'memory',
      'tool',
      'mcp',
      'skill',
      'device',
      'api',
      'private_domain'
    )
  ),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  permission_level TEXT NOT NULL CHECK (
    permission_level IN (
      'always_allow',
      'ask_every_time',
      'allow_once',
      'denied',
      'forbidden_ask'
    )
  ),
  permission_updated_at TEXT NOT NULL,
  policy_fingerprint TEXT NOT NULL,
  confirmation_mode TEXT NOT NULL CHECK (
    confirmation_mode IN ('every_time', 'user_defined')
  ),
  risk_level TEXT NOT NULL CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')
  ),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, permission_id)
    REFERENCES permissions(user_id, permission_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_security_confirmations_user_and_confirmation
  ON security_confirmations (user_id, confirmation_id);

CREATE INDEX idx_security_confirmations_user_status_time
  ON security_confirmations (user_id, status, requested_at DESC, confirmation_id);

CREATE TABLE audit_logs (
  audit_log_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN (
      'general_access',
      'permission_change',
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

CREATE INDEX idx_audit_logs_user_time
  ON audit_logs (user_id, occurred_at DESC, audit_log_id);

CREATE INDEX idx_audit_logs_user_subject_time
  ON audit_logs (user_id, subject_id, occurred_at DESC, audit_log_id);

CREATE INDEX idx_audit_logs_user_operation_result_time
  ON audit_logs (user_id, operation_type, result, occurred_at DESC, audit_log_id);
