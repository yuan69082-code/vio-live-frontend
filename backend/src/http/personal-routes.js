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
export function createPersonalHttpAccess({identityService:identity,configurationService,deletionService,vault,secureCookies=false,allowedOrigin=null}) {
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
      else if(method==='GET'&&/^\/providers\/[^/]+\/connection-tests\/[^/]+$/.test(path))send(configurationService.getConnection(context,decodeURIComponent(path.split('/')[2]),decodeURIComponent(path.split('/')[4])));
      else throw new NotFoundError('Personal route was not found.');
      return true;
    },
  };
}
