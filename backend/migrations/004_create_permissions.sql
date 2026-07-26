CREATE TABLE permissions (
  permission_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
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
  action TEXT NOT NULL CHECK (
    action IN ('read', 'write', 'execute', 'control', 'connect', 'export', 'delete', 'manage')
  ),
  permission_level TEXT NOT NULL CHECK (
    permission_level IN (
      'always_allow',
      'ask_every_time',
      'allow_once',
      'denied',
      'forbidden_ask'
    )
  ),
  status TEXT NOT NULL CHECK (
    status IN ('active', 'inactive', 'consumed', 'deleted')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_permissions_current_scope
  ON permissions (user_id, subject_id, resource_type, resource_id, action)
  WHERE status IN ('active', 'inactive');

CREATE INDEX idx_permissions_user_subject_status
  ON permissions (user_id, subject_id, status, updated_at DESC, permission_id);

CREATE INDEX idx_permissions_active_check
  ON permissions (user_id, subject_id, resource_type, resource_id, action)
  WHERE status = 'active';
