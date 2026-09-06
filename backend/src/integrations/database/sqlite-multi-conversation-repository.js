import { ConflictError } from '../../core/errors.js';

function constrained(operation, message) {
  try {
    return operation();
  } catch (error) {
    const code = String(error?.code ?? '');
    if (code.includes('CONSTRAINT') || /constraint failed/i.test(error?.message ?? '')) {
      throw new ConflictError(message);
    }
    throw error;
  }
}

function json(value) {
  return value == null ? null : JSON.parse(value);
}

function conversation(row) {
  if (!row) return null;
  return {
    conversationId: row.conversation_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    title: row.title,
    status: row.r3_status,
    version: row.version,
    currentBranchId: row.current_branch_id,
    messageCount: row.message_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
  };
}

function branch(row) {
  if (!row) return null;
  return {
    branchId: row.branch_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    parentBranchId: row.parent_branch_id,
    forkMessageId: row.fork_message_id,
    title: row.title,
    version: row.version,
    clearThroughSequence: row.clear_through_sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function branchMessage(row) {
  if (!row) return null;
  return {
    branchId: row.branch_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    messageVersionId: row.selected_version_id,
    senderType: row.sender_type,
    content: row.content,
    sequenceNumber: row.sequence_number,
    messageCreatedAt: row.message_created_at,
    versionCreatedAt: row.version_created_at,
    versionKind: row.change_reason,
    hidden: row.hidden === 1,
  };
}

function operation(row) {
  if (!row) return null;
  return {
    operationId: row.operation_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    idempotencyKey: row.idempotency_key,
    operationType: row.operation_type,
    contentHash: row.content_hash,
    inputJson: row.input_json,
    status: row.status,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    result: json(row.result_json),
    resultJson: row.result_json,
    errorCode: row.error_code,
    externalCall: row.external_call,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function attachment(row) {
  if (!row) return null;
  return {
    attachmentId: row.attachment_id,
    operationId: row.operation_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    fileName: row.file_name,
    mediaType: row.media_type,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    sha256: row.content_hash,
    storageRef: row.storage_ref,
    managedCopyId: row.managed_copy_id,
    status: row.status,
    messageId: row.message_id,
    messageVersionId: row.message_version_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function regeneration(row) {
  if (!row) return null;
  return {
    executionId: row.execution_id,
    operationId: row.operation_id,
    userId: row.user_id,
    assistantId: row.assistant_id,
    conversationId: row.conversation_id,
    branchId: row.branch_id,
    messageId: row.message_id,
    baseVersionId: row.base_version_id,
    modelId: row.model_id,
    providerId: row.provider_id,
    credentialBindingId: row.credential_binding_id,
    requestHash: row.request_hash,
    contextHash: row.context_hash,
    status: row.status,
    attemptCount: row.attempt_count,
    providerCallMayHaveStarted: row.provider_call_may_have_started === 1,
    result: json(row.result_json),
    resultJson: row.result_json,
    resultHash: row.result_hash,
    responseContentHash: row.response_content_hash,
    finishReason: row.finish_reason,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    usageStatus: row.usage_status,
    costStatus: row.cost_status,
    costAmountMicros: row.cost_amount_micros,
    costCurrency: row.cost_currency,
    messageVersionId: row.message_version_id,
    errorCode: row.error_code,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function createSqliteMultiConversationRepository(connection) {
  const conversationSelect = `
    SELECT pc.*, pc.status AS r3_status, c.title,
      (SELECT COUNT(*) FROM personal_chat_branch_messages bm
       JOIN personal_chat_branches cb ON cb.branch_id = bm.branch_id
       WHERE bm.branch_id = pc.current_branch_id AND bm.hidden = 0
         AND bm.sequence_number > cb.clear_through_sequence) AS message_count
    FROM personal_chat_conversations pc
    JOIN conversations c
      ON c.user_id=pc.user_id AND c.subject_id=pc.assistant_id
     AND c.conversation_id=pc.conversation_id
  `;
  const branchMessageSelect = `
    SELECT bm.*, m.sender_type, m.created_at AS message_created_at,
           mv.content, mv.created_at AS version_created_at, mv.change_reason
    FROM personal_chat_branch_messages bm
    JOIN messages m
      ON m.user_id=bm.user_id AND m.subject_id=bm.assistant_id
     AND m.conversation_id=bm.conversation_id AND m.message_id=bm.message_id
    JOIN message_versions mv
      ON mv.user_id=bm.user_id AND mv.subject_id=bm.assistant_id
     AND mv.conversation_id=bm.conversation_id AND mv.message_id=bm.message_id
     AND mv.message_version_id=bm.selected_version_id
  `;

  const findConversation = connection.prepare(`${conversationSelect}
    WHERE pc.user_id=? AND pc.assistant_id=? AND pc.conversation_id=?`);
  const listConversations = connection.prepare(`${conversationSelect}
    WHERE pc.user_id=? AND pc.assistant_id=?`);
  const insertRegistration = connection.prepare(`INSERT INTO standalone_chat_default_conversations
    (user_id,assistant_id,conversation_id,is_r1_default,created_at) VALUES(?,?,?,0,?)`);
  const insertCatalog = connection.prepare(`INSERT INTO personal_chat_conversations
    (conversation_id,user_id,assistant_id,status,version,current_branch_id,created_at,updated_at)
    VALUES(?,?,?,'active',1,?,?,?)`);
  const insertBranch = connection.prepare(`INSERT INTO personal_chat_branches
    (branch_id,user_id,assistant_id,conversation_id,parent_branch_id,fork_message_id,title,
     version,clear_through_sequence,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,0,?,?)`);
  const setCatalogBranch = connection.prepare(`UPDATE personal_chat_conversations
    SET current_branch_id=?,version=version+1,updated_at=?
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND version=?`);
  const findBranch = connection.prepare(`SELECT * FROM personal_chat_branches
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND branch_id=?`);
  const listBranches = connection.prepare(`SELECT * FROM personal_chat_branches
    WHERE user_id=? AND assistant_id=? AND conversation_id=? ORDER BY created_at,branch_id`);
  const listBranchMessages = connection.prepare(`${branchMessageSelect}
    WHERE bm.branch_id=? AND bm.user_id=? AND bm.assistant_id=? AND bm.conversation_id=?
    ORDER BY bm.sequence_number,bm.message_id`);
  const findBranchMessage = connection.prepare(`${branchMessageSelect}
    WHERE bm.branch_id=? AND bm.user_id=? AND bm.assistant_id=?
      AND bm.conversation_id=? AND bm.message_id=?`);
  const insertBranchMessage = connection.prepare(`INSERT INTO personal_chat_branch_messages
    (branch_id,user_id,assistant_id,conversation_id,message_id,selected_version_id,
     sequence_number,hidden,linked_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)`);
  const selectVersion = connection.prepare(`UPDATE personal_chat_branch_messages
    SET selected_version_id=?,updated_at=? WHERE branch_id=? AND user_id=?
      AND assistant_id=? AND conversation_id=? AND message_id=? AND selected_version_id=?`);
  const hideMessage = connection.prepare(`UPDATE personal_chat_branch_messages
    SET hidden=1,updated_at=? WHERE branch_id=? AND user_id=? AND assistant_id=?
      AND conversation_id=? AND message_id=? AND hidden=0`);
  const updateBranchVersion = connection.prepare(`UPDATE personal_chat_branches
    SET version=version+1,updated_at=? WHERE branch_id=? AND user_id=? AND assistant_id=?
      AND conversation_id=? AND version=?`);
  const touchBranchForMessage = connection.prepare(`UPDATE personal_chat_branches
    SET version=version+1,updated_at=? WHERE branch_id=? AND user_id=? AND assistant_id=?
      AND conversation_id=?`);
  const touchCatalog = connection.prepare(`UPDATE personal_chat_conversations
    SET updated_at=? WHERE user_id=? AND assistant_id=? AND conversation_id=?`);
  const clearBranch = connection.prepare(`UPDATE personal_chat_branches
    SET clear_through_sequence=?,version=version+1,updated_at=?
    WHERE branch_id=? AND user_id=? AND assistant_id=? AND conversation_id=? AND version=?`);

  const findSelection = connection.prepare(`SELECT * FROM personal_chat_current_conversations
    WHERE user_id=? AND assistant_id=?`);
  const upsertSelection = connection.prepare(`INSERT INTO personal_chat_current_conversations
    (user_id,assistant_id,conversation_id,selection_version,updated_at) VALUES(?,?,?,1,?)
    ON CONFLICT(user_id,assistant_id) DO UPDATE SET
      conversation_id=excluded.conversation_id,
      selection_version=personal_chat_current_conversations.selection_version+1,
      updated_at=excluded.updated_at
    WHERE personal_chat_current_conversations.selection_version=?`);
  const clearSelection = connection.prepare(`UPDATE personal_chat_current_conversations
    SET conversation_id=NULL,selection_version=selection_version+1,updated_at=?
    WHERE user_id=? AND assistant_id=? AND conversation_id=?`);
  const renameConversation = connection.prepare(`UPDATE conversations SET title=?,updated_at=?,last_activity_at=?
    WHERE user_id=? AND subject_id=? AND conversation_id=?`);
  const transitionCatalog = connection.prepare(`UPDATE personal_chat_conversations
    SET status=?,version=version+1,updated_at=?,archived_at=?,deleted_at=?
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND status=? AND version=?`);

  const findOperation = connection.prepare(`SELECT * FROM personal_chat_operations
    WHERE user_id=? AND assistant_id=? AND idempotency_key=?`);
  const findOperationById = connection.prepare(`SELECT * FROM personal_chat_operations
    WHERE operation_id=?`);
  const insertOperation = connection.prepare(`INSERT INTO personal_chat_operations
    (operation_id,user_id,assistant_id,idempotency_key,operation_type,content_hash,input_json,
     status,resource_type,external_call,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'processing',?,'not_performed',?,?)`);
  const completeOperation = connection.prepare(`UPDATE personal_chat_operations SET
    status=?,resource_type=?,resource_id=?,result_json=?,error_code=?,external_call=?,
    updated_at=?,completed_at=? WHERE operation_id=? AND status='processing'`);

  const insertTurnBranch = connection.prepare(`INSERT INTO personal_chat_turn_branches
    (turn_id,user_id,assistant_id,conversation_id,branch_id,created_at) VALUES(?,?,?,?,?,?)`);
  const findTurnBranch = connection.prepare(`SELECT * FROM personal_chat_turn_branches WHERE turn_id=?`);

  const insertVersionFact = connection.prepare(`INSERT INTO personal_chat_message_version_facts
    (message_version_id,user_id,assistant_id,conversation_id,message_id,branch_id,operation_id,
     version_kind,base_version_id,context_hash,model_id,provider_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const insertRegeneration = connection.prepare(`INSERT INTO personal_chat_regenerations
    (execution_id,operation_id,user_id,assistant_id,conversation_id,branch_id,message_id,
     base_version_id,model_id,provider_id,credential_binding_id,request_hash,context_hash,
     status,attempt_count,provider_call_may_have_started,started_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'prepared',0,0,?,?)`);
  const findRegeneration = connection.prepare(`SELECT * FROM personal_chat_regenerations
    WHERE operation_id=?`);
  const updateRegeneration = connection.prepare(`UPDATE personal_chat_regenerations SET
    status=?,attempt_count=?,provider_call_may_have_started=?,result_json=?,result_hash=?,
    response_content_hash=?,finish_reason=?,input_tokens=?,output_tokens=?,total_tokens=?,
    usage_status=?,cost_status=?,cost_amount_micros=?,cost_currency=?,message_version_id=?,
    error_code=?,updated_at=?,completed_at=? WHERE execution_id=? AND status=?`);

  const insertAttachment = connection.prepare(`INSERT INTO personal_chat_attachments
    (attachment_id,operation_id,user_id,assistant_id,conversation_id,file_name,media_type,kind,
     size_bytes,content_hash,storage_ref,managed_copy_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'ready',?)`);
  const findAttachment = connection.prepare(`SELECT * FROM personal_chat_attachments
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND attachment_id=?`);
  const listAttachmentsByIds = connection.prepare(`SELECT * FROM personal_chat_attachments
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND attachment_id IN (SELECT value FROM json_each(?))`);
  const listAttachmentsForVersion = connection.prepare(`SELECT * FROM personal_chat_attachments
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND message_version_id=?
      AND status='ready' ORDER BY created_at,attachment_id`);
  const attachAttachment = connection.prepare(`UPDATE personal_chat_attachments
    SET message_id=?,message_version_id=? WHERE attachment_id=? AND status='ready'
      AND message_version_id IS NULL`);
  const deleteAttachment = connection.prepare(`UPDATE personal_chat_attachments
    SET status='deleted',deleted_at=? WHERE attachment_id=? AND status='ready'
      AND message_version_id IS NULL`);

  const insertExport = connection.prepare(`INSERT INTO personal_chat_exports
    (export_id,operation_id,user_id,assistant_id,conversation_id,branch_id,format,file_name,
     media_type,content,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const findExport = connection.prepare(`SELECT * FROM personal_chat_exports WHERE operation_id=?`);
  const insertEvent = connection.prepare(`INSERT INTO personal_chat_events
    (chat_event_id,user_id,assistant_id,conversation_id,event_type,resource_id,event_data_json,occurred_at)
    VALUES(?,?,?,?,?,?,?,?)`);

  return Object.freeze({
    findConversation(userId, assistantId, conversationId) {
      return conversation(findConversation.get(userId, assistantId, conversationId));
    },
    listConversations(userId, assistantId) {
      return listConversations.all(userId, assistantId).map(conversation);
    },
    insertConversation(record) {
      return constrained(() => {
        insertRegistration.run(record.userId, record.assistantId, record.conversationId, record.createdAt);
        insertCatalog.run(record.conversationId, record.userId, record.assistantId,
          record.rootBranchId, record.createdAt, record.createdAt);
        insertBranch.run(record.rootBranchId, record.userId, record.assistantId,
          record.conversationId, null, null, 'Main', record.createdAt, record.createdAt);
        return conversation(findConversation.get(record.userId, record.assistantId, record.conversationId));
      }, 'Conversation registration conflicts with persisted scope.');
    },
    findSelection(userId, assistantId) {
      const row = findSelection.get(userId, assistantId);
      return row ? {conversationId: row.conversation_id, selectionVersion: row.selection_version, updatedAt: row.updated_at} : null;
    },
    selectConversation(userId, assistantId, conversationId, expectedVersion, updatedAt) {
      const result = upsertSelection.run(userId, assistantId, conversationId, updatedAt, expectedVersion);
      if (result.changes !== 1) throw new ConflictError('Conversation selection version conflicts.');
      return this.findSelection(userId, assistantId);
    },
    clearSelection(userId, assistantId, conversationId, updatedAt) {
      clearSelection.run(updatedAt, userId, assistantId, conversationId);
      return this.findSelection(userId, assistantId);
    },
    renameConversation(record) {
      const changed = renameConversation.run(record.title, record.updatedAt, record.updatedAt,
        record.userId, record.assistantId, record.conversationId);
      if (changed.changes !== 1) throw new ConflictError('Conversation rename conflicts.');
      const catalog = connection.prepare(`UPDATE personal_chat_conversations SET version=version+1,updated_at=?
        WHERE user_id=? AND assistant_id=? AND conversation_id=? AND status<>'deleted' AND version=?`)
        .run(record.updatedAt, record.userId, record.assistantId, record.conversationId, record.expectedVersion);
      if (catalog.changes !== 1) throw new ConflictError('Conversation version conflicts.');
      return conversation(findConversation.get(record.userId, record.assistantId, record.conversationId));
    },
    transitionConversation(record) {
      const archivedAt = record.status === 'archived' ? record.updatedAt : null;
      const deletedAt = record.status === 'deleted' ? record.updatedAt : null;
      const changed = transitionCatalog.run(record.status, record.updatedAt, archivedAt, deletedAt,
        record.userId, record.assistantId, record.conversationId, record.expectedStatus, record.expectedVersion);
      if (changed.changes !== 1) throw new ConflictError('Conversation state or version conflicts.');
      connection.prepare(`UPDATE conversations SET status=?,updated_at=?,last_activity_at=?
        WHERE user_id=? AND subject_id=? AND conversation_id=?`).run(
        record.status === 'active' ? 'active' : 'archived', record.updatedAt, record.updatedAt,
        record.userId, record.assistantId, record.conversationId,
      );
      return conversation(findConversation.get(record.userId, record.assistantId, record.conversationId));
    },
    findBranch(userId, assistantId, conversationId, branchId) {
      return branch(findBranch.get(userId, assistantId, conversationId, branchId));
    },
    listBranches(userId, assistantId, conversationId) {
      return listBranches.all(userId, assistantId, conversationId).map(branch);
    },
    insertBranch(record) {
      insertBranch.run(record.branchId, record.userId, record.assistantId, record.conversationId,
        record.parentBranchId, record.forkMessageId, record.title, record.createdAt, record.createdAt);
      for (const item of record.messages) insertBranchMessage.run(record.branchId, record.userId,
        record.assistantId, record.conversationId, item.messageId, item.messageVersionId,
        item.sequenceNumber, record.createdAt, record.createdAt);
      return branch(findBranch.get(record.userId, record.assistantId, record.conversationId, record.branchId));
    },
    setCurrentBranch(record) {
      const changed = setCatalogBranch.run(record.branchId, record.updatedAt, record.userId,
        record.assistantId, record.conversationId, record.expectedConversationVersion);
      if (changed.changes !== 1) throw new ConflictError('Conversation version conflicts.');
      return conversation(findConversation.get(record.userId, record.assistantId, record.conversationId));
    },
    listBranchMessages(userId, assistantId, conversationId, branchId, {includeHidden=false}={}) {
      const currentBranch = branch(findBranch.get(userId, assistantId, conversationId, branchId));
      if (!currentBranch) return [];
      return listBranchMessages.all(branchId, userId, assistantId, conversationId)
        .map(branchMessage)
        .filter(item => includeHidden || (!item.hidden && item.sequenceNumber > currentBranch.clearThroughSequence));
    },
    findBranchMessage(userId, assistantId, conversationId, branchId, messageId) {
      return branchMessage(findBranchMessage.get(branchId, userId, assistantId, conversationId, messageId));
    },
    insertBranchMessage(record) {
      return constrained(() => insertBranchMessage.run(record.branchId, record.userId,
        record.assistantId, record.conversationId, record.messageId, record.messageVersionId,
        record.sequenceNumber, record.createdAt, record.createdAt), 'Message is already linked to this branch.');
    },
    selectMessageVersion(record) {
      const changed = selectVersion.run(record.messageVersionId, record.updatedAt, record.branchId,
        record.userId, record.assistantId, record.conversationId, record.messageId, record.baseVersionId);
      if (changed.changes !== 1) throw new ConflictError('Message version selection conflicts.');
      return branchMessage(findBranchMessage.get(record.branchId, record.userId, record.assistantId,
        record.conversationId, record.messageId));
    },
    hideMessage(record) {
      const changed = hideMessage.run(record.updatedAt, record.branchId, record.userId,
        record.assistantId, record.conversationId, record.messageId);
      if (changed.changes !== 1) throw new ConflictError('Message visibility conflicts.');
    },
    bumpBranch(record) {
      const changed = updateBranchVersion.run(record.updatedAt, record.branchId, record.userId,
        record.assistantId, record.conversationId, record.expectedVersion);
      if (changed.changes !== 1) throw new ConflictError('Branch version conflicts.');
      touchCatalog.run(record.updatedAt, record.userId, record.assistantId, record.conversationId);
      return branch(findBranch.get(record.userId, record.assistantId, record.conversationId, record.branchId));
    },
    touchBranchForMessage(record) {
      touchBranchForMessage.run(record.updatedAt, record.branchId, record.userId,
        record.assistantId, record.conversationId);
      touchCatalog.run(record.updatedAt, record.userId, record.assistantId, record.conversationId);
    },
    clearBranch(record) {
      const changed = clearBranch.run(record.clearThroughSequence, record.updatedAt, record.branchId,
        record.userId, record.assistantId, record.conversationId, record.expectedVersion);
      if (changed.changes !== 1) throw new ConflictError('Branch version conflicts.');
      touchCatalog.run(record.updatedAt, record.userId, record.assistantId, record.conversationId);
      return branch(findBranch.get(record.userId, record.assistantId, record.conversationId, record.branchId));
    },
    findOperation(userId, assistantId, key) { return operation(findOperation.get(userId, assistantId, key)); },
    insertOperation(record) {
      return constrained(() => {
        insertOperation.run(record.operationId, record.userId, record.assistantId, record.idempotencyKey,
          record.operationType, record.contentHash, record.inputJson, record.resourceType,
          record.createdAt, record.createdAt);
        return operation(findOperationById.get(record.operationId));
      }, 'Idempotency-Key is already bound to another personal chat operation.');
    },
    completeOperation(record) {
      const changed = completeOperation.run(record.status, record.resourceType ?? null, record.resourceId ?? null,
        record.resultJson ?? null, record.errorCode ?? null, record.externalCall ?? 'not_performed',
        record.completedAt, record.completedAt, record.operationId);
      if (changed.changes !== 1) return operation(findOperationById.get(record.operationId));
      return operation(findOperationById.get(record.operationId));
    },
    linkTurn(record) { insertTurnBranch.run(record.turnId, record.userId, record.assistantId,
      record.conversationId, record.branchId, record.createdAt); },
    findTurnBranch(turnId) {
      const row = findTurnBranch.get(turnId);
      return row ? {turnId:row.turn_id,userId:row.user_id,assistantId:row.assistant_id,
        conversationId:row.conversation_id,branchId:row.branch_id,createdAt:row.created_at} : null;
    },
    insertVersionFact(record) { insertVersionFact.run(record.messageVersionId, record.userId,
      record.assistantId, record.conversationId, record.messageId, record.branchId, record.operationId,
      record.versionKind, record.baseVersionId, record.contextHash ?? null, record.modelId ?? null,
      record.providerId ?? null, record.createdAt); },
    insertRegeneration(record) { insertRegeneration.run(record.executionId, record.operationId,
      record.userId, record.assistantId, record.conversationId, record.branchId, record.messageId,
      record.baseVersionId, record.modelId, record.providerId, record.credentialBindingId,
      record.requestHash, record.contextHash, record.startedAt, record.startedAt);
      return regeneration(findRegeneration.get(record.operationId)); },
    findRegenerationByOperation(operationId) { return regeneration(findRegeneration.get(operationId)); },
    transitionRegeneration(executionId, expectedStatus, details) {
      updateRegeneration.run(details.status, details.attemptCount, details.providerCallMayHaveStarted?1:0,
        details.resultJson??null, details.resultHash??null, details.responseContentHash??null,
        details.finishReason??null, details.inputTokens??null, details.outputTokens??null,
        details.totalTokens??null, details.usageStatus??null, details.costStatus??null,
        details.costAmountMicros??null, details.costCurrency??null, details.messageVersionId??null,
        details.errorCode??null, details.updatedAt, details.completedAt??null, executionId, expectedStatus);
      return regeneration(connection.prepare('SELECT * FROM personal_chat_regenerations WHERE execution_id=?').get(executionId));
    },
    insertAttachment(record) { insertAttachment.run(record.attachmentId, record.operationId,
      record.userId, record.assistantId, record.conversationId, record.fileName, record.mediaType,
      record.kind, record.sizeBytes, record.sha256, record.storageRef, record.managedCopyId, record.createdAt);
      return attachment(findAttachment.get(record.userId,record.assistantId,record.conversationId,record.attachmentId)); },
    findAttachment(userId,assistantId,conversationId,attachmentId) {
      return attachment(findAttachment.get(userId,assistantId,conversationId,attachmentId));
    },
    listAttachments(userId,assistantId,conversationId,ids) {
      return ids.length ? listAttachmentsByIds.all(userId,assistantId,conversationId,JSON.stringify(ids)).map(attachment) : [];
    },
    listAttachmentsForVersion(userId,assistantId,conversationId,messageVersionId) {
      return listAttachmentsForVersion.all(userId,assistantId,conversationId,messageVersionId).map(attachment);
    },
    attachAttachments(records,messageId,messageVersionId) {
      for (const record of records) {
        const changed=attachAttachment.run(messageId,messageVersionId,record.attachmentId);
        if(changed.changes!==1)throw new ConflictError('Attachment is no longer available.');
      }
    },
    deleteAttachment(attachmentId,deletedAt) {
      const changed=deleteAttachment.run(deletedAt,attachmentId);
      if(changed.changes!==1)throw new ConflictError('Attachment cannot be removed.');
    },
    insertExport(record) { insertExport.run(record.exportId,record.operationId,record.userId,
      record.assistantId,record.conversationId,record.branchId,record.format,record.fileName,
      record.mediaType,record.content,record.contentHash,record.createdAt); return this.findExport(record.operationId); },
    findExport(operationId) { const row=findExport.get(operationId); return row?{
      exportId:row.export_id,operationId:row.operation_id,userId:row.user_id,assistantId:row.assistant_id,
      conversationId:row.conversation_id,branchId:row.branch_id,format:row.format,fileName:row.file_name,
      mediaType:row.media_type,content:row.content,contentHash:row.content_hash,createdAt:row.created_at}:null; },
    insertEvent(record) { insertEvent.run(record.eventId,record.userId,record.assistantId,
      record.conversationId??null,record.eventType,record.resourceId??null,
      JSON.stringify(record.data??{}),record.occurredAt); },
  });
}
