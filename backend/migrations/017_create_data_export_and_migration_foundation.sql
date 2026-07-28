-- vio-migration: foreign-keys-off

CREATE TABLE permissions_017 (
  permission_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain',
      'life_data', 'proactive_interaction', 'data_export'
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

INSERT INTO permissions_017 SELECT * FROM permissions;
DROP TABLE permissions;
ALTER TABLE permissions_017 RENAME TO permissions;
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

CREATE TABLE security_policies_017 (
  policy_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain',
      'life_data', 'proactive_interaction', 'data_export'
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

INSERT INTO security_policies_017 SELECT * FROM security_policies;
DROP TABLE security_policies;
ALTER TABLE security_policies_017 RENAME TO security_policies;
CREATE UNIQUE INDEX idx_security_policies_active_scope
  ON security_policies (user_id, resource_type, action_type, risk_level)
  WHERE status = 'active';
CREATE INDEX idx_security_policies_user_status_scope
  ON security_policies (
    user_id, status, resource_type, action_type, risk_level, updated_at DESC, policy_id
  );

CREATE TABLE security_confirmations_017 (
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
      'life_data', 'proactive_interaction', 'data_export'
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

INSERT INTO security_confirmations_017 SELECT * FROM security_confirmations;
DROP TABLE security_confirmations;
ALTER TABLE security_confirmations_017 RENAME TO security_confirmations;
CREATE UNIQUE INDEX idx_security_confirmations_user_and_confirmation
  ON security_confirmations (user_id, confirmation_id);
CREATE INDEX idx_security_confirmations_user_status_time
  ON security_confirmations (user_id, status, requested_at DESC, confirmation_id);

CREATE TABLE audit_logs_017 (
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
      'proactive_interaction', 'data_export', 'identity', 'payment'
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

INSERT INTO audit_logs_017 SELECT * FROM audit_logs;
DROP TABLE audit_logs;
ALTER TABLE audit_logs_017 RENAME TO audit_logs;
CREATE INDEX idx_audit_logs_user_time
  ON audit_logs (user_id, occurred_at DESC, audit_log_id);
CREATE INDEX idx_audit_logs_user_subject_time
  ON audit_logs (user_id, subject_id, occurred_at DESC, audit_log_id);
CREATE INDEX idx_audit_logs_user_operation_result_time
  ON audit_logs (user_id, operation_type, result, occurred_at DESC, audit_log_id);
CREATE UNIQUE INDEX idx_audit_logs_user_and_audit_log
  ON audit_logs (user_id, audit_log_id);

CREATE TABLE export_schema_versions (
  schema_version TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL
);

CREATE TABLE export_schema_types (
  schema_version TEXT NOT NULL,
  export_type TEXT NOT NULL CHECK (export_type IN ('full', 'selected', 'migration')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (schema_version, export_type),
  FOREIGN KEY (schema_version)
    REFERENCES export_schema_versions(schema_version) ON DELETE RESTRICT
);

CREATE TABLE export_schema_scopes (
  schema_version TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (
    scope_type IN (
      'user_data', 'subject_state', 'event', 'message_version',
      'conversation_summary', 'assistant_private_space',
      'assistant_global_settings', 'permission', 'security_policy',
      'tool', 'device', 'life_data'
    )
  ),
  data_category TEXT NOT NULL,
  ownership_scope TEXT NOT NULL CHECK (ownership_scope IN ('user', 'user_and_subject')),
  sensitive_category TEXT CHECK (
    sensitive_category IS NULL OR sensitive_category IN (
      'identity_information', 'private_record', 'ai_private_domain'
    )
  ),
  required_fields_json TEXT NOT NULL,
  relation_fields_json TEXT NOT NULL,
  PRIMARY KEY (schema_version, scope_type),
  FOREIGN KEY (schema_version)
    REFERENCES export_schema_versions(schema_version) ON DELETE RESTRICT
);

INSERT INTO export_schema_versions (schema_version, status, created_at)
VALUES ('vio-live-export-v1', 'active', '2026-07-28T00:00:00.000Z');

INSERT INTO export_schema_types (schema_version, export_type, created_at) VALUES
  ('vio-live-export-v1', 'full', '2026-07-28T00:00:00.000Z'),
  ('vio-live-export-v1', 'selected', '2026-07-28T00:00:00.000Z'),
  ('vio-live-export-v1', 'migration', '2026-07-28T00:00:00.000Z');

INSERT INTO export_schema_scopes (
  schema_version, scope_type, data_category, ownership_scope,
  sensitive_category, required_fields_json, relation_fields_json
) VALUES
  ('vio-live-export-v1', 'user_data', 'user_data', 'user_and_subject',
    'identity_information', '["user_id","subject_id","created_at"]',
    '["user_space","subject"]'),
  ('vio-live-export-v1', 'subject_state', 'ai_subject_data', 'user_and_subject',
    'private_record', '["subject_state_id","state_version","created_at"]',
    '["subject","source"]'),
  ('vio-live-export-v1', 'event', 'event_data', 'user_and_subject',
    'private_record', '["event_id","event_type","occurred_at"]',
    '["user","optional_subject","source"]'),
  ('vio-live-export-v1', 'message_version', 'conversation_data', 'user_and_subject',
    'private_record', '["message_version_id","version_number","created_at"]',
    '["conversation","message","parent_version"]'),
  ('vio-live-export-v1', 'conversation_summary', 'conversation_data', 'user_and_subject',
    'private_record', '["summary_id","summary_version","created_at"]',
    '["conversation","summary_source"]'),
  ('vio-live-export-v1', 'assistant_private_space', 'ai_private_data', 'user_and_subject',
    'ai_private_domain', '["space_id","content_version_id","created_at"]',
    '["assistant","content","parent_version"]'),
  ('vio-live-export-v1', 'assistant_global_settings', 'ai_subject_data', 'user_and_subject',
    'private_record', '["subject_id","created_at","updated_at"]',
    '["subject"]'),
  ('vio-live-export-v1', 'permission', 'security_data', 'user_and_subject',
    'private_record', '["permission_id","resource_type","action","created_at"]',
    '["subject","resource"]'),
  ('vio-live-export-v1', 'security_policy', 'security_data', 'user',
    'private_record', '["policy_id","resource_type","action_type","created_at"]',
    '["user"]'),
  ('vio-live-export-v1', 'tool', 'capability_data', 'user', NULL,
    '["tool_id","name","created_at"]', '["user"]'),
  ('vio-live-export-v1', 'device', 'device_data', 'user',
    'private_record', '["device_id","device_type","created_at"]',
    '["user","capability"]'),
  ('vio-live-export-v1', 'life_data', 'life_data', 'user_and_subject',
    'private_record', '["record_id","created_at"]', '["user","subject"]');

CREATE TABLE data_export_records (
  export_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  export_type TEXT NOT NULL CHECK (export_type IN ('full', 'selected', 'migration')),
  requested_scopes_json TEXT NOT NULL,
  sensitive_categories_json TEXT NOT NULL,
  ownership_status TEXT NOT NULL CHECK (ownership_status IN ('passed', 'failed')),
  permission_status TEXT NOT NULL CHECK (
    permission_status IN ('not_checked', 'allow', 'ask', 'deny')
  ),
  field_status TEXT NOT NULL CHECK (field_status IN ('passed', 'failed')),
  integrity_status TEXT NOT NULL CHECK (integrity_status IN ('passed', 'failed')),
  integrity_report_json TEXT NOT NULL,
  result_status TEXT NOT NULL CHECK (
    result_status IN (
      'preflight_failed', 'preflight_passed', 'confirmation_required', 'denied', 'ready'
    )
  ),
  security_audit_log_id TEXT,
  payload_status TEXT NOT NULL CHECK (payload_status = 'not_generated'),
  file_status TEXT NOT NULL CHECK (file_status = 'not_created'),
  external_storage_status TEXT NOT NULL CHECK (external_storage_status = 'not_connected'),
  migration_status TEXT NOT NULL CHECK (migration_status = 'not_executed'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (schema_version)
    REFERENCES export_schema_versions(schema_version) ON DELETE RESTRICT,
  FOREIGN KEY (schema_version, export_type)
    REFERENCES export_schema_types(schema_version, export_type) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, security_audit_log_id)
    REFERENCES audit_logs(user_id, audit_log_id) ON DELETE RESTRICT,
  UNIQUE (user_id, subject_id, export_id)
);

CREATE INDEX idx_data_export_records_scope_time
  ON data_export_records (
    user_id, subject_id, result_status, created_at DESC, export_id
  );
