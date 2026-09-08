-- R4 deterministic context assembly, source evidence, folding and recovery.
-- These facts belong to Vio standalone chat and never contain Engine state.

ALTER TABLE standalone_chat_model_executions
  ADD COLUMN context_snapshot_hash TEXT CHECK (
    context_snapshot_hash IS NULL OR (
      length(context_snapshot_hash)=71
      AND substr(context_snapshot_hash,1,7)='sha256:'
      AND substr(context_snapshot_hash,8) NOT GLOB '*[^0-9a-f]*'
    )
  );

CREATE TABLE personal_context_conversation_settings (
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('concise','balanced','complete','custom')),
  excluded_source_refs_json TEXT NOT NULL CHECK (json_valid(excluded_source_refs_json)),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, assistant_id, conversation_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES personal_chat_conversations(user_id, assistant_id, conversation_id)
      ON DELETE RESTRICT
);

CREATE TABLE personal_context_operations (
  operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  operation_type TEXT NOT NULL CHECK (
    operation_type IN ('context.settings.update','context.summary.retry')
  ),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash)=71 AND substr(content_hash,1,7)='sha256:'
    AND substr(content_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  status TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('contextSettings','contextAssembly')),
  resource_id TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, assistant_id, idempotency_key),
  UNIQUE (operation_id, user_id, assistant_id),
  FOREIGN KEY (user_id, assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  CHECK (
    (status='processing' AND completed_at IS NULL)
    OR (status<>'processing' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE personal_context_summaries (
  summary_id TEXT PRIMARY KEY CHECK (length(summary_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK (schema_version='vio-context-summary/v1'),
  source_set_hash TEXT NOT NULL CHECK (
    length(source_set_hash)=71 AND substr(source_set_hash,1,7)='sha256:'
    AND substr(source_set_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('building','ready','failed')),
  structured_summary_json TEXT CHECK (
    structured_summary_json IS NULL OR json_valid(structured_summary_json)
  ),
  content_hash TEXT CHECK (
    content_hash IS NULL OR (
      length(content_hash)=71 AND substr(content_hash,1,7)='sha256:'
      AND substr(content_hash,8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  failure_code TEXT,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, assistant_id, conversation_id, branch_id, source_set_hash),
  UNIQUE (summary_id, user_id, assistant_id, conversation_id, branch_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_chat_branches(user_id, assistant_id, conversation_id, branch_id)
      ON DELETE RESTRICT,
  CHECK (
    (status='building' AND structured_summary_json IS NULL AND content_hash IS NULL AND completed_at IS NULL)
    OR (status='ready' AND structured_summary_json IS NOT NULL AND content_hash IS NOT NULL AND failure_code IS NULL AND completed_at IS NOT NULL)
    OR (status='failed' AND structured_summary_json IS NULL AND content_hash IS NULL AND failure_code IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE personal_context_turn_controls (
  turn_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('concise','balanced','complete','custom')),
  controls_source TEXT NOT NULL CHECK (controls_source IN ('turn','conversation','personal_default')),
  excluded_source_refs_json TEXT NOT NULL CHECK (json_valid(excluded_source_refs_json)),
  unavailable_excluded_source_refs_json TEXT NOT NULL CHECK (
    json_valid(unavailable_excluded_source_refs_json)
  ),
  expected_plan_hash TEXT CHECK (
    expected_plan_hash IS NULL OR (
      length(expected_plan_hash)=71 AND substr(expected_plan_hash,1,7)='sha256:'
      AND substr(expected_plan_hash,8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  created_at TEXT NOT NULL,
  UNIQUE (turn_id,user_id,assistant_id,conversation_id,branch_id),
  FOREIGN KEY (user_id,assistant_id,conversation_id,turn_id)
    REFERENCES standalone_chat_turns(user_id,assistant_id,conversation_id,turn_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (turn_id,user_id,assistant_id,conversation_id,branch_id)
    REFERENCES personal_chat_turn_branches(turn_id,user_id,assistant_id,conversation_id,branch_id)
      ON DELETE RESTRICT
);

CREATE TABLE personal_context_summary_sources (
  summary_id TEXT NOT NULL,
  source_order INTEGER NOT NULL CHECK (source_order >= 0),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source_ref TEXT NOT NULL CHECK (length(source_ref) BETWEEN 3 AND 256),
  source_type TEXT NOT NULL CHECK (source_type IN ('message_version','event')),
  message_id TEXT,
  message_version_id TEXT,
  event_id TEXT,
  content_hash TEXT NOT NULL CHECK (
    length(content_hash)=71 AND substr(content_hash,1,7)='sha256:'
    AND substr(content_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  PRIMARY KEY (summary_id, source_order),
  UNIQUE (summary_id, source_ref),
  FOREIGN KEY (summary_id, user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_context_summaries(
      summary_id, user_id, assistant_id, conversation_id, branch_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, message_id, message_version_id)
    REFERENCES message_versions(
      user_id, subject_id, conversation_id, message_id, message_version_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, event_id)
    REFERENCES events(user_id, subject_id, event_id) ON DELETE RESTRICT,
  CHECK (
    (source_type='message_version' AND message_id IS NOT NULL AND message_version_id IS NOT NULL AND event_id IS NULL)
    OR (source_type='event' AND message_id IS NULL AND message_version_id IS NULL AND event_id IS NOT NULL)
  )
);

CREATE TABLE personal_context_summary_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (length(attempt_id) BETWEEN 1 AND 128),
  summary_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (summary_id, attempt_number),
  FOREIGN KEY (summary_id) REFERENCES personal_context_summaries(summary_id)
    ON DELETE RESTRICT,
  CHECK (
    (status='succeeded' AND error_code IS NULL)
    OR (status='failed' AND error_code IS NOT NULL)
  )
);

CREATE TABLE personal_context_assemblies (
  assembly_id TEXT PRIMARY KEY CHECK (length(assembly_id) BETWEEN 1 AND 128),
  turn_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  contract_version TEXT NOT NULL CHECK (contract_version='vio-context-assembly/v1'),
  schema_version TEXT NOT NULL CHECK (schema_version='vio-context-assembly-snapshot/v1'),
  mode TEXT NOT NULL CHECK (mode IN ('concise','balanced','complete','custom')),
  controls_source TEXT NOT NULL CHECK (controls_source IN ('turn','conversation','personal_default')),
  excluded_source_refs_json TEXT NOT NULL CHECK (json_valid(excluded_source_refs_json)),
  unavailable_excluded_source_refs_json TEXT NOT NULL CHECK (
    json_valid(unavailable_excluded_source_refs_json)
  ),
  state TEXT NOT NULL CHECK (state IN ('locked','fold_failed','budget_blocked')),
  plan_hash TEXT NOT NULL CHECK (
    length(plan_hash)=71 AND substr(plan_hash,1,7)='sha256:'
    AND substr(plan_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  snapshot_hash TEXT CHECK (
    snapshot_hash IS NULL OR (
      length(snapshot_hash)=71 AND substr(snapshot_hash,1,7)='sha256:'
      AND substr(snapshot_hash,8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  model_id TEXT,
  estimation_method TEXT NOT NULL CHECK (estimation_method='utf8-byte-upper-bound/v1'),
  context_limit_tokens INTEGER NOT NULL CHECK (context_limit_tokens > 0),
  reserved_output_tokens INTEGER NOT NULL CHECK (reserved_output_tokens > 0),
  input_budget_tokens INTEGER NOT NULL CHECK (input_budget_tokens >= 0),
  raw_estimated_input_tokens INTEGER NOT NULL CHECK (raw_estimated_input_tokens >= 0),
  estimated_input_tokens INTEGER NOT NULL CHECK (estimated_input_tokens >= 0),
  trimming_applied INTEGER NOT NULL CHECK (trimming_applied IN (0,1)),
  trimming_reason TEXT,
  folding_status TEXT NOT NULL CHECK (folding_status IN (
    'not_required','ready','failed_fallback_original','failed'
  )),
  summary_id TEXT,
  runtime_projection_status TEXT NOT NULL CHECK (
    runtime_projection_status IN ('not_available','included')
  ),
  selection_json TEXT NOT NULL CHECK (json_valid(selection_json)),
  snapshot_json TEXT CHECK (snapshot_json IS NULL OR json_valid(snapshot_json)),
  provider_messages_json TEXT CHECK (
    provider_messages_json IS NULL OR json_valid(provider_messages_json)
  ),
  provider_messages_hash TEXT CHECK (
    provider_messages_hash IS NULL OR (
      length(provider_messages_hash)=71 AND substr(provider_messages_hash,1,7)='sha256:'
      AND substr(provider_messages_hash,8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  locked_at TEXT,
  UNIQUE (assembly_id, user_id, assistant_id, conversation_id, branch_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id, turn_id)
    REFERENCES standalone_chat_turns(user_id, assistant_id, conversation_id, turn_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (turn_id, user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_chat_turn_branches(turn_id, user_id, assistant_id, conversation_id, branch_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (summary_id) REFERENCES personal_context_summaries(summary_id)
    ON DELETE RESTRICT,
  CHECK (
    (state='locked' AND snapshot_hash IS NOT NULL AND snapshot_json IS NOT NULL
      AND provider_messages_json IS NOT NULL AND provider_messages_hash IS NOT NULL
      AND failure_code IS NULL AND locked_at IS NOT NULL)
    OR (state<>'locked' AND snapshot_hash IS NULL AND snapshot_json IS NULL
      AND provider_messages_json IS NULL AND provider_messages_hash IS NULL
      AND failure_code IS NOT NULL AND locked_at IS NULL)
  )
);

CREATE TABLE personal_context_assembly_sources (
  assembly_id TEXT NOT NULL,
  source_phase TEXT NOT NULL CHECK (source_phase IN ('failed_candidate','locked')),
  source_order INTEGER NOT NULL CHECK (source_order >= 0),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source_ref TEXT NOT NULL CHECK (length(source_ref) BETWEEN 3 AND 256),
  source_type TEXT NOT NULL CHECK (source_type IN (
    'system_rule','assistant_settings','runtime_projection','event',
    'message_version','summary','memory_slot','current_user_message'
  )),
  slot TEXT NOT NULL CHECK (slot IN (
    'system_rules','assistant_settings','runtime_projection','unresolved_events',
    'recent_original_text','long_term_memory','current_user_message'
  )),
  origin TEXT NOT NULL CHECK (origin IN (
    'system','assistant','runtime','current_conversation','cross_window',
    'event','memory','current_turn'
  )),
  status TEXT NOT NULL CHECK (status IN ('included','excluded','trimmed','summarized')),
  reason TEXT,
  source_conversation_id TEXT,
  source_branch_id TEXT,
  message_id TEXT,
  message_version_id TEXT,
  event_id TEXT,
  summary_id TEXT,
  content_hash TEXT NOT NULL CHECK (
    length(content_hash)=71 AND substr(content_hash,1,7)='sha256:'
    AND substr(content_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens >= 0),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (assembly_id, source_phase, source_order),
  UNIQUE (assembly_id, source_phase, source_ref),
  FOREIGN KEY (assembly_id, user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_context_assemblies(
      assembly_id, user_id, assistant_id, conversation_id, branch_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, source_conversation_id, message_id, message_version_id)
    REFERENCES message_versions(
      user_id, subject_id, conversation_id, message_id, message_version_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, event_id)
    REFERENCES events(user_id, subject_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (summary_id) REFERENCES personal_context_summaries(summary_id)
    ON DELETE RESTRICT,
  CHECK (
    (source_type='message_version' AND source_conversation_id IS NOT NULL
      AND source_branch_id IS NOT NULL AND message_id IS NOT NULL
      AND message_version_id IS NOT NULL AND event_id IS NULL AND summary_id IS NULL)
    OR (source_type='event' AND message_id IS NULL AND message_version_id IS NULL
      AND event_id IS NOT NULL AND summary_id IS NULL)
    OR (source_type='summary' AND source_conversation_id IS NOT NULL
      AND source_branch_id IS NOT NULL AND message_id IS NULL
      AND message_version_id IS NULL AND event_id IS NULL AND summary_id IS NOT NULL)
    OR (source_type NOT IN ('message_version','event','summary')
      AND source_conversation_id IS NULL AND source_branch_id IS NULL
      AND message_id IS NULL AND message_version_id IS NULL
      AND event_id IS NULL AND summary_id IS NULL)
  )
);

CREATE TABLE personal_context_recovery_actions (
  recovery_id TEXT PRIMARY KEY CHECK (length(recovery_id) BETWEEN 1 AND 128),
  operation_id TEXT NOT NULL UNIQUE,
  assembly_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type='retry_fold'),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (recovery_id, user_id, assistant_id),
  FOREIGN KEY (operation_id, user_id, assistant_id)
    REFERENCES personal_context_operations(operation_id, user_id, assistant_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (assembly_id, user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_context_assemblies(
      assembly_id, user_id, assistant_id, conversation_id, branch_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, turn_id)
    REFERENCES standalone_chat_turns(user_id, assistant_id, conversation_id, turn_id)
      ON DELETE RESTRICT,
  CHECK (
    (status='pending' AND completed_at IS NULL)
    OR (status<>'pending' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_personal_context_settings_scope
  ON personal_context_conversation_settings(user_id,assistant_id,updated_at,conversation_id);
CREATE INDEX idx_personal_context_assemblies_scope
  ON personal_context_assemblies(user_id,assistant_id,conversation_id,created_at,assembly_id);
CREATE INDEX idx_personal_context_sources_reference
  ON personal_context_assembly_sources(user_id,assistant_id,source_ref,source_phase,assembly_id);
CREATE INDEX idx_personal_context_summaries_scope
  ON personal_context_summaries(user_id,assistant_id,conversation_id,branch_id,created_at,summary_id);

CREATE TRIGGER prevent_personal_context_turn_control_update
BEFORE UPDATE ON personal_context_turn_controls
BEGIN SELECT RAISE(ABORT,'context turn controls are immutable'); END;

CREATE TRIGGER guard_personal_context_settings_update
BEFORE UPDATE ON personal_context_conversation_settings
WHEN NEW.user_id<>OLD.user_id OR NEW.assistant_id<>OLD.assistant_id
  OR NEW.conversation_id<>OLD.conversation_id OR NEW.version<>OLD.version+1
  OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'context settings identity/version is immutable'); END;

CREATE TRIGGER protect_personal_context_operation_identity
BEFORE UPDATE ON personal_context_operations
WHEN NEW.operation_id<>OLD.operation_id OR NEW.user_id<>OLD.user_id
  OR NEW.assistant_id<>OLD.assistant_id OR NEW.idempotency_key<>OLD.idempotency_key
  OR NEW.operation_type<>OLD.operation_type OR NEW.content_hash<>OLD.content_hash
  OR NEW.input_json<>OLD.input_json OR NEW.resource_type<>OLD.resource_type
  OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'context operation identity is immutable'); END;

CREATE TRIGGER guard_personal_context_operation_transition
BEFORE UPDATE OF status ON personal_context_operations
WHEN OLD.status<>'processing' OR NEW.status='processing'
BEGIN SELECT RAISE(ABORT,'invalid context operation transition'); END;

CREATE TRIGGER protect_personal_context_summary_identity
BEFORE UPDATE ON personal_context_summaries
WHEN NEW.summary_id<>OLD.summary_id OR NEW.user_id<>OLD.user_id
  OR NEW.assistant_id<>OLD.assistant_id OR NEW.conversation_id<>OLD.conversation_id
  OR NEW.branch_id<>OLD.branch_id OR NEW.schema_version<>OLD.schema_version
  OR NEW.source_set_hash<>OLD.source_set_hash OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'context summary identity is immutable'); END;

CREATE TRIGGER protect_ready_personal_context_summary
BEFORE UPDATE ON personal_context_summaries
WHEN OLD.status='ready'
BEGIN SELECT RAISE(ABORT,'ready context summary is immutable'); END;

CREATE TRIGGER guard_personal_context_assembly_transition
BEFORE UPDATE ON personal_context_assemblies
WHEN OLD.state<>'fold_failed' OR NEW.state<>'locked'
BEGIN SELECT RAISE(ABORT,'invalid context assembly transition'); END;

CREATE TRIGGER protect_personal_context_assembly_identity
BEFORE UPDATE ON personal_context_assemblies
WHEN NEW.assembly_id<>OLD.assembly_id OR NEW.turn_id<>OLD.turn_id
  OR NEW.user_id<>OLD.user_id OR NEW.assistant_id<>OLD.assistant_id
  OR NEW.conversation_id<>OLD.conversation_id OR NEW.branch_id<>OLD.branch_id
  OR NEW.contract_version<>OLD.contract_version OR NEW.schema_version<>OLD.schema_version
  OR NEW.mode<>OLD.mode OR NEW.controls_source<>OLD.controls_source
  OR NEW.excluded_source_refs_json<>OLD.excluded_source_refs_json
  OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'context assembly identity is immutable'); END;

CREATE TRIGGER prevent_personal_context_summary_source_update
BEFORE UPDATE ON personal_context_summary_sources
BEGIN SELECT RAISE(ABORT,'context summary sources are immutable'); END;
CREATE TRIGGER prevent_personal_context_summary_attempt_update
BEFORE UPDATE ON personal_context_summary_attempts
BEGIN SELECT RAISE(ABORT,'context summary attempts are immutable'); END;
CREATE TRIGGER prevent_personal_context_assembly_source_update
BEFORE UPDATE ON personal_context_assembly_sources
BEGIN SELECT RAISE(ABORT,'context assembly sources are immutable'); END;
CREATE TRIGGER guard_personal_context_assembly_source_phase
BEFORE INSERT ON personal_context_assembly_sources
WHEN (NEW.source_phase='locked' AND NOT EXISTS (
    SELECT 1 FROM personal_context_assemblies
    WHERE assembly_id=NEW.assembly_id AND state='locked'
  )) OR (NEW.source_phase='failed_candidate' AND NOT EXISTS (
    SELECT 1 FROM personal_context_assemblies
    WHERE assembly_id=NEW.assembly_id AND state<>'locked'
  ))
BEGIN SELECT RAISE(ABORT,'context assembly source phase conflicts with assembly state'); END;
CREATE TRIGGER prevent_personal_context_recovery_update
BEFORE UPDATE ON personal_context_recovery_actions
WHEN OLD.status<>'pending' OR NEW.recovery_id<>OLD.recovery_id
  OR NEW.operation_id<>OLD.operation_id OR NEW.assembly_id<>OLD.assembly_id
  OR NEW.turn_id<>OLD.turn_id OR NEW.user_id<>OLD.user_id
  OR NEW.assistant_id<>OLD.assistant_id OR NEW.conversation_id<>OLD.conversation_id
  OR NEW.branch_id<>OLD.branch_id OR NEW.action_type<>OLD.action_type
  OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'context recovery identity/transition is immutable'); END;

CREATE TRIGGER prevent_personal_context_settings_delete
BEFORE DELETE ON personal_context_conversation_settings
WHEN vio_owner_deletion_authorized('personal_context_conversation_settings',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context settings require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_context_operation_delete
BEFORE DELETE ON personal_context_operations
WHEN vio_owner_deletion_authorized('personal_context_operations',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context operations require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_context_summary_delete
BEFORE DELETE ON personal_context_summaries
WHEN vio_owner_deletion_authorized('personal_context_summaries',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context summaries require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_context_turn_control_delete
BEFORE DELETE ON personal_context_turn_controls
WHEN vio_owner_deletion_authorized('personal_context_turn_controls',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context turn controls require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_context_summary_source_delete
BEFORE DELETE ON personal_context_summary_sources
WHEN vio_owner_deletion_authorized('personal_context_summary_sources',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context summary sources require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_context_summary_attempt_delete
BEFORE DELETE ON personal_context_summary_attempts
WHEN vio_owner_deletion_authorized('personal_context_summary_attempts',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context summary attempts require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_context_assembly_delete
BEFORE DELETE ON personal_context_assemblies
WHEN vio_owner_deletion_authorized('personal_context_assemblies',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context assemblies require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_context_assembly_source_delete
BEFORE DELETE ON personal_context_assembly_sources
WHEN vio_owner_deletion_authorized('personal_context_assembly_sources',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context assembly sources require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_context_recovery_delete
BEFORE DELETE ON personal_context_recovery_actions
WHEN vio_owner_deletion_authorized('personal_context_recovery_actions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context recoveries require governed owner deletion'); END;
