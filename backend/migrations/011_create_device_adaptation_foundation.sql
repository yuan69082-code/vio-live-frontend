CREATE TABLE device_registry (
  device_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (
    device_type IN (
      'phone',
      'watch',
      'air_conditioner',
      'robot_vacuum',
      'washing_machine',
      'camera',
      'appliance'
    )
  ),
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  adapter_type TEXT NOT NULL CHECK (
    adapter_type IN ('xiaomi', 'midea', 'apple', 'android', 'generic')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, device_id),
  UNIQUE (owner_user_id, name)
);

CREATE INDEX idx_device_registry_owner_status_type_name
  ON device_registry (owner_user_id, status, device_type, name, device_id);

CREATE INDEX idx_device_registry_owner_brand_name
  ON device_registry (owner_user_id, brand, name, device_id);

CREATE TABLE device_capabilities (
  owner_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (
    capability IN ('view_status', 'power', 'adjust_parameter', 'get_data')
  ),
  PRIMARY KEY (owner_user_id, device_id, capability),
  FOREIGN KEY (owner_user_id, device_id)
    REFERENCES device_registry(owner_user_id, device_id) ON DELETE RESTRICT
);

CREATE INDEX idx_device_capabilities_owner_capability
  ON device_capabilities (owner_user_id, capability, device_id);

CREATE UNIQUE INDEX idx_events_user_and_event
  ON events (user_id, event_id);

CREATE TABLE device_operation_logs (
  device_operation_log_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (
    capability IN ('view_status', 'power', 'adjust_parameter', 'get_data')
  ),
  action TEXT NOT NULL CHECK (action IN ('read', 'control')),
  permission_decision TEXT NOT NULL CHECK (
    permission_decision IN ('allow', 'ask', 'deny')
  ),
  security_decision TEXT NOT NULL CHECK (
    security_decision IN ('allow', 'confirm', 'deny')
  ),
  risk_level TEXT NOT NULL CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  ),
  preparation_status TEXT NOT NULL CHECK (
    preparation_status IN ('ready', 'confirmation_required', 'denied')
  ),
  execution_status TEXT NOT NULL CHECK (execution_status = 'not_executed'),
  result_summary TEXT NOT NULL,
  audit_log_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, device_id)
    REFERENCES device_registry(owner_user_id, device_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, audit_log_id)
    REFERENCES audit_logs(user_id, audit_log_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, event_id)
    REFERENCES events(user_id, event_id) ON DELETE RESTRICT
);

CREATE INDEX idx_device_operation_logs_user_subject_time
  ON device_operation_logs (
    user_id,
    subject_id,
    requested_at DESC,
    device_operation_log_id
  );

CREATE INDEX idx_device_operation_logs_user_subject_device_time
  ON device_operation_logs (
    user_id,
    subject_id,
    device_id,
    requested_at DESC,
    device_operation_log_id
  );
