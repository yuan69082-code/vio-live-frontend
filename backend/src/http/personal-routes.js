import { ApplicationError, NotFoundError, ValidationError } from '../core/errors.js';
import { readJsonBody, sendJson } from './json.js';
import { equalSecret } from '../modules/personal/personal-crypto.js';

const PREFIX='/api/v1/personal';
function tokenFrom(request,name='vio_personal_session') {
  const values=(request.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(`${name}=`));
  if(values.length!==1) return null;
  return values[0].slice(name.length+1);
}
function sameOrigin(request,allowedOrigin) {
  const origin=request.headers.origin;
  if(request.headers['sec-fetch-site']==='cross-site') throw new ApplicationError('Cross-site request denied.',{code:'ORIGIN_DENIED',statusCode:403});
  if(origin) {
    let url; try {url=new URL(origin);} catch {throw new ApplicationError('Origin denied.',{code:'ORIGIN_DENIED',statusCode:403});}
    const loopbackDevelopment=!allowedOrigin&&request.socket.remoteAddress&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
      && ['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol==='http:';
    if((allowedOrigin&&url.origin!==allowedOrigin)||(!allowedOrigin&&!loopbackDevelopment)) throw new ApplicationError('Origin denied.',{code:'ORIGIN_DENIED',statusCode:403});
  }
}
function cookie(token,secure=false,expired=false) {
  return `vio_personal_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expired?0:30*86400}${secure?'; Secure':''}`;
}
function deletionCookie(token,secure=false,expired=false) {return `vio_deletion_access=${token}; Path=/api/v1/personal; HttpOnly; SameSite=Strict; Max-Age=${expired?0:90*86400}${secure?'; Secure':''}`;}
function rejectChatIdentityFields(input) {
  if(input===null||typeof input!=='object'||Array.isArray(input)) {
    throw new ValidationError('Personal chat request body must be a JSON object.',{field:'body'});
  }
  const forbidden=['userId','assistantId','subjectId','conversationId'];
  const fields=forbidden.filter(field=>Object.hasOwn(input,field));
  if(fields.length) throw new ValidationError('Personal chat scope is derived from the verified session.',{unexpectedFields:fields});
  return input;
}
function rejectMemoryIdentityFields(input) {
  if(input===null||typeof input!=='object'||Array.isArray(input)) {
    throw new ValidationError('Personal memory request body must be a JSON object.',{field:'body'});
  }
  const unexpectedFields=['userId','assistantId','subjectId'].filter(field=>Object.hasOwn(input,field));
  if(unexpectedFields.length) throw new ValidationError(
    'Personal memory scope is derived from the verified session.',{unexpectedFields});
  return input;
}
function decodeChatPathSegment(value,field) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ValidationError('Personal chat path contains malformed percent-encoding.',{field});
  }
}
function memoryReadContext(request) {
  const confirmationId=request.headers['x-vio-confirmation-id'];
  const securitySessionId=request.headers['x-vio-security-session-id'];
  if(Array.isArray(confirmationId)||Array.isArray(securitySessionId)) {
    throw new ValidationError('Only one memory security context value is allowed.');
  }
  return {confirmationId:confirmationId??null,securitySessionId:securitySessionId??null};
}
export function createPersonalHttpAccess({identityService:identity,configurationService,deletionService,standaloneChatService,multiConversationService,contextAssemblyService,localMemoryService,unifiedCapabilityExecutionService,vault,secureCookies=false,allowedOrigin=null}) {
  function authenticate(request,write=false) {
    const context=identity.authenticate(tokenFrom(request));
    if(write) {
      sameOrigin(request,allowedOrigin);
      const csrf=request.headers['x-vio-csrf'];
      if(typeof csrf!=='string'||!equalSecret(csrf,context.csrfToken)) throw new ApplicationError('CSRF verification failed.',{code:'CSRF_DENIED',statusCode:403});
    }
    request.accessContext=context;
    return context;
  }
  return {
    authorizeLegacy(request,url) {
      const context=authenticate(request,!['GET','HEAD','OPTIONS'].includes(request.method));
      if(request.method==='POST' && url.pathname==='/api/v1/users') throw new ApplicationError('Public registration is disabled.',{code:'REGISTRATION_DISABLED',statusCode:403});
      const match=url.pathname.match(/^\/api\/v1\/users\/([^/]+)/);
      if(match && match[1]!=='current' && decodeURIComponent(match[1])!==context.userId) throw new NotFoundError('Resource was not found for this identity.');
      // Legacy read contracts remain available, but the personal owner cannot
      // bypass R2 confirmation, encrypted input or optimistic versions through
      // older write shapes. Historical tests opt into their separate test-only
      // access adapter; there is no production header/environment bypass.
      const r2OwnedLegacyWrite=/^\/api\/v1\/users\/[^/]+\/(?:api-providers(?:\/|$)|models(?:\/|$)|model-routing-rules(?:\/|$)|user-space\/current-assistant$|subjects(?:\/[^/]+(?:\/global-settings)?)?$)/.test(url.pathname);
      if(!['GET','HEAD','OPTIONS'].includes(request.method)&&r2OwnedLegacyWrite) {
        throw new ApplicationError('Use the personal configuration route for this operation.',{code:'PERSONAL_WRITE_ROUTE_REQUIRED',statusCode:403});
      }
      // Personal chat writes are owned by the R1 ledger and its server-derived
      // current-assistant scope. Historical read contracts remain available,
      // while historical tests explicitly inject their test-only access port.
      const r1OwnedLegacyWrite=/^\/api\/v1\/users\/[^/]+\/subjects\/[^/]+\/(?:state-updates(?:\/|$)|conversations(?:\/|$))/.test(url.pathname);
      if(!['GET','HEAD','OPTIONS'].includes(request.method)&&r1OwnedLegacyWrite) {
        throw new ApplicationError('Use the personal chat route for this operation.',{code:'PERSONAL_CHAT_ROUTE_REQUIRED',statusCode:403});
      }
      return context;
    },
    async handle(request,response,url) {
      if(!url.pathname.startsWith(`${PREFIX}/`)) return false;
      const path=url.pathname.slice(PREFIX.length);
      const method=request.method;
      sameOrigin(request,allowedOrigin);
      const key=request.headers['idempotency-key'];
      if(Array.isArray(key)) throw new ValidationError('Only one Idempotency-Key is allowed.');
      const send=(data,status=200)=>sendJson(response,status,{data});
      if(method==='GET'&&path==='/access') {send(deletionService?.pendingOwner()?{status:'deletion_authentication_required',registration:'disabled'}:identity.access());return true;}
      if(method==='POST'&&path==='/deletion-access') {
        const {token,...data}=deletionService.verifyAccess(await readJsonBody(request));
        response.setHeader('Set-Cookie',[cookie('',secureCookies,true),deletionCookie(token,secureCookies)]);send(data);return true;
      }
      if(path.startsWith('/deletions/')) {
        const token=tokenFrom(request,'vio_deletion_access');
        const csrf=!['GET','HEAD'].includes(method)?request.headers['x-vio-csrf']:null;
        const access=deletionService.authenticate(token,csrf??(method==='GET'?null:''));
        if(method==='GET'&&(path==='/deletions/current'||path===`/deletions/${access.task.deletion_id}`))send({deletion:access.deletion,csrfToken:access.csrfToken});
        else if(method==='POST'&&path==='/deletions/current/cancellation') {
          const result=deletionService.cancel(token,csrf,await readJsonBody(request));
          response.setHeader('Set-Cookie',[cookie('',secureCookies,true),deletionCookie('',secureCookies,true)]);send(result);
        }else if(method==='POST'&&path==='/deletions/current/retry') {
          const result=deletionService.retry(token,csrf,await readJsonBody(request));send({deletion:result.deletion,csrfToken:result.csrfToken});
        }else throw new NotFoundError('Deletion route was not found.');
        return true;
      }
      if(method==='POST'&&(path==='/initialize'||path==='/sessions')) {
        const input=await readJsonBody(request);
        const result=path==='/initialize'?identity.initialize(input,key):identity.login(input);
        response.setHeader('Set-Cookie',cookie(result.token,secureCookies));
        send(identity.sessionView(result.context)); return true;
      }
      const context=authenticate(request,!['GET','HEAD'].includes(method));
      const user=context.userId;
      if(method==='POST'&&path==='/deletions') {
        const {token,...data}=deletionService.request(context,await readJsonBody(request),key);
        if(token)response.setHeader('Set-Cookie',[cookie('',secureCookies,true),deletionCookie(token,secureCookies)]);
        send(data);
      }
      else if(method==='GET'&&path==='/session') send(identity.sessionView(context));
      else if(method==='DELETE'&&path==='/session') {const result=identity.logout(context);response.setHeader('Set-Cookie',cookie('',secureCookies,true));send(result);}
      else if(method==='GET'&&path==='/sessions') send(identity.sessions(context));
      else if(method==='DELETE'&&/^\/sessions\/[^/]+$/.test(path)) {const result=identity.revoke(context,decodeURIComponent(path.split('/')[2]));if(result.current)response.setHeader('Set-Cookie',cookie('',secureCookies,true));send(result);}
      else if(method==='GET'&&path==='/profile') send(identity.profile(user));
      else if(method==='PATCH'&&path==='/profile') send(identity.updateProfile(user,await readJsonBody(request)));
      else if(method==='POST'&&path==='/onboarding') send(identity.onboarding(context,await readJsonBody(request),key));
      else if(method==='GET'&&path==='/assistants') send(identity.assistants(user));
      else if(method==='POST'&&path==='/assistants') send(identity.addAssistant(user,await readJsonBody(request),key),201);
      else if(method==='GET'&&/^\/assistants\/[^/]+$/.test(path)) send(identity.assistant(user,decodeURIComponent(path.split('/')[2])));
      else if(method==='PATCH'&&/^\/assistants\/[^/]+$/.test(path)) send(identity.updateAssistant(user,decodeURIComponent(path.split('/')[2]),await readJsonBody(request)));
      else if(method==='PUT'&&path==='/current-assistant') send(identity.select(user,await readJsonBody(request)));
      else if(method==='GET'&&path==='/access-audit') send(identity.audits(user));
      else if(method==='GET'&&path==='/diagnostics') send(identity.diagnostics(user));
      else if(method==='GET'&&path==='/vault') send(vault.publicTransport(user));
      else if(method==='POST'&&path==='/vault/unlock') send(identity.unlock(context,await readJsonBody(request)));
      else if(method==='GET'&&path==='/capabilities') send(unifiedCapabilityExecutionService.catalog(context));
      else if(method==='POST'&&path==='/capabilities/local-tools') send(unifiedCapabilityExecutionService.installLocalTool(context,rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&path==='/capabilities/mcp-servers') send(unifiedCapabilityExecutionService.installMcp(context,rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&/^\/capabilities\/mcp-servers\/[^/]+\/discovery$/.test(path)) send(await unifiedCapabilityExecutionService.discoverMcp(context,decodeChatPathSegment(path.split('/')[3],'capabilityId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/capabilities\/mcp-servers\/[^/]+\/discovery\/by-idempotency-key\/[^/]+$/.test(path)) {const parts=path.split('/');send(unifiedCapabilityExecutionService.getMcpDiscoveryOperation(context,decodeChatPathSegment(parts[3],'capabilityId'),decodeChatPathSegment(parts[6],'idempotencyKey')));}
      else if(method==='POST'&&path==='/capabilities/skills') send(unifiedCapabilityExecutionService.installSkill(context,rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&path==='/capabilities/plugins') send(unifiedCapabilityExecutionService.installPlugin(context,rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&/^\/capabilities\/plugins\/[^/]+\/lifecycle$/.test(path)) send(unifiedCapabilityExecutionService.pluginLifecycle(context,decodeChatPathSegment(path.split('/')[3],'capabilityId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&path==='/capability-executions') send(unifiedCapabilityExecutionService.listExecutions(context,{category:url.searchParams.get('category')??undefined,status:url.searchParams.get('status')??undefined,cursor:url.searchParams.get('cursor')??undefined,limit:url.searchParams.get('limit')??undefined}));
      else if(method==='POST'&&path==='/capability-executions') send(await unifiedCapabilityExecutionService.createExecution(context,rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/capability-executions\/by-idempotency-key\/[^/]+$/.test(path)) send(unifiedCapabilityExecutionService.getByKey(context,decodeChatPathSegment(path.split('/')[3],'idempotencyKey')));
      else if(method==='GET'&&/^\/capability-executions\/[^/]+$/.test(path)) send(unifiedCapabilityExecutionService.getExecution(context,decodeChatPathSegment(path.split('/')[2],'executionId')));
      else if(method==='POST'&&/^\/capability-executions\/[^/]+\/recovery$/.test(path)) send(await unifiedCapabilityExecutionService.recoverExecution(context,decodeChatPathSegment(path.split('/')[2],'executionId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&path==='/memories') send(localMemoryService.list(context,{
        query:url.searchParams.get('query')??undefined,kind:url.searchParams.get('kind')??undefined,
        status:url.searchParams.get('status')??undefined,
        includeInContext:url.searchParams.get('includeInContext')??undefined,
        cursor:url.searchParams.get('cursor')??undefined,limit:url.searchParams.get('limit')??undefined,
      },memoryReadContext(request)));
      else if(method==='POST'&&path==='/memories') {const value=localMemoryService.create(context,rejectMemoryIdentityFields(await readJsonBody(request)),key);send(value,value.operationStatus==='completed'?201:200);}
      else if(method==='POST'&&path==='/memories/imports') send(localMemoryService.createImport(context,rejectMemoryIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&path==='/memories/exports') send(localMemoryService.createExport(context,rejectMemoryIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/memories\/deletions\/[^/]+$/.test(path)) send(localMemoryService.deletion(context,decodeChatPathSegment(path.split('/')[3],'deletionId')));
      else if(method==='GET'&&/^\/memories\/operations\/by-idempotency-key\/[^/]+$/.test(path)) send(localMemoryService.operation(context,decodeChatPathSegment(path.split('/')[4],'idempotencyKey')));
      else if(method==='GET'&&/^\/memories\/[^/]+\/versions$/.test(path)) send(localMemoryService.versions(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),memoryReadContext(request)));
      else if(method==='GET'&&/^\/memories\/[^/]+\/references$/.test(path)) send(localMemoryService.references(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),memoryReadContext(request)));
      else if(method==='POST'&&/^\/memories\/[^/]+\/references\/[^/]+\/deletion$/.test(path)) {const parts=path.split('/');send(localMemoryService.deleteReference(context,decodeChatPathSegment(parts[2],'memoryId'),decodeChatPathSegment(parts[4],'referenceId'),rejectMemoryIdentityFields(await readJsonBody(request)),key));}
      else if(method==='POST'&&/^\/memories\/[^/]+\/references$/.test(path)) send(localMemoryService.createReference(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),rejectMemoryIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&/^\/memories\/[^/]+\/context-inclusion$/.test(path)) send(localMemoryService.setContextInclusion(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),rejectMemoryIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&/^\/memories\/[^/]+\/(archive|restore)$/.test(path)) {const parts=path.split('/');send(localMemoryService.transition(context,decodeChatPathSegment(parts[2],'memoryId'),rejectMemoryIdentityFields(await readJsonBody(request)),key,parts[3]));}
      else if(method==='POST'&&/^\/memories\/[^/]+\/deletion$/.test(path)) send(localMemoryService.requestDeletion(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),rejectMemoryIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&/^\/memories\/[^/]+\/deletion-cancellation$/.test(path)) send(localMemoryService.cancelDeletion(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),rejectMemoryIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&/^\/memories\/[^/]+\/deletion-finalization$/.test(path)) send(localMemoryService.finalizeDeletion(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),rejectMemoryIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/memories\/[^/]+$/.test(path)) send(localMemoryService.get(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),memoryReadContext(request)));
      else if(method==='PATCH'&&/^\/memories\/[^/]+$/.test(path)) send(localMemoryService.edit(context,decodeChatPathSegment(path.split('/')[2],'memoryId'),rejectMemoryIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&path==='/chat/conversations') send(multiConversationService.listConversations(context,{
        status:url.searchParams.get('status')??undefined,query:url.searchParams.get('query')??undefined,
        sort:url.searchParams.get('sort')??undefined,cursor:url.searchParams.get('cursor')??undefined,
        limit:url.searchParams.get('limit')??undefined,
      }));
      else if(method==='POST'&&path==='/chat/conversations') send(multiConversationService.createConversation(context,rejectChatIdentityFields(await readJsonBody(request)),key),201);
      else if(method==='GET'&&path==='/chat/conversations/current') send(multiConversationService.getCurrent(context));
      else if(method==='GET'&&/^\/chat\/conversations\/[^/]+$/.test(path)) send(multiConversationService.getConversation(context,decodeChatPathSegment(path.split('/')[3],'conversationId')));
      else if(method==='GET'&&/^\/chat\/conversations\/[^/]+\/context-settings$/.test(path)) send(contextAssemblyService.getSettings(context,decodeChatPathSegment(path.split('/')[3],'conversationId')));
      else if(method==='PATCH'&&/^\/chat\/conversations\/[^/]+\/context-settings$/.test(path)) send(contextAssemblyService.updateSettings(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/chat\/conversations\/[^/]+\/context-plan$/.test(path)) send(contextAssemblyService.preview(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),{
        branchId:url.searchParams.get('branchId')??undefined,mode:url.searchParams.get('mode')??undefined,
        excludedSourceRefs:url.searchParams.getAll('excludeSourceRef'),
      }));
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/selection$/.test(path)) send(multiConversationService.selectConversation(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='PATCH'&&/^\/chat\/conversations\/[^/]+$/.test(path)) send(multiConversationService.renameConversation(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/(archive|restore|deletion)$/.test(path)) {const parts=path.split('/');send(multiConversationService.transitionConversation(context,decodeChatPathSegment(parts[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key,{archive:'archive',restore:'restore',deletion:'delete'}[parts[4]]));}
      else if(method==='GET'&&/^\/chat\/conversations\/[^/]+\/branches$/.test(path)) send(multiConversationService.listBranches(context,decodeChatPathSegment(path.split('/')[3],'conversationId')));
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/branches$/.test(path)) send(multiConversationService.createBranch(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key),201);
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/branches\/[^/]+\/selection$/.test(path)) {const parts=path.split('/');send(multiConversationService.selectBranch(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'branchId'),rejectChatIdentityFields(await readJsonBody(request)),key));}
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/clear$/.test(path)) send(multiConversationService.clearBranch(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/chat\/conversations\/[^/]+\/messages\/[^/]+\/versions$/.test(path)) {const parts=path.split('/');send(multiConversationService.listVersions(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'messageId')));}
      else if(method==='PATCH'&&/^\/chat\/conversations\/[^/]+\/messages\/[^/]+$/.test(path)) {const parts=path.split('/');send(multiConversationService.editMessage(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'messageId'),rejectChatIdentityFields(await readJsonBody(request)),key));}
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/messages\/[^/]+\/regenerations$/.test(path)) {const parts=path.split('/');send(await multiConversationService.regenerate(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'messageId'),rejectChatIdentityFields(await readJsonBody(request)),key));}
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/messages\/[^/]+\/version-selection$/.test(path)) {const parts=path.split('/');send(multiConversationService.selectMessageVersion(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'messageId'),rejectChatIdentityFields(await readJsonBody(request)),key));}
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/messages\/[^/]+\/deletion$/.test(path)) {const parts=path.split('/');send(multiConversationService.hideMessage(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'messageId'),rejectChatIdentityFields(await readJsonBody(request)),key));}
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/turns$/.test(path)) send(await multiConversationService.createTurn(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/attachments$/.test(path)) send(multiConversationService.createAttachment(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key),201);
      else if(method==='GET'&&/^\/chat\/conversations\/[^/]+\/attachments\/[^/]+$/.test(path)) {const parts=path.split('/');send(multiConversationService.getAttachment(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'attachmentId')));}
      else if(method==='GET'&&/^\/chat\/conversations\/[^/]+\/attachments\/[^/]+\/content$/.test(path)) {const parts=path.split('/');send(multiConversationService.getAttachment(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'attachmentId'),{content:true}));}
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/attachments\/[^/]+\/deletion$/.test(path)) {const parts=path.split('/');send(multiConversationService.deleteAttachment(context,decodeChatPathSegment(parts[3],'conversationId'),decodeChatPathSegment(parts[5],'attachmentId'),rejectChatIdentityFields(await readJsonBody(request)),key));}
      else if(method==='POST'&&/^\/chat\/conversations\/[^/]+\/exports$/.test(path)) send(multiConversationService.exportConversation(context,decodeChatPathSegment(path.split('/')[3],'conversationId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/chat\/operations\/by-idempotency-key\/[^/]+$/.test(path)) send(multiConversationService.getOperation(context,decodeChatPathSegment(path.split('/')[4],'idempotencyKey')));
      else if(method==='GET'&&path==='/chat/default') send(await standaloneChatService.getDefaultChat(context));
      else if(method==='POST'&&path==='/chat/turns') send(await standaloneChatService.createTurn(context,rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/chat\/turns\/by-idempotency-key\/[^/]+$/.test(path)) send(await standaloneChatService.getTurnByIdempotencyKey(context,decodeChatPathSegment(path.split('/')[4],'idempotencyKey')));
      else if(method==='GET'&&/^\/chat\/turns\/[^/]+\/context$/.test(path)) send(contextAssemblyService.getSnapshot(context,decodeChatPathSegment(path.split('/')[3],'turnId')));
      else if(method==='POST'&&/^\/chat\/turns\/[^/]+\/context-recovery$/.test(path)) send(await contextAssemblyService.recoverFold(context,decodeChatPathSegment(path.split('/')[3],'turnId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&/^\/chat\/turns\/[^/]+$/.test(path)) send(await standaloneChatService.getTurn(context,decodeChatPathSegment(path.split('/')[3],'turnId')));
      else if(method==='POST'&&/^\/chat\/turns\/[^/]+\/recovery$/.test(path)) send(await standaloneChatService.recoverTurn(context,decodeChatPathSegment(path.split('/')[3],'turnId'),rejectChatIdentityFields(await readJsonBody(request)),key));
      else if(method==='GET'&&path==='/providers')send(configurationService.providers(user));
      else if(method==='GET'&&path==='/operations')send(configurationService.operation(context,url.searchParams.get('operation'),url.searchParams.get('key')));
      else if(method==='POST'&&path==='/operation-cancellations')send(configurationService.cancelOperation(context,await readJsonBody(request)));
      else if(method==='POST'&&path==='/providers')send(configurationService.createProvider(context,await readJsonBody(request),key));
      else if(method==='PATCH'&&/^\/providers\/[^/]+$/.test(path))send(configurationService.updateProvider(context,decodeURIComponent(path.split('/')[2]),await readJsonBody(request),key));
      else if(method==='GET'&&path==='/models')send(configurationService.models(user));
      else if(method==='POST'&&path==='/models')send(configurationService.createModel(context,await readJsonBody(request),key));
      else if(method==='PATCH'&&/^\/models\/[^/]+$/.test(path))send(configurationService.updateModel(context,decodeURIComponent(path.split('/')[2]),await readJsonBody(request),key));
      else if(method==='POST'&&/^\/confirmations\/[^/]+\/decision$/.test(path))send(configurationService.decide(context,decodeURIComponent(path.split('/')[2]),await readJsonBody(request)));
      else if(method==='PUT'&&/^\/providers\/[^/]+\/credential$/.test(path))send(configurationService.saveCredential(context,decodeURIComponent(path.split('/')[2]),await readJsonBody(request),key));
      else if(method==='DELETE'&&/^\/providers\/[^/]+\/credential$/.test(path))send(configurationService.revokeCredential(context,decodeURIComponent(path.split('/')[2]),await readJsonBody(request),key));
      else if(method==='POST'&&/^\/providers\/[^/]+\/connection-tests$/.test(path))send(await configurationService.testConnection(context,decodeURIComponent(path.split('/')[2]),await readJsonBody(request),key));
      else if(method==='GET'&&/^\/chat\/context-sources\/[^/]+$/.test(path))send(contextAssemblyService.getEvidence(context,decodeChatPathSegment(path.split('/')[3],'sourceRef')));
      else if(method==='GET'&&/^\/providers\/[^/]+\/connection-tests\/[^/]+$/.test(path))send(configurationService.getConnection(context,decodeURIComponent(path.split('/')[2]),decodeURIComponent(path.split('/')[4])));
      else throw new NotFoundError('Personal route was not found.');
      return true;
    },
  };
}
