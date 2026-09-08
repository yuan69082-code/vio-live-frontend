import {ApplicationError, ConflictError, NotFoundError, ValidationError} from '../../core/errors.js';
import {createId} from '../../core/ids.js';
import {canonicalizeJson, sha256Hash} from '../../core/canonical-json.js';
import {requireMessageContent} from '../messages/message-types.js';
import {fields, text} from '../personal/personal-validation.js';

const KEY=/^[A-Za-z0-9._:-]{8,128}$/;
const HASH=/^sha256:[0-9a-f]{64}$/;
const MAX_ATTACHMENT=10*1024*1024;
const MAX_TURN_ATTACHMENTS=20*1024*1024;
const ALLOWED_MEDIA={
  image:new Set(['image/png','image/jpeg','image/webp','image/gif']),
  audio:new Set(['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm']),
  file:new Set(['text/plain','text/markdown','application/pdf','application/json','application/zip','application/octet-stream']),
};
const OPERATION_RESOURCE_TYPES=Object.freeze({
  'conversation.create':'conversation','conversation.select':'conversation','conversation.rename':'conversation',
  'conversation.archive':'conversation','conversation.restore':'conversation','conversation.delete':'conversation',
  'conversation.export':'export','branch.create':'branch','branch.select':'branch','branch.clear':'branch',
  'message.edit':'messageVersion','message.regenerate':'messageVersion','message.version_select':'messageVersion',
  'message.hide':'message','attachment.create':'attachment','attachment.delete':'attachment',
});

function coded(code,message,statusCode=409){return new ApplicationError(message,{code,statusCode});}
function key(value){if(typeof value!=='string'||!KEY.test(value))throw new ValidationError('Invalid Idempotency-Key.',{field:'Idempotency-Key'});return value;}
function integer(value,name,{min=0,max=Number.MAX_SAFE_INTEGER}={}){if(!Number.isSafeInteger(value)||value<min||value>max)throw new ValidationError('Invalid integer.',{field:name});return value;}
function opaque(value,name){return text(value,name,128);}
function hashInput(input){return sha256Hash(canonicalizeJson(input));}
function resultJson(value){return canonicalizeJson(value).toString('utf8');}
function cursorSortValue(conversation,sort){
  if(sort.startsWith('updated_'))return conversation.updatedAt;
  if(sort.startsWith('created_'))return conversation.createdAt;
  return conversation.title;
}
function encodeConversationCursor(scope,conversation){
  return Buffer.from(canonicalizeJson({version:1,scopeHash:scope.scopeHash,
    conversationId:conversation.conversationId,sortValue:cursorSortValue(conversation,scope.sort)})).toString('base64url');
}
function decodeConversationCursor(value,scope){
  if(typeof value!=='string'||value.length<1||value.length>1024||!/^[A-Za-z0-9_-]+$/u.test(value)){
    throw coded('CONVERSATION_CURSOR_INVALID','Conversation cursor is invalid.',400);
  }
  try{
    const bytes=Buffer.from(value,'base64url');
    if(bytes.toString('base64url')!==value)throw new Error('non-canonical cursor');
    const decoded=JSON.parse(bytes.toString('utf8'));
    fields(decoded,['version','scopeHash','conversationId','sortValue'],['version','scopeHash','conversationId','sortValue']);
    if(decoded.version!==1||decoded.scopeHash!==scope.scopeHash||typeof decoded.sortValue!=='string'
      ||decoded.sortValue.length>512)return null;
    return {conversationId:opaque(decoded.conversationId,'cursor.conversationId'),sortValue:decoded.sortValue};
  }catch(error){
    if(error instanceof ValidationError)throw coded('CONVERSATION_CURSOR_INVALID','Conversation cursor is invalid.',400);
    if(error instanceof ApplicationError)throw error;
    throw coded('CONVERSATION_CURSOR_INVALID','Conversation cursor is invalid.',400);
  }
}
function publicOperation(value){return Object.freeze({
  operationId:value.operationId,operationType:value.operationType,idempotencyKey:value.idempotencyKey,
  status:value.status,resourceType:value.resourceType,resourceId:value.resourceId,error:value.errorCode?{code:value.errorCode}:null,
  result:value.result,createdAt:value.createdAt,updatedAt:value.updatedAt,completedAt:value.completedAt,externalCall:value.externalCall,
});}
function safeFileName(value){
  const name=text(value,'fileName',255);
  if(name==='.'||name==='..'||/[\\/:*?"<>|\u0000-\u001f]/u.test(name)||/^[A-Za-z]:/.test(name))throw new ValidationError('Unsafe attachment file name.',{field:'fileName'});
  return name;
}
function exactBase64(value){
  if(typeof value!=='string'||value.length>Math.ceil(MAX_ATTACHMENT/3)*4+8||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new ValidationError('Attachment content must be canonical Base64.',{field:'contentBase64'});
  const bytes=Buffer.from(value,'base64');
  if(bytes.toString('base64')!==value)throw new ValidationError('Attachment content must be canonical Base64.',{field:'contentBase64'});
  return bytes;
}

export function createMultiConversationService({
  repository,personalIdentityService,subjectRuntimeStatusService,conversationService,messageRepository,
  messageVersionRepository,standaloneChatService,modelRouterService,apiProviderService,securityService,
  proactiveInteractionService,modelExecutor,attachmentStore,runInTransaction,clock=()=>new Date(),idFactory=createId,
  managedCopies,faultInjector=null,
}){
  function scope(context){
    const runtime=subjectRuntimeStatusService.getStatus();
    if(runtime.mode!=='none')throw coded('STANDALONE_MODE_REQUIRED','Standalone chat requires independent mode.');
    personalIdentityService.assertSessionActive?.(context);
    const identity=personalIdentityService.identity(context.userId);
    if(!identity.current_assistant_id)throw coded('ASSISTANT_NOT_SELECTED','Select an assistant first.');
    const assistant=personalIdentityService.assistant(context.userId,identity.current_assistant_id);
    if(assistant.status!=='active')throw coded('ASSISTANT_NOT_SELECTED','The selected assistant is unavailable.');
    return {userId:context.userId,sessionId:context.sessionId,assistantId:assistant.assistantId,assistant};
  }
  function getConversation(s,conversationId,{includeDeleted=false}={}){
    const item=repository.findConversation(s.userId,s.assistantId,opaque(conversationId,'conversationId'));
    if(!item||(!includeDeleted&&item.status==='deleted'))throw coded('CONVERSATION_NOT_FOUND','Conversation was not found.',404);
    return item;
  }
  function getBranch(s,c,branchId){
    const item=repository.findBranch(s.userId,s.assistantId,c.conversationId,opaque(branchId,'branchId'));
    if(!item)throw coded('BRANCH_NOT_FOUND','Branch was not found.',404);return item;
  }
  function selection(s){return repository.findSelection(s.userId,s.assistantId)??{conversationId:null,selectionVersion:0,updatedAt:null};}
  function publicConversation(s,c){const selected=selection(s);return Object.freeze({
    conversationId:c.conversationId,title:c.title,status:c.status,version:c.version,
    isCurrent:selected.conversationId===c.conversationId,currentBranchId:c.currentBranchId,
    messageCount:c.messageCount,createdAt:c.createdAt,updatedAt:c.updatedAt,archivedAt:c.archivedAt,
  });}
  function publicBranch(c,b){return Object.freeze({
    branchId:b.branchId,parentBranchId:b.parentBranchId,forkMessageId:b.forkMessageId,title:b.title,
    version:b.version,conversationVersion:c.version,isCurrent:c.currentBranchId===b.branchId,
    createdAt:b.createdAt,updatedAt:b.updatedAt,
  });}
  function messageAttachments(s,c,messageVersionId){
    return repository.listAttachmentsForVersion?.(s.userId,s.assistantId,c.conversationId,messageVersionId)??[];
  }
  function publicAttachment(a){return Object.freeze({attachmentId:a.attachmentId,fileName:a.fileName,mediaType:a.mediaType,kind:a.kind,
    sizeBytes:a.sizeBytes,sha256:a.sha256,status:a.status,createdAt:a.createdAt,messageVersionId:a.messageVersionId});}
  function publicMessages(s,c,branchId){return repository.listBranchMessages(s.userId,s.assistantId,c.conversationId,branchId).map(m=>Object.freeze({
    messageId:m.messageId,messageVersionId:m.messageVersionId,senderType:m.senderType,content:m.content,
    sequenceNumber:m.sequenceNumber,createdAt:m.messageCreatedAt,versionCreatedAt:m.versionCreatedAt,
    versionKind:m.versionKind,attachmentIds:messageAttachments(s,c,m.messageVersionId).map(a=>a.attachmentId),hidden:false,
  }));}
  function begin(s,type,idempotencyKey,input){
    const resourceType=OPERATION_RESOURCE_TYPES[type];
    if(!resourceType)throw coded('OPERATION_TYPE_UNSUPPORTED','Personal chat operation type is unsupported.',500);
    const normalized=key(idempotencyKey);const inputJson=resultJson(input);const contentHash=hashInput(input);
    const existing=repository.findOperation(s.userId,s.assistantId,normalized);
    if(existing){
      if(existing.operationType!==type||existing.contentHash!==contentHash||existing.inputJson!==inputJson)throw coded('IDEMPOTENCY_CONFLICT','Idempotency-Key is bound to different facts.');
      return {existing,operation:null};
    }
    return {existing:null,operation:repository.insertOperation({operationId:idFactory(),userId:s.userId,assistantId:s.assistantId,
      idempotencyKey:normalized,operationType:type,resourceType,contentHash,inputJson,createdAt:clock().toISOString()})};
  }
  function finish(operation,data,{resourceType=null,resourceId=null,externalCall='not_performed',status='completed',errorCode=null}={}){
    return repository.completeOperation({operationId:operation.operationId,status,resourceType,resourceId,
      resultJson:data==null?null:resultJson(data),errorCode,externalCall,completedAt:clock().toISOString()});
  }
  function replay(result){if(result.existing){return result.existing.result??publicOperation(result.existing);}return null;}
  function event(s,c,type,resourceId,data={}){repository.insertEvent({eventId:idFactory(),userId:s.userId,assistantId:s.assistantId,
    conversationId:c?.conversationId??null,eventType:type,resourceId,data,occurredAt:clock().toISOString()});}
  function requireActive(c){if(c.status==='archived')throw coded('CONVERSATION_ARCHIVED','Conversation is archived.');if(c.status!=='active')throw coded('CONVERSATION_NOT_FOUND','Conversation was not found.',404);}

  function chatView(s,c){const b=getBranch(s,c,c.currentBranchId);const active=standaloneChatService.findActiveTurn?.(s.userId,s.assistantId,c.conversationId)??null;return Object.freeze({
    assistant:{assistantId:s.assistantId,name:s.assistant.name},conversation:publicConversation(s,c),selectionVersion:selection(s).selectionVersion,
    branch:publicBranch(c,b),messages:publicMessages(s,c,b.branchId),activeTurn:active,externalCall:'not_performed',
  });}

  function publishRegeneration(s,c,b,target,operation,execution){
    const providerFact=execution.result;
    const content=requireMessageContent(providerFact?.responseCandidate);
    const usage=providerFact?.usage;
    if(!Number.isSafeInteger(usage?.inputTokens)||!Number.isSafeInteger(usage?.outputTokens)||usage.totalTokens!==usage.inputTokens+usage.outputTokens)throw coded('PROVIDER_OUTCOME_UNKNOWN','Persisted Provider usage cannot be trusted.');
    return runInTransaction(()=>{
      const versions=messageVersionRepository.findMany(s.userId,s.assistantId,c.conversationId,target.messageId);
      const completedAt=execution.updatedAt??clock().toISOString();
      const version={messageVersionId:idFactory(),messageId:target.messageId,userId:s.userId,subjectId:s.assistantId,
        conversationId:c.conversationId,versionNumber:versions.at(-1).versionNumber+1,senderType:'subject',changeReason:'regenerated',
        content,parentVersionId:target.messageVersionId,createdAt:completedAt};
      messageVersionRepository.insert(version);messageRepository.setCurrentVersion(s.userId,s.assistantId,c.conversationId,target.messageId,
        {currentVersionId:version.messageVersionId,updatedAt:completedAt});
      repository.selectMessageVersion({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,
        messageId:target.messageId,baseVersionId:target.messageVersionId,messageVersionId:version.messageVersionId,updatedAt:completedAt});
      const updatedBranch=repository.bumpBranch({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,
        branchId:b.branchId,expectedVersion:b.version,updatedAt:completedAt});
      repository.insertVersionFact({messageVersionId:version.messageVersionId,userId:s.userId,assistantId:s.assistantId,
        conversationId:c.conversationId,messageId:target.messageId,branchId:b.branchId,operationId:operation.operationId,
        versionKind:'regenerated',baseVersionId:target.messageVersionId,contextHash:execution.contextHash,
        modelId:execution.modelId,providerId:execution.providerId,createdAt:completedAt});
      repository.transitionRegeneration(execution.executionId,'result_ready',{status:'completed',attemptCount:execution.attemptCount,
        providerCallMayHaveStarted:true,resultJson:execution.resultJson,resultHash:execution.resultHash,
        responseContentHash:execution.responseContentHash,finishReason:execution.finishReason,inputTokens:execution.inputTokens,
        outputTokens:execution.outputTokens,totalTokens:execution.totalTokens,usageStatus:execution.usageStatus,costStatus:execution.costStatus,
        costAmountMicros:execution.costAmountMicros,costCurrency:execution.costCurrency,messageVersionId:version.messageVersionId,
        updatedAt:completedAt,completedAt});
      event(s,c,'message_regenerated',version.messageVersionId,{messageId:target.messageId});
      const response={message:publicMessages(s,c,b.branchId).find(m=>m.messageId===target.messageId),branch:publicBranch(c,updatedBranch),
        execution:{executionId:execution.executionId,modelId:execution.modelId,providerId:execution.providerId,status:'completed',
          inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,totalTokens:usage.totalTokens,finishReason:execution.finishReason},externalCall:'performed'};
      finish(operation,response,{resourceType:'messageVersion',resourceId:version.messageVersionId,externalCall:'performed'});return response;
    });
  }

  async function regenerate(context,conversationId,messageId,value,idempotencyKey){
    const s=scope(context);fields(value,['branchId','baseVersionId','confirmationId','confirmationKind'],['branchId','baseVersionId']);
    const input={conversationId:opaque(conversationId,'conversationId'),messageId:opaque(messageId,'messageId'),
      branchId:opaque(value.branchId,'branchId'),baseVersionId:opaque(value.baseVersionId,'baseVersionId'),
      ...(value.confirmationId!==undefined?{confirmationId:opaque(value.confirmationId,'confirmationId'),confirmationKind:value.confirmationKind}: {})};
    if((value.confirmationId===undefined)!==(value.confirmationKind===undefined))throw new ValidationError('confirmationId and confirmationKind must be provided together.',{field:value.confirmationId===undefined?'confirmationId':'confirmationKind'});
    if(input.confirmationId&&!['budget','security'].includes(input.confirmationKind))throw new ValidationError('confirmationKind is required for a confirmation.',{field:'confirmationKind'});
    const started=runInTransaction(()=>begin(s,'message.regenerate',idempotencyKey,input));
    if(started.existing&&started.existing.status!=='processing')return replay(started);
    const operation=started.operation??started.existing;
    let c;let b;let target;let selected;let credential;let preparedExecution=null;let persistedExecution=null;
    try{
      c=getConversation(s,input.conversationId);requireActive(c);b=getBranch(s,c,input.branchId);
      target=repository.findBranchMessage(s.userId,s.assistantId,c.conversationId,b.branchId,input.messageId);
      if(!target||target.hidden)throw coded('MESSAGE_NOT_VISIBLE','Message is not visible.',404);
      if(target.senderType!=='subject')throw coded('MESSAGE_SENDER_MISMATCH','Only a subject message can be regenerated.');
      if(target.messageVersionId!==input.baseVersionId)throw coded('MESSAGE_VERSION_CONFLICT','baseVersionId is not selected on this branch.');
      const persisted=repository.findRegenerationByOperation(operation.operationId);persistedExecution=persisted;
      if(persisted?.status==='result_ready')return publishRegeneration(s,c,b,target,operation,persisted);
      if(persisted?.providerCallMayHaveStarted){
        if(!['outcome_unknown','completed','failed','cancelled'].includes(persisted.status))repository.transitionRegeneration(persisted.executionId,persisted.status,{...persisted,status:'outcome_unknown',errorCode:'PROCESS_INTERRUPTED',updatedAt:clock().toISOString(),completedAt:clock().toISOString()});
        const completed=finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:'outcome_unknown',errorCode:'PROVIDER_OUTCOME_UNKNOWN',externalCall:'outcome_unknown'});
        return publicOperation(completed);
      }
      if(persisted?.status==='prepared')preparedExecution=persisted;
      selected=modelRouterService.selectConfiguredDefaultModel(s.userId,'chat');
      if(selected.model.provider.interfaceFormat!=='openai_compatible')throw coded('PROVIDER_INTERFACE_UNSUPPORTED','Provider interface is unsupported.');
      credential=apiProviderService.getCredentialBindingForExecution(s.userId,selected.model.providerId);
    }catch(error){
      if(persistedExecution?.status==='result_ready')throw error;
      if(preparedExecution)repository.transitionRegeneration(preparedExecution.executionId,'prepared',{...preparedExecution,status:'failed',errorCode:error?.code??'REGENERATION_PREFLIGHT_FAILED',updatedAt:clock().toISOString(),completedAt:clock().toISOString()});
      if(operation.status==='processing')finish(operation,null,{resourceType:'messageVersion',resourceId:input.messageId,status:'failed',errorCode:error?.code??'REGENERATION_PREFLIGHT_FAILED'});
      throw error;
    }
    const visible=repository.listBranchMessages(s.userId,s.assistantId,c.conversationId,b.branchId)
      .filter(m=>m.sequenceNumber<target.sequenceNumber).slice(-24);
    const system={role:'system',content:`You are ${s.assistant.name}.`};
    const messages=[system,...visible.map(m=>({role:m.senderType==='user'?'user':'assistant',content:m.content}))];
    const contextHash=hashInput(messages);const requestHash=hashInput({modelId:selected.model.modelId,providerId:selected.model.providerId,messages,maxOutputTokens:4096});
    if(preparedExecution&&(preparedExecution.modelId!==selected.model.modelId||preparedExecution.providerId!==selected.model.providerId
      ||preparedExecution.credentialBindingId!==credential.credentialBindingId||preparedExecution.requestHash!==requestHash||preparedExecution.contextHash!==contextHash)){
      repository.transitionRegeneration(preparedExecution.executionId,'prepared',{...preparedExecution,status:'failed',errorCode:'REGENERATION_SNAPSHOT_CONFLICT',updatedAt:clock().toISOString(),completedAt:clock().toISOString()});
      finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:'failed',errorCode:'REGENERATION_SNAPSHOT_CONFLICT'});
      throw coded('REGENERATION_SNAPSHOT_CONFLICT','The persisted regeneration snapshot no longer matches current facts.');
    }
    const estimate=messages.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8'),0)+4096+512;
    let budget;
    try{const preview=proactiveInteractionService.previewTokenBudget(s.userId,s.assistantId,{estimatedTokens:estimate,budgetSessionId:c.conversationId});
      if(preview.decision==='confirm')budget=proactiveInteractionService.checkTokenBudget(s.userId,s.assistantId,{estimatedTokens:estimate,budgetSessionId:c.conversationId,
        securitySessionId:s.sessionId,...(input.confirmationKind==='budget'?{confirmationId:input.confirmationId}:{})});
      else{if(input.confirmationKind==='budget')throw new ValidationError('Budget confirmation is not applicable to the current budget.',{field:'confirmationId'});budget=preview;}}
    catch(error){if(preparedExecution)repository.transitionRegeneration(preparedExecution.executionId,'prepared',{...preparedExecution,status:'failed',errorCode:error?.code??'TOKEN_BUDGET_CHECK_FAILED',updatedAt:clock().toISOString(),completedAt:clock().toISOString()});finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:'failed',errorCode:error?.code??'TOKEN_BUDGET_CHECK_FAILED'});throw error;}
    if(budget.decision==='confirm'){
      const data={operationStatus:'confirmation_required',confirmation:{confirmationId:budget.security.confirmation.confirmationId,kind:'budget'},externalCall:'not_performed'};
      finish(operation,data,{resourceType:'messageVersion',resourceId:target.messageId,status:'failed',errorCode:'TOKEN_BUDGET_CONFIRMATION_REQUIRED'});return data;
    }
    if(budget.decision!=='allow'){
      finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:'failed',errorCode:budget.decision==='deny'?'TOKEN_BUDGET_BLOCKED':'TOKEN_BUDGET_DEFERRED'});
      throw coded(budget.decision==='deny'?'TOKEN_BUDGET_BLOCKED':'TOKEN_BUDGET_DEFERRED','Token budget does not currently allow regeneration.');
    }
    let security;
    try{security=securityService.checkSecurity(s.userId,{subjectId:null,resourceType:'api',resourceId:selected.model.providerId,
      action:'execute',operationType:'privacy_access_request',sensitiveDataCategories:['private_record'],securitySessionId:s.sessionId,
      ...(input.confirmationKind==='security'?{confirmationId:input.confirmationId}:{})},{minimumRiskLevel:'high'});}
    catch(error){if(preparedExecution)repository.transitionRegeneration(preparedExecution.executionId,'prepared',{...preparedExecution,status:'failed',errorCode:error?.code??'SECURITY_CHECK_FAILED',updatedAt:clock().toISOString(),completedAt:clock().toISOString()});finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:'failed',errorCode:error?.code??'SECURITY_CHECK_FAILED'});throw error;}
    if(security.decision==='confirm'){
      const data={operationStatus:'confirmation_required',confirmation:{confirmationId:security.confirmation.confirmationId,kind:'security'},externalCall:'not_performed'};
      finish(operation,data,{resourceType:'messageVersion',resourceId:target.messageId,status:'failed',errorCode:'SECURITY_CONFIRMATION_REQUIRED'});return data;
    }
    if(security.decision!=='allow'){
      finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:'failed',errorCode:'PERMISSION_DENIED'});
      throw coded('PERMISSION_DENIED','Security policy does not currently allow regeneration.');
    }
    let apiKey;
    try{apiKey=credential.resolveApiKey();}
    catch(error){if(preparedExecution)repository.transitionRegeneration(preparedExecution.executionId,'prepared',{...preparedExecution,status:'failed',errorCode:error?.code??'CREDENTIAL_UNAVAILABLE',updatedAt:clock().toISOString(),completedAt:clock().toISOString()});finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:'failed',errorCode:error?.code??'CREDENTIAL_UNAVAILABLE'});throw error;}
    const now=clock().toISOString();
    const execution=preparedExecution??runInTransaction(()=>repository.insertRegeneration({executionId:idFactory(),operationId:operation.operationId,
      userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,messageId:target.messageId,
      baseVersionId:target.messageVersionId,modelId:selected.model.modelId,providerId:selected.model.providerId,
      credentialBindingId:credential.credentialBindingId,requestHash,contextHash,startedAt:now}));
    let providerResult;
    try{
      providerResult=await modelExecutor.executeChat({provider:selected.model.provider,model:selected.model,messages,
        deadlineAt:new Date(clock().getTime()+60000).toISOString(),maxOutputCharacters:4096,maxOutputTokens:4096,
        apiKey,onRequestStart:()=>repository.transitionRegeneration(execution.executionId,'prepared',{status:'in_flight',attemptCount:1,
          providerCallMayHaveStarted:true,updatedAt:clock().toISOString()})});
    }catch{
      providerResult={status:'UNKNOWN',requestMayHaveBeenSent:true,errorCode:'PROVIDER_EXECUTION_INTERRUPTED',completedAt:clock().toISOString(),cost:{status:'not_reported'}};
    }
    const completedAt=providerResult.completedAt??clock().toISOString();
    if(providerResult.status!=='SUCCEEDED'){
      const unknown=providerResult.status==='UNKNOWN';
      const status=unknown?'outcome_unknown':providerResult.status==='FAILED_RETRYABLE'?'retryable':'failed';
      repository.transitionRegeneration(execution.executionId,'in_flight',{status,attemptCount:1,providerCallMayHaveStarted:Boolean(providerResult.requestMayHaveBeenSent),
        usageStatus:unknown?'unknown':'not_incurred',costStatus:providerResult.cost?.status??'not_reported',errorCode:providerResult.errorCode??'PROVIDER_TERMINAL_FAILURE',
        updatedAt:completedAt,completedAt});
      const op=finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:unknown?'outcome_unknown':'failed',
        errorCode:unknown?'PROVIDER_OUTCOME_UNKNOWN':providerResult.errorCode??'PROVIDER_TERMINAL_FAILURE',externalCall:unknown?'outcome_unknown':providerResult.requestMayHaveBeenSent?'performed':'not_performed'});
      return publicOperation(op);
    }
    let content;const usage=providerResult.usage;
    try{content=requireMessageContent(providerResult.output?.responseCandidate);if(!Number.isSafeInteger(usage?.inputTokens)||!Number.isSafeInteger(usage?.outputTokens)||usage.totalTokens!==usage.inputTokens+usage.outputTokens)throw coded('PROVIDER_OUTCOME_UNKNOWN','Provider usage cannot be trusted.');}
    catch(error){repository.transitionRegeneration(execution.executionId,'in_flight',{status:'outcome_unknown',attemptCount:1,providerCallMayHaveStarted:true,usageStatus:'unknown',costStatus:'not_reported',errorCode:'PROVIDER_OUTCOME_UNKNOWN',updatedAt:completedAt,completedAt});const op=finish(operation,null,{resourceType:'messageVersion',resourceId:target.messageId,status:'outcome_unknown',errorCode:'PROVIDER_OUTCOME_UNKNOWN',externalCall:'outcome_unknown'});return publicOperation(op);}
    const providerFact={schemaVersion:'vio-standalone-model-result/v1',responseCandidate:content,finishReason:text(providerResult.output?.finishReason,'finishReason',128),usage};
    const providerJson=resultJson(providerFact);const responseHash=sha256Hash(Buffer.from(content));
    const persisted=repository.transitionRegeneration(execution.executionId,'in_flight',{status:'result_ready',attemptCount:1,providerCallMayHaveStarted:true,
      resultJson:providerJson,resultHash:sha256Hash(Buffer.from(providerJson)),responseContentHash:responseHash,finishReason:providerFact.finishReason,
      inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,totalTokens:usage.totalTokens,usageStatus:'provider_reported',
      costStatus:providerResult.cost?.status??'not_reported',costAmountMicros:providerResult.cost?.amountMicros??null,
      costCurrency:providerResult.cost?.currency??null,updatedAt:completedAt});
    await faultInjector?.afterRegenerationResultPersisted?.({operationId:operation.operationId,executionId:execution.executionId});
    return publishRegeneration(s,c,b,target,operation,persisted);
  }

  return Object.freeze({
    createDefaultConversation(context) {
      const s = scope(context);
      const createdAt = clock().toISOString();
      const conversation = conversationService.createConversation(s.userId, s.assistantId, {
        title: `Chat with ${s.assistant.name}`,
      });
      repository.insertConversation({ conversationId: conversation.conversationId,
        userId: s.userId, assistantId: s.assistantId, rootBranchId: idFactory(),
        isR1Default: true, createdAt });
      return { conversationId: conversation.conversationId };
    },
    listConversations(context,params={}){const s=scope(context);const status=params.status??'active';if(!['active','archived','all'].includes(status))throw new ValidationError('Invalid status.',{field:'status'});
      const sort=params.sort??'updated_desc';if(!['updated_desc','updated_asc','created_desc','created_asc','title_asc'].includes(sort))throw new ValidationError('Invalid sort.',{field:'sort'});
      if(params.query!==undefined&&typeof params.query!=='string')throw new ValidationError('Invalid query.',{field:'query'});
      const rawQuery=(params.query??'').trim();if(rawQuery.length>120)throw new ValidationError('Invalid query.',{field:'query'});
      const query=rawQuery.toLocaleLowerCase();const limit=params.limit==null?50:integer(Number(params.limit),'limit',{min:1,max:100});
      let items=repository.listConversations(s.userId,s.assistantId).filter(c=>c.status!=='deleted'&&(status==='all'||c.status===status));
      if(query)items=items.filter(c=>c.title.toLocaleLowerCase().includes(query));const compare={updated_desc:(a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.conversationId.localeCompare(b.conversationId),
        updated_asc:(a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.conversationId.localeCompare(b.conversationId),created_desc:(a,b)=>b.createdAt.localeCompare(a.createdAt)||a.conversationId.localeCompare(b.conversationId),
        created_asc:(a,b)=>a.createdAt.localeCompare(b.createdAt)||a.conversationId.localeCompare(b.conversationId),title_asc:(a,b)=>a.title.localeCompare(b.title)||a.conversationId.localeCompare(b.conversationId)}[sort];
      items.sort(compare);const cursorScope={sort,scopeHash:hashInput({userId:s.userId,assistantId:s.assistantId,status,query,sort,limit})};let start=0;
      if(params.cursor!==undefined&&params.cursor!==null&&params.cursor!==''){
        const cursor=decodeConversationCursor(params.cursor,cursorScope);if(!cursor)throw coded('CONVERSATION_CURSOR_INVALID','Conversation cursor does not match this list.',400);
        const anchor=items.findIndex(item=>item.conversationId===cursor.conversationId&&cursorSortValue(item,sort)===cursor.sortValue);
        if(anchor<0)throw coded('CONVERSATION_CURSOR_INVALID','Conversation cursor does not match this list.',400);start=anchor+1;
      }
      const page=items.slice(start,start+limit);const nextCursor=start+page.length<items.length?encodeConversationCursor(cursorScope,page.at(-1)):null;
      return {assistant:{assistantId:s.assistantId,name:s.assistant.name},conversations:page.map(c=>publicConversation(s,c)),selectionVersion:selection(s).selectionVersion,nextCursor,externalCall:'not_performed'};},
    createConversation(context,value,idempotencyKey){const s=scope(context);fields(value,['title'],['title']);const input={title:text(value.title,'title',120)};
      return runInTransaction(()=>{const started=begin(s,'conversation.create',idempotencyKey,input);const old=replay(started);if(old)return old;
        const base=conversationService.createConversation(s.userId,s.assistantId,input);const c=repository.insertConversation({userId:s.userId,assistantId:s.assistantId,
          conversationId:base.conversationId,rootBranchId:idFactory(),createdAt:base.createdAt});event(s,c,'conversation_created',c.conversationId);
        const data={conversation:publicConversation(s,c),selectionVersion:selection(s).selectionVersion,externalCall:'not_performed'};
        finish(started.operation,data,{resourceType:'conversation',resourceId:c.conversationId});return data;});},
    getCurrent(context){const s=scope(context);const selected=selection(s);if(!selected.conversationId)return {assistant:{assistantId:s.assistantId,name:s.assistant.name},conversation:null,
      selectionVersion:selected.selectionVersion,messages:[],activeTurn:null,externalCall:'not_performed'};const c=getConversation(s,selected.conversationId);return chatView(s,c);},
    getConversation(context,conversationId){const s=scope(context);return chatView(s,getConversation(s,conversationId));},
    selectConversation(context,conversationId,value,idempotencyKey){const s=scope(context);fields(value,['expectedSelectionVersion'],['expectedSelectionVersion']);const c=getConversation(s,conversationId);requireActive(c);
      const input={conversationId:c.conversationId,expectedSelectionVersion:integer(value.expectedSelectionVersion,'expectedSelectionVersion')};return runInTransaction(()=>{const started=begin(s,'conversation.select',idempotencyKey,input);const old=replay(started);if(old)return old;
        const selected=repository.selectConversation(s.userId,s.assistantId,c.conversationId,input.expectedSelectionVersion,clock().toISOString());event(s,c,'conversation_selected',c.conversationId);
        const data={conversation:publicConversation(s,c),selectionVersion:selected.selectionVersion,externalCall:'not_performed'};finish(started.operation,data,{resourceType:'conversation',resourceId:c.conversationId});return data;});},
    renameConversation(context,conversationId,value,idempotencyKey){const s=scope(context);fields(value,['title','expectedVersion'],['title','expectedVersion']);const c=getConversation(s,conversationId);requireActive(c);
      const input={conversationId:c.conversationId,title:text(value.title,'title',120),expectedVersion:integer(value.expectedVersion,'expectedVersion',{min:1})};return runInTransaction(()=>{const started=begin(s,'conversation.rename',idempotencyKey,input);const old=replay(started);if(old)return old;
        const updated=repository.renameConversation({...input,userId:s.userId,assistantId:s.assistantId,updatedAt:clock().toISOString()});event(s,updated,'conversation_renamed',updated.conversationId);
        const data={conversation:publicConversation(s,updated),selectionVersion:selection(s).selectionVersion,externalCall:'not_performed'};finish(started.operation,data,{resourceType:'conversation',resourceId:updated.conversationId});return data;});},
    transitionConversation(context,conversationId,value,idempotencyKey,action){const s=scope(context);const deleting=action==='delete';fields(value,deleting?['expectedVersion','confirmation']:['expectedVersion'],deleting?['expectedVersion','confirmation']:['expectedVersion']);const c=getConversation(s,conversationId);
      const expectedStatus=action==='restore'?'archived':'active';if(c.status!==expectedStatus)throw coded(action==='archive'?'CONVERSATION_ARCHIVED':'CONVERSATION_VERSION_CONFLICT','Conversation state conflicts.');
      if(deleting&&value.confirmation!=='delete')throw coded('CONVERSATION_DELETE_CONFIRMATION_REQUIRED','Deletion confirmation is required.');const input={conversationId:c.conversationId,expectedVersion:integer(value.expectedVersion,'expectedVersion',{min:1}),...(deleting?{confirmation:'delete'}:{})};
      return runInTransaction(()=>{const started=begin(s,`conversation.${action}`,idempotencyKey,input);const old=replay(started);if(old)return old;const status={archive:'archived',restore:'active',delete:'deleted'}[action];const updated=repository.transitionConversation({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,
          expectedStatus,expectedVersion:input.expectedVersion,status,updatedAt:clock().toISOString()});if(status!=='active')repository.clearSelection(s.userId,s.assistantId,c.conversationId,clock().toISOString());event(s,updated,{archive:'conversation_archived',restore:'conversation_restored',delete:'conversation_deleted'}[action],updated.conversationId);
        const data={conversation:deleting?null:publicConversation(s,updated),conversationId:updated.conversationId,status:updated.status,selectionVersion:selection(s).selectionVersion,externalCall:'not_performed'};
        finish(started.operation,data,{resourceType:'conversation',resourceId:updated.conversationId});return data;});},
    listVersions(context,conversationId,messageId){const s=scope(context);const c=getConversation(s,conversationId);const msg=messageRepository.findById(s.userId,s.assistantId,c.conversationId,opaque(messageId,'messageId'));if(!msg)throw coded('MESSAGE_NOT_VISIBLE','Message not found.',404);
      return {messageId:msg.messageId,versions:messageVersionRepository.findMany(s.userId,s.assistantId,c.conversationId,msg.messageId).map(v=>({messageId:msg.messageId,messageVersionId:v.messageVersionId,senderType:v.senderType,
        content:v.content,versionNumber:v.versionNumber,versionKind:v.changeReason,parentVersionId:v.parentVersionId,createdAt:msg.createdAt,versionCreatedAt:v.createdAt})),externalCall:'not_performed'};},
    editMessage(context,conversationId,messageId,value,idempotencyKey){const s=scope(context);fields(value,['branchId','baseVersionId','content'],['branchId','baseVersionId','content']);const c=getConversation(s,conversationId);requireActive(c);const b=getBranch(s,c,value.branchId);
      const current=repository.findBranchMessage(s.userId,s.assistantId,c.conversationId,b.branchId,opaque(messageId,'messageId'));if(!current||current.hidden)throw coded('MESSAGE_NOT_VISIBLE','Message is not visible.',404);if(current.senderType!=='user')throw coded('MESSAGE_SENDER_MISMATCH','Only user messages can be edited.');
      const input={conversationId:c.conversationId,messageId:current.messageId,branchId:b.branchId,baseVersionId:opaque(value.baseVersionId,'baseVersionId'),content:requireMessageContent(value.content)};if(current.messageVersionId!==input.baseVersionId)throw coded('MESSAGE_VERSION_CONFLICT','baseVersionId is not selected.');
      return runInTransaction(()=>{const started=begin(s,'message.edit',idempotencyKey,input);const old=replay(started);if(old)return old;const versions=messageVersionRepository.findMany(s.userId,s.assistantId,c.conversationId,current.messageId);const now=clock().toISOString();const v={messageVersionId:idFactory(),messageId:current.messageId,userId:s.userId,subjectId:s.assistantId,
          conversationId:c.conversationId,versionNumber:versions.at(-1).versionNumber+1,senderType:'user',changeReason:'edited',content:input.content,parentVersionId:input.baseVersionId,createdAt:now};messageVersionRepository.insert(v);
        messageRepository.setCurrentVersion(s.userId,s.assistantId,c.conversationId,current.messageId,{currentVersionId:v.messageVersionId,updatedAt:now});repository.selectMessageVersion({userId:s.userId,assistantId:s.assistantId,
          conversationId:c.conversationId,branchId:b.branchId,messageId:current.messageId,baseVersionId:input.baseVersionId,messageVersionId:v.messageVersionId,updatedAt:now});const updatedBranch=repository.bumpBranch({userId:s.userId,
          assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,expectedVersion:b.version,updatedAt:now});repository.insertVersionFact({messageVersionId:v.messageVersionId,userId:s.userId,assistantId:s.assistantId,
          conversationId:c.conversationId,messageId:current.messageId,branchId:b.branchId,operationId:started.operation.operationId,versionKind:'edited',baseVersionId:input.baseVersionId,createdAt:now});event(s,c,'message_edited',v.messageVersionId,{messageId:current.messageId});
        const data={message:publicMessages(s,c,b.branchId).find(m=>m.messageId===current.messageId),branch:publicBranch(c,updatedBranch),externalCall:'not_performed'};finish(started.operation,data,{resourceType:'messageVersion',resourceId:v.messageVersionId});return data;});},
    regenerate,
    selectMessageVersion(context,conversationId,messageId,value,idempotencyKey){const s=scope(context);fields(value,['branchId','messageVersionId','expectedBranchVersion'],['branchId','messageVersionId','expectedBranchVersion']);const c=getConversation(s,conversationId);requireActive(c);const b=getBranch(s,c,value.branchId);const current=repository.findBranchMessage(s.userId,s.assistantId,c.conversationId,b.branchId,messageId);if(!current||current.hidden)throw coded('MESSAGE_NOT_VISIBLE','Message is not visible.',404);
      const version=messageVersionRepository.findById(s.userId,s.assistantId,c.conversationId,current.messageId,opaque(value.messageVersionId,'messageVersionId'));if(!version||version.senderType!==current.senderType)throw coded('MESSAGE_VERSION_SCOPE_MISMATCH','Message version is outside this message.');
      const input={conversationId:c.conversationId,messageId:current.messageId,branchId:b.branchId,messageVersionId:version.messageVersionId,expectedBranchVersion:integer(value.expectedBranchVersion,'expectedBranchVersion',{min:1})};return runInTransaction(()=>{const started=begin(s,'message.version_select',idempotencyKey,input);const old=replay(started);if(old)return old;
        repository.selectMessageVersion({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,messageId:current.messageId,baseVersionId:current.messageVersionId,messageVersionId:version.messageVersionId,updatedAt:clock().toISOString()});const updated=repository.bumpBranch({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,expectedVersion:input.expectedBranchVersion,updatedAt:clock().toISOString()});event(s,c,'message_version_selected',version.messageVersionId,{messageId:current.messageId});
        const data={message:publicMessages(s,c,b.branchId).find(m=>m.messageId===current.messageId),branch:publicBranch(c,updated),externalCall:'not_performed'};finish(started.operation,data,{resourceType:'messageVersion',resourceId:version.messageVersionId});return data;});},
    hideMessage(context,conversationId,messageId,value,idempotencyKey){const s=scope(context);fields(value,['branchId','expectedBranchVersion'],['branchId','expectedBranchVersion']);const c=getConversation(s,conversationId);requireActive(c);const b=getBranch(s,c,value.branchId);const input={conversationId:c.conversationId,messageId:opaque(messageId,'messageId'),branchId:b.branchId,expectedBranchVersion:integer(value.expectedBranchVersion,'expectedBranchVersion',{min:1})};
      return runInTransaction(()=>{const started=begin(s,'message.hide',idempotencyKey,input);const old=replay(started);if(old)return old;repository.hideMessage({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,messageId:input.messageId,updatedAt:clock().toISOString()});const updated=repository.bumpBranch({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,expectedVersion:input.expectedBranchVersion,updatedAt:clock().toISOString()});event(s,c,'message_hidden',input.messageId);
        const data={messageId:input.messageId,hidden:true,branch:publicBranch(c,updated),externalCall:'not_performed'};finish(started.operation,data,{resourceType:'message',resourceId:input.messageId});return data;});},
    listBranches(context,conversationId){const s=scope(context);const c=getConversation(s,conversationId);return {conversationId:c.conversationId,conversationVersion:c.version,branches:repository.listBranches(s.userId,s.assistantId,c.conversationId).map(b=>publicBranch(c,b)),externalCall:'not_performed'};},
    createBranch(context,conversationId,value,idempotencyKey){const s=scope(context);fields(value,['sourceBranchId','restartAfterMessageId','title'],['sourceBranchId','restartAfterMessageId','title']);const c=getConversation(s,conversationId);requireActive(c);const source=getBranch(s,c,value.sourceBranchId);const messages=repository.listBranchMessages(s.userId,s.assistantId,c.conversationId,source.branchId);const pivot=messages.find(m=>m.messageId===value.restartAfterMessageId);if(!pivot)throw coded('MESSAGE_NOT_VISIBLE','Restart point is not visible.',404);
      const input={conversationId:c.conversationId,sourceBranchId:source.branchId,restartAfterMessageId:pivot.messageId,title:text(value.title,'title',120)};return runInTransaction(()=>{const started=begin(s,'branch.create',idempotencyKey,input);const old=replay(started);if(old)return old;const now=clock().toISOString();const b=repository.insertBranch({branchId:idFactory(),userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,parentBranchId:source.branchId,
          forkMessageId:pivot.messageId,title:input.title,messages:messages.filter(m=>m.sequenceNumber<=pivot.sequenceNumber),createdAt:now});const updatedConversation=repository.setCurrentBranch({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,expectedConversationVersion:c.version,updatedAt:now});event(s,c,'branch_created',b.branchId,{parentBranchId:source.branchId});
        const data={conversation:publicConversation(s,updatedConversation),branch:publicBranch(updatedConversation,b),externalCall:'not_performed'};finish(started.operation,data,{resourceType:'branch',resourceId:b.branchId});return data;});},
    selectBranch(context,conversationId,branchId,value,idempotencyKey){const s=scope(context);fields(value,['expectedConversationVersion'],['expectedConversationVersion']);const c=getConversation(s,conversationId);requireActive(c);const b=getBranch(s,c,branchId);const input={conversationId:c.conversationId,branchId:b.branchId,expectedConversationVersion:integer(value.expectedConversationVersion,'expectedConversationVersion',{min:1})};return runInTransaction(()=>{const started=begin(s,'branch.select',idempotencyKey,input);const old=replay(started);if(old)return old;
        const updated=repository.setCurrentBranch({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,expectedConversationVersion:input.expectedConversationVersion,updatedAt:clock().toISOString()});event(s,c,'branch_selected',b.branchId);const data={conversation:publicConversation(s,updated),branch:publicBranch(updated,b),externalCall:'not_performed'};finish(started.operation,data,{resourceType:'branch',resourceId:b.branchId});return data;});},
    clearBranch(context,conversationId,value,idempotencyKey){const s=scope(context);fields(value,['branchId','expectedBranchVersion'],['branchId','expectedBranchVersion']);const c=getConversation(s,conversationId);requireActive(c);const b=getBranch(s,c,value.branchId);const visible=repository.listBranchMessages(s.userId,s.assistantId,c.conversationId,b.branchId);const input={conversationId:c.conversationId,branchId:b.branchId,expectedBranchVersion:integer(value.expectedBranchVersion,'expectedBranchVersion',{min:1})};return runInTransaction(()=>{const started=begin(s,'branch.clear',idempotencyKey,input);const old=replay(started);if(old)return old;const updated=repository.clearBranch({userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,expectedVersion:input.expectedBranchVersion,
          clearThroughSequence:visible.at(-1)?.sequenceNumber??b.clearThroughSequence,updatedAt:clock().toISOString()});event(s,c,'branch_cleared',b.branchId);const data={branch:publicBranch(c,updated),messages:[],externalCall:'not_performed'};finish(started.operation,data,{resourceType:'branch',resourceId:b.branchId});return data;});},
    async createTurn(context,conversationId,value,idempotencyKey){const s=scope(context);fields(value,['branchId','content','attachmentIds','context'],['branchId','content','attachmentIds']);const c=getConversation(s,conversationId);requireActive(c);const b=getBranch(s,c,value.branchId);if(!Array.isArray(value.attachmentIds)||new Set(value.attachmentIds).size!==value.attachmentIds.length)throw new ValidationError('attachmentIds must be a unique array.',{field:'attachmentIds'});const ids=value.attachmentIds.map((id,i)=>opaque(id,`attachmentIds[${i}]`));const attachments=repository.listAttachments(s.userId,s.assistantId,c.conversationId,ids);if(attachments.length!==ids.length||attachments.some(a=>a.status!=='ready'||a.messageVersionId))throw coded('ATTACHMENT_SCOPE_MISMATCH','Attachment is unavailable for this turn.');if(attachments.reduce((n,a)=>n+a.sizeBytes,0)>MAX_TURN_ATTACHMENTS)throw coded('ATTACHMENT_TOO_LARGE','Turn attachments exceed 20 MiB.',413);
      return standaloneChatService.createConversationTurn(context,{content:requireMessageContent(value.content),branchId:b.branchId,attachmentIds:ids,context:value.context},idempotencyKey,{conversationId:c.conversationId,branchId:b.branchId,attachments});},
    findActiveTurn(userId,assistantId,conversationId){return standaloneChatService.findActiveTurn?.(userId,assistantId,conversationId)??null;},
    createAttachment(context,conversationId,value,idempotencyKey){const s=scope(context);fields(value,['fileName','mediaType','kind','sizeBytes','sha256','contentBase64'],['fileName','mediaType','kind','sizeBytes','sha256','contentBase64']);const c=getConversation(s,conversationId);requireActive(c);if(!['image','file','audio'].includes(value.kind))throw new ValidationError('Unsupported attachment kind.',{field:'kind'});const mediaType=text(value.mediaType,'mediaType',128).toLowerCase();if(!ALLOWED_MEDIA[value.kind].has(mediaType))throw coded('ATTACHMENT_MEDIA_TYPE_UNSUPPORTED','Attachment media type is unsupported.',415);const bytes=exactBase64(value.contentBase64);const size=integer(value.sizeBytes,'sizeBytes',{max:MAX_ATTACHMENT});if(bytes.length!==size)throw coded('ATTACHMENT_CONTENT_INVALID','Attachment size does not match.');if(typeof value.sha256!=='string'||!HASH.test(value.sha256)||sha256Hash(bytes)!==value.sha256)throw coded('ATTACHMENT_CONTENT_INVALID','Attachment hash does not match.');const input={conversationId:c.conversationId,fileName:safeFileName(value.fileName),mediaType,kind:value.kind,sizeBytes:size,sha256:value.sha256};
      const started=runInTransaction(()=>begin(s,'attachment.create',idempotencyKey,input));const old=replay(started);if(old)return old;const attachmentId=idFactory();const storageRef=hashInput({attachmentId,sha256:value.sha256}).slice(7);try{attachmentStore.put(storageRef,bytes);const data=runInTransaction(()=>{const copy=managedCopies.register({ownerUserId:s.userId,kind:'file',rootPath:attachmentStore.root,relativePath:`${storageRef.slice(0,2)}/${storageRef}`});const a=repository.insertAttachment({attachmentId,operationId:started.operation.operationId,userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,
            fileName:input.fileName,mediaType,kind:value.kind,sizeBytes:size,sha256:value.sha256,storageRef,managedCopyId:copy.copyId,createdAt:clock().toISOString()});event(s,c,'attachment_created',a.attachmentId);const response={attachment:publicAttachment(a),externalCall:'not_performed'};finish(started.operation,response,{resourceType:'attachment',resourceId:a.attachmentId});return response;});return data;}catch(error){try{attachmentStore.remove(storageRef);}catch{}finish(started.operation,null,{resourceType:'attachment',resourceId:attachmentId,status:'failed',errorCode:'ATTACHMENT_STORAGE_UNAVAILABLE'});throw coded('ATTACHMENT_STORAGE_UNAVAILABLE','Attachment could not be stored.',500);}},
    getAttachment(context,conversationId,attachmentId,{content=false}={}){const s=scope(context);const c=getConversation(s,conversationId);const a=repository.findAttachment(s.userId,s.assistantId,c.conversationId,opaque(attachmentId,'attachmentId'));if(!a||a.status!=='ready')throw coded('ATTACHMENT_NOT_FOUND','Attachment not found.',404);if(!content)return {attachment:publicAttachment(a),externalCall:'not_performed'};let bytes;try{bytes=attachmentStore.read(a.storageRef);}catch{throw coded('ATTACHMENT_STORAGE_INCONSISTENT','Attachment storage is inconsistent.',500);}if(bytes.length!==a.sizeBytes||sha256Hash(bytes)!==a.sha256)throw coded('ATTACHMENT_STORAGE_INCONSISTENT','Attachment storage is inconsistent.',500);return {attachmentId:a.attachmentId,fileName:a.fileName,mediaType:a.mediaType,sizeBytes:a.sizeBytes,contentBase64:bytes.toString('base64'),externalCall:'not_performed'};},
    deleteAttachment(context,conversationId,attachmentId,value,idempotencyKey){const s=scope(context);fields(value,[]);const c=getConversation(s,conversationId);const a=repository.findAttachment(s.userId,s.assistantId,c.conversationId,attachmentId);if(!a||a.status!=='ready')throw coded('ATTACHMENT_NOT_FOUND','Attachment not found.',404);const input={conversationId:c.conversationId,attachmentId:a.attachmentId};const started=runInTransaction(()=>begin(s,'attachment.delete',idempotencyKey,input));const old=replay(started);if(old)return old;if(a.messageVersionId)throw coded('ATTACHMENT_ALREADY_LINKED','Linked attachment cannot be removed.');managedCopies.remove({ownerUserId:s.userId,copyId:a.managedCopyId});return runInTransaction(()=>{repository.deleteAttachment(a.attachmentId,clock().toISOString());event(s,c,'attachment_deleted',a.attachmentId);const data={attachmentId:a.attachmentId,status:'deleted',externalCall:'not_performed'};finish(started.operation,data,{resourceType:'attachment',resourceId:a.attachmentId});return data;});},
    exportConversation(context,conversationId,value,idempotencyKey){const s=scope(context);fields(value,['format'],['format']);if(!['json','markdown'].includes(value.format))throw new ValidationError('Unsupported export format.',{field:'format'});const c=getConversation(s,conversationId);const b=getBranch(s,c,c.currentBranchId);const input={conversationId:c.conversationId,branchId:b.branchId,format:value.format};return runInTransaction(()=>{const started=begin(s,'conversation.export',idempotencyKey,input);const old=replay(started);if(old)return old;const messages=publicMessages(s,c,b.branchId);const ids=[...new Set(messages.flatMap(message=>message.attachmentIds))];const attachments=repository.listAttachments(s.userId,s.assistantId,c.conversationId,ids).filter(item=>item.status==='ready').map(publicAttachment);const createdAt=clock().toISOString();const content=value.format==='json'?JSON.stringify({schemaVersion:'vio-personal-conversation-export/v1',conversation:{conversationId:c.conversationId,title:c.title},branch:{branchId:b.branchId,title:b.title},messages,attachments},null,2):[`# ${c.title}`,'',...messages.map(m=>{const names=attachments.filter(a=>m.attachmentIds.includes(a.attachmentId)).map(a=>a.fileName);return `**${m.senderType==='user'?'User':'Assistant'}**\n\n${m.content}${names.length?`\n\nAttachments: ${names.join(', ')}`:''}`;})].join('\n\n');
        const exportFact=repository.insertExport({exportId:idFactory(),operationId:started.operation.operationId,userId:s.userId,assistantId:s.assistantId,conversationId:c.conversationId,branchId:b.branchId,format:value.format,
          fileName:`conversation-${c.conversationId}.${value.format==='json'?'json':'md'}`,mediaType:value.format==='json'?'application/json':'text/markdown',content,contentHash:sha256Hash(Buffer.from(content)),createdAt});event(s,c,'conversation_exported',exportFact.exportId);
        const data={export:{exportId:exportFact.exportId,fileName:exportFact.fileName,mediaType:exportFact.mediaType,content:exportFact.content,sha256:exportFact.contentHash,createdAt:exportFact.createdAt},externalCall:'not_performed'};finish(started.operation,data,{resourceType:'export',resourceId:exportFact.exportId});return data;});},
    getOperation(context,idempotencyKey){const s=scope(context);const op=repository.findOperation(s.userId,s.assistantId,key(idempotencyKey));if(op)return publicOperation(op);const turn=standaloneChatService.getTurnByIdempotencyKey(context,idempotencyKey);return {operationId:turn.turnId,operationType:'turn.create',idempotencyKey,status:turn.status==='completed'?'completed':turn.status,
      resourceType:'turn',resourceId:turn.turnId,error:turn.error,result:turn,createdAt:turn.createdAt,updatedAt:turn.updatedAt,completedAt:turn.completedAt,externalCall:turn.externalCall};},
    providerMessagesForTurn(turn){const link=repository.findTurnBranch(turn.turnId);if(!link)return null;return repository.listBranchMessages(turn.userId,turn.assistantId,turn.conversationId,link.branchId).slice(-25).map(m=>({role:m.senderType==='user'?'user':'assistant',content:m.content}));},
    findTurnBinding(turnId){return repository.findTurnBranch(turnId);},
    findConversationBinding(userId,assistantId,conversationId){const c=repository.findConversation(userId,assistantId,conversationId);if(!c||c.status==='deleted'||!c.currentBranchId)return null;const b=repository.findBranch(userId,assistantId,conversationId,c.currentBranchId);return b?{conversationId,branchId:b.branchId}:null;},
    linkTurnAndUserMessage(record){repository.linkTurn(record);repository.insertBranchMessage({...record,messageId:record.userMessageId,messageVersionId:record.userMessageVersionId,sequenceNumber:record.sequenceNumber});if(record.attachments?.length)repository.attachAttachments(record.attachments,record.userMessageId,record.userMessageVersionId);repository.touchBranchForMessage({...record,updatedAt:record.createdAt});},
    linkAssistantMessage(turn,message){const link=repository.findTurnBranch(turn.turnId);if(!link)return;repository.insertBranchMessage({userId:turn.userId,assistantId:turn.assistantId,conversationId:turn.conversationId,branchId:link.branchId,messageId:message.messageId,
      messageVersionId:message.currentVersionId,sequenceNumber:message.sequenceNumber,createdAt:message.createdAt});repository.touchBranchForMessage({...link,updatedAt:message.createdAt});},
  });
}
