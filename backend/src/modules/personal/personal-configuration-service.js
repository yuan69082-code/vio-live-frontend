import { randomUUID } from 'node:crypto';
import { ApplicationError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { canonicalizeJson } from '../continuity-integration/first-round-hashing.js';
import { digest } from './personal-crypto.js';
import { fields,text,version } from './personal-validation.js';

export function createPersonalConfigurationService({repository:r,identityService:identity,apiProviderService:providers,
  modelService:models,modelRoutingRuleService:routing,permissionService,securityService,confirmationService,
  credentialBindingRepository,connectionChecker,vault,runInTransaction,clock=()=>new Date()}) {
  const now=()=>clock().toISOString();
  function provider(user,id) {const p=providers.getProvider(user,id);return {...p,version:r.providerVersion(user,id)};}
  function scope(context,resource,id,action='manage') {return {subjectId:null,resourceType:resource,resourceId:id,action,operationType:'api_configuration_change',sensitiveDataCategories:[],securitySessionId:context.sessionId};}
  function secured(context,operation,key,input,securityScope,execute) {
    text(key,'Idempotency-Key',128);identity.identity(context.userId);
    const {confirmationId,...content}=input;const hash=digest(canonicalizeJson(content));
    return runInTransaction(()=>{
      const old=r.operation(context.userId,operation,key);
      if(old) {if(old.content_hash!==hash)throw new ConflictError('Idempotency key content changed.');return JSON.parse(old.response_json);}
      if(r.cancellation(context.userId,operation,key))return {operationStatus:'cancelled'};
      const pending=r.pendingConfirmation(context.userId,operation,key);
      if(pending && pending.content_hash!==hash) throw new ConflictError('Confirmation does not cover changed content.');
      if(confirmationId && (!pending||pending.confirmation_id!==confirmationId)) throw new ConflictError('Confirmation does not belong to this operation.');
      if(pending&&!confirmationId) {
        const confirmation=confirmationService.getConfirmation(context.userId,pending.confirmation_id);
        return {operationStatus:'confirmation_required',security:{confirmation}};
      }
      const security=securityService.checkSecurity(context.userId,{...securityScope,...(confirmationId?{confirmationId}:{})},{minimumRiskLevel:'high'});
      if(security.decision!=='allow') {
        if(security.decision==='confirm'&&!pending)r.addPendingConfirmation(context.userId,operation,key,hash,security.confirmation.confirmationId);
        return {operationStatus:security.decision==='confirm'?'confirmation_required':'denied',security};
      }
      const result={operationStatus:'completed',...execute(security),security};
      r.addOperation(context.userId,operation,key,hash,result,now());return result;
    });
  }
  function model(user,id) {
    const m=models.getModel(user,id);const rule=routing.listRules(user).find(x=>x.taskType==='chat');
    return {modelId:m.modelId,providerId:m.providerId,modelName:m.modelName,modelType:m.modelType,capabilities:m.capabilities,
      costDescription:m.costDescription,testStatus:m.testStatus,status:m.status,version:m.version,defaultForChat:rule?.status==='enabled'&&rule?.defaultModel?.modelId===m.modelId,createdAt:m.createdAt};
  }
  function chooseDefault(user,id,wanted) {
    if(typeof wanted!=='boolean') throw new ValidationError('defaultForChat must be boolean.',{field:'defaultForChat'});
    const existing=routing.listRules(user).find(x=>x.taskType==='chat');
    if(!wanted){if(existing?.defaultModel?.modelId===id&&existing.status==='enabled')routing.updateRule(user,'chat',{status:'disabled'});return;}
    if(existing)routing.updateRule(user,'chat',{defaultModelId:id,fallbackModelId:null,status:'enabled'});
    else routing.createRule(user,{taskType:'chat',defaultModelId:id,fallbackModelId:null,status:'enabled'});
  }
  function connectionView(row) {
    if(!row)throw new NotFoundError('Connection test was not found.');
    return {testId:row.test_id,providerId:row.provider_id,scope:'authentication',status:row.status,reason:row.reason,
      startedAt:row.started_at,completedAt:row.completed_at,generation:'not_performed',providerCharge:'not_incurred'};
  }
  return {
    secured,
    operation(context,operation,key) {
      text(operation,'operation',256);text(key,'key',128);
      const old=r.operation(context.userId,operation,key);
      if(old) {
        const connectionProvider=/^connection\/([a-zA-Z0-9-]+)$/.exec(operation)?.[1];
        const connection=connectionProvider?r.connectionByKey(context.userId,connectionProvider,key):null;
        if(connection&&connection.status!=='running') {
          return {status:'completed',result:{operationStatus:'completed',test:connectionView(connection)}};
        }
        return {status:'completed',result:JSON.parse(old.response_json)};
      }
      if(r.cancellation(context.userId,operation,key))return {status:'cancelled'};
      const pending=r.pendingConfirmation(context.userId,operation,key);
      if(pending)return {status:'confirmation_required',confirmation:confirmationService.getConfirmation(context.userId,pending.confirmation_id)};
      return {status:'not_found'};
    },
    cancelOperation(context,input) {
      fields(input,['operation','key'],['operation','key']);text(input.operation,'operation',256);text(input.key,'key',128);
      if(!/^(delete-personal-space|create-provider|create-model|(update-provider|update-model|save-credential|revoke-credential|connection)\/[a-zA-Z0-9-]+)$/.test(input.operation))throw new ValidationError('Unsupported cancellable operation.',{field:'operation'});
      return runInTransaction(()=>{
        const previous=r.operation(context.userId,input.operation,input.key);
        if(previous)return {status:'completed',result:JSON.parse(previous.response_json)};
        r.cancelOperation(context.userId,input.operation,input.key,now());return {status:'cancelled'};
      });
    },
    initialize(){r.interruptConnections(now());},
    providers:user=>({items:providers.listProviders(user).map(p=>provider(user,p.providerId))}),
    createProvider(context,input,key) {
      fields(input,['displayName','providerType','baseUrl','interfaceFormat','status','confirmationId'],['displayName','providerType','baseUrl','interfaceFormat','status']);
      connectionChecker.validateTarget(input.baseUrl);
      if(input.interfaceFormat!=='openai_compatible')throw new ValidationError('Only openai_compatible is implemented.',{field:'interfaceFormat'});
      const {confirmationId,...body}=input;
      return secured(context,'create-provider',key,input,scope(context,'identity',context.userId),()=>{
        const p=providers.createProvider(context.userId,body);r.addProvider(context.userId,p.providerId);
        for(const action of ['manage','execute','connect'])permissionService.createPermission(context.userId,{subjectId:null,resourceType:'api',resourceId:p.providerId,action,permissionLevel:'always_allow'});
        return {provider:provider(context.userId,p.providerId)};
      });
    },
    updateProvider(context,id,input,key) {
      fields(input,['displayName','baseUrl','interfaceFormat','status','expectedVersion','confirmationId'],['displayName','baseUrl','interfaceFormat','status','expectedVersion']);
      // Ownership precedes confirmation/audit creation, not just the write.
      provider(context.userId,id);
      connectionChecker.validateTarget(input.baseUrl);
      if(input.interfaceFormat!=='openai_compatible')throw new ValidationError('Interface not supported.',{field:'interfaceFormat'});
      const {confirmationId,expectedVersion,...body}=input;
      return secured(context,`update-provider/${id}`,key,input,scope(context,'api',id),()=>{
        if(provider(context.userId,id).version!==version(expectedVersion))throw new ConflictError('Provider version changed.');
        providers.updateConfiguration(context.userId,id,body);r.touchProvider(context.userId,id);
        return {provider:provider(context.userId,id)};
      });
    },
    models:user=>({items:models.listModels(user).map(m=>model(user,m.modelId))}),
    createModel(context,input,key) {
      fields(input,['providerId','modelName','modelType','capabilities','costDescription','defaultForChat','confirmationId'],['providerId','modelName','modelType','capabilities','defaultForChat']);
      provider(context.userId,input.providerId);
      const {confirmationId,providerId,defaultForChat,...body}=input;
      return secured(context,'create-model',key,input,scope(context,'api',providerId),()=>{
        const m=models.createModel(context.userId,providerId,body);chooseDefault(context.userId,m.modelId,defaultForChat);return {model:model(context.userId,m.modelId)};
      });
    },
    updateModel(context,id,input,key) {
      fields(input,['modelName','modelType','capabilities','costDescription','status','defaultForChat','expectedVersion','confirmationId'],['modelName','modelType','capabilities','status','defaultForChat','expectedVersion']);
      const current=model(context.userId,id);const {confirmationId,defaultForChat,expectedVersion,...body}=input;
      return secured(context,`update-model/${id}`,key,input,scope(context,'api',current.providerId),()=>{
        if(model(context.userId,id).version!==version(expectedVersion))throw new ConflictError('Model version changed.');
        models.updateModel(context.userId,id,body);chooseDefault(context.userId,id,defaultForChat);return {model:model(context.userId,id)};
      });
    },
    decide(context,id,input) {return confirmationService.decideConfirmation(context.userId,id,input);},
    saveCredential(context,id,input,key) {
      fields(input,['keyId','sealedCredential','confirmationId'],['keyId','sealedCredential']);provider(context.userId,id);
      return secured(context,`save-credential/${id}`,key,input,{...scope(context,'api',id),sensitiveDataCategories:['api_key']},security=>{
        const value=vault.unseal(context.userId,input.keyId,input.sealedCredential);
        try {
          const credentialId=randomUUID();const time=now();
          r.revokeCredentials(context.userId,id,time);
          r.addCredential({id:credentialId,user:context.userId,provider:id,encrypted:vault.encrypt(context.userId,credentialId,id,value),now:time});
          credentialBindingRepository.replaceActive({credentialBindingId:randomUUID(),ownerUserId:context.userId,providerId:id,secretRef:`vault:${credentialId}`,securityAuditLogId:security.auditLogId,createdAt:time});
          identity.audit(context.userId,'credential_changed',context.sessionId);
          return {provider:provider(context.userId,id)};
        } finally {value.fill(0);}
      });
    },
    revokeCredential(context,id,input,key) {
      fields(input,['confirmationId']);provider(context.userId,id);
      return secured(context,`revoke-credential/${id}`,key,input,{...scope(context,'api',id),sensitiveDataCategories:['api_key']},()=>{
        r.revokeCredentials(context.userId,id,now());identity.audit(context.userId,'credential_changed',context.sessionId);
        return {provider:provider(context.userId,id)};
      });
    },
    async testConnection(context,id,input,key) {
      fields(input,['scope','confirmationId'],['scope']);text(key,'Idempotency-Key',128);
      if(input.scope!=='authentication')throw new ValidationError('Only authentication checks are authorized by this endpoint.',{field:'scope'});
      const p=provider(context.userId,id);const hash=digest(canonicalizeJson({scope:input.scope}));
      const old=r.connectionByKey(context.userId,id,key);
      if(old){if(old.content_hash!==hash)throw new ConflictError('Connection key content changed.');return {operationStatus:'completed',test:connectionView(old)};}
      const setup=secured(context,`connection/${id}`,key,input,scope(context,'api',id,'connect'),()=>{
        const testId=randomUUID();r.addConnection({id:testId,user:context.userId,provider:id,key,hash,now:now()});return {testId};
      });
      if(setup.operationStatus!=='completed')return setup;
      let result;
      try {
        if(p.status!=='enabled')result={status:'failed',reason:'provider_disabled'};
        else result=await connectionChecker.check({baseUrl:p.baseUrl,interfaceFormat:p.interfaceFormat,resolveApiKey:providers.getCredentialBindingForExecution(context.userId,id).resolveApiKey});
      } catch(error) {
        result={status:'failed',reason:error.code==='VAULT_LOCKED'?'vault_locked':error.code==='CREDENTIAL_UNAVAILABLE'||error.code==='not_found'?'credential_unavailable':'unsafe_target'};
      }
      // A deletion may have been accepted while the network operation awaited.
      // Do not revive business facts/audits after suspension or actual erasure.
      identity.identity(context.userId);
      r.finishConnection(setup.testId,result.status,result.reason,now());identity.audit(context.userId,'connection_checked',context.sessionId);
      return {operationStatus:'completed',test:connectionView(r.connection(context.userId,id,setup.testId))};
    },
    getConnection(context,providerId,id) {provider(context.userId,providerId);return connectionView(r.connection(context.userId,providerId,id));},
  };
}
