CREATE TABLE api_providers (
  api_provider_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (
    provider_type IN ('openai', 'claude', 'glm', 'custom')
  ),
  base_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('enabled', 'disabled')
  ),
  api_key_secret_ref TEXT CHECK (api_key_secret_ref IS NULL),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, api_provider_id)
);

CREATE INDEX idx_api_providers_owner_status_created
  ON api_providers (owner_user_id, status, created_at, api_provider_id);

CREATE TABLE models (
  model_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id, provider_id)
    REFERENCES api_providers(owner_user_id, api_provider_id) ON DELETE RESTRICT,
  UNIQUE (provider_id, model_name)
);

CREATE INDEX idx_models_owner_provider_created
  ON models (owner_user_id, provider_id, created_at, model_id);

CREATE TABLE model_capabilities (
  model_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (
    capability IN ('chat', 'vision', 'image', 'video', 'embedding')
  ),
  PRIMARY KEY (model_id, capability),
  FOREIGN KEY (model_id) REFERENCES models(model_id) ON DELETE RESTRICT
);

CREATE INDEX idx_model_capabilities_capability_model
  ON model_capabilities (capability, model_id);
