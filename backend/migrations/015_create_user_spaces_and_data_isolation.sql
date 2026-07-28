CREATE TABLE user_spaces (
  space_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  identity_mode TEXT NOT NULL CHECK (identity_mode = 'development_unverified'),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'disabled')),
  current_assistant_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, current_assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (user_id, space_id)
);

CREATE INDEX idx_user_spaces_current_assistant
  ON user_spaces (user_id, current_assistant_id);

INSERT INTO user_spaces (
  space_id,
  user_id,
  identity_mode,
  status,
  current_assistant_id,
  created_at,
  updated_at
)
SELECT
  'user-space-' || user_id,
  user_id,
  'development_unverified',
  CASE
    WHEN status = 'active' THEN 'active'
    WHEN status = 'disabled' THEN 'disabled'
    ELSE 'suspended'
  END,
  (
    SELECT subject_id
    FROM subjects
    WHERE owner_user_id = users.user_id AND status = 'active'
    ORDER BY created_at ASC, subject_id ASC
    LIMIT 1
  ),
  created_at,
  updated_at
FROM users;
