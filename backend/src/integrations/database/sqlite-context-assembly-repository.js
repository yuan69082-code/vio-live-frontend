import { ConflictError } from '../../core/errors.js';

function constrained(action, message) {
  try { return action(); } catch (error) {
    if (String(error?.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      throw new ConflictError(message);
    }
    throw error;
  }
}

const parse = value => value == null ? null : JSON.parse(value);

function settings(row) {
  return row ? {
    userId: row.user_id, assistantId: row.assistant_id,
    conversationId: row.conversation_id, mode: row.mode,
    excludedSourceRefs: parse(row.excluded_source_refs_json), version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
}

function operation(row) {
  return row ? {
    operationId: row.operation_id, userId: row.user_id, assistantId: row.assistant_id,
    idempotencyKey: row.idempotency_key, operationType: row.operation_type,
    contentHash: row.content_hash, input: parse(row.input_json), status: row.status,
    resourceType: row.resource_type, resourceId: row.resource_id,
    result: parse(row.result_json), errorCode: row.error_code,
    createdAt: row.created_at, completedAt: row.completed_at,
  } : null;
}

function controls(row) {
  return row ? {
    turnId: row.turn_id, userId: row.user_id, assistantId: row.assistant_id,
    conversationId: row.conversation_id, branchId: row.branch_id,
    mode: row.mode, controlsSource: row.controls_source,
    excludedSourceRefs: parse(row.excluded_source_refs_json),
    unavailableExcludedSourceRefs: parse(row.unavailable_excluded_source_refs_json),
    expectedPlanHash: row.expected_plan_hash, createdAt: row.created_at,
  } : null;
}

function summary(row) {
  return row ? {
    summaryId: row.summary_id, userId: row.user_id, assistantId: row.assistant_id,
    conversationId: row.conversation_id, branchId: row.branch_id,
    schemaVersion: row.schema_version, sourceSetHash: row.source_set_hash,
    status: row.status, structuredSummary: parse(row.structured_summary_json),
    contentHash: row.content_hash, failureCode: row.failure_code,
    attemptCount: row.attempt_count, createdAt: row.created_at,
    updatedAt: row.updated_at, completedAt: row.completed_at,
  } : null;
}

function assembly(row) {
  return row ? {
    assemblyId: row.assembly_id, turnId: row.turn_id, userId: row.user_id,
    assistantId: row.assistant_id, conversationId: row.conversation_id,
    branchId: row.branch_id, contractVersion: row.contract_version,
    schemaVersion: row.schema_version, mode: row.mode,
    controlsSource: row.controls_source,
    excludedSourceRefs: parse(row.excluded_source_refs_json), state: row.state,
    unavailableExcludedSourceRefs: parse(row.unavailable_excluded_source_refs_json),
    planHash: row.plan_hash, snapshotHash: row.snapshot_hash, modelId: row.model_id,
    estimationMethod: row.estimation_method, contextLimitTokens: row.context_limit_tokens,
    reservedOutputTokens: row.reserved_output_tokens,
    inputBudgetTokens: row.input_budget_tokens,
    rawEstimatedInputTokens: row.raw_estimated_input_tokens,
    estimatedInputTokens: row.estimated_input_tokens,
    trimmingApplied: row.trimming_applied === 1, trimmingReason: row.trimming_reason,
    foldingStatus: row.folding_status, summaryId: row.summary_id,
    runtimeProjectionStatus: row.runtime_projection_status,
    selection: parse(row.selection_json),
    snapshot: parse(row.snapshot_json), providerMessages: parse(row.provider_messages_json),
    providerMessagesHash: row.provider_messages_hash,
    failureCode: row.failure_code, createdAt: row.created_at, lockedAt: row.locked_at,
  } : null;
}

function source(row) {
  return row ? {
    assemblyId: row.assembly_id, sourcePhase: row.source_phase, sourceOrder: row.source_order,
    userId: row.user_id, assistantId: row.assistant_id,
    conversationId: row.conversation_id, branchId: row.branch_id,
    sourceRef: row.source_ref, sourceType: row.source_type, slot: row.slot,
    origin: row.origin, status: row.status, reason: row.reason,
    sourceConversationId: row.source_conversation_id,
    sourceBranchId: row.source_branch_id, messageId: row.message_id,
    messageVersionId: row.message_version_id, eventId: row.event_id,
    summaryId: row.summary_id, contentHash: row.content_hash,
    estimatedTokens: row.estimated_tokens, source: parse(row.source_json),
    evidence: parse(row.evidence_json), createdAt: row.created_at,
  } : null;
}

export function createSqliteContextAssemblyRepository(connection) {
  const findSettings = connection.prepare(`SELECT * FROM personal_context_conversation_settings
    WHERE user_id=? AND assistant_id=? AND conversation_id=?`);
  const insertSettings = connection.prepare(`INSERT INTO personal_context_conversation_settings
    (user_id,assistant_id,conversation_id,mode,excluded_source_refs_json,version,created_at,updated_at)
    VALUES(?,?,?,?,?,1,?,?)`);
  const updateSettings = connection.prepare(`UPDATE personal_context_conversation_settings
    SET mode=?,excluded_source_refs_json=?,version=version+1,updated_at=?
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND version=?`);
  const findOperation = connection.prepare(`SELECT * FROM personal_context_operations
    WHERE user_id=? AND assistant_id=? AND idempotency_key=?`);
  const findOperationById = connection.prepare(`SELECT * FROM personal_context_operations WHERE operation_id=?`);
  const insertOperation = connection.prepare(`INSERT INTO personal_context_operations
    (operation_id,user_id,assistant_id,idempotency_key,operation_type,content_hash,input_json,
     status,resource_type,created_at) VALUES(?,?,?,?,?,?,?,'processing',?,?)`);
  const completeOperation = connection.prepare(`UPDATE personal_context_operations SET
    status=?,resource_id=?,result_json=?,error_code=?,completed_at=?
    WHERE operation_id=? AND status='processing'`);
  const findSummary = connection.prepare(`SELECT * FROM personal_context_summaries
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND branch_id=? AND source_set_hash=?`);
  const findSummaryById = connection.prepare(`SELECT * FROM personal_context_summaries WHERE summary_id=?`);
  const listReadySummaries = connection.prepare(`SELECT * FROM personal_context_summaries
    WHERE user_id=? AND assistant_id=? AND conversation_id=? AND branch_id=? AND status='ready'
    ORDER BY completed_at DESC,summary_id DESC`);
  const insertSummary = connection.prepare(`INSERT INTO personal_context_summaries
    (summary_id,user_id,assistant_id,conversation_id,branch_id,schema_version,source_set_hash,
     status,attempt_count,created_at,updated_at) VALUES(?,?,?,?,?,'vio-context-summary/v1',?,'building',0,?,?)`);
  const findControls = connection.prepare(`SELECT * FROM personal_context_turn_controls WHERE turn_id=?`);
  const insertControls = connection.prepare(`INSERT INTO personal_context_turn_controls
    (turn_id,user_id,assistant_id,conversation_id,branch_id,mode,controls_source,
     excluded_source_refs_json,unavailable_excluded_source_refs_json,expected_plan_hash,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const updateSummary = connection.prepare(`UPDATE personal_context_summaries SET
    status=?,structured_summary_json=?,content_hash=?,failure_code=?,attempt_count=?,updated_at=?,completed_at=?
    WHERE summary_id=? AND status=?`);
  const restartSummary = connection.prepare(`UPDATE personal_context_summaries SET
    status='building',structured_summary_json=NULL,content_hash=NULL,failure_code=NULL,
    updated_at=?,completed_at=NULL WHERE summary_id=? AND status='failed'`);
  const insertSummarySource = connection.prepare(`INSERT INTO personal_context_summary_sources
    (summary_id,source_order,user_id,assistant_id,conversation_id,branch_id,source_ref,source_type,
     message_id,message_version_id,event_id,content_hash,source_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const listSummarySources = connection.prepare(`SELECT * FROM personal_context_summary_sources
    WHERE summary_id=? ORDER BY source_order`);
  const insertSummaryAttempt = connection.prepare(`INSERT INTO personal_context_summary_attempts
    (attempt_id,summary_id,attempt_number,status,error_code,started_at,completed_at)
    VALUES(?,?,?,?,?,?,?)`);
  const findAssemblyByTurn = connection.prepare(`SELECT * FROM personal_context_assemblies WHERE turn_id=?`);
  const findAssembly = connection.prepare(`SELECT * FROM personal_context_assemblies
    WHERE user_id=? AND assistant_id=? AND turn_id=?`);
  const insertAssembly = connection.prepare(`INSERT INTO personal_context_assemblies
    (assembly_id,turn_id,user_id,assistant_id,conversation_id,branch_id,contract_version,schema_version,
     mode,controls_source,excluded_source_refs_json,unavailable_excluded_source_refs_json,
     state,plan_hash,snapshot_hash,model_id,
     estimation_method,context_limit_tokens,reserved_output_tokens,input_budget_tokens,
     raw_estimated_input_tokens,
     estimated_input_tokens,trimming_applied,trimming_reason,folding_status,summary_id,
     runtime_projection_status,selection_json,snapshot_json,provider_messages_json,
     provider_messages_hash,failure_code,created_at,locked_at)
     VALUES(?,?,?,?,?,?,'vio-context-assembly/v1','vio-context-assembly-snapshot/v1',?,?,?,?,?,?,? ,?,
     'utf8-byte-upper-bound/v1',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const updateAssembly = connection.prepare(`UPDATE personal_context_assemblies SET
    state='locked',unavailable_excluded_source_refs_json=?,plan_hash=?,snapshot_hash=?,model_id=?,
    context_limit_tokens=?,reserved_output_tokens=?,input_budget_tokens=?,raw_estimated_input_tokens=?,
    estimated_input_tokens=?,trimming_applied=?,trimming_reason=?,folding_status=?,summary_id=?,
    runtime_projection_status=?,selection_json=?,snapshot_json=?,provider_messages_json=?,
    provider_messages_hash=?,failure_code=NULL,locked_at=? WHERE assembly_id=? AND state='fold_failed'`);
  const insertAssemblySource = connection.prepare(`INSERT INTO personal_context_assembly_sources
    (assembly_id,source_phase,source_order,user_id,assistant_id,conversation_id,branch_id,source_ref,source_type,
     slot,origin,status,reason,source_conversation_id,source_branch_id,message_id,message_version_id,
     event_id,summary_id,content_hash,estimated_tokens,source_json,evidence_json,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertMemorySourceLink = connection.prepare(`INSERT INTO personal_context_memory_source_links
    (assembly_id,source_phase,source_order,user_id,assistant_id,memory_id,memory_version_id,
     memory_content_hash,primary_source_ref,primary_source_content_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const listAssemblySources = connection.prepare(`SELECT * FROM personal_context_assembly_sources
    WHERE assembly_id=? AND source_phase=? ORDER BY source_order`);
  const findEvidence = connection.prepare(`SELECT * FROM personal_context_assembly_sources
    WHERE user_id=? AND assistant_id=? AND source_ref=?
    ORDER BY CASE source_phase WHEN 'locked' THEN 0 ELSE 1 END,
      created_at DESC,assembly_id DESC LIMIT 1`);
  const insertRecovery = connection.prepare(`INSERT INTO personal_context_recovery_actions
    (recovery_id,operation_id,assembly_id,turn_id,user_id,assistant_id,conversation_id,branch_id,
     action_type,status,created_at) VALUES(?,?,?,?,?,?,?,?,'retry_fold','pending',?)`);
  const completeRecovery = connection.prepare(`UPDATE personal_context_recovery_actions
    SET status=?,completed_at=? WHERE recovery_id=? AND status='pending'`);

  function insertAssemblySources(record, sourcePhase, sources) {
    sources.forEach((item, index) => {
      insertAssemblySource.run(record.assemblyId, sourcePhase, index,
        record.userId, record.assistantId, record.conversationId, record.branchId,
        item.sourceRef, item.sourceType, item.slot, item.origin, item.status,
        item.reason ?? null, item.sourceConversationId ?? null, item.sourceBranchId ?? null,
        item.messageId ?? null, item.messageVersionId ?? null, item.eventId ?? null,
        item.summaryId ?? null, item.contentHash, item.estimatedTokens,
        JSON.stringify(item.source), JSON.stringify(item.evidence), item.createdAt);
      if (item.sourceType === 'memory_slot') {
        insertMemorySourceLink.run(record.assemblyId, sourcePhase, index,
          record.userId, record.assistantId, item.evidence.memoryId,
          item.evidence.memoryVersionId, item.evidence.memoryContentHash,
          item.evidence.sourceRef, item.evidence.sourceContentHash);
      }
    });
  }

  return Object.freeze({
    findSettings(userId, assistantId, conversationId) {
      return settings(findSettings.get(userId, assistantId, conversationId));
    },
    saveSettings(record) {
      return constrained(() => {
        const existing = findSettings.get(record.userId, record.assistantId, record.conversationId);
        if (!existing) {
          if (record.expectedVersion !== 0) throw new ConflictError('Context settings version conflicts.');
          insertSettings.run(record.userId, record.assistantId, record.conversationId,
            record.mode, JSON.stringify(record.excludedSourceRefs), record.updatedAt, record.updatedAt);
        } else {
          const changed = updateSettings.run(record.mode, JSON.stringify(record.excludedSourceRefs),
            record.updatedAt, record.userId, record.assistantId, record.conversationId,
            record.expectedVersion);
          if (changed.changes !== 1) throw new ConflictError('Context settings version conflicts.');
        }
        return settings(findSettings.get(record.userId, record.assistantId, record.conversationId));
      }, 'Context settings version conflicts.');
    },
    findOperation(userId, assistantId, key) {
      return operation(findOperation.get(userId, assistantId, key));
    },
    insertOperation(record) {
      return constrained(() => {
        insertOperation.run(record.operationId, record.userId, record.assistantId,
          record.idempotencyKey, record.operationType, record.contentHash,
          JSON.stringify(record.input), record.resourceType, record.createdAt);
        return operation(findOperationById.get(record.operationId));
      }, 'Idempotency-Key is already bound to another context operation.');
    },
    completeOperation(record) {
      completeOperation.run(record.status, record.resourceId ?? null,
        record.result ? JSON.stringify(record.result) : null, record.errorCode ?? null,
        record.completedAt, record.operationId);
      return operation(findOperationById.get(record.operationId));
    },
    findTurnControls(turnId) { return controls(findControls.get(turnId)); },
    insertTurnControls(record) {
      return constrained(() => {
        insertControls.run(record.turnId, record.userId, record.assistantId,
          record.conversationId, record.branchId, record.mode, record.controlsSource,
          JSON.stringify(record.excludedSourceRefs),
          JSON.stringify(record.unavailableExcludedSourceRefs ?? []),
          record.expectedPlanHash ?? null,
          record.createdAt);
        return controls(findControls.get(record.turnId));
      }, 'Context controls conflict with the persisted turn.');
    },
    findSummary(userId, assistantId, conversationId, branchId, sourceSetHash) {
      return summary(findSummary.get(userId, assistantId, conversationId, branchId, sourceSetHash));
    },
    findSummaryById(summaryId) { return summary(findSummaryById.get(summaryId)); },
    listReadySummaries(userId, assistantId, conversationId, branchId) {
      return listReadySummaries.all(userId, assistantId, conversationId, branchId).map(summary);
    },
    insertSummary(record, sources) {
      insertSummary.run(record.summaryId, record.userId, record.assistantId,
        record.conversationId, record.branchId, record.sourceSetHash,
        record.createdAt, record.createdAt);
      sources.forEach((item, index) => insertSummarySource.run(record.summaryId, index,
        record.userId, record.assistantId, record.conversationId, record.branchId,
        item.sourceRef, item.sourceType, item.messageId ?? null,
        item.messageVersionId ?? null, item.eventId ?? null, item.contentHash,
        JSON.stringify(item.source)));
      return summary(findSummaryById.get(record.summaryId));
    },
    completeSummary(record) {
      const changed = updateSummary.run(record.status,
        record.structuredSummary ? JSON.stringify(record.structuredSummary) : null,
        record.contentHash ?? null, record.failureCode ?? null, record.attemptCount,
        record.completedAt, record.completedAt, record.summaryId, record.expectedStatus);
      if (changed.changes !== 1) throw new ConflictError('Context summary state conflicts.');
      return summary(findSummaryById.get(record.summaryId));
    },
    restartSummary(summaryId, updatedAt) {
      const changed = restartSummary.run(updatedAt, summaryId);
      if (changed.changes !== 1) throw new ConflictError('Context summary state conflicts.');
      return summary(findSummaryById.get(summaryId));
    },
    insertSummaryAttempt(record) {
      insertSummaryAttempt.run(record.attemptId, record.summaryId, record.attemptNumber,
        record.status, record.errorCode ?? null, record.startedAt, record.completedAt);
    },
    listSummarySources(summaryId) { return listSummarySources.all(summaryId).map(row => ({
      summaryId: row.summary_id, sourceOrder: row.source_order, sourceRef: row.source_ref,
      sourceType: row.source_type, messageId: row.message_id,
      messageVersionId: row.message_version_id, eventId: row.event_id,
      contentHash: row.content_hash, source: parse(row.source_json),
    })); },
    findAssemblyByTurn(turnId) { return assembly(findAssemblyByTurn.get(turnId)); },
    findAssembly(userId, assistantId, turnId) {
      return assembly(findAssembly.get(userId, assistantId, turnId));
    },
    insertAssembly(record, sources) {
      return constrained(() => {
        const sourcePhase = record.state === 'locked' ? 'locked' : 'failed_candidate';
        insertAssembly.run(record.assemblyId, record.turnId, record.userId, record.assistantId,
          record.conversationId, record.branchId, record.mode, record.controlsSource,
          JSON.stringify(record.excludedSourceRefs),
          JSON.stringify(record.unavailableExcludedSourceRefs ?? []), record.state, record.planHash,
          record.snapshotHash ?? null, record.modelId ?? null, record.contextLimitTokens,
          record.reservedOutputTokens, record.inputBudgetTokens, record.rawEstimatedInputTokens,
          record.estimatedInputTokens,
          record.trimmingApplied ? 1 : 0, record.trimmingReason ?? null,
          record.foldingStatus, record.summaryId ?? null, record.runtimeProjectionStatus,
          JSON.stringify(record.selection),
          record.snapshot ? JSON.stringify(record.snapshot) : null,
          record.providerMessages ? JSON.stringify(record.providerMessages) : null,
          record.providerMessagesHash ?? null,
          record.failureCode ?? null, record.createdAt, record.lockedAt ?? null);
        insertAssemblySources(record, sourcePhase, sources);
        return assembly(findAssemblyByTurn.get(record.turnId));
      }, 'Context assembly conflicts with an existing turn snapshot.');
    },
    replaceFailedAssembly(record, sources) {
      const changed = updateAssembly.run(JSON.stringify(record.unavailableExcludedSourceRefs ?? []),
        record.planHash, record.snapshotHash, record.modelId, record.contextLimitTokens,
        record.reservedOutputTokens, record.inputBudgetTokens, record.rawEstimatedInputTokens,
        record.estimatedInputTokens,
        record.trimmingApplied ? 1 : 0, record.trimmingReason ?? null,
        record.foldingStatus, record.summaryId ?? null, record.runtimeProjectionStatus,
        JSON.stringify(record.selection),
        JSON.stringify(record.snapshot), JSON.stringify(record.providerMessages),
        record.providerMessagesHash, record.lockedAt, record.assemblyId);
      if (changed.changes !== 1) throw new ConflictError('Context assembly state conflicts.');
      // The failed candidate set remains immutable; recovery appends a distinct locked set.
      insertAssemblySources(record, 'locked', sources);
      return assembly(findAssemblyByTurn.get(record.turnId));
    },
    listAssemblySources(assemblyId, sourcePhase = 'locked') {
      return listAssemblySources.all(assemblyId, sourcePhase).map(source);
    },
    findEvidence(userId, assistantId, sourceRef) {
      return source(findEvidence.get(userId, assistantId, sourceRef));
    },
    insertRecovery(record) {
      insertRecovery.run(record.recoveryId, record.operationId, record.assemblyId, record.turnId,
        record.userId, record.assistantId, record.conversationId, record.branchId, record.createdAt);
    },
    completeRecovery(recoveryId, status, completedAt) {
      completeRecovery.run(status, completedAt, recoveryId);
    },
  });
}
