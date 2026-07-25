CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  primary_email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'active', 'suspended', 'disabled', 'deletion_pending')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE subjects (
  subject_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_ref TEXT,
  basic_settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (
    status IN ('active', 'archived', 'disabled', 'deletion_pending')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT
);

CREATE INDEX idx_subjects_owner_user_id
  ON subjects (owner_user_id, created_at);
