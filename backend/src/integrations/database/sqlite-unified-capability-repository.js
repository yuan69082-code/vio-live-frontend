import { ConflictError } from '../../core/errors.js';

function json(value) { return JSON.parse(value); }
function constrained(operation, message) {
  try { return operation(); } catch (error) {
    if (String(error?.message).includes('constraint failed') || error?.code?.startsWith?.('SQLITE_CONSTRAINT')) {
      throw new ConflictError(message);
    }
    throw error;
  }
}
function definition(row) { return row ? {
  capabilityId:row.capability_id,ownerUserId:row.owner_user_id,assistantId:row.assistant_id,category:row.category,
  registryId:row.registry_id,name:row.name,version:row.version,definition:json(row.definition_json),
  definitionHash:row.definition_hash,status:row.status,lifecycleStatus:row.lifecycle_status,
  createdAt:row.created_at,updatedAt:row.updated_at,
} : null; }
function execution(row) { return row ? {
  executionId:row.execution_id,ownerUserId:row.owner_user_id,assistantId:row.assistant_id,
  category:row.category,capabilityId:row.capability_id,capabilityVersion:row.capability_version,
  operationName:row.operation_name,idempotencyKey:row.idempotency_key,input:json(row.input_json),
  inputJson:row.input_json,inputHash:row.input_hash,sourceType:row.source_type,sourceId:row.source_id,
  status:row.status,confirmationId:row.confirmation_id,
  requestMayHaveBeenSent:Boolean(row.request_may_have_been_sent),errorCode:row.error_code,
  createdAt:row.created_at,updatedAt:row.updated_at,completedAt:row.completed_at,
} : null; }
function attempt(row) { return row ? {
  attemptId:row.attempt_id,executionId:row.execution_id,ownerUserId:row.owner_user_id,
  assistantId:row.assistant_id,attemptNumber:row.attempt_number,status:row.status,
  requestMayHaveBeenSent:Boolean(row.request_may_have_been_sent),errorCode:row.error_code,
  startedAt:row.started_at,completedAt:row.completed_at,
} : null; }
function usage(row) { return row ? {
  usageFactId:row.usage_fact_id,executionId:row.execution_id,attemptId:row.attempt_id,
  usageStatus:row.usage_status,inputTokens:row.input_tokens,outputTokens:row.output_tokens,
  totalTokens:row.total_tokens,costStatus:row.cost_status,costAmountMicros:row.cost_amount_micros,
  costCurrency:row.cost_currency,recordedAt:row.recorded_at,
} : null; }
function result(row) { return row ? {
  resultId:row.result_id,executionId:row.execution_id,attemptId:row.attempt_id,status:row.status,
  output:json(row.output_json),outputJson:row.output_json,contentHash:row.content_hash,createdAt:row.created_at,
} : null; }
function snapshot(row) { return row ? {
  snapshotId:row.snapshot_id,ownerUserId:row.owner_user_id,assistantId:row.assistant_id,capabilityId:row.capability_id,
  protocolVersion:row.protocol_version,tools:json(row.tools_json),toolsHash:row.tools_hash,
  ttlMs:row.ttl_ms,cacheScope:row.cache_scope,discoveredAt:row.discovered_at,
} : null; }

export function createSqliteUnifiedCapabilityRepository(connection) {
  const selectExecution='SELECT * FROM r6_unified_executions';
  const selectAttempt='SELECT * FROM r6_execution_attempts';
  return {
    insertDefinition(record) {
      constrained(()=>connection.prepare(`INSERT INTO r6_capability_definitions
        (capability_id,owner_user_id,assistant_id,category,registry_id,name,version,definition_json,definition_hash,status,lifecycle_status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.capabilityId,record.ownerUserId,record.assistantId,record.category,
        record.registryId,record.name,record.version,record.definitionJson,record.definitionHash,
        record.status,record.lifecycleStatus,record.createdAt,record.updatedAt),'R6 capability definition conflicts with existing facts.');
      return this.findDefinition(record.ownerUserId,record.assistantId,record.capabilityId);
    },
    findDefinition(userId,assistantId,capabilityId) {return definition(connection.prepare('SELECT * FROM r6_capability_definitions WHERE owner_user_id=? AND assistant_id=? AND capability_id=?').get(userId,assistantId,capabilityId));},
    findDefinitionByName(userId,assistantId,category,name) {return definition(connection.prepare('SELECT * FROM r6_capability_definitions WHERE owner_user_id=? AND assistant_id=? AND category=? AND name=?').get(userId,assistantId,category,name));},
    listDefinitions(userId,assistantId) {return connection.prepare('SELECT * FROM r6_capability_definitions WHERE owner_user_id=? AND assistant_id=? ORDER BY category,name,capability_id').all(userId,assistantId).map(definition);},
    updateDefinitionState(userId,assistantId,capabilityId,status,lifecycleStatus,updatedAt) {
      constrained(()=>connection.prepare('UPDATE r6_capability_definitions SET status=?,lifecycle_status=?,updated_at=? WHERE owner_user_id=? AND assistant_id=? AND capability_id=?').run(status,lifecycleStatus,updatedAt,userId,assistantId,capabilityId),'R6 capability lifecycle transition is not allowed.');
      return this.findDefinition(userId,assistantId,capabilityId);
    },
    findOperation(userId,assistantId,type,key) {const row=connection.prepare('SELECT * FROM r6_capability_operations WHERE owner_user_id=? AND assistant_id=? AND operation_type=? AND idempotency_key=?').get(userId,assistantId,type,key);return row?{operationId:row.operation_id,inputHash:row.input_hash,response:json(row.response_json),createdAt:row.created_at}:null;},
    insertOperation(record) {constrained(()=>connection.prepare('INSERT INTO r6_capability_operations(operation_id,owner_user_id,assistant_id,operation_type,idempotency_key,input_hash,response_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(record.operationId,record.ownerUserId,record.assistantId,record.operationType,record.idempotencyKey,record.inputHash,record.responseJson,record.createdAt),'R6 idempotency operation conflicts with existing facts.');return this.findOperation(record.ownerUserId,record.assistantId,record.operationType,record.idempotencyKey);},
    insertSnapshot(record) {constrained(()=>connection.prepare(`INSERT INTO r6_mcp_discovery_snapshots
      (snapshot_id,owner_user_id,assistant_id,capability_id,protocol_version,tools_json,tools_hash,ttl_ms,cache_scope,discovered_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      record.snapshotId,record.ownerUserId,record.assistantId,record.capabilityId,record.protocolVersion,record.toolsJson,record.toolsHash,record.ttlMs,record.cacheScope,record.discoveredAt),'R6 MCP discovery snapshot conflicts with existing facts.');return this.findSnapshot(record.ownerUserId,record.assistantId,record.capabilityId,record.snapshotId);},
    findSnapshot(userId,assistantId,capabilityId,snapshotId) {return snapshot(connection.prepare('SELECT * FROM r6_mcp_discovery_snapshots WHERE owner_user_id=? AND assistant_id=? AND capability_id=? AND snapshot_id=?').get(userId,assistantId,capabilityId,snapshotId));},
    latestSnapshot(userId,assistantId,capabilityId) {return snapshot(connection.prepare('SELECT * FROM r6_mcp_discovery_snapshots WHERE owner_user_id=? AND assistant_id=? AND capability_id=? ORDER BY discovered_at DESC,snapshot_id DESC LIMIT 1').get(userId,assistantId,capabilityId));},
    insertExecution(record) {constrained(()=>connection.prepare(`INSERT INTO r6_unified_executions
      (execution_id,owner_user_id,assistant_id,category,capability_id,capability_version,operation_name,idempotency_key,input_json,input_hash,source_type,source_id,status,confirmation_id,request_may_have_been_sent,error_code,created_at,updated_at,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.executionId,record.ownerUserId,record.assistantId,record.category,record.capabilityId,record.capabilityVersion,record.operationName,record.idempotencyKey,record.inputJson,record.inputHash,record.sourceType,record.sourceId??null,record.status,record.confirmationId??null,record.requestMayHaveBeenSent?1:0,record.errorCode??null,record.createdAt,record.updatedAt,record.completedAt??null),'R6 execution conflicts with persisted facts.');return this.findExecution(record.ownerUserId,record.assistantId,record.executionId);},
    findExecution(userId,assistantId,executionId) {return execution(connection.prepare(`${selectExecution} WHERE owner_user_id=? AND assistant_id=? AND execution_id=?`).get(userId,assistantId,executionId));},
    findExecutionById(executionId) {return execution(connection.prepare(`${selectExecution} WHERE execution_id=?`).get(executionId));},
    findExecutionByKey(userId,assistantId,key) {return execution(connection.prepare(`${selectExecution} WHERE owner_user_id=? AND assistant_id=? AND idempotency_key=?`).get(userId,assistantId,key));},
    findExecutionBySource(type,id) {return execution(connection.prepare(`${selectExecution} WHERE source_type=? AND source_id=?`).get(type,id));},
    listExecutions(userId,assistantId,{category=null,status=null,cursor=null,limit=50}={}) {
      const clauses=['owner_user_id=?','assistant_id=?'];const args=[userId,assistantId];
      if(category){clauses.push('category=?');args.push(category);}if(status){clauses.push('status=?');args.push(status);}
      if(cursor){clauses.push('(created_at < ? OR (created_at = ? AND execution_id < ?))');args.push(cursor.createdAt,cursor.createdAt,cursor.executionId);}
      args.push(limit);return connection.prepare(`${selectExecution} WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,execution_id DESC LIMIT ?`).all(...args).map(execution);
    },
    transitionExecution(executionId,expected,status,details={}) {
      const row=connection.prepare(`${selectExecution} WHERE execution_id=?`).get(executionId);if(!row||row.status!==expected)return null;
      const sent=details.requestMayHaveBeenSent===undefined?row.request_may_have_been_sent:(details.requestMayHaveBeenSent?1:0);
      constrained(()=>connection.prepare(`UPDATE r6_unified_executions SET status=?,confirmation_id=?,request_may_have_been_sent=?,error_code=?,updated_at=?,completed_at=? WHERE execution_id=? AND status=?`).run(status,details.confirmationId??null,sent,details.errorCode??null,details.updatedAt,row.completed_at??details.completedAt??null,executionId,expected),'R6 execution transition is not allowed.');
      return this.findExecutionById(executionId);
    },
    interruptInflight(now) {
      connection.prepare(`UPDATE r6_unified_executions SET status=CASE WHEN request_may_have_been_sent=1 THEN 'outcome_unknown' ELSE 'retryable' END,error_code='CAPABILITY_EXECUTION_INTERRUPTED',updated_at=? WHERE status='in_flight'`).run(now);
      connection.prepare(`UPDATE r6_execution_attempts SET status=CASE WHEN request_may_have_been_sent=1 THEN 'outcome_unknown' ELSE 'retryable' END,error_code='CAPABILITY_EXECUTION_INTERRUPTED',completed_at=? WHERE status='in_flight'`).run(now);
    },
    startAttempt(record) {const next=connection.prepare('SELECT COALESCE(MAX(attempt_number),0)+1 AS value FROM r6_execution_attempts WHERE execution_id=?').get(record.executionId).value;constrained(()=>connection.prepare(`INSERT INTO r6_execution_attempts(attempt_id,execution_id,owner_user_id,assistant_id,attempt_number,status,request_may_have_been_sent,error_code,started_at,completed_at) VALUES(?,?,?,?,?,'prepared',0,NULL,?,NULL)`).run(record.attemptId,record.executionId,record.ownerUserId,record.assistantId,next,record.startedAt),'R6 execution attempt conflicts with persisted facts.');return attempt(connection.prepare(`${selectAttempt} WHERE attempt_id=?`).get(record.attemptId));},
    latestAttempt(executionId) {return attempt(connection.prepare(`${selectAttempt} WHERE execution_id=? ORDER BY attempt_number DESC LIMIT 1`).get(executionId));},
    findAttempt(attemptId) {return attempt(connection.prepare(`${selectAttempt} WHERE attempt_id=?`).get(attemptId));},
    listAttempts(executionId) {return connection.prepare(`${selectAttempt} WHERE execution_id=? ORDER BY attempt_number`).all(executionId).map(attempt);},
    transitionAttempt(attemptId,expected,status,details={}) {const row=connection.prepare(`${selectAttempt} WHERE attempt_id=?`).get(attemptId);if(!row||row.status!==expected)return null;const sent=details.requestMayHaveBeenSent===undefined?row.request_may_have_been_sent:(details.requestMayHaveBeenSent?1:0);constrained(()=>connection.prepare('UPDATE r6_execution_attempts SET status=?,request_may_have_been_sent=?,error_code=?,completed_at=? WHERE attempt_id=? AND status=?').run(status,sent,details.errorCode??null,details.completedAt??null,attemptId,expected),'R6 attempt transition is not allowed.');return attempt(connection.prepare(`${selectAttempt} WHERE attempt_id=?`).get(attemptId));},
    insertStep(record) {constrained(()=>connection.prepare(`INSERT INTO r6_execution_steps(step_fact_id,execution_id,attempt_id,owner_user_id,assistant_id,step_number,step_id,category,capability_id,operation_name,status,input_hash,output_hash,error_code,started_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.stepFactId,record.executionId,record.attemptId,record.ownerUserId,record.assistantId,record.stepNumber,record.stepId,record.category,record.capabilityId,record.operationName,record.status,record.inputHash,record.outputHash??null,record.errorCode??null,record.startedAt,record.completedAt),'R6 step fact conflicts with persisted facts.');},
    listSteps(executionId) {return connection.prepare('SELECT * FROM r6_execution_steps WHERE execution_id=? ORDER BY step_number').all(executionId).map(row=>({stepFactId:row.step_fact_id,stepNumber:row.step_number,stepId:row.step_id,category:row.category,capabilityId:row.capability_id,operationName:row.operation_name,status:row.status,inputHash:row.input_hash,outputHash:row.output_hash,errorCode:row.error_code,startedAt:row.started_at,completedAt:row.completed_at}));},
    insertUsage(record) {constrained(()=>connection.prepare(`INSERT INTO r6_execution_usage_facts(usage_fact_id,execution_id,attempt_id,owner_user_id,assistant_id,usage_status,input_tokens,output_tokens,total_tokens,cost_status,cost_amount_micros,cost_currency,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.usageFactId,record.executionId,record.attemptId,record.ownerUserId,record.assistantId,record.usageStatus,record.inputTokens,record.outputTokens,record.totalTokens,record.costStatus,record.costAmountMicros??null,record.costCurrency??null,record.recordedAt),'R6 usage fact conflicts with persisted facts.');return this.findUsage(record.executionId);},
    findUsageByAttempt(attemptId) {return usage(connection.prepare('SELECT * FROM r6_execution_usage_facts WHERE attempt_id=?').get(attemptId));},
    findUsage(executionId) {return usage(connection.prepare('SELECT * FROM r6_execution_usage_facts WHERE execution_id=? ORDER BY recorded_at DESC LIMIT 1').get(executionId));},
    insertResult(record) {constrained(()=>connection.prepare(`INSERT INTO r6_execution_results(result_id,execution_id,attempt_id,owner_user_id,assistant_id,status,output_json,content_hash,created_at) VALUES(?,?,?,?,?,'succeeded',?,?,?)`).run(record.resultId,record.executionId,record.attemptId,record.ownerUserId,record.assistantId,record.outputJson,record.contentHash,record.createdAt),'R6 result conflicts with persisted facts.');return this.findResult(record.executionId);},
    findResult(executionId) {return result(connection.prepare('SELECT * FROM r6_execution_results WHERE execution_id=?').get(executionId));},
    insertStandaloneProjection(record) {constrained(()=>connection.prepare('INSERT INTO r6_standalone_execution_projections(standalone_execution_id,execution_id,owner_user_id,assistant_id,projected_at) VALUES(?,?,?,?,?)').run(record.standaloneExecutionId,record.executionId,record.ownerUserId,record.assistantId,record.projectedAt),'Standalone model execution was already projected.');},
    hasStandaloneProjection(id) {return Boolean(connection.prepare('SELECT 1 FROM r6_standalone_execution_projections WHERE standalone_execution_id=?').get(id));},
  };
}
