-- R5 Vio-owned local long-term memory ledger and R4 memory-source links.
-- This is independent from life-management local_memories and external runtime memory.

CREATE TABLE personal_local_memories (
  memory_id TEXT PRIMARY KEY CHECK(length(memory_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  current_version_id TEXT,
  current_version INTEGER NOT NULL CHECK(current_version > 0),
  status TEXT NOT NULL CHECK(status IN ('active','archived','deletion_pending')),
  deletion_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(memory_id,user_id,assistant_id),
  UNIQUE(user_id,assistant_id,memory_id,current_version_id),
  FOREIGN KEY(user_id,assistant_id)
    REFERENCES subjects(owner_user_id,subject_id) ON DELETE RESTRICT,
  FOREIGN KEY(memory_id,user_id,assistant_id,current_version_id)
    REFERENCES personal_local_memory_versions(
      memory_id,user_id,assistant_id,memory_version_id
    ) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK((status='deletion_pending' AND deletion_id IS NOT NULL)
    OR (status<>'deletion_pending' AND deletion_id IS NULL))
);

CREATE TABLE personal_local_memory_versions (
  memory_version_id TEXT PRIMARY KEY CHECK(length(memory_version_id) BETWEEN 1 AND 128),
  memory_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  kind TEXT NOT NULL CHECK(kind IN (
    'preference','profile_fact','relationship','decision','project','routine','other'
  )),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 8192),
  summary TEXT CHECK(summary IS NULL OR length(summary) BETWEEN 1 AND 512),
  primary_source_type TEXT NOT NULL CHECK(primary_source_type IN (
    'manual','import','message_version','event'
  )),
  primary_source_ref TEXT NOT NULL CHECK(length(primary_source_ref) BETWEEN 3 AND 256),
  primary_source_content_hash TEXT NOT NULL CHECK(
    length(primary_source_content_hash)=71
    AND substr(primary_source_content_hash,1,7)='sha256:'
    AND substr(primary_source_content_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  source_conversation_id TEXT,
  source_message_id TEXT,
  source_message_version_id TEXT,
  source_event_id TEXT,
  occurred_at TEXT,
  recorded_at TEXT NOT NULL,
  include_in_context INTEGER NOT NULL CHECK(include_in_context IN (0,1)),
  visibility_scope TEXT NOT NULL CHECK(visibility_scope='current_assistant'),
  sensitivity TEXT NOT NULL CHECK(sensitivity IN ('normal','sensitive')),
  content_hash TEXT NOT NULL CHECK(
    length(content_hash)=71 AND substr(content_hash,1,7)='sha256:'
    AND substr(content_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  previous_version_id TEXT,
  UNIQUE(memory_id,user_id,assistant_id,version_number),
  UNIQUE(memory_id,user_id,assistant_id,memory_version_id),
  FOREIGN KEY(memory_id,user_id,assistant_id)
    REFERENCES personal_local_memories(memory_id,user_id,assistant_id) ON DELETE RESTRICT,
  FOREIGN KEY(memory_id,user_id,assistant_id,previous_version_id)
    REFERENCES personal_local_memory_versions(memory_id,user_id,assistant_id,memory_version_id)
      ON DELETE RESTRICT,
  FOREIGN KEY(user_id,assistant_id,source_conversation_id,source_message_id,source_message_version_id)
    REFERENCES message_versions(user_id,subject_id,conversation_id,message_id,message_version_id)
      ON DELETE RESTRICT,
  FOREIGN KEY(user_id,assistant_id,source_event_id)
    REFERENCES events(user_id,subject_id,event_id) ON DELETE RESTRICT,
  CHECK(
    (primary_source_type IN ('manual','import') AND source_conversation_id IS NULL
      AND source_message_id IS NULL AND source_message_version_id IS NULL
      AND source_event_id IS NULL)
    OR (primary_source_type='message_version' AND source_conversation_id IS NOT NULL
      AND source_message_id IS NOT NULL AND source_message_version_id IS NOT NULL
      AND source_event_id IS NULL)
    OR (primary_source_type='event' AND source_conversation_id IS NULL
      AND source_message_id IS NULL AND source_message_version_id IS NULL
      AND source_event_id IS NOT NULL)
  )
);

CREATE TABLE personal_local_memory_references (
  reference_id TEXT PRIMARY KEY CHECK(length(reference_id) BETWEEN 1 AND 128),
  memory_id TEXT NOT NULL,
  memory_version_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('message_version','event')),
  source_conversation_id TEXT,
  source_message_id TEXT,
  source_message_version_id TEXT,
  source_event_id TEXT,
  source_content_hash TEXT NOT NULL CHECK(
    length(source_content_hash)=71 AND substr(source_content_hash,1,7)='sha256:'
    AND substr(source_content_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK(status IN ('active','deleted')),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(memory_id,user_id,assistant_id,reference_id),
  FOREIGN KEY(memory_id,user_id,assistant_id,memory_version_id)
    REFERENCES personal_local_memory_versions(memory_id,user_id,assistant_id,memory_version_id)
      ON DELETE RESTRICT,
  FOREIGN KEY(user_id,assistant_id,source_conversation_id,source_message_id,source_message_version_id)
    REFERENCES message_versions(user_id,subject_id,conversation_id,message_id,message_version_id)
      ON DELETE RESTRICT,
  FOREIGN KEY(user_id,assistant_id,source_event_id)
    REFERENCES events(user_id,subject_id,event_id) ON DELETE RESTRICT,
  CHECK(
    (source_type='message_version' AND source_conversation_id IS NOT NULL
      AND source_message_id IS NOT NULL AND source_message_version_id IS NOT NULL
      AND source_event_id IS NULL)
    OR (source_type='event' AND source_conversation_id IS NULL
      AND source_message_id IS NULL AND source_message_version_id IS NULL
      AND source_event_id IS NOT NULL)
  ),
  CHECK((status='active' AND deleted_at IS NULL) OR (status='deleted' AND deleted_at IS NOT NULL))
);

CREATE TABLE personal_local_memory_operations (
  operation_id TEXT PRIMARY KEY CHECK(length(operation_id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(
    length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  operation_type TEXT NOT NULL CHECK(operation_type IN (
    'memory.create','memory.edit','memory.context_inclusion','memory.archive','memory.restore',
    'memory.reference.create','memory.reference.delete','memory.deletion.request',
    'memory.deletion.cancel','memory.deletion.finalize','memory.import','memory.export'
  )),
  request_hash TEXT NOT NULL CHECK(
    length(request_hash)=71 AND substr(request_hash,1,7)='sha256:'
    AND substr(request_hash,8) NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK(status IN (
    'processing','confirmation_required','completed','failed'
  )),
  resource_type TEXT NOT NULL CHECK(resource_type IN (
    'memory','reference','deletion','import','export'
  )),
  resource_id TEXT,
  resource_version_id TEXT,
  confirmation_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(user_id,assistant_id,idempotency_key),
  UNIQUE(operation_id,user_id,assistant_id),
  FOREIGN KEY(user_id,assistant_id)
    REFERENCES subjects(owner_user_id,subject_id) ON DELETE RESTRICT,
  CHECK(
    (status IN ('processing','confirmation_required') AND completed_at IS NULL)
    OR (status IN ('completed','failed') AND completed_at IS NOT NULL)
  ),
  CHECK((status='confirmation_required' AND confirmation_id IS NOT NULL)
    OR status<>'confirmation_required')
);

CREATE TABLE personal_local_memory_imports (
  import_id TEXT PRIMARY KEY CHECK(length(import_id) BETWEEN 1 AND 128),
  operation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('atomic','best_effort')),
  status TEXT NOT NULL CHECK(status IN ('completed','failed')),
  report_hash TEXT NOT NULL,
  total_count INTEGER NOT NULL CHECK(total_count BETWEEN 1 AND 100),
  created_count INTEGER NOT NULL CHECK(created_count>=0),
  reused_count INTEGER NOT NULL CHECK(reused_count>=0),
  invalid_count INTEGER NOT NULL CHECK(invalid_count>=0),
  conflict_count INTEGER NOT NULL CHECK(conflict_count>=0),
  created_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY(operation_id,user_id,assistant_id)
    REFERENCES personal_local_memory_operations(operation_id,user_id,assistant_id)
      ON DELETE RESTRICT
);

CREATE TABLE personal_local_memory_import_items (
  import_id TEXT NOT NULL,
  client_item_id TEXT NOT NULL CHECK(length(client_item_id) BETWEEN 1 AND 128),
  item_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('created','reused','invalid','conflict')),
  memory_id TEXT,
  error_code TEXT,
  PRIMARY KEY(import_id,client_item_id),
  FOREIGN KEY(import_id) REFERENCES personal_local_memory_imports(import_id) ON DELETE RESTRICT,
  CHECK((status IN ('created','reused') AND memory_id IS NOT NULL AND error_code IS NULL)
    OR (status IN ('invalid','conflict') AND memory_id IS NULL AND error_code IS NOT NULL))
);

CREATE TABLE personal_local_memory_exports (
  export_id TEXT PRIMARY KEY CHECK(length(export_id) BETWEEN 1 AND 128),
  operation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  include_archived INTEGER NOT NULL CHECK(include_archived IN (0,1)),
  item_count INTEGER NOT NULL CHECK(item_count BETWEEN 0 AND 100),
  manifest_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(operation_id,user_id,assistant_id)
    REFERENCES personal_local_memory_operations(operation_id,user_id,assistant_id)
      ON DELETE RESTRICT
);

CREATE TABLE personal_local_memory_export_items (
  export_id TEXT NOT NULL,
  item_order INTEGER NOT NULL CHECK(item_order>=0),
  memory_id TEXT NOT NULL,
  memory_version_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY(export_id,item_order),
  UNIQUE(export_id,memory_id),
  FOREIGN KEY(export_id) REFERENCES personal_local_memory_exports(export_id) ON DELETE RESTRICT
);

CREATE TABLE personal_local_memory_deletions (
  deletion_id TEXT PRIMARY KEY CHECK(length(deletion_id) BETWEEN 1 AND 128),
  memory_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','cancelled','completed','failed')),
  requested_at TEXT NOT NULL,
  cancelled_at TEXT,
  finalized_at TEXT,
  result TEXT NOT NULL CHECK(result IN ('pending','cancelled','deleted','failed')),
  failure_code TEXT,
  body_retained INTEGER NOT NULL CHECK(body_retained IN (0,1)),
  UNIQUE(memory_id,user_id,assistant_id,deletion_id),
  CHECK(
    (status='pending' AND result='pending' AND cancelled_at IS NULL
      AND finalized_at IS NULL AND body_retained=1)
    OR (status='cancelled' AND result='cancelled' AND cancelled_at IS NOT NULL
      AND finalized_at IS NULL AND body_retained=1)
    OR (status='completed' AND result='deleted' AND cancelled_at IS NULL
      AND finalized_at IS NOT NULL AND body_retained=0)
    OR (status='failed' AND result='failed' AND failure_code IS NOT NULL
      AND body_retained=1)
  )
);

-- Hash-only link; no FK to the deletable body/version tables by design.
CREATE TABLE personal_context_memory_source_links (
  assembly_id TEXT NOT NULL,
  source_phase TEXT NOT NULL CHECK(source_phase IN ('failed_candidate','locked')),
  source_order INTEGER NOT NULL CHECK(source_order>=0),
  user_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  memory_version_id TEXT NOT NULL,
  memory_content_hash TEXT NOT NULL,
  primary_source_ref TEXT NOT NULL,
  primary_source_content_hash TEXT NOT NULL,
  PRIMARY KEY(assembly_id,source_phase,source_order),
  FOREIGN KEY(assembly_id,source_phase,source_order)
    REFERENCES personal_context_assembly_sources(assembly_id,source_phase,source_order)
      ON DELETE RESTRICT
);

-- Existing R2 personal assistants receive the same assistant-scoped memory
-- boundary that newly created assistants receive through the domain service.
WITH memory_actions(action) AS (
  VALUES('read'),('write'),('manage'),('delete'),('export')
)
INSERT INTO permissions(
  permission_id,user_id,subject_id,resource_type,resource_id,action,
  permission_level,status,created_at,updated_at
)
SELECT lower(hex(randomblob(16))),p.user_id,p.assistant_id,'memory','local-memory',
  a.action,'always_allow','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM personal_assistant_versions p CROSS JOIN memory_actions a
WHERE NOT EXISTS (
  SELECT 1 FROM permissions existing
  WHERE existing.user_id=p.user_id AND existing.subject_id=p.assistant_id
    AND existing.resource_type='memory' AND existing.resource_id='local-memory'
    AND existing.action=a.action AND existing.status IN ('active','inactive')
);

CREATE INDEX idx_personal_local_memories_scope
  ON personal_local_memories(user_id,assistant_id,status,updated_at DESC,memory_id DESC);
CREATE INDEX idx_personal_local_memory_versions_scope
  ON personal_local_memory_versions(user_id,assistant_id,memory_id,version_number);
CREATE INDEX idx_personal_local_memory_references_scope
  ON personal_local_memory_references(user_id,assistant_id,memory_id,status,created_at);
CREATE INDEX idx_personal_local_memory_operations_scope
  ON personal_local_memory_operations(user_id,assistant_id,created_at,operation_id);
CREATE INDEX idx_personal_local_memory_deletions_scope
  ON personal_local_memory_deletions(user_id,assistant_id,status,requested_at,deletion_id);

CREATE TRIGGER protect_personal_local_memory_version_update
BEFORE UPDATE ON personal_local_memory_versions
BEGIN SELECT RAISE(ABORT,'local memory versions are immutable'); END;

CREATE TRIGGER protect_personal_local_memory_version_delete
BEFORE DELETE ON personal_local_memory_versions
WHEN vio_memory_deletion_authorized('personal_local_memory_versions',OLD.rowid)<>1
 AND vio_owner_deletion_authorized('personal_local_memory_versions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory versions require scoped deletion'); END;

CREATE TRIGGER protect_personal_local_memory_identity
BEFORE UPDATE ON personal_local_memories
WHEN NEW.memory_id<>OLD.memory_id OR NEW.user_id<>OLD.user_id
 OR NEW.assistant_id<>OLD.assistant_id OR NEW.created_at<>OLD.created_at
 OR NEW.current_version<OLD.current_version OR NEW.current_version>OLD.current_version+1
 OR (OLD.current_version_id IS NOT NULL AND NEW.current_version=OLD.current_version
   AND COALESCE(NEW.current_version_id,'')<>COALESCE(OLD.current_version_id,''))
BEGIN SELECT RAISE(ABORT,'local memory identity/version is immutable'); END;

CREATE TRIGGER guard_personal_local_memory_status
BEFORE UPDATE OF status ON personal_local_memories
WHEN NOT (
  (OLD.status='active' AND NEW.status IN ('active','archived','deletion_pending'))
  OR (OLD.status='archived' AND NEW.status IN ('archived','active','deletion_pending'))
  OR (OLD.status='deletion_pending' AND NEW.status IN ('deletion_pending','active','archived'))
)
BEGIN SELECT RAISE(ABORT,'invalid local memory status transition'); END;

CREATE TRIGGER protect_personal_local_memory_delete
BEFORE DELETE ON personal_local_memories
WHEN vio_memory_deletion_authorized('personal_local_memories',OLD.rowid)<>1
 AND vio_owner_deletion_authorized('personal_local_memories',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory requires scoped deletion'); END;

CREATE TRIGGER protect_personal_local_memory_reference_update
BEFORE UPDATE ON personal_local_memory_references
WHEN NEW.reference_id<>OLD.reference_id OR NEW.memory_id<>OLD.memory_id
 OR NEW.memory_version_id<>OLD.memory_version_id OR NEW.user_id<>OLD.user_id
 OR NEW.assistant_id<>OLD.assistant_id OR NEW.source_type<>OLD.source_type
 OR COALESCE(NEW.source_conversation_id,'')<>COALESCE(OLD.source_conversation_id,'')
 OR COALESCE(NEW.source_message_id,'')<>COALESCE(OLD.source_message_id,'')
 OR COALESCE(NEW.source_message_version_id,'')<>COALESCE(OLD.source_message_version_id,'')
 OR COALESCE(NEW.source_event_id,'')<>COALESCE(OLD.source_event_id,'')
 OR NEW.source_content_hash<>OLD.source_content_hash OR NEW.created_at<>OLD.created_at
 OR OLD.status<>'active' OR NEW.status<>'deleted' OR NEW.deleted_at IS NULL
BEGIN SELECT RAISE(ABORT,'local memory reference is immutable'); END;

CREATE TRIGGER protect_personal_local_memory_reference_delete
BEFORE DELETE ON personal_local_memory_references
WHEN vio_memory_deletion_authorized('personal_local_memory_references',OLD.rowid)<>1
 AND vio_owner_deletion_authorized('personal_local_memory_references',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory references require scoped deletion'); END;

CREATE TRIGGER protect_personal_local_memory_operation_identity
BEFORE UPDATE ON personal_local_memory_operations
WHEN NEW.operation_id<>OLD.operation_id OR NEW.user_id<>OLD.user_id
 OR NEW.assistant_id<>OLD.assistant_id OR NEW.idempotency_key<>OLD.idempotency_key
 OR NEW.operation_type<>OLD.operation_type OR NEW.request_hash<>OLD.request_hash
 OR NEW.resource_type<>OLD.resource_type OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'local memory operation identity is immutable'); END;

CREATE TRIGGER guard_personal_local_memory_operation_transition
BEFORE UPDATE OF status ON personal_local_memory_operations
WHEN NOT (
  (OLD.status='processing' AND NEW.status IN ('processing','confirmation_required','completed','failed'))
  OR (OLD.status='confirmation_required'
    AND NEW.status IN ('confirmation_required','processing','completed','failed'))
)
BEGIN SELECT RAISE(ABORT,'invalid local memory operation transition'); END;

CREATE TRIGGER protect_personal_local_memory_operation_terminal
BEFORE UPDATE ON personal_local_memory_operations
WHEN OLD.status IN ('completed','failed')
BEGIN SELECT RAISE(ABORT,'terminal local memory operations are immutable'); END;

CREATE TRIGGER prevent_personal_local_memory_import_update
BEFORE UPDATE ON personal_local_memory_imports
BEGIN SELECT RAISE(ABORT,'local memory import facts are immutable'); END;
CREATE TRIGGER prevent_personal_local_memory_import_item_update
BEFORE UPDATE ON personal_local_memory_import_items
BEGIN SELECT RAISE(ABORT,'local memory import items are immutable'); END;
CREATE TRIGGER prevent_personal_local_memory_export_update
BEFORE UPDATE ON personal_local_memory_exports
BEGIN SELECT RAISE(ABORT,'local memory export facts are immutable'); END;
CREATE TRIGGER prevent_personal_local_memory_export_item_update
BEFORE UPDATE ON personal_local_memory_export_items
BEGIN SELECT RAISE(ABORT,'local memory export items are immutable'); END;
CREATE TRIGGER prevent_personal_context_memory_link_update
BEFORE UPDATE ON personal_context_memory_source_links
BEGIN SELECT RAISE(ABORT,'context memory links are immutable'); END;
CREATE TRIGGER prevent_personal_context_memory_link_delete
BEFORE DELETE ON personal_context_memory_source_links
WHEN vio_owner_deletion_authorized('personal_context_memory_source_links',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'context memory links require governed owner deletion'); END;

CREATE TRIGGER protect_personal_local_memory_deletion_identity
BEFORE UPDATE ON personal_local_memory_deletions
WHEN NEW.deletion_id<>OLD.deletion_id OR NEW.memory_id<>OLD.memory_id
 OR NEW.user_id<>OLD.user_id OR NEW.assistant_id<>OLD.assistant_id
 OR NEW.requested_at<>OLD.requested_at OR OLD.status IN ('cancelled','completed','failed')
BEGIN SELECT RAISE(ABORT,'local memory deletion identity/terminal state is immutable'); END;

CREATE TRIGGER prevent_personal_local_memory_operation_delete
BEFORE DELETE ON personal_local_memory_operations
WHEN vio_owner_deletion_authorized('personal_local_memory_operations',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory operations require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_local_memory_import_delete
BEFORE DELETE ON personal_local_memory_imports
WHEN vio_owner_deletion_authorized('personal_local_memory_imports',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory imports require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_local_memory_import_item_delete
BEFORE DELETE ON personal_local_memory_import_items
WHEN vio_owner_deletion_authorized('personal_local_memory_import_items',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory import items require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_local_memory_export_delete
BEFORE DELETE ON personal_local_memory_exports
WHEN vio_owner_deletion_authorized('personal_local_memory_exports',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory exports require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_local_memory_export_item_delete
BEFORE DELETE ON personal_local_memory_export_items
WHEN vio_owner_deletion_authorized('personal_local_memory_export_items',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory export items require governed owner deletion'); END;
CREATE TRIGGER prevent_personal_local_memory_deletion_delete
BEFORE DELETE ON personal_local_memory_deletions
WHEN vio_owner_deletion_authorized('personal_local_memory_deletions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'local memory deletion receipts require governed owner deletion'); END;
