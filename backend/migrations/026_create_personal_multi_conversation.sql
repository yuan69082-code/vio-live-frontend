-- vio-migration: foreign-keys-off
-- R3 adds multi-conversation catalog, branch projections, attachments, exports,
-- and regeneration facts around the immutable R1 standalone-chat ledger.

CREATE TABLE standalone_chat_default_conversations_026 (
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  is_r1_default INTEGER NOT NULL DEFAULT 0 CHECK (is_r1_default IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, assistant_id, conversation_id),
  UNIQUE (conversation_id),
  FOREIGN KEY (user_id) REFERENCES personal_identities(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES conversations(user_id, subject_id, conversation_id) ON DELETE RESTRICT
);

INSERT INTO standalone_chat_default_conversations_026 (
  user_id, assistant_id, conversation_id, is_r1_default, created_at
)
SELECT user_id, assistant_id, conversation_id, 1, created_at
FROM standalone_chat_default_conversations;

DROP TABLE standalone_chat_default_conversations;
ALTER TABLE standalone_chat_default_conversations_026
  RENAME TO standalone_chat_default_conversations;

CREATE UNIQUE INDEX idx_standalone_chat_one_r1_default
  ON standalone_chat_default_conversations(user_id, assistant_id)
  WHERE is_r1_default = 1;

CREATE TRIGGER validate_standalone_default_conversation
BEFORE INSERT ON standalone_chat_default_conversations
WHEN NOT EXISTS (
  SELECT 1 FROM conversations
  WHERE user_id = NEW.user_id
    AND subject_id = NEW.assistant_id
    AND conversation_id = NEW.conversation_id
    AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'standalone chat requires an active owned conversation');
END;

CREATE TRIGGER prevent_standalone_default_conversation_update
BEFORE UPDATE ON standalone_chat_default_conversations
BEGIN
  SELECT RAISE(ABORT, 'standalone conversation registration is immutable');
END;

CREATE TRIGGER prevent_standalone_default_conversation_delete
BEFORE DELETE ON standalone_chat_default_conversations
WHEN vio_owner_deletion_authorized('standalone_chat_default_conversations', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'standalone conversation registrations require governed retention');
END;

CREATE TABLE personal_chat_conversations (
  conversation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'deleted')),
  version INTEGER NOT NULL CHECK (version > 0),
  current_branch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT,
  UNIQUE (user_id, assistant_id, conversation_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES standalone_chat_default_conversations(
      user_id, assistant_id, conversation_id
    ) ON DELETE RESTRICT,
  CHECK (
    (status = 'active' AND archived_at IS NULL AND deleted_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  )
);

CREATE INDEX idx_personal_chat_conversations_scope
  ON personal_chat_conversations(user_id, assistant_id, status, updated_at DESC, conversation_id);

CREATE TABLE personal_chat_branches (
  branch_id TEXT PRIMARY KEY CHECK (length(branch_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  parent_branch_id TEXT,
  fork_message_id TEXT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  version INTEGER NOT NULL CHECK (version > 0),
  clear_through_sequence INTEGER NOT NULL DEFAULT 0 CHECK (clear_through_sequence >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, assistant_id, conversation_id, branch_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES personal_chat_conversations(user_id, assistant_id, conversation_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, parent_branch_id)
    REFERENCES personal_chat_branches(user_id, assistant_id, conversation_id, branch_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, fork_message_id)
    REFERENCES messages(user_id, subject_id, conversation_id, message_id)
      ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_personal_chat_root_branch
  ON personal_chat_branches(user_id, assistant_id, conversation_id)
  WHERE parent_branch_id IS NULL;

CREATE TABLE personal_chat_current_conversations (
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT,
  selection_version INTEGER NOT NULL CHECK (selection_version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, assistant_id),
  FOREIGN KEY (user_id, assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES personal_chat_conversations(user_id, assistant_id, conversation_id)
      ON DELETE RESTRICT
);

CREATE TABLE personal_chat_branch_messages (
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  selected_version_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  linked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (branch_id, message_id),
  UNIQUE (branch_id, sequence_number),
  FOREIGN KEY (user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_chat_branches(user_id, assistant_id, conversation_id, branch_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, message_id, selected_version_id)
    REFERENCES message_versions(
      user_id, subject_id, conversation_id, message_id, message_version_id
    ) ON DELETE RESTRICT
);

CREATE INDEX idx_personal_chat_branch_messages_visible
  ON personal_chat_branch_messages(branch_id, hidden, sequence_number, message_id);

CREATE TABLE personal_chat_turn_branches (
  turn_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (turn_id, user_id, assistant_id, conversation_id, branch_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id, turn_id)
    REFERENCES standalone_chat_turns(user_id, assistant_id, conversation_id, turn_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_chat_branches(user_id, assistant_id, conversation_id, branch_id)
      ON DELETE RESTRICT
);

CREATE TABLE personal_chat_operations (
  operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'conversation.create', 'conversation.select', 'conversation.rename',
    'conversation.archive', 'conversation.restore', 'conversation.delete',
    'message.edit', 'message.regenerate', 'message.version_select', 'message.hide',
    'branch.create', 'branch.select', 'branch.clear',
    'attachment.create', 'attachment.delete', 'conversation.export'
  )),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:'
    AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  status TEXT NOT NULL CHECK (status IN (
    'processing', 'completed', 'failed', 'cancelled', 'outcome_unknown'
  )),
  resource_type TEXT NOT NULL CHECK (resource_type IN (
    'conversation', 'branch', 'message', 'messageVersion', 'attachment', 'export'
  )),
  resource_id TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  external_call TEXT NOT NULL CHECK (
    external_call IN ('not_performed', 'performed', 'outcome_unknown')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, assistant_id, idempotency_key),
  UNIQUE (operation_id, user_id, assistant_id),
  FOREIGN KEY (user_id, assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'processing' AND completed_at IS NULL)
    OR (status <> 'processing' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_personal_chat_operations_scope
  ON personal_chat_operations(user_id, assistant_id, created_at, operation_id);

CREATE TABLE personal_chat_message_version_facts (
  message_version_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  version_kind TEXT NOT NULL CHECK (version_kind IN ('edited', 'regenerated')),
  base_version_id TEXT NOT NULL,
  context_hash TEXT,
  model_id TEXT,
  provider_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (message_version_id, user_id, assistant_id, conversation_id, message_id),
  FOREIGN KEY (user_id, assistant_id, conversation_id, message_id, message_version_id)
    REFERENCES message_versions(
      user_id, subject_id, conversation_id, message_id, message_version_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, message_id, base_version_id)
    REFERENCES message_versions(
      user_id, subject_id, conversation_id, message_id, message_version_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_chat_branches(user_id, assistant_id, conversation_id, branch_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (operation_id, user_id, assistant_id)
    REFERENCES personal_chat_operations(operation_id, user_id, assistant_id)
      ON DELETE RESTRICT,
  CHECK (
    (version_kind = 'edited' AND context_hash IS NULL AND model_id IS NULL AND provider_id IS NULL)
    OR (version_kind = 'regenerated' AND context_hash IS NOT NULL AND model_id IS NOT NULL AND provider_id IS NOT NULL)
  )
);

CREATE TABLE personal_chat_regenerations (
  execution_id TEXT PRIMARY KEY CHECK (length(execution_id) BETWEEN 1 AND 128),
  operation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  base_version_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  credential_binding_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'prepared', 'in_flight', 'retryable', 'outcome_unknown',
    'result_ready', 'completed', 'failed', 'cancelled'
  )),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  provider_call_may_have_started INTEGER NOT NULL CHECK (
    provider_call_may_have_started IN (0, 1)
  ),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  result_hash TEXT,
  response_content_hash TEXT,
  finish_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  usage_status TEXT CHECK (usage_status IS NULL OR usage_status IN ('provider_reported', 'unknown', 'not_incurred')),
  cost_status TEXT CHECK (cost_status IS NULL OR cost_status IN ('provider_reported', 'calculated', 'not_reported', 'not_incurred')),
  cost_amount_micros INTEGER,
  cost_currency TEXT,
  message_version_id TEXT UNIQUE,
  error_code TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (execution_id, user_id, assistant_id, conversation_id),
  FOREIGN KEY (operation_id, user_id, assistant_id)
    REFERENCES personal_chat_operations(operation_id, user_id, assistant_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_chat_branches(user_id, assistant_id, conversation_id, branch_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, message_id, base_version_id)
    REFERENCES message_versions(
      user_id, subject_id, conversation_id, message_id, message_version_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, model_id)
    REFERENCES models(owner_user_id, model_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, provider_id)
    REFERENCES api_providers(owner_user_id, api_provider_id) ON DELETE RESTRICT,
  FOREIGN KEY (credential_binding_id)
    REFERENCES api_provider_credential_bindings(credential_binding_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, message_id, message_version_id)
    REFERENCES message_versions(
      user_id, subject_id, conversation_id, message_id, message_version_id
    ) ON DELETE RESTRICT,
  CHECK (total_tokens IS NULL OR total_tokens = input_tokens + output_tokens),
  CHECK (provider_call_may_have_started = 1 OR status NOT IN ('outcome_unknown', 'result_ready', 'completed'))
);

CREATE TABLE personal_chat_attachments (
  attachment_id TEXT PRIMARY KEY CHECK (length(attachment_id) BETWEEN 1 AND 128),
  operation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 1 AND 128),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'file', 'audio')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 10485760),
  content_hash TEXT NOT NULL,
  storage_ref TEXT NOT NULL UNIQUE,
  managed_copy_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('ready', 'deleted', 'quarantined')),
  message_id TEXT,
  message_version_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (attachment_id, user_id, assistant_id, conversation_id),
  FOREIGN KEY (operation_id, user_id, assistant_id)
    REFERENCES personal_chat_operations(operation_id, user_id, assistant_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (managed_copy_id)
    REFERENCES personal_managed_copies(copy_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id)
    REFERENCES personal_chat_conversations(user_id, assistant_id, conversation_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, message_id, message_version_id)
    REFERENCES message_versions(
      user_id, subject_id, conversation_id, message_id, message_version_id
    )
      ON DELETE RESTRICT,
  CHECK (
    (message_id IS NULL AND message_version_id IS NULL)
    OR (message_id IS NOT NULL AND message_version_id IS NOT NULL)
  ),
  CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status <> 'deleted' AND deleted_at IS NULL)
  )
);

CREATE INDEX idx_personal_chat_attachments_scope
  ON personal_chat_attachments(user_id, assistant_id, conversation_id, status, created_at);

CREATE TABLE personal_chat_exports (
  export_id TEXT PRIMARY KEY CHECK (length(export_id) BETWEEN 1 AND 128),
  operation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('json', 'markdown')),
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (export_id, user_id, assistant_id, conversation_id),
  FOREIGN KEY (operation_id, user_id, assistant_id)
    REFERENCES personal_chat_operations(operation_id, user_id, assistant_id)
      ON DELETE RESTRICT,
  FOREIGN KEY (user_id, assistant_id, conversation_id, branch_id)
    REFERENCES personal_chat_branches(user_id, assistant_id, conversation_id, branch_id)
      ON DELETE RESTRICT
);

CREATE TABLE personal_chat_events (
  chat_event_id TEXT PRIMARY KEY CHECK (length(chat_event_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  conversation_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'conversation_created', 'conversation_selected', 'conversation_renamed',
    'conversation_archived', 'conversation_restored', 'conversation_deleted',
    'message_edited', 'message_regenerated', 'message_version_selected',
    'message_hidden', 'branch_created', 'branch_selected', 'branch_cleared',
    'attachment_created', 'attachment_deleted', 'conversation_exported'
  )),
  resource_id TEXT,
  event_data_json TEXT NOT NULL CHECK (json_valid(event_data_json)),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (user_id, assistant_id)
    REFERENCES subjects(owner_user_id, subject_id) ON DELETE RESTRICT
);

INSERT INTO personal_chat_conversations (
  conversation_id, user_id, assistant_id, status, version,
  current_branch_id, created_at, updated_at, archived_at, deleted_at
)
SELECT c.conversation_id, c.user_id, c.subject_id, c.status, 1,
       NULL, c.created_at, c.updated_at,
       CASE WHEN c.status = 'archived' THEN c.updated_at ELSE NULL END, NULL
FROM conversations c
JOIN standalone_chat_default_conversations d
  ON d.user_id = c.user_id
 AND d.assistant_id = c.subject_id
 AND d.conversation_id = c.conversation_id;

INSERT INTO personal_chat_branches (
  branch_id, user_id, assistant_id, conversation_id, parent_branch_id,
  fork_message_id, title, version, clear_through_sequence, created_at, updated_at
)
SELECT 'branch-root-' || conversation_id, user_id, assistant_id, conversation_id,
       NULL, NULL, 'Main', 1, 0, created_at, updated_at
FROM personal_chat_conversations;

UPDATE personal_chat_conversations
SET current_branch_id = 'branch-root-' || conversation_id;

INSERT INTO personal_chat_current_conversations (
  user_id, assistant_id, conversation_id, selection_version, updated_at
)
SELECT user_id, assistant_id, conversation_id, 1, created_at
FROM standalone_chat_default_conversations
WHERE is_r1_default = 1;

INSERT INTO personal_chat_branch_messages (
  branch_id, user_id, assistant_id, conversation_id, message_id,
  selected_version_id, sequence_number, hidden, linked_at, updated_at
)
SELECT 'branch-root-' || t.conversation_id, t.user_id, t.assistant_id,
       t.conversation_id, m.message_id,
       CASE WHEN m.sender_type = 'user' THEN t.user_message_version_id
            ELSE t.assistant_message_version_id END,
       m.sequence_number, 0, m.created_at, m.updated_at
FROM standalone_chat_turns t
JOIN messages m
  ON m.user_id = t.user_id
 AND m.subject_id = t.assistant_id
 AND m.conversation_id = t.conversation_id
 AND m.message_id IN (t.user_message_id, t.assistant_message_id)
WHERE (m.sender_type = 'user' AND t.user_message_version_id IS NOT NULL)
   OR (m.sender_type = 'subject' AND t.assistant_message_version_id IS NOT NULL);

INSERT INTO personal_chat_turn_branches (
  turn_id, user_id, assistant_id, conversation_id, branch_id, created_at
)
SELECT turn_id, user_id, assistant_id, conversation_id,
       'branch-root-' || conversation_id, created_at
FROM standalone_chat_turns;

CREATE TRIGGER protect_personal_chat_operation_identity
BEFORE UPDATE ON personal_chat_operations
WHEN NEW.operation_id IS NOT OLD.operation_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.assistant_id IS NOT OLD.assistant_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.operation_type IS NOT OLD.operation_type
  OR NEW.content_hash IS NOT OLD.content_hash
  OR NEW.input_json IS NOT OLD.input_json
  OR NEW.resource_type IS NOT OLD.resource_type
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'personal chat operation identity is immutable');
END;

CREATE TRIGGER protect_terminal_personal_chat_operation
BEFORE UPDATE ON personal_chat_operations
WHEN OLD.status <> 'processing'
BEGIN
  SELECT RAISE(ABORT, 'terminal personal chat operation is immutable');
END;

CREATE TRIGGER prevent_personal_chat_version_fact_update
BEFORE UPDATE ON personal_chat_message_version_facts
BEGIN
  SELECT RAISE(ABORT, 'personal chat message version facts are immutable');
END;

CREATE TRIGGER prevent_personal_chat_export_update
BEFORE UPDATE ON personal_chat_exports
BEGIN
  SELECT RAISE(ABORT, 'personal chat exports are immutable');
END;

CREATE TRIGGER prevent_personal_chat_event_update
BEFORE UPDATE ON personal_chat_events
BEGIN
  SELECT RAISE(ABORT, 'personal chat events are immutable');
END;

CREATE TRIGGER protect_personal_chat_regeneration_identity
BEFORE UPDATE ON personal_chat_regenerations
WHEN NEW.execution_id IS NOT OLD.execution_id
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.assistant_id IS NOT OLD.assistant_id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.branch_id IS NOT OLD.branch_id
  OR NEW.message_id IS NOT OLD.message_id
  OR NEW.base_version_id IS NOT OLD.base_version_id
  OR NEW.model_id IS NOT OLD.model_id
  OR NEW.provider_id IS NOT OLD.provider_id
  OR NEW.credential_binding_id IS NOT OLD.credential_binding_id
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.context_hash IS NOT OLD.context_hash
  OR NEW.started_at IS NOT OLD.started_at
  OR (OLD.result_json IS NOT NULL AND (
    NEW.result_json IS NOT OLD.result_json
    OR NEW.result_hash IS NOT OLD.result_hash
    OR NEW.response_content_hash IS NOT OLD.response_content_hash
    OR NEW.finish_reason IS NOT OLD.finish_reason
    OR NEW.input_tokens IS NOT OLD.input_tokens
    OR NEW.output_tokens IS NOT OLD.output_tokens
    OR NEW.total_tokens IS NOT OLD.total_tokens
    OR NEW.usage_status IS NOT OLD.usage_status
    OR NEW.cost_status IS NOT OLD.cost_status
    OR NEW.cost_amount_micros IS NOT OLD.cost_amount_micros
    OR NEW.cost_currency IS NOT OLD.cost_currency
  ))
  OR (OLD.message_version_id IS NOT NULL AND NEW.message_version_id IS NOT OLD.message_version_id)
BEGIN
  SELECT RAISE(ABORT, 'personal chat regeneration identity and locked result are immutable');
END;

CREATE TRIGGER guard_personal_chat_regeneration_transition
BEFORE UPDATE OF status ON personal_chat_regenerations
WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'prepared' AND NEW.status IN ('in_flight', 'failed', 'cancelled'))
  OR (OLD.status = 'in_flight' AND NEW.status IN ('retryable', 'outcome_unknown', 'result_ready', 'failed', 'cancelled'))
  OR (OLD.status = 'result_ready' AND NEW.status = 'completed')
)
BEGIN
  SELECT RAISE(ABORT, 'personal chat regeneration state transition is not allowed');
END;

CREATE TRIGGER protect_terminal_personal_chat_regeneration
BEFORE UPDATE ON personal_chat_regenerations
WHEN OLD.status IN ('retryable', 'outcome_unknown', 'completed', 'failed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'terminal personal chat regeneration fact is immutable');
END;

CREATE TRIGGER protect_personal_chat_attachment_identity
BEFORE UPDATE ON personal_chat_attachments
WHEN NEW.attachment_id IS NOT OLD.attachment_id
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.assistant_id IS NOT OLD.assistant_id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.file_name IS NOT OLD.file_name
  OR NEW.media_type IS NOT OLD.media_type
  OR NEW.kind IS NOT OLD.kind
  OR NEW.size_bytes IS NOT OLD.size_bytes
  OR NEW.content_hash IS NOT OLD.content_hash
  OR NEW.storage_ref IS NOT OLD.storage_ref
  OR NEW.managed_copy_id IS NOT OLD.managed_copy_id
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.message_version_id IS NOT NULL AND (
    NEW.message_id IS NOT OLD.message_id OR NEW.message_version_id IS NOT OLD.message_version_id
  ))
  OR (OLD.status <> 'ready' AND (
    NEW.status IS NOT OLD.status OR NEW.deleted_at IS NOT OLD.deleted_at
  ))
BEGIN
  SELECT RAISE(ABORT, 'personal chat attachment identity and terminal fact are immutable');
END;

CREATE TRIGGER prevent_personal_chat_operation_delete
BEFORE DELETE ON personal_chat_operations
WHEN vio_owner_deletion_authorized('personal_chat_operations', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'personal chat operations require governed retention');
END;

CREATE TRIGGER prevent_personal_chat_version_fact_delete
BEFORE DELETE ON personal_chat_message_version_facts
WHEN vio_owner_deletion_authorized('personal_chat_message_version_facts', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'personal chat version facts require governed retention');
END;

CREATE TRIGGER prevent_personal_chat_regeneration_delete
BEFORE DELETE ON personal_chat_regenerations
WHEN vio_owner_deletion_authorized('personal_chat_regenerations', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'personal chat regeneration facts require governed retention');
END;

CREATE TRIGGER prevent_personal_chat_export_delete
BEFORE DELETE ON personal_chat_exports
WHEN vio_owner_deletion_authorized('personal_chat_exports', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'personal chat exports require governed retention');
END;

CREATE TRIGGER prevent_personal_chat_event_delete
BEFORE DELETE ON personal_chat_events
WHEN vio_owner_deletion_authorized('personal_chat_events', OLD.rowid) <> 1
BEGIN
  SELECT RAISE(ABORT, 'personal chat events require governed retention');
END;

CREATE TRIGGER prevent_personal_chat_conversation_delete
BEFORE DELETE ON personal_chat_conversations
WHEN vio_owner_deletion_authorized('personal_chat_conversations', OLD.rowid) <> 1
BEGIN SELECT RAISE(ABORT, 'personal chat conversations require governed retention'); END;

CREATE TRIGGER prevent_personal_chat_branch_delete
BEFORE DELETE ON personal_chat_branches
WHEN vio_owner_deletion_authorized('personal_chat_branches', OLD.rowid) <> 1
BEGIN SELECT RAISE(ABORT, 'personal chat branches require governed retention'); END;

CREATE TRIGGER prevent_personal_chat_selection_delete
BEFORE DELETE ON personal_chat_current_conversations
WHEN vio_owner_deletion_authorized('personal_chat_current_conversations', OLD.rowid) <> 1
BEGIN SELECT RAISE(ABORT, 'personal chat selections require governed retention'); END;

CREATE TRIGGER prevent_personal_chat_branch_message_delete
BEFORE DELETE ON personal_chat_branch_messages
WHEN vio_owner_deletion_authorized('personal_chat_branch_messages', OLD.rowid) <> 1
BEGIN SELECT RAISE(ABORT, 'personal chat branch messages require governed retention'); END;

CREATE TRIGGER prevent_personal_chat_turn_branch_delete
BEFORE DELETE ON personal_chat_turn_branches
WHEN vio_owner_deletion_authorized('personal_chat_turn_branches', OLD.rowid) <> 1
BEGIN SELECT RAISE(ABORT, 'personal chat turn branches require governed retention'); END;

CREATE TRIGGER prevent_personal_chat_attachment_delete
BEFORE DELETE ON personal_chat_attachments
WHEN vio_owner_deletion_authorized('personal_chat_attachments', OLD.rowid) <> 1
BEGIN SELECT RAISE(ABORT, 'personal chat attachments require governed retention'); END;
