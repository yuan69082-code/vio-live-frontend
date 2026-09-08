import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApplicationError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { canonicalizeJson } from '../continuity-integration/first-round-hashing.js';
import { digest, encrypt, decrypt, equalSecret, passwordKey, randomToken } from './personal-crypto.js';
import { fields, text, version, avatar, preferences, assistantInput } from './personal-validation.js';

const DAY = 86400000;
const denied = () => new ApplicationError('Personal access verification failed.', {code:'ACCESS_DENIED',statusCode:401});
export function createPersonalIdentityService({repository:r,userRepository, userSpaceRepository, subjectService,userSpaceService,permissionService,runInTransaction, vault, clock=()=>new Date()}) {
  const audit=(user,type,session=null,anomaly=false)=>r.audit({id:randomUUID(),user,type,session,anomaly,now:clock().toISOString()});
  function identity(user) {
    const p=r.identity(user);
    if (!p || p.status!=='active') throw denied();
    return p;
  }
  function verify(user,passphrase) {
    const p=identity(user);
    let key;
    try {
      key=passwordKey(passphrase,p.password_salt);
      if (!equalSecret(digest(key),p.password_verifier)) throw denied();
      vault.unlock(user,decrypt(key,p.wrapped_vault_key,user));
    } catch { throw denied(); } finally { key?.fill(0); }
    return p;
  }
  function session(user,device,token=randomToken()) {
    const now=clock();
    let s=r.session(digest(token));
    if (!s) {
      const id=randomUUID();
      r.addSession({id,user,hash:digest(token),device,now:now.toISOString(),expires:new Date(now.getTime()+30*DAY).toISOString()});
      s=r.session(digest(token));
    }
    if (s.revoked_at || s.user_status!=='active') throw denied();
    return {token,context:{userId:user,sessionId:s.session_id,expiresAt:s.expires_at,csrfToken:createHmac('sha256',token).update('vio-personal-csrf/v1').digest('base64url')}};
  }
  function idempotent(user,operation,key,input,execute) {
    text(key,'Idempotency-Key',128);
    const hash=digest(canonicalizeJson(input));
    return runInTransaction(()=>{
      identity(user);
      const previous=r.operation(user,operation,key);
      if (previous) {
        if (previous.content_hash!==hash) throw new ConflictError('Idempotency key has different content.');
        return JSON.parse(previous.response_json);
      }
      const result=execute();
      r.addOperation(user,operation,key,hash,result,clock().toISOString());
      return result;
    });
  }
  function profile(user) {
    const p=identity(user);
    return {userId:user,displayName:p.display_name,avatar:p.avatar,preferences:JSON.parse(p.preferences_json),
      storage:{actualLocation:'server_database',cloudSync:false},version:p.profile_version};
  }
  function assistant(user,id) {
    const s=subjectService.getSubject(user,id);
    const v=r.assistantVersion(user,id);
    if (!v) throw new NotFoundError('Assistant is not managed by this personal identity.');
    return {assistantId:s.subjectId,name:s.name,avatar:v.avatar,settings:s.basicSettings,status:s.status,version:v.version};
  }
  function createAssistant(user,p) {
    const created=subjectService.createSubject(user,{name:p.name,avatarRef:null,basicSettings:p.settings});
    r.addAssistant(user,created.subjectId,p.avatar);
    for (const action of ['read','write','manage','delete','export']) {
      permissionService.createPermission(user,{subjectId:created.subjectId,resourceType:'memory',
        resourceId:'local-memory',action,permissionLevel:'always_allow'});
    }
    return assistant(user,created.subjectId);
  }
  const api={
    audit, identity, idempotent,
    assertSessionActive(context) {
      const p=identity(context.userId);
      const now=clock();
      const session=r.sessions(context.userId).find(item=>item.session_id===context.sessionId);
      if(!session || session.revoked_at || session.expires_at<=now.toISOString()
          || Date.parse(session.last_seen_at)+7*DAY<=now.getTime() || p.status!=='active') throw denied();
      return context;
    },
    issueInvitation() {
      if (r.owner()) throw new ConflictError('Personal owner already initialized.');
      if (r.activeInvitation(clock().toISOString())) throw new ConflictError('An unexpired personal invitation already exists.');
      const invitation=randomToken();
      r.addInvitation(digest(invitation),new Date(clock().getTime()+15*60000).toISOString());
      return invitation;
    },
    access:()=>({status:r.owner()?'authentication_required':'initialization_required',registration:'disabled'}),
    initialize(input,key) {
      fields(input,['invitation','passphrase','agreementVersion'],['invitation','passphrase','agreementVersion']);
      text(key,'Idempotency-Key',128);
      if (input.agreementVersion!=='personal-use/v1') throw new ValidationError('Agreement must be accepted.',{field:'agreementVersion'});
      const invitation=typeof input.invitation==='string'?r.invitation(digest(input.invitation)):null;
      if (!invitation) throw denied();
      if (invitation.consumed_at) {
        if (invitation.initialization_key!==key) throw denied();
        verify(invitation.owner_user_id,input.passphrase);
        const token=createHmac('sha256',input.invitation).update(key).digest('base64url');
        return session(invitation.owner_user_id,'Initial personal browser',token);
      }
      if (invitation.expires_at<=clock().toISOString() || r.owner()) throw denied();
      const salt=randomBytes(32).toString('base64url');
      const derived=passwordKey(input.passphrase,salt);
      const vaultKey=randomBytes(32); const user=randomUUID(); const now=clock().toISOString();
      try {
        runInTransaction(()=>{
          if (r.owner()) throw new ConflictError('Owner has already been initialized.');
          userRepository.insert({userId:user,email:null,displayName:null,status:'active',createdAt:now,updatedAt:now});
          userSpaceRepository.insert({spaceId:randomUUID(),userId:user,identityMode:'personal_owner',status:'active',currentAssistantId:null,createdAt:now,updatedAt:now});
          r.createIdentity({userId:user,salt,verifier:digest(derived),wrapped:encrypt(derived,vaultKey,user),now});
          r.consumeInvitation(digest(input.invitation),now,key,user);
          for (const action of ['manage','delete']) permissionService.createPermission(user,{subjectId:null,resourceType:'identity',resourceId:user,action,permissionLevel:'always_allow'});
          audit(user,'initialized');
        });
        vault.unlock(user,Buffer.from(vaultKey));
      } finally { derived.fill(0); vaultKey.fill(0); }
      return session(user,'Initial personal browser',createHmac('sha256',input.invitation).update(key).digest('base64url'));
    },
    login(input) {
      fields(input,['passphrase','deviceName'],['passphrase','deviceName']);
      const device=text(input.deviceName,'deviceName',80);
      if (r.recentFailures(new Date(clock().getTime()-15*60000).toISOString())>=10) {
        throw new ApplicationError('Too many access attempts; retry later.',{code:'ACCESS_RATE_LIMITED',statusCode:429});
      }
      const owner=r.owner();
      try { verify(owner,input.passphrase); } catch {
        // Before controlled initialization there is deliberately no identity to
        // attach an audit fact to. Never turn that unauthenticated attempt into
        // a foreign-key failure or an implicit owner record.
        if (owner) audit(owner,'login_failed',null,true);
        throw denied();
      }
      const result=session(owner,device);
      audit(owner,'login_succeeded',result.context.sessionId);
      return result;
    },
    authenticate(token) {
      if (typeof token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw denied();
      const s=r.session(digest(token)); const now=clock();
      if (!s || s.revoked_at || s.user_status!=='active' || s.expires_at<=now.toISOString()
          || Date.parse(s.last_seen_at)+7*DAY<=now.getTime()) throw denied();
      identity(s.user_id);
      r.touchSession(s.session_id,now.toISOString());
      return {userId:s.user_id,sessionId:s.session_id,expiresAt:s.expires_at,
        csrfToken:createHmac('sha256',token).update('vio-personal-csrf/v1').digest('base64url')};
    },
    sessionView(context) {
      const p=identity(context.userId); const v=profile(context.userId);
      return {user:{userId:v.userId,displayName:v.displayName,avatar:v.avatar},
        session:{sessionId:context.sessionId,expiresAt:context.expiresAt},csrfToken:context.csrfToken,
        onboardingCompleted:Boolean(p.onboarding_completed),currentAssistantId:p.current_assistant_id,
        selectionVersion:p.selection_version,preferences:v.preferences,storage:v.storage,vaultStatus:vault.status(context.userId)};
    },
    logout(context) { r.revokeSession(context.userId,context.sessionId,clock().toISOString()); audit(context.userId,'logout',context.sessionId); return {status:'signed_out'}; },
    sessions(context) {
      const now=clock().getTime();
      return {items:r.sessions(context.userId).map(s=>({sessionId:s.session_id,deviceName:s.device_name,createdAt:s.created_at,lastSeenAt:s.last_seen_at,expiresAt:s.expires_at,current:s.session_id===context.sessionId,status:s.revoked_at?'revoked':Date.parse(s.expires_at)<=now||Date.parse(s.last_seen_at)+7*DAY<=now?'expired':'active'}))};
    },
    revoke(context,id) {
      if (!r.sessions(context.userId).some(s=>s.session_id===id)) throw new NotFoundError('Session was not found.');
      if (r.revokeSession(context.userId,id,clock().toISOString()).changes) audit(context.userId,'session_revoked',id);
      return {status:'revoked',sessionId:id,current:id===context.sessionId};
    },
    unlock(context,input) {
      fields(input,['passphrase'],['passphrase']);
      // Session authentication is performed by the HTTP boundary. Keep an
      // inactive/missing owner as access denial, but a failed vault challenge
      // for an active owner must not invalidate that owner's valid session.
      identity(context.userId);
      try { verify(context.userId,input.passphrase); }
      catch { throw new ApplicationError('Personal credential vault could not be unlocked.',{code:'VAULT_UNLOCK_FAILED',statusCode:403}); }
      audit(context.userId,'vault_unlocked',context.sessionId);
      return {status:vault.status(context.userId)};
    },
    profile,
    updateProfile(user,input) {
      fields(input,['displayName','avatar','preferences','expectedVersion'],['displayName','avatar','preferences','expectedVersion']);
      const p={displayName:text(input.displayName,'displayName',80),avatar:avatar(input.avatar),preferences:preferences(input.preferences),now:clock().toISOString()};
      return runInTransaction(()=>{ if (identity(user).profile_version!==version(input.expectedVersion)) throw new ConflictError('Profile version changed.'); r.profile(user,p); return profile(user); });
    },
    onboarding(context,input,key) {
      fields(input,['displayName','avatar','assistant','preferences'],['displayName','avatar','assistant','preferences']);
      const p={displayName:text(input.displayName,'displayName',80),avatar:avatar(input.avatar),preferences:preferences(input.preferences),now:clock().toISOString()};
      const a=assistantInput(input.assistant);
      idempotent(context.userId,'onboarding',key,input,()=>{
        if(identity(context.userId).onboarding_completed) throw new ConflictError('First setup is already complete.');
        r.profile(context.userId,p); createAssistant(context.userId,a); r.onboard(context.userId);
        return {completed:true};
      });
      return api.sessionView(context);
    },
    assistants(user) {
      const p=identity(user);
      return {items:subjectService.listSubjects(user).filter(s=>r.assistantVersion(user,s.subjectId)).map(s=>assistant(user,s.subjectId)),currentAssistantId:p.current_assistant_id,selectionVersion:p.selection_version};
    },
    assistant,
    addAssistant(user,input,key) { const a=assistantInput(input); return idempotent(user,'create-assistant',key,input,()=>createAssistant(user,a)); },
    updateAssistant(user,id,input) {
      const a=assistantInput(input);
      return runInTransaction(()=>{
        if(assistant(user,id).version!==version(input.expectedVersion)) throw new ConflictError('Assistant version changed.');
        subjectService.updateSubject(user,id,{name:a.name,basicSettings:a.settings});
        r.updateAssistant(user,id,a.avatar); return assistant(user,id);
      });
    },
    select(user,input) {
      fields(input,['assistantId','expectedSelectionVersion'],['assistantId','expectedSelectionVersion']);
      return runInTransaction(()=>{
        const p=identity(user); assistant(user,input.assistantId);
        if(p.selection_version!==version(input.expectedSelectionVersion,'expectedSelectionVersion')) throw new ConflictError('Current assistant selection changed.');
        userSpaceService.switchCurrentAssistant(user,{assistantId:input.assistantId});
        if(p.current_assistant_id!==input.assistantId) r.select(user);
        return api.assistants(user);
      });
    },
    audits(user) {return {items:r.audits(user).map(e=>({eventId:e.event_id,type:e.event_type,occurredAt:e.occurred_at,anomaly:Boolean(e.anomaly)}))};},
    diagnostics(user) {identity(user); return {identity:'verified_personal_owner',database:'available',vault:vault.status(user),authentication:'session_cookie',externalCall:'not_performed',providerCharge:'not_incurred'};},
  };
  return api;
}
