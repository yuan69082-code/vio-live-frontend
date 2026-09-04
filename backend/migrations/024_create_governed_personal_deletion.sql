-- R2 governed deletion: ordinary immutable histories retain their protections.
-- The function is connection-local, deny-by-default, and authorizes exact rows
-- only inside an executing, owner-bound deletion transaction.
CREATE TABLE personal_deletion_tasks (
 deletion_id TEXT PRIMARY KEY, owner_user_id TEXT, owner_fingerprint TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, requested_at TEXT NOT NULL, cancellable_until TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('waiting','processing','cleanup_pending','failed','completed','cancelled')),
 online_deleted_at TEXT, receipt_expires_at TEXT, backup_deadline_at TEXT, reason TEXT,
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 inventory_json TEXT CHECK(inventory_json IS NULL OR json_valid(inventory_json)),
 wal_status TEXT NOT NULL DEFAULT 'pending' CHECK(wal_status IN ('pending','checkpoint_completed','checkpoint_pending')),
 UNIQUE(owner_fingerprint,idempotency_key)
);
CREATE UNIQUE INDEX idx_personal_deletion_active_owner ON personal_deletion_tasks(owner_user_id)
 WHERE status NOT IN ('cancelled','completed');
CREATE INDEX idx_personal_deletion_due ON personal_deletion_tasks(status,cancellable_until);
CREATE TABLE personal_deletion_access (
 token_hash TEXT PRIMARY KEY, deletion_id TEXT NOT NULL REFERENCES personal_deletion_tasks(deletion_id) ON DELETE CASCADE,
 created_at TEXT NOT NULL
);
CREATE TABLE personal_deletion_tombstones (
 owner_fingerprint TEXT PRIMARY KEY, deletion_id TEXT NOT NULL UNIQUE REFERENCES personal_deletion_tasks(deletion_id) ON DELETE CASCADE,
 deleted_at TEXT NOT NULL
);
CREATE TABLE personal_managed_copies (
 copy_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, owner_fingerprint TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('file','backup')), root_path TEXT NOT NULL, relative_path TEXT NOT NULL,
 content_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','removed')),
 created_at TEXT NOT NULL, removed_at TEXT, UNIQUE(root_path,relative_path)
);
CREATE TABLE personal_deletion_attempts (
 attempt_id TEXT PRIMARY KEY, deletion_id TEXT NOT NULL REFERENCES personal_deletion_tasks(deletion_id) ON DELETE CASCADE,
 started_at TEXT NOT NULL, completed_at TEXT, result TEXT CHECK(result IN ('completed','failed')),
 reason TEXT
);
CREATE TRIGGER protect_deletion_task_identity BEFORE UPDATE ON personal_deletion_tasks
WHEN NEW.deletion_id<>OLD.deletion_id OR NEW.owner_fingerprint<>OLD.owner_fingerprint
 OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.requested_at<>OLD.requested_at OR NEW.cancellable_until<>OLD.cancellable_until
 OR (NEW.owner_user_id IS NOT OLD.owner_user_id AND NOT (OLD.owner_user_id IS NOT NULL AND NEW.owner_user_id IS NULL AND NEW.status='completed' AND NEW.online_deleted_at IS NOT NULL))
 OR (OLD.online_deleted_at IS NOT NULL AND NEW.online_deleted_at IS NOT OLD.online_deleted_at)
BEGIN SELECT RAISE(ABORT,'deletion task identity is immutable'); END;
CREATE TRIGGER protect_deletion_terminal_state BEFORE UPDATE ON personal_deletion_tasks
WHEN (OLD.status IN ('completed','cancelled') AND NEW.status<>OLD.status)
 OR (OLD.online_deleted_at IS NOT NULL AND NEW.status IN ('waiting','processing','cancelled'))
BEGIN SELECT RAISE(ABORT,'deletion terminal state cannot be restored'); END;
DROP TRIGGER prevent_message_version_delete;
CREATE TRIGGER prevent_message_version_delete BEFORE DELETE ON message_versions
WHEN vio_owner_deletion_authorized('message_versions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'message versions require a governed retention process'); END;

DROP TRIGGER prevent_conversation_summary_delete;
CREATE TRIGGER prevent_conversation_summary_delete BEFORE DELETE ON conversation_summaries
WHEN vio_owner_deletion_authorized('conversation_summaries',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'conversation summaries require a governed retention process'); END;

DROP TRIGGER prevent_conversation_summary_source_delete;
CREATE TRIGGER prevent_conversation_summary_source_delete BEFORE DELETE ON conversation_summary_sources
WHEN vio_owner_deletion_authorized('conversation_summary_sources',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'conversation summary sources require a governed retention process'); END;

DROP TRIGGER prevent_subject_state_delete;
CREATE TRIGGER prevent_subject_state_delete BEFORE DELETE ON subject_states
WHEN vio_owner_deletion_authorized('subject_states',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'subject states require a governed retention process'); END;

DROP TRIGGER prevent_subject_state_event_delete;
CREATE TRIGGER prevent_subject_state_event_delete BEFORE DELETE ON subject_state_unresolved_events
WHEN vio_owner_deletion_authorized('subject_state_unresolved_events',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'subject state event references require a governed retention process'); END;

DROP TRIGGER assistant_private_content_versions_no_delete;
CREATE TRIGGER assistant_private_content_versions_no_delete BEFORE DELETE ON assistant_private_content_versions
WHEN vio_owner_deletion_authorized('assistant_private_content_versions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'assistant private content versions are immutable'); END;

DROP TRIGGER prevent_continuity_first_round_binding_delete;
CREATE TRIGGER prevent_continuity_first_round_binding_delete BEFORE DELETE ON continuity_first_round_binding_fixtures
WHEN vio_owner_deletion_authorized('continuity_first_round_binding_fixtures',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'first-round SubjectBinding fixture cannot be deleted'); END;

DROP TRIGGER prevent_continuity_first_round_request_delete;
CREATE TRIGGER prevent_continuity_first_round_request_delete BEFORE DELETE ON continuity_first_round_requests
WHEN vio_owner_deletion_authorized('continuity_first_round_requests',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'first-round continuity requests require governed retention'); END;

DROP TRIGGER prevent_continuity_result_delete;
CREATE TRIGGER prevent_continuity_result_delete BEFORE DELETE ON continuity_first_round_results
WHEN vio_owner_deletion_authorized('continuity_first_round_results',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'first-round results require governed retention'); END;

DROP TRIGGER prevent_continuity_projection_version_delete;
CREATE TRIGGER prevent_continuity_projection_version_delete BEFORE DELETE ON continuity_engine_state_projection_versions
WHEN vio_owner_deletion_authorized('continuity_engine_state_projection_versions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'Engine state projections require governed retention'); END;

DROP TRIGGER prevent_continuity_projection_receipt_delete;
CREATE TRIGGER prevent_continuity_projection_receipt_delete BEFORE DELETE ON continuity_engine_state_projection_receipts
WHEN vio_owner_deletion_authorized('continuity_engine_state_projection_receipts',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'Engine projection receipts require governed retention'); END;

DROP TRIGGER prevent_continuity_projection_head_delete;
CREATE TRIGGER prevent_continuity_projection_head_delete BEFORE DELETE ON continuity_engine_state_projection_heads
WHEN vio_owner_deletion_authorized('continuity_engine_state_projection_heads',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'Engine projection heads require governed retention'); END;

DROP TRIGGER prevent_continuity_delivery_outbox_delete;
CREATE TRIGGER prevent_continuity_delivery_outbox_delete BEFORE DELETE ON continuity_first_round_delivery_outbox
WHEN vio_owner_deletion_authorized('continuity_first_round_delivery_outbox',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'delivery outbox requires governed retention'); END;

DROP TRIGGER prevent_continuity_delivery_attempt_delete;
CREATE TRIGGER prevent_continuity_delivery_attempt_delete BEFORE DELETE ON continuity_first_round_delivery_attempts
WHEN vio_owner_deletion_authorized('continuity_first_round_delivery_attempts',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'delivery attempts require governed retention'); END;

DROP TRIGGER prevent_api_provider_credential_binding_delete;
CREATE TRIGGER prevent_api_provider_credential_binding_delete BEFORE DELETE ON api_provider_credential_bindings
WHEN vio_owner_deletion_authorized('api_provider_credential_bindings',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'credential binding history requires governed retention'); END;

DROP TRIGGER prevent_continuity_capability_request_delete;
CREATE TRIGGER prevent_continuity_capability_request_delete BEFORE DELETE ON continuity_capability_requests
WHEN vio_owner_deletion_authorized('continuity_capability_requests',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'capability requests require governed retention'); END;

DROP TRIGGER prevent_continuity_capability_decision_delete;
CREATE TRIGGER prevent_continuity_capability_decision_delete BEFORE DELETE ON continuity_capability_decisions
WHEN vio_owner_deletion_authorized('continuity_capability_decisions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'capability decisions require governed retention'); END;

DROP TRIGGER prevent_continuity_capability_execution_delete;
CREATE TRIGGER prevent_continuity_capability_execution_delete BEFORE DELETE ON continuity_capability_model_executions
WHEN vio_owner_deletion_authorized('continuity_capability_model_executions',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'model executions require governed retention'); END;

DROP TRIGGER prevent_continuity_capability_usage_delete;
CREATE TRIGGER prevent_continuity_capability_usage_delete BEFORE DELETE ON continuity_capability_usage_facts
WHEN vio_owner_deletion_authorized('continuity_capability_usage_facts',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'capability usage facts require governed retention'); END;

DROP TRIGGER prevent_continuity_capability_result_delete;
CREATE TRIGGER prevent_continuity_capability_result_delete BEFORE DELETE ON continuity_capability_results
WHEN vio_owner_deletion_authorized('continuity_capability_results',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'capability results require governed retention'); END;

DROP TRIGGER prevent_continuity_capability_result_outbox_delete;
CREATE TRIGGER prevent_continuity_capability_result_outbox_delete BEFORE DELETE ON continuity_capability_result_outbox
WHEN vio_owner_deletion_authorized('continuity_capability_result_outbox',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'capability result outbox requires governed retention'); END;

DROP TRIGGER prevent_continuity_capability_attempt_delete;
CREATE TRIGGER prevent_continuity_capability_attempt_delete BEFORE DELETE ON continuity_capability_result_attempts
WHEN vio_owner_deletion_authorized('continuity_capability_result_attempts',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'capability result attempts require governed retention'); END;

DROP TRIGGER prevent_continuity_capability_incident_delete;
CREATE TRIGGER prevent_continuity_capability_incident_delete BEFORE DELETE ON continuity_capability_incidents
WHEN vio_owner_deletion_authorized('continuity_capability_incidents',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'capability incidents require governed retention'); END;

DROP TRIGGER prevent_continuity_conversation_turn_delete;
CREATE TRIGGER prevent_continuity_conversation_turn_delete BEFORE DELETE ON continuity_conversation_turns
WHEN vio_owner_deletion_authorized('continuity_conversation_turns',OLD.rowid)<>1
BEGIN SELECT RAISE(ABORT,'conversation turns require governed retention'); END;
