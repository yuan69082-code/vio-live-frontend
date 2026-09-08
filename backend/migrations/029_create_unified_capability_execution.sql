-- R6 real capability definitions and unified execution facts. Historical
-- migration 010 registries remain registry/preflight evidence only.

CREATE TABLE r6_capability_definitions (
  capability_id TEXT PRIMARY KEY CHECK (length(capability_id) BETWEEN 1 AND 128),
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('local_tool','mcp_server','skill','plugin')),
  registry_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 80),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  definition_hash TEXT NOT NULL CHECK (
    length(definition_hash)=71 AND substr(definition_hash,1,7)='sha256:'
    AND substr(definition_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('enabled','disabled')),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('installed','uninstalled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_user_id, assistant_id, capability_id),
  UNIQUE (owner_user_id, assistant_id, category, registry_id),
  UNIQUE (owner_user_id, assistant_id, category, name),
  FOREIGN KEY (owner_user_id,assistant_id)
    REFERENCES subjects(owner_user_id,subject_id) ON DELETE RESTRICT
);

CREATE INDEX idx_r6_capability_catalog
  ON r6_capability_definitions(owner_user_id,assistant_id,category,status,lifecycle_status,name);

CREATE TABLE r6_capability_operations (
  operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 1 AND 128),
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (length(operation_type) BETWEEN 1 AND 128),
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  input_hash TEXT NOT NULL CHECK (
    length(input_hash)=71 AND substr(input_hash,1,7)='sha256:'
    AND substr(input_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL,
  UNIQUE (owner_user_id,assistant_id,operation_type,idempotency_key),
  FOREIGN KEY (owner_user_id,assistant_id)
    REFERENCES subjects(owner_user_id,subject_id) ON DELETE RESTRICT
);

CREATE TABLE r6_mcp_discovery_snapshots (
  snapshot_id TEXT PRIMARY KEY CHECK (length(snapshot_id) BETWEEN 1 AND 128),
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  protocol_version TEXT NOT NULL CHECK (protocol_version='2026-07-28'),
  tools_json TEXT NOT NULL CHECK (json_valid(tools_json)),
  tools_hash TEXT NOT NULL CHECK (
    length(tools_hash)=71 AND substr(tools_hash,1,7)='sha256:'
    AND substr(tools_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  ttl_ms INTEGER CHECK (ttl_ms IS NULL OR ttl_ms BETWEEN 0 AND 86400000),
  cache_scope TEXT CHECK (cache_scope IS NULL OR cache_scope IN ('public','private')),
  discovered_at TEXT NOT NULL,
  UNIQUE (owner_user_id,assistant_id,capability_id,snapshot_id),
  FOREIGN KEY (owner_user_id,assistant_id,capability_id)
    REFERENCES r6_capability_definitions(owner_user_id,assistant_id,capability_id) ON DELETE RESTRICT
);

CREATE INDEX idx_r6_mcp_discovery_latest
  ON r6_mcp_discovery_snapshots(owner_user_id,assistant_id,capability_id,discovered_at DESC,snapshot_id DESC);

CREATE TABLE r6_unified_executions (
  execution_id TEXT PRIMARY KEY CHECK (length(execution_id) BETWEEN 1 AND 128),
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('model_api','mcp_tool','local_tool','skill','plugin_action')),
  capability_id TEXT NOT NULL CHECK (length(capability_id) BETWEEN 1 AND 128),
  capability_version TEXT NOT NULL CHECK (length(capability_version) BETWEEN 1 AND 80),
  operation_name TEXT NOT NULL CHECK (length(operation_name) BETWEEN 1 AND 128),
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  input_hash TEXT NOT NULL CHECK (
    length(input_hash)=71 AND substr(input_hash,1,7)='sha256:'
    AND substr(input_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  source_type TEXT NOT NULL CHECK (source_type IN ('personal_api','standalone_chat_projection')),
  source_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'waiting_confirmation','prepared','in_flight','retryable','outcome_unknown',
    'succeeded','failed_terminal','cancelled'
  )),
  confirmation_id TEXT,
  request_may_have_been_sent INTEGER NOT NULL CHECK (request_may_have_been_sent IN (0,1)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (owner_user_id,assistant_id,idempotency_key),
  UNIQUE (source_type,source_id),
  UNIQUE (owner_user_id,assistant_id,execution_id),
  FOREIGN KEY (owner_user_id,assistant_id)
    REFERENCES subjects(owner_user_id,subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id,confirmation_id)
    REFERENCES security_confirmations(user_id,confirmation_id) ON DELETE RESTRICT,
  CHECK (
    (status='waiting_confirmation' AND confirmation_id IS NOT NULL)
    OR (status<>'waiting_confirmation' AND confirmation_id IS NULL)
  ),
  CHECK (
    (status IN ('succeeded','failed_terminal','cancelled') AND completed_at IS NOT NULL)
    OR (status NOT IN ('succeeded','failed_terminal','cancelled') AND completed_at IS NULL)
  ),
  CHECK (source_type='personal_api' OR source_id IS NOT NULL)
);

CREATE INDEX idx_r6_execution_history
  ON r6_unified_executions(owner_user_id,assistant_id,created_at DESC,execution_id DESC);
CREATE INDEX idx_r6_execution_recovery
  ON r6_unified_executions(status,updated_at,execution_id);

CREATE TABLE r6_execution_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (length(attempt_id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number>0),
  status TEXT NOT NULL CHECK (status IN (
    'prepared','in_flight','not_sent','response_received','retryable',
    'outcome_unknown','failed_terminal','cancelled'
  )),
  request_may_have_been_sent INTEGER NOT NULL CHECK (request_may_have_been_sent IN (0,1)),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (execution_id,attempt_number),
  UNIQUE (attempt_id,execution_id,owner_user_id,assistant_id),
  FOREIGN KEY (owner_user_id,assistant_id,execution_id)
    REFERENCES r6_unified_executions(owner_user_id,assistant_id,execution_id) ON DELETE RESTRICT,
  CHECK (
    (status IN ('prepared','in_flight') AND completed_at IS NULL)
    OR (status NOT IN ('prepared','in_flight') AND completed_at IS NOT NULL)
  ),
  CHECK (request_may_have_been_sent=1 OR status<>'outcome_unknown')
);

CREATE UNIQUE INDEX idx_r6_one_active_attempt
  ON r6_execution_attempts(execution_id) WHERE status IN ('prepared','in_flight');

CREATE TABLE r6_execution_steps (
  step_fact_id TEXT PRIMARY KEY CHECK (length(step_fact_id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 32),
  step_id TEXT NOT NULL CHECK (length(step_id) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (category IN ('local_tool','mcp_tool')),
  capability_id TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed_terminal','outcome_unknown')),
  input_hash TEXT NOT NULL,
  output_hash TEXT,
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (execution_id,attempt_id,step_number),
  FOREIGN KEY (attempt_id,execution_id,owner_user_id,assistant_id)
    REFERENCES r6_execution_attempts(attempt_id,execution_id,owner_user_id,assistant_id) ON DELETE RESTRICT
);

CREATE TABLE r6_execution_usage_facts (
  usage_fact_id TEXT PRIMARY KEY CHECK (length(usage_fact_id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  usage_status TEXT NOT NULL CHECK (usage_status IN ('provider_reported','unknown','not_incurred')),
  input_tokens INTEGER NOT NULL CHECK (input_tokens>=0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens>=0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens=input_tokens+output_tokens),
  cost_status TEXT NOT NULL CHECK (cost_status IN ('provider_reported','calculated','not_reported','not_incurred')),
  cost_amount_micros INTEGER CHECK (cost_amount_micros IS NULL OR cost_amount_micros>=0),
  cost_currency TEXT CHECK (cost_currency IS NULL OR length(cost_currency) BETWEEN 3 AND 8),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id,execution_id,owner_user_id,assistant_id)
    REFERENCES r6_execution_attempts(attempt_id,execution_id,owner_user_id,assistant_id) ON DELETE RESTRICT,
  CHECK (usage_status='provider_reported' OR total_tokens=0),
  CHECK (
    (cost_status IN ('provider_reported','calculated') AND cost_amount_micros IS NOT NULL AND cost_currency IS NOT NULL)
    OR (cost_status IN ('not_reported','not_incurred') AND cost_amount_micros IS NULL AND cost_currency IS NULL)
  )
);

CREATE TABLE r6_execution_results (
  result_id TEXT PRIMARY KEY CHECK (length(result_id) BETWEEN 1 AND 128),
  execution_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status='succeeded'),
  output_json TEXT NOT NULL CHECK (json_valid(output_json)),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash)=71 AND substr(content_hash,1,7)='sha256:'
    AND substr(content_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id,execution_id,owner_user_id,assistant_id)
    REFERENCES r6_execution_attempts(attempt_id,execution_id,owner_user_id,assistant_id) ON DELETE RESTRICT
);

CREATE TABLE r6_standalone_execution_projections (
  standalone_execution_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  FOREIGN KEY (standalone_execution_id)
    REFERENCES standalone_chat_model_executions(execution_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id,assistant_id,execution_id)
    REFERENCES r6_unified_executions(owner_user_id,assistant_id,execution_id) ON DELETE RESTRICT
);

CREATE TRIGGER protect_r6_definition_identity
BEFORE UPDATE ON r6_capability_definitions
WHEN NEW.capability_id<>OLD.capability_id OR NEW.owner_user_id<>OLD.owner_user_id
  OR NEW.assistant_id<>OLD.assistant_id
  OR NEW.category<>OLD.category OR NEW.registry_id<>OLD.registry_id
  OR NEW.name<>OLD.name OR NEW.version<>OLD.version
  OR NEW.definition_json<>OLD.definition_json OR NEW.definition_hash<>OLD.definition_hash
  OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'R6 capability definition identity is immutable'); END;

CREATE TRIGGER protect_r6_uninstalled_definition
BEFORE UPDATE ON r6_capability_definitions
WHEN OLD.lifecycle_status='uninstalled'
BEGIN SELECT RAISE(ABORT,'Uninstalled R6 capability is terminal'); END;

CREATE TRIGGER protect_r6_execution_identity
BEFORE UPDATE ON r6_unified_executions
WHEN NEW.execution_id<>OLD.execution_id OR NEW.owner_user_id<>OLD.owner_user_id
  OR NEW.assistant_id<>OLD.assistant_id OR NEW.category<>OLD.category
  OR NEW.capability_id<>OLD.capability_id OR NEW.capability_version<>OLD.capability_version
  OR NEW.operation_name<>OLD.operation_name OR NEW.idempotency_key<>OLD.idempotency_key
  OR NEW.input_json<>OLD.input_json OR NEW.input_hash<>OLD.input_hash
  OR NEW.source_type<>OLD.source_type OR NEW.source_id IS NOT OLD.source_id
  OR NEW.request_may_have_been_sent<OLD.request_may_have_been_sent
  OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'R6 execution identity is immutable'); END;

CREATE TRIGGER protect_terminal_r6_execution
BEFORE UPDATE ON r6_unified_executions
WHEN OLD.status IN ('succeeded','failed_terminal','cancelled')
BEGIN SELECT RAISE(ABORT,'Terminal R6 execution is immutable'); END;

CREATE TRIGGER protect_r6_attempt_identity
BEFORE UPDATE ON r6_execution_attempts
WHEN NEW.attempt_id<>OLD.attempt_id OR NEW.execution_id<>OLD.execution_id
  OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.assistant_id<>OLD.assistant_id
  OR NEW.attempt_number<>OLD.attempt_number OR NEW.started_at<>OLD.started_at
  OR NEW.request_may_have_been_sent<OLD.request_may_have_been_sent
BEGIN SELECT RAISE(ABORT,'R6 attempt identity is immutable'); END;

CREATE TRIGGER protect_terminal_r6_attempt
BEFORE UPDATE ON r6_execution_attempts
WHEN OLD.status NOT IN ('prepared','in_flight')
BEGIN SELECT RAISE(ABORT,'Terminal R6 attempt is immutable'); END;

CREATE TRIGGER prevent_r6_operation_update BEFORE UPDATE ON r6_capability_operations
BEGIN SELECT RAISE(ABORT,'R6 operation fact is immutable'); END;
CREATE TRIGGER prevent_r6_snapshot_update BEFORE UPDATE ON r6_mcp_discovery_snapshots
BEGIN SELECT RAISE(ABORT,'R6 MCP snapshot is immutable'); END;
CREATE TRIGGER prevent_r6_step_update BEFORE UPDATE ON r6_execution_steps
BEGIN SELECT RAISE(ABORT,'R6 step fact is immutable'); END;
CREATE TRIGGER prevent_r6_usage_update BEFORE UPDATE ON r6_execution_usage_facts
BEGIN SELECT RAISE(ABORT,'R6 usage fact is immutable'); END;
CREATE TRIGGER prevent_r6_result_update BEFORE UPDATE ON r6_execution_results
BEGIN SELECT RAISE(ABORT,'R6 result fact is immutable'); END;
CREATE TRIGGER prevent_r6_projection_update BEFORE UPDATE ON r6_standalone_execution_projections
BEGIN SELECT RAISE(ABORT,'R6 projection fact is immutable'); END;

CREATE TRIGGER prevent_r6_definition_delete BEFORE DELETE ON r6_capability_definitions
WHEN vio_owner_deletion_authorized('r6_capability_definitions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 capability definitions cannot be deleted'); END;
CREATE TRIGGER prevent_r6_operation_delete BEFORE DELETE ON r6_capability_operations
WHEN vio_owner_deletion_authorized('r6_capability_operations',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 operation facts cannot be deleted'); END;
CREATE TRIGGER prevent_r6_snapshot_delete BEFORE DELETE ON r6_mcp_discovery_snapshots
WHEN vio_owner_deletion_authorized('r6_mcp_discovery_snapshots',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 MCP snapshots cannot be deleted'); END;
CREATE TRIGGER prevent_r6_execution_delete BEFORE DELETE ON r6_unified_executions
WHEN vio_owner_deletion_authorized('r6_unified_executions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 executions cannot be deleted'); END;
CREATE TRIGGER prevent_r6_attempt_delete BEFORE DELETE ON r6_execution_attempts
WHEN vio_owner_deletion_authorized('r6_execution_attempts',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 attempts cannot be deleted'); END;
CREATE TRIGGER prevent_r6_step_delete BEFORE DELETE ON r6_execution_steps
WHEN vio_owner_deletion_authorized('r6_execution_steps',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 steps cannot be deleted'); END;
CREATE TRIGGER prevent_r6_usage_delete BEFORE DELETE ON r6_execution_usage_facts
WHEN vio_owner_deletion_authorized('r6_execution_usage_facts',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 usage facts cannot be deleted'); END;
CREATE TRIGGER prevent_r6_result_delete BEFORE DELETE ON r6_execution_results
WHEN vio_owner_deletion_authorized('r6_execution_results',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 results cannot be deleted'); END;
CREATE TRIGGER prevent_r6_projection_delete BEFORE DELETE ON r6_standalone_execution_projections
WHEN vio_owner_deletion_authorized('r6_standalone_execution_projections',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'R6 projections cannot be deleted'); END;
