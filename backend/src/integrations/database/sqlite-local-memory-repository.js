import { ConflictError } from '../../core/errors.js';
import { deleteMemoryRows, memoryDeletionRows } from './local-memory-deletion-scope.js';

const constrained = (operation, message) => {
  try { return operation(); } catch (error) {
    if (String(error?.code ?? '').startsWith('ERR_SQLITE_CONSTRAINT')) {
      throw new ConflictError(message);
    }
    throw error;
  }
};

function memory(row) {
  return row ? {
    memoryId: row.memory_id, userId: row.user_id, assistantId: row.assistant_id,
    currentVersionId: row.current_version_id, currentVersion: row.current_version,
    status: row.status, deletionId: row.deletion_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
}

function version(row) {
  return row ? {
    memoryVersionId: row.memory_version_id, memoryId: row.memory_id,
    userId: row.user_id, assistantId: row.assistant_id, version: row.version_number,
    kind: row.kind, body: row.body, summary: row.summary,
    sourceType: row.primary_source_type, sourceRef: row.primary_source_ref,
    sourceContentHash: row.primary_source_content_hash,
    sourceConversationId: row.source_conversation_id,
    sourceMessageId: row.source_message_id,
    sourceMessageVersionId: row.source_message_version_id,
    sourceEventId: row.source_event_id, occurredAt: row.occurred_at,
    recordedAt: row.recorded_at, includeInContext: row.include_in_context === 1,
    visibilityScope: row.visibility_scope, sensitivity: row.sensitivity,
    contentHash: row.content_hash, previousVersionId: row.previous_version_id,
  } : null;
}

function reference(row) {
  return row ? {
    referenceId: row.reference_id, memoryId: row.memory_id,
    memoryVersionId: row.memory_version_id, userId: row.user_id,
    assistantId: row.assistant_id, sourceType: row.source_type,
    conversationId: row.source_conversation_id, messageId: row.source_message_id,
    messageVersionId: row.source_message_version_id, eventId: row.source_event_id,
    sourceContentHash: row.source_content_hash, status: row.status,
    createdAt: row.created_at, deletedAt: row.deleted_at,
  } : null;
}

function operation(row) {
  return row ? {
    operationId: row.operation_id, userId: row.user_id, assistantId: row.assistant_id,
    idempotencyKey: row.idempotency_key, operationType: row.operation_type,
    requestHash: row.request_hash, status: row.status, resourceType: row.resource_type,
    resourceId: row.resource_id, resourceVersionId: row.resource_version_id,
    confirmationId: row.confirmation_id, errorCode: row.error_code,
    createdAt: row.created_at, completedAt: row.completed_at,
  } : null;
}

function deletion(row) {
  return row ? {
    deletionId: row.deletion_id, memoryId: row.memory_id,
    userId: row.user_id, assistantId: row.assistant_id, status: row.status,
    requestedAt: row.requested_at, cancelledAt: row.cancelled_at,
    finalizedAt: row.finalized_at, result: row.result,
    failureCode: row.failure_code, bodyRetained: row.body_retained === 1,
  } : null;
}

export function createSqliteLocalMemoryRepository(database) {
  const db = database.connection;
  const currentSelect = `SELECT m.*,v.* FROM personal_local_memories m
    JOIN personal_local_memory_versions v ON v.memory_id=m.memory_id
     AND v.user_id=m.user_id AND v.assistant_id=m.assistant_id
     AND v.memory_version_id=m.current_version_id`;
  const findMemory = db.prepare(`${currentSelect}
    WHERE m.user_id=? AND m.assistant_id=? AND m.memory_id=?`);
  const listMemory = db.prepare(`${currentSelect}
    WHERE m.user_id=? AND m.assistant_id=? ORDER BY m.updated_at DESC,m.memory_id DESC`);
  const findVersion = db.prepare(`SELECT * FROM personal_local_memory_versions
    WHERE user_id=? AND assistant_id=? AND memory_id=? AND memory_version_id=?`);
  const listVersions = db.prepare(`SELECT * FROM personal_local_memory_versions
    WHERE user_id=? AND assistant_id=? AND memory_id=? ORDER BY version_number,memory_version_id`);
  const listReferences = db.prepare(`SELECT * FROM personal_local_memory_references
    WHERE user_id=? AND assistant_id=? AND memory_id=? ORDER BY created_at,reference_id`);
  const findReference = db.prepare(`SELECT * FROM personal_local_memory_references
    WHERE user_id=? AND assistant_id=? AND memory_id=? AND reference_id=?`);
  const findReferenceById = db.prepare(`SELECT * FROM personal_local_memory_references
    WHERE user_id=? AND assistant_id=? AND reference_id=?`);
  const resolveMessageVersion = db.prepare(`SELECT mv.*,bm.branch_id,
      bm.hidden,cb.clear_through_sequence,bm.sequence_number,pc.status AS conversation_status
    FROM message_versions mv
    JOIN personal_chat_branch_messages bm
      ON bm.user_id=mv.user_id AND bm.assistant_id=mv.subject_id
     AND bm.conversation_id=mv.conversation_id AND bm.message_id=mv.message_id
     AND bm.selected_version_id=mv.message_version_id
    JOIN personal_chat_branches cb
      ON cb.user_id=bm.user_id AND cb.assistant_id=bm.assistant_id
     AND cb.conversation_id=bm.conversation_id AND cb.branch_id=bm.branch_id
    JOIN personal_chat_conversations pc
      ON pc.user_id=bm.user_id AND pc.assistant_id=bm.assistant_id
     AND pc.conversation_id=bm.conversation_id
    WHERE mv.user_id=? AND mv.subject_id=? AND mv.message_version_id=?
      AND bm.hidden=0 AND bm.sequence_number>cb.clear_through_sequence
      AND pc.status='active'
    ORDER BY bm.branch_id LIMIT 1`);
  const findOperation = db.prepare(`SELECT * FROM personal_local_memory_operations
    WHERE user_id=? AND assistant_id=? AND idempotency_key=?`);
  const findOperationById = db.prepare(`SELECT * FROM personal_local_memory_operations
    WHERE operation_id=?`);
  const findDeletion = db.prepare(`SELECT * FROM personal_local_memory_deletions
    WHERE user_id=? AND assistant_id=? AND deletion_id=?`);
  const findImport = db.prepare(`SELECT * FROM personal_local_memory_imports WHERE import_id=?`);
  const listImportItems = db.prepare(`SELECT * FROM personal_local_memory_import_items
    WHERE import_id=? ORDER BY client_item_id`);
  const findExport = db.prepare(`SELECT * FROM personal_local_memory_exports WHERE export_id=?`);
  const listExportItems = db.prepare(`SELECT * FROM personal_local_memory_export_items
    WHERE export_id=? ORDER BY item_order`);

  return Object.freeze({
    findMemory(userId, assistantId, memoryId) {
      const row = findMemory.get(userId, assistantId, memoryId);
      return row ? { memory: memory(row), version: version(row) } : null;
    },
    listMemories(userId, assistantId) {
      return listMemory.all(userId, assistantId)
        .map(row => ({ memory: memory(row), version: version(row) }));
    },
    findVersion(userId, assistantId, memoryId, memoryVersionId) {
      return version(findVersion.get(userId, assistantId, memoryId, memoryVersionId));
    },
    listVersions(userId, assistantId, memoryId) {
      return listVersions.all(userId, assistantId, memoryId).map(version);
    },
    insertMemory(record, firstVersion) {
      return constrained(() => {
        db.prepare(`INSERT INTO personal_local_memories
          (memory_id,user_id,assistant_id,current_version_id,current_version,status,deletion_id,
           created_at,updated_at) VALUES(?,?,?,NULL,1,'active',NULL,?,?)`).run(
          record.memoryId, record.userId, record.assistantId, record.createdAt, record.createdAt,
        );
        this.insertVersion(firstVersion);
        db.prepare(`UPDATE personal_local_memories SET current_version_id=?,updated_at=?
          WHERE memory_id=? AND user_id=? AND assistant_id=?`).run(
          firstVersion.memoryVersionId, record.createdAt,
          record.memoryId, record.userId, record.assistantId,
        );
        return this.findMemory(record.userId, record.assistantId, record.memoryId);
      }, 'Local memory conflicts with an existing identity.');
    },
    insertVersion(record) {
      return constrained(() => {
        db.prepare(`INSERT INTO personal_local_memory_versions
          (memory_version_id,memory_id,user_id,assistant_id,version_number,kind,body,summary,
           primary_source_type,primary_source_ref,primary_source_content_hash,
           source_conversation_id,source_message_id,source_message_version_id,source_event_id,
           occurred_at,recorded_at,include_in_context,visibility_scope,sensitivity,content_hash,
           previous_version_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'current_assistant',?,?,?)`).run(
          record.memoryVersionId, record.memoryId, record.userId, record.assistantId,
          record.version, record.kind, record.body, record.summary, record.sourceType,
          record.sourceRef, record.sourceContentHash, record.sourceConversationId ?? null,
          record.sourceMessageId ?? null, record.sourceMessageVersionId ?? null,
          record.sourceEventId ?? null, record.occurredAt, record.recordedAt,
          record.includeInContext ? 1 : 0, record.sensitivity, record.contentHash,
          record.previousVersionId,
        );
        return this.findVersion(record.userId, record.assistantId,
          record.memoryId, record.memoryVersionId);
      }, 'Local memory version conflicts with an existing fact.');
    },
    advanceVersion(record) {
      this.insertVersion(record);
      const changed = db.prepare(`UPDATE personal_local_memories SET
        current_version_id=?,current_version=?,updated_at=?
        WHERE memory_id=? AND user_id=? AND assistant_id=? AND current_version=?
         AND status IN ('active','archived')`).run(
        record.memoryVersionId, record.version, record.recordedAt,
        record.memoryId, record.userId, record.assistantId, record.version - 1,
      );
      if (changed.changes !== 1) throw new ConflictError('Local memory version conflicts.');
      return this.findMemory(record.userId, record.assistantId, record.memoryId);
    },
    setStatus(userId, assistantId, memoryId, expectedVersion, status, deletionId, updatedAt) {
      const result = db.prepare(`UPDATE personal_local_memories SET status=?,deletion_id=?,updated_at=?
        WHERE user_id=? AND assistant_id=? AND memory_id=? AND current_version=?`).run(
        status, deletionId, updatedAt, userId, assistantId, memoryId, expectedVersion,
      );
      if (result.changes !== 1) throw new ConflictError('Local memory state/version conflicts.');
      return this.findMemory(userId, assistantId, memoryId);
    },
    listReferences(userId, assistantId, memoryId) {
      return listReferences.all(userId, assistantId, memoryId).map(reference);
    },
    findReference(userId, assistantId, memoryId, referenceId) {
      return reference(findReference.get(userId, assistantId, memoryId, referenceId));
    },
    findReferenceById(userId, assistantId, referenceId) {
      return reference(findReferenceById.get(userId, assistantId, referenceId));
    },
    resolveMessageVersion(userId, assistantId, memoryVersionId) {
      const row = resolveMessageVersion.get(userId, assistantId, memoryVersionId);
      return row ? {
        messageVersionId: row.message_version_id,
        messageId: row.message_id,
        userId: row.user_id,
        assistantId: row.subject_id,
        conversationId: row.conversation_id,
        branchId: row.branch_id,
        senderType: row.sender_type,
        content: row.content,
        createdAt: row.created_at,
      } : null;
    },
    insertReference(record) {
      return constrained(() => {
        db.prepare(`INSERT INTO personal_local_memory_references
          (reference_id,memory_id,memory_version_id,user_id,assistant_id,source_type,
           source_conversation_id,source_message_id,source_message_version_id,source_event_id,
           source_content_hash,status,created_at,deleted_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',?,NULL)`).run(
          record.referenceId, record.memoryId, record.memoryVersionId,
          record.userId, record.assistantId, record.sourceType,
          record.conversationId, record.messageId, record.messageVersionId,
          record.eventId, record.sourceContentHash, record.createdAt,
        );
        return this.findReference(record.userId, record.assistantId,
          record.memoryId, record.referenceId);
      }, 'Local memory reference conflicts.');
    },
    deleteReference(userId, assistantId, memoryId, referenceId, deletedAt) {
      const changed = db.prepare(`UPDATE personal_local_memory_references
        SET status='deleted',deleted_at=? WHERE user_id=? AND assistant_id=?
         AND memory_id=? AND reference_id=? AND status='active'`).run(
        deletedAt, userId, assistantId, memoryId, referenceId,
      );
      if (changed.changes !== 1) throw new ConflictError('Local memory reference state conflicts.');
      return this.findReference(userId, assistantId, memoryId, referenceId);
    },
    findOperation(userId, assistantId, idempotencyKey) {
      return operation(findOperation.get(userId, assistantId, idempotencyKey));
    },
    insertOperation(record) {
      return constrained(() => {
        db.prepare(`INSERT INTO personal_local_memory_operations
          (operation_id,user_id,assistant_id,idempotency_key,operation_type,request_hash,status,
           resource_type,resource_id,resource_version_id,confirmation_id,error_code,
           created_at,completed_at) VALUES(?,?,?,?,?,?,'processing',?,NULL,NULL,NULL,NULL,?,NULL)`).run(
          record.operationId, record.userId, record.assistantId, record.idempotencyKey,
          record.operationType, record.requestHash, record.resourceType, record.createdAt,
        );
        return operation(findOperationById.get(record.operationId));
      }, 'Idempotency-Key is already bound to another local memory operation.');
    },
    setOperationConfirmation(operationId, confirmationId) {
      db.prepare(`UPDATE personal_local_memory_operations SET status='confirmation_required',
        confirmation_id=? WHERE operation_id=? AND status IN ('processing','confirmation_required')`)
        .run(confirmationId, operationId);
      return operation(findOperationById.get(operationId));
    },
    resumeOperation(operationId) {
      db.prepare(`UPDATE personal_local_memory_operations SET status='processing',confirmation_id=NULL
        WHERE operation_id=? AND status='confirmation_required'`).run(operationId);
      return operation(findOperationById.get(operationId));
    },
    completeOperation(record) {
      db.prepare(`UPDATE personal_local_memory_operations SET status=?,resource_id=?,
        resource_version_id=?,confirmation_id=NULL,error_code=?,completed_at=?
        WHERE operation_id=? AND status IN ('processing','confirmation_required')`).run(
        record.status, record.resourceId ?? null, record.resourceVersionId ?? null,
        record.errorCode ?? null, record.completedAt, record.operationId,
      );
      return operation(findOperationById.get(record.operationId));
    },
    failInterrupted(completedAt) {
      return db.prepare(`UPDATE personal_local_memory_operations SET status='failed',
        error_code='MEMORY_OPERATION_INTERRUPTED',completed_at=? WHERE status='processing'`)
        .run(completedAt).changes;
    },
    insertDeletion(record) {
      db.prepare(`INSERT INTO personal_local_memory_deletions
        (deletion_id,memory_id,user_id,assistant_id,status,requested_at,cancelled_at,finalized_at,
         result,failure_code,body_retained) VALUES(?,?,?,?,'pending',?,NULL,NULL,'pending',NULL,1)`)
        .run(record.deletionId, record.memoryId, record.userId, record.assistantId, record.requestedAt);
      return deletion(findDeletion.get(record.userId, record.assistantId, record.deletionId));
    },
    findDeletion(userId, assistantId, deletionId) {
      return deletion(findDeletion.get(userId, assistantId, deletionId));
    },
    cancelDeletion(record) {
      const changed = db.prepare(`UPDATE personal_local_memory_deletions SET
        status='cancelled',result='cancelled',cancelled_at=?
        WHERE deletion_id=? AND user_id=? AND assistant_id=? AND memory_id=? AND status='pending'`)
        .run(record.cancelledAt, record.deletionId, record.userId,
          record.assistantId, record.memoryId);
      if (changed.changes !== 1) throw new ConflictError('Memory deletion cannot be cancelled.');
      return this.findDeletion(record.userId, record.assistantId, record.deletionId);
    },
    finalizeDeletion(record) {
      const rows = memoryDeletionRows(db, record.userId, record.assistantId, record.memoryId);
      database.withMemoryDeletion(record.deletionId, record.userId, record.assistantId,
        record.memoryId, rows, () => deleteMemoryRows(db, rows));
      const changed = db.prepare(`UPDATE personal_local_memory_deletions SET
        status='completed',result='deleted',finalized_at=?,body_retained=0,failure_code=NULL
        WHERE deletion_id=? AND user_id=? AND assistant_id=? AND memory_id=? AND status='pending'`)
        .run(record.finalizedAt, record.deletionId, record.userId,
          record.assistantId, record.memoryId);
      if (changed.changes !== 1) throw new ConflictError('Memory deletion cannot be finalized.');
      return this.findDeletion(record.userId, record.assistantId, record.deletionId);
    },
    insertImport(record, items) {
      db.prepare(`INSERT INTO personal_local_memory_imports
        (import_id,operation_id,user_id,assistant_id,mode,status,report_hash,total_count,
         created_count,reused_count,invalid_count,conflict_count,created_at,completed_at)
        VALUES(?,?,?,?,?,'completed',?,?,?,?,?,?,?,?)`).run(
        record.importId, record.operationId, record.userId, record.assistantId,
        record.mode, record.reportHash, record.totalCount, record.createdCount,
        record.reusedCount, record.invalidCount, record.conflictCount,
        record.createdAt, record.completedAt,
      );
      const insert = db.prepare(`INSERT INTO personal_local_memory_import_items
        (import_id,client_item_id,item_hash,status,memory_id,error_code) VALUES(?,?,?,?,?,?)`);
      for (const item of items) insert.run(record.importId, item.clientItemId, item.itemHash,
        item.status, item.memoryId, item.errorCode);
    },
    getImport(importId) {
      const row = findImport.get(importId);
      return row ? { importId: row.import_id, operationId: row.operation_id,
        userId: row.user_id, assistantId: row.assistant_id, mode: row.mode,
        status: row.status, reportHash: row.report_hash, totalCount: row.total_count,
        createdCount: row.created_count, reusedCount: row.reused_count,
        invalidCount: row.invalid_count, conflictCount: row.conflict_count,
        createdAt: row.created_at, completedAt: row.completed_at,
        items: listImportItems.all(importId).map(item => ({
          clientItemId: item.client_item_id, itemHash: item.item_hash,
          status: item.status, memoryId: item.memory_id, errorCode: item.error_code,
        })) } : null;
    },
    findImportedItem(userId, assistantId, clientItemId) {
      const row = db.prepare(`SELECT i.*,x.user_id,x.assistant_id FROM personal_local_memory_import_items i
        JOIN personal_local_memory_imports x ON x.import_id=i.import_id
        WHERE x.user_id=? AND x.assistant_id=? AND i.client_item_id=?
        ORDER BY x.created_at LIMIT 1`).get(userId, assistantId, clientItemId);
      return row ? { itemHash: row.item_hash, status: row.status, memoryId: row.memory_id } : null;
    },
    insertExport(record, items) {
      db.prepare(`INSERT INTO personal_local_memory_exports
        (export_id,operation_id,user_id,assistant_id,include_archived,item_count,manifest_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(record.exportId, record.operationId,
        record.userId, record.assistantId, record.includeArchived ? 1 : 0,
        items.length, record.manifestHash, record.createdAt);
      const insert = db.prepare(`INSERT INTO personal_local_memory_export_items
        (export_id,item_order,memory_id,memory_version_id,content_hash) VALUES(?,?,?,?,?)`);
      items.forEach((item, index) => insert.run(record.exportId, index,
        item.memoryId, item.memoryVersionId, item.contentHash));
    },
    getExport(exportId) {
      const row = findExport.get(exportId);
      return row ? { exportId: row.export_id, operationId: row.operation_id,
        userId: row.user_id, assistantId: row.assistant_id,
        includeArchived: row.include_archived === 1, itemCount: row.item_count,
        manifestHash: row.manifest_hash, createdAt: row.created_at,
        items: listExportItems.all(exportId).map(item => ({ memoryId: item.memory_id,
          memoryVersionId: item.memory_version_id, contentHash: item.content_hash })) } : null;
    },
  });
}
