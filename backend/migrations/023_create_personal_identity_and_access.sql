-- vio-migration: foreign-keys-off
-- R2: real personal identities do not invent email addresses or claim development data.
CREATE TABLE users_023 (
 user_id TEXT PRIMARY KEY, primary_email TEXT COLLATE NOCASE UNIQUE, display_name TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending','active','suspended','disabled','deletion_pending')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO users_023 SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_023 RENAME TO users;
CREATE TABLE user_spaces_023 (
 space_id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE,
 identity_mode TEXT NOT NULL CHECK(identity_mode IN ('development_unverified','personal_owner')),
 status TEXT NOT NULL CHECK(status IN ('active','suspended','disabled')),
 current_assistant_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
 FOREIGN KEY(user_id,current_assistant_id) REFERENCES subjects(owner_user_id,subject_id) ON DELETE RESTRICT,
 UNIQUE(user_id,space_id)
);
INSERT INTO user_spaces_023 SELECT * FROM user_spaces;
DROP TABLE user_spaces;
ALTER TABLE user_spaces_023 RENAME TO user_spaces;
CREATE INDEX idx_user_spaces_current_assistant ON user_spaces(user_id,current_assistant_id);
CREATE TABLE permissions_023 (
  permission_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain',
      'life_data', 'proactive_interaction', 'data_export', 'identity'
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

INSERT INTO permissions_023 SELECT * FROM permissions;
DROP TABLE permissions;
ALTER TABLE permissions_023 RENAME TO permissions;
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


CREATE TABLE security_confirmations_023 (
  confirmation_id TEXT PRIMARY KEY,
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
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain',
      'life_data', 'proactive_interaction', 'data_export', 'identity'
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

INSERT INTO security_confirmations_023 SELECT * FROM security_confirmations;
DROP TABLE security_confirmations;
ALTER TABLE security_confirmations_023 RENAME TO security_confirmations;
CREATE UNIQUE INDEX idx_security_confirmations_user_and_confirmation
  ON security_confirmations (user_id, confirmation_id);
CREATE INDEX idx_security_confirmations_user_status_time
  ON security_confirmations (user_id, status, requested_at DESC, confirmation_id);


CREATE TABLE personal_identities (
 user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE RESTRICT,
 password_salt TEXT NOT NULL, password_verifier TEXT NOT NULL, wrapped_vault_key TEXT NOT NULL,
 avatar TEXT, preferences_json TEXT NOT NULL DEFAULT '{"storagePreference":"local","contextMode":"balanced"}',
 onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK(onboarding_completed IN (0,1)),
 profile_version INTEGER NOT NULL DEFAULT 1, selection_version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);
CREATE TABLE personal_installation (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 owner_user_id TEXT NOT NULL UNIQUE REFERENCES personal_identities(user_id) ON DELETE RESTRICT
);
CREATE TABLE personal_initialization_invitations (
 invitation_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, consumed_at TEXT,
 initialization_key TEXT UNIQUE, owner_user_id TEXT REFERENCES personal_identities(user_id) ON DELETE RESTRICT
);
CREATE TABLE personal_sessions (
 session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES personal_identities(user_id) ON DELETE RESTRICT,
 token_hash TEXT NOT NULL UNIQUE, device_name TEXT NOT NULL,
 created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE INDEX idx_personal_sessions_user ON personal_sessions(user_id,created_at);
CREATE TABLE personal_access_events (
 event_id TEXT PRIMARY KEY, user_id TEXT REFERENCES personal_identities(user_id) ON DELETE RESTRICT,
 event_type TEXT NOT NULL CHECK(event_type IN ('initialized','login_succeeded','login_failed','logout','session_revoked','vault_unlocked','credential_changed','connection_checked','deletion_started','deletion_failed','deletion_completed')),
 occurred_at TEXT NOT NULL, session_id TEXT, anomaly INTEGER NOT NULL DEFAULT 0 CHECK(anomaly IN (0,1))
);
CREATE INDEX idx_personal_access_events_time ON personal_access_events(occurred_at);
CREATE TABLE personal_operations (
 user_id TEXT NOT NULL REFERENCES personal_identities(user_id) ON DELETE RESTRICT,
 operation TEXT NOT NULL, idempotency_key TEXT NOT NULL, content_hash TEXT NOT NULL,
 response_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,operation,idempotency_key)
);
CREATE TRIGGER protect_personal_operation_update BEFORE UPDATE ON personal_operations
BEGIN SELECT RAISE(ABORT,'personal operation result is immutable'); END;
CREATE TABLE personal_assistant_versions (
 user_id TEXT NOT NULL, assistant_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, avatar TEXT,
 FOREIGN KEY(user_id,assistant_id) REFERENCES subjects(owner_user_id,subject_id) ON DELETE RESTRICT
);
CREATE TABLE personal_provider_versions (
 user_id TEXT NOT NULL, provider_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(user_id,provider_id) REFERENCES api_providers(owner_user_id,api_provider_id) ON DELETE RESTRICT
);
CREATE TABLE personal_credential_secrets (
 credential_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL,
 encrypted_value TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','revoked')),
 created_at TEXT NOT NULL, revoked_at TEXT,
 FOREIGN KEY(user_id,provider_id) REFERENCES api_providers(owner_user_id,api_provider_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_personal_credential_active ON personal_credential_secrets(user_id,provider_id) WHERE status='active';
CREATE TABLE personal_connection_tests (
 test_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, content_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','outcome_unknown')),
 reason TEXT, started_at TEXT NOT NULL, completed_at TEXT,
 FOREIGN KEY(user_id,provider_id) REFERENCES api_providers(owner_user_id,api_provider_id) ON DELETE RESTRICT,
 UNIQUE(user_id,provider_id,idempotency_key)
);
CREATE TABLE personal_pending_confirmations (
 user_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL,
 content_hash TEXT NOT NULL, confirmation_id TEXT NOT NULL,
 PRIMARY KEY(user_id,operation,idempotency_key),
 FOREIGN KEY(user_id,confirmation_id) REFERENCES security_confirmations(user_id,confirmation_id) ON DELETE RESTRICT
);
CREATE TABLE personal_operation_cancellations (
 user_id TEXT NOT NULL REFERENCES personal_identities(user_id) ON DELETE RESTRICT,
 operation TEXT NOT NULL, idempotency_key TEXT NOT NULL, cancelled_at TEXT NOT NULL,
 PRIMARY KEY(user_id,operation,idempotency_key)
);
ALTER TABLE models ADD COLUMN status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','disabled'));
ALTER TABLE models ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE security_policies_023 (
  policy_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN (
      'memory', 'tool', 'mcp', 'skill', 'device', 'api', 'private_domain',
      'life_data', 'proactive_interaction', 'data_export', 'identity'
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

INSERT INTO security_policies_023 SELECT * FROM security_policies;
DROP TABLE security_policies;
ALTER TABLE security_policies_023 RENAME TO security_policies;
CREATE UNIQUE INDEX idx_security_policies_active_scope
  ON security_policies (user_id, resource_type, action_type, risk_level)
  WHERE status = 'active';
CREATE INDEX idx_security_policies_user_status_scope
  ON security_policies (
    user_id, status, resource_type, action_type, risk_level, updated_at DESC, policy_id
  );


CREATE TABLE api_provider_credential_bindings_023 (
  credential_binding_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  secret_ref TEXT NOT NULL CHECK (
    (length(secret_ref) = 42 AND substr(secret_ref,1,6)='vault:' AND substr(secret_ref,7) NOT GLOB '*[^a-f0-9-]*') OR
    (length(secret_ref) BETWEEN 23 AND 160
    AND substr(secret_ref, 1, 22) = 'env:VIO_MODEL_API_KEY_'
    AND substr(secret_ref, 23) NOT GLOB '*[^A-Z0-9_]*')
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
INSERT INTO api_provider_credential_bindings_023 SELECT * FROM api_provider_credential_bindings;
DROP TABLE api_provider_credential_bindings;
ALTER TABLE api_provider_credential_bindings_023 RENAME TO api_provider_credential_bindings;
CREATE UNIQUE INDEX idx_api_provider_credential_active ON api_provider_credential_bindings(owner_user_id, provider_id) WHERE status = 'active';
CREATE INDEX idx_api_provider_credential_history ON api_provider_credential_bindings(owner_user_id, provider_id, created_at, credential_binding_id);

CREATE TRIGGER protect_api_provider_credential_binding_identity BEFORE UPDATE ON api_provider_credential_bindings
BEGIN SELECT CASE WHEN NEW.credential_binding_id<>OLD.credential_binding_id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.provider_id<>OLD.provider_id OR NEW.secret_ref<>OLD.secret_ref OR NEW.security_audit_log_id<>OLD.security_audit_log_id OR NEW.created_at<>OLD.created_at THEN RAISE(ABORT,'credential binding facts are immutable') END; SELECT CASE WHEN NOT (OLD.status='active' AND OLD.superseded_at IS NULL AND NEW.status='superseded' AND NEW.superseded_at IS NOT NULL) THEN RAISE(ABORT,'credential binding lifecycle is immutable') END; END;
CREATE TRIGGER prevent_api_provider_credential_binding_delete BEFORE DELETE ON api_provider_credential_bindings BEGIN SELECT RAISE(ABORT,'credential binding history requires governed retention'); END;
