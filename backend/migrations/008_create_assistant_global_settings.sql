CREATE TABLE assistant_global_settings (
  owner_user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  personality_description TEXT NOT NULL DEFAULT '',
  expression_style_json TEXT NOT NULL DEFAULT '{}',
  relationship_definition TEXT NOT NULL DEFAULT '',
  long_term_requirements_json TEXT NOT NULL DEFAULT '[]',
  prohibitions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, subject_id),
  FOREIGN KEY (owner_user_id, subject_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT
);

INSERT INTO assistant_global_settings (
  owner_user_id,
  subject_id,
  personality_description,
  expression_style_json,
  relationship_definition,
  long_term_requirements_json,
  prohibitions_json,
  created_at,
  updated_at
)
SELECT
  owner_user_id,
  subject_id,
  '',
  '{}',
  '',
  '[]',
  '[]',
  created_at,
  updated_at
FROM subjects;
