CREATE TABLE tool_registry (
  tool_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tool_type TEXT NOT NULL,
  input_definition_json TEXT NOT NULL DEFAULT '{}',
  output_definition_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  permission_action TEXT NOT NULL CHECK (
    permission_action IN ('read', 'write', 'execute', 'control', 'connect', 'export', 'delete', 'manage')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, tool_id),
  UNIQUE (owner_user_id, name)
);

CREATE INDEX idx_tool_registry_owner_status_name
  ON tool_registry (owner_user_id, status, name, tool_id);

CREATE TABLE mcp_registry (
  mcp_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  service_url TEXT NOT NULL,
  capability_description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  permission_action TEXT NOT NULL CHECK (
    permission_action IN ('read', 'write', 'execute', 'control', 'connect', 'export', 'delete', 'manage')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, mcp_id),
  UNIQUE (owner_user_id, name)
);

CREATE INDEX idx_mcp_registry_owner_status_name
  ON mcp_registry (owner_user_id, status, name, mcp_id);

CREATE TABLE skill_registry (
  skill_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  applicable_scenarios_json TEXT NOT NULL DEFAULT '[]',
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  permission_action TEXT NOT NULL CHECK (
    permission_action IN ('read', 'write', 'execute', 'control', 'connect', 'export', 'delete', 'manage')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, skill_id),
  UNIQUE (owner_user_id, name)
);

CREATE INDEX idx_skill_registry_owner_status_name
  ON skill_registry (owner_user_id, status, name, skill_id);

CREATE TABLE plugin_registry (
  plugin_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT NOT NULL,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, plugin_id),
  UNIQUE (owner_user_id, name)
);

CREATE INDEX idx_plugin_registry_owner_status_name
  ON plugin_registry (owner_user_id, status, name, plugin_id);

CREATE UNIQUE INDEX idx_audit_logs_user_and_audit_log
  ON audit_logs (user_id, audit_log_id);

CREATE TABLE tool_usage_records (
  tool_usage_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  permission_decision TEXT NOT NULL CHECK (
    permission_decision IN ('allow', 'ask', 'deny')
  ),
  security_decision TEXT NOT NULL CHECK (
    security_decision IN ('allow', 'confirm', 'deny')
  ),
  preparation_status TEXT NOT NULL CHECK (
    preparation_status IN ('ready', 'confirmation_required', 'denied')
  ),
  execution_status TEXT NOT NULL CHECK (execution_status = 'not_executed'),
  result_summary TEXT NOT NULL,
  consumption_json TEXT NOT NULL DEFAULT '{}',
  audit_log_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, tool_id)
    REFERENCES tool_registry(owner_user_id, tool_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, audit_log_id)
    REFERENCES audit_logs(user_id, audit_log_id) ON DELETE RESTRICT
);

CREATE INDEX idx_tool_usage_user_subject_time
  ON tool_usage_records (user_id, subject_id, occurred_at DESC, tool_usage_id);

CREATE INDEX idx_tool_usage_user_subject_tool_time
  ON tool_usage_records (
    user_id,
    subject_id,
    tool_id,
    occurred_at DESC,
    tool_usage_id
  );
