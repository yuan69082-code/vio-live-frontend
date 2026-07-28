ALTER TABLE api_providers
  ADD COLUMN interface_format TEXT NOT NULL DEFAULT 'custom_http' CHECK (
    interface_format IN (
      'openai_compatible',
      'anthropic_messages',
      'glm_compatible',
      'custom_http'
    )
  );

UPDATE api_providers
SET interface_format = CASE provider_type
  WHEN 'openai' THEN 'openai_compatible'
  WHEN 'claude' THEN 'anthropic_messages'
  WHEN 'glm' THEN 'glm_compatible'
  ELSE 'custom_http'
END;

ALTER TABLE api_providers
  ADD COLUMN test_status TEXT NOT NULL DEFAULT 'not_tested' CHECK (
    test_status IN ('not_tested', 'passed', 'failed', 'blocked')
  );

ALTER TABLE models
  ADD COLUMN cost_description TEXT NOT NULL DEFAULT '';

ALTER TABLE models
  ADD COLUMN test_status TEXT NOT NULL DEFAULT 'not_tested' CHECK (
    test_status IN ('not_tested', 'passed', 'failed', 'blocked')
  );

CREATE UNIQUE INDEX idx_models_owner_and_model
  ON models (owner_user_id, model_id);

CREATE TABLE model_capabilities_009 (
  model_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (
    capability IN (
      'chat',
      'long_text',
      'vision',
      'image',
      'video',
      'audio',
      'search',
      'embedding'
    )
  ),
  PRIMARY KEY (model_id, capability),
  FOREIGN KEY (model_id) REFERENCES models(model_id) ON DELETE RESTRICT
);

INSERT INTO model_capabilities_009 (model_id, capability)
SELECT model_id, capability
FROM model_capabilities;

DROP TABLE model_capabilities;

ALTER TABLE model_capabilities_009 RENAME TO model_capabilities;

CREATE INDEX idx_model_capabilities_capability_model
  ON model_capabilities (capability, model_id);

CREATE TABLE model_routing_rules (
  routing_rule_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (
    task_type IN ('chat', 'long_text', 'image', 'video', 'audio', 'search')
  ),
  default_model_id TEXT NOT NULL,
  fallback_model_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id, default_model_id)
    REFERENCES models(owner_user_id, model_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id, fallback_model_id)
    REFERENCES models(owner_user_id, model_id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, task_type),
  CHECK (fallback_model_id IS NULL OR fallback_model_id <> default_model_id)
);

CREATE INDEX idx_model_routing_rules_owner_status_task
  ON model_routing_rules (owner_user_id, status, task_type, routing_rule_id);
