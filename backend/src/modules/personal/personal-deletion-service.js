import { createHmac,randomUUID } from 'node:crypto';
import { ApplicationError,ConflictError,NotFoundError } from '../../core/errors.js';
import { digest,equalSecret,passwordKey,randomToken } from './personal-crypto.js';
import { fields,text } from './personal-validation.js';
import { ownerDeletionInventory,deleteInventory } from '../../integrations/database/personal-deletion-scope.js';

const DAY=86400000;
const failure=(code,statusCode=409)=>new ApplicationError('Personal deletion operation could not be completed.',{code,statusCode});
export function createPersonalDeletionService({database,identityService:identity,configurationService,repository,vault,managedCopies,
  clock=()=>new Date(),beforeOnlineDelete=()=>{}}) {
  const db=database.connection;
  const get=(sql,...args)=>db.prepare(sql).get(...args)??null;
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const time=()=>clock().toISOString();
  const task=id=>get('SELECT * FROM personal_deletion_tasks WHERE deletion_id=?',id);
  function pendingOwner(){return get("SELECT t.* FROM personal_deletion_tasks t JOIN personal_installation i ON i.owner_user_id=t.owner_user_id WHERE t.status NOT IN ('cancelled','completed') ORDER BY t.requested_at DESC LIMIT 1");}
  function counts(owner) {
    const result=get("SELECT sum(kind='file' AND status='active') f,sum(kind='backup' AND status='active') b FROM personal_managed_copies WHERE owner_user_id=?",owner);
    return {files:result?.f??0,backups:result?.b??0};
  }
  function view(t) {
    const c=counts(t.owner_user_id??'');
    return {deletionId:t.deletion_id,status:t.status,requestedAt:t.requested_at,cancellableUntil:t.cancellable_until,
      serverTime:time(),onlineDeletedAt:t.online_deleted_at,receiptExpiresAt:t.receipt_expires_at,backupDeadlineAt:t.backup_deadline_at,
      reason:t.reason,scope:JSON.parse(t.scope_json),onlineData:t.online_deleted_at?'deleted':'pending',
      managedFiles:{status:c.files?'pending':'completed',remaining:c.files},managedBackups:{status:c.backups?'pending':'completed',remaining:c.backups},
      storage:{sqlite:t.online_deleted_at?'logical_rows_deleted':'pending',wal:t.wal_status,physicalErasure:'not_claimed',userCopies:'not_managed'},
      externalCall:'not_performed',providerCharge:'not_incurred'};
  }
  function issue(t) {
    const token=randomToken();run('INSERT INTO personal_deletion_access VALUES(?,?,?)',digest(token),t.deletion_id,time());
    return {token,...limitedView(token,t)};
  }
  function limitedView(token,t) {return {deletion:view(t),csrfToken:createHmac('sha256',token).update('vio-personal-deletion-csrf/v1').digest('base64url')};}
  function verify(t,phrase,code='DELETION_VERIFICATION_FAILED',http=403) {
    const p=t?.owner_user_id?repository.identity(t.owner_user_id):null;
    let key;
    try {
      if(!p||p.status!=='deletion_pending')throw new Error('unavailable');
      key=passwordKey(phrase,p.password_salt);
      if(!equalSecret(digest(key),p.password_verifier))throw new Error('invalid');
    } catch {throw failure(code,http);}finally{key?.fill(0);}
  }
  function scope(owner) {
    const inventory=ownerDeletionInventory(db,owner);const c=counts(owner);
    return {inventory,summary:{tableCount:inventory.dependencies.length,rowCount:inventory.rows.length,managedFileCount:c.files,managedBackupCount:c.backups}};
  }
  function checkpoint(t) {
    if(!t.online_deleted_at)return;
    try {
      const r=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      run('UPDATE personal_deletion_tasks SET wal_status=? WHERE deletion_id=?',r.busy===0?'checkpoint_completed':'checkpoint_pending',t.deletion_id);
    }catch {run("UPDATE personal_deletion_tasks SET wal_status='checkpoint_pending' WHERE deletion_id=?",t.deletion_id);}
  }
  function process(id) {
    let t=task(id);if(!t)throw new NotFoundError('Deletion task was not found.');
    if(['cancelled','completed'].includes(t.status))return view(t);
    if(time()<t.cancellable_until)throw failure('DELETION_NOT_DUE');
    const attempt=randomUUID();
    try{run('INSERT INTO personal_deletion_attempts(attempt_id,deletion_id,started_at) VALUES(?,?,?)',attempt,id,time());}
    catch(error){if(error.errcode===5||error.code==='SQLITE_BUSY')throw failure('DELETION_DATABASE_BUSY',503);throw error;}
    try {
      if(!t.online_deleted_at) database.runInTransaction(()=>{
        t=task(id);
        if(t.status==='cancelled'||time()<t.cancellable_until)throw failure('DELETION_NOT_DUE');
        run("UPDATE personal_deletion_tasks SET status='processing',reason=NULL WHERE deletion_id=?",id);
        const {inventory,summary}=scope(t.owner_user_id);
        run('UPDATE personal_deletion_tasks SET inventory_json=?,scope_json=? WHERE deletion_id=?',JSON.stringify(inventory),JSON.stringify(summary),id);
        beforeOnlineDelete({deletionId:id,ownerUserId:t.owner_user_id});
        database.withOwnerDeletion(id,t.owner_user_id,inventory.rows,()=>deleteInventory(db,inventory.rows));
        const now=clock();
        run('INSERT INTO personal_deletion_tombstones VALUES(?,?,?)',t.owner_fingerprint,id,now.toISOString());
        run("UPDATE personal_deletion_tasks SET status='cleanup_pending',online_deleted_at=?,receipt_expires_at=?,backup_deadline_at=?,inventory_json=NULL WHERE deletion_id=?",
          now.toISOString(),new Date(now.getTime()+30*DAY).toISOString(),new Date(now.getTime()+14*DAY).toISOString(),id);
      });
      t=task(id);
      const cleanup=managedCopies.cleanup(t.owner_user_id);
      checkpoint(t);
      const c=counts(t.owner_user_id);
      const wal=task(id).wal_status;
      // Receipt finalization, residual copy metadata and this attempt must
      // commit together. An interruption must leave the task resumable, not
      // completed with owner-linked paths stranded outside receipt retention.
      database.runInTransaction(()=>{
        if(c.files||c.backups||wal!=='checkpoint_completed') {
          run("UPDATE personal_deletion_tasks SET status='cleanup_pending',reason=? WHERE deletion_id=?",c.backups&&time()>=t.backup_deadline_at?'managed_backup_deadline_exceeded':cleanup.failures?.[0]?.reason?.toLowerCase()??(wal!=='checkpoint_completed'?'sqlite_checkpoint_pending':'managed_cleanup_pending'),id);
        } else {
          // Once all controlled copies are gone, retain no owner identifier,
          // path, inventory, operation key or business content in the receipt.
          run("UPDATE personal_deletion_tasks SET status='completed',reason=NULL,owner_user_id=NULL WHERE deletion_id=?",id);
          run("DELETE FROM personal_managed_copies WHERE owner_user_id=? AND status='removed'",t.owner_user_id);
        }
        run("UPDATE personal_deletion_attempts SET completed_at=?,result='completed' WHERE attempt_id=?",time(),attempt);
      });
    }catch(error) {
      t=task(id);const reason=error.code==='SQLITE_BUSY'||error.errcode===5?'database_busy':error.code==='MANAGED_COPY_UNSAFE'?'managed_copy_unsafe':error.code==='MANAGED_COPY_CHANGED'?'managed_copy_changed':t.online_deleted_at?'managed_cleanup_failed':'online_deletion_failed';
      run('UPDATE personal_deletion_tasks SET status=?,reason=? WHERE deletion_id=?',t.online_deleted_at?'cleanup_pending':'failed',reason,id);
      run("UPDATE personal_deletion_attempts SET completed_at=?,result='failed',reason=? WHERE attempt_id=?",time(),reason,attempt);
    }
    return view(task(id));
  }
  return {
    pendingOwner,
    request(context,input,key) {
      fields(input,['confirmationId']);
      const result=configurationService.secured(context,'delete-personal-space',key,input,{subjectId:null,resourceType:'identity',resourceId:context.userId,
        action:'delete',operationType:'data_deletion',sensitiveDataCategories:[],securitySessionId:context.sessionId},()=>{
        const old=get("SELECT * FROM personal_deletion_tasks WHERE owner_user_id=? AND status NOT IN ('cancelled','completed')",context.userId);
        if(old)throw new ConflictError('Deletion is already pending.');
        const now=clock();const id=randomUUID();const {inventory,summary}=scope(context.userId);
        run("INSERT INTO personal_deletion_tasks(deletion_id,owner_user_id,owner_fingerprint,idempotency_key,requested_at,cancellable_until,status,scope_json,inventory_json) VALUES(?,?,?,?,?,?,'waiting',?,?)",
          id,context.userId,digest(`vio-deleted-owner/v1/${context.userId}`),digest(key),now.toISOString(),new Date(now.getTime()+7*DAY).toISOString(),JSON.stringify(summary),JSON.stringify(inventory));
        run("UPDATE users SET status='deletion_pending',updated_at=? WHERE user_id=?",now.toISOString(),context.userId);
        run('UPDATE personal_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',now.toISOString(),context.userId);
        identity.audit(context.userId,'deletion_started',context.sessionId);vault.lock(context.userId);
        return {deletionId:id};
      });
      if(result.operationStatus!=='completed')return result;
      const current=task(result.deletionId);
      // The immutable original operation remains recorded. Its later lawful
      // cancellation must not issue an unusable token or log out a new session.
      if(!current||current.status==='cancelled')return {operationStatus:'cancelled'};
      return {operationStatus:'completed',...issue(current)};
    },
    verifyAccess(input) {
      fields(input,['passphrase'],['passphrase']);
      if(repository.recentFailures(new Date(clock().getTime()-15*60000).toISOString())>=10)throw failure('ACCESS_RATE_LIMITED',429);
      const t=pendingOwner();
      try{verify(t,input.passphrase,'DELETION_ACCESS_DENIED',401);}catch(error){if(t?.owner_user_id)identity.audit(t.owner_user_id,'login_failed',null,true);throw error;}
      return issue(t);
    },
    authenticate(token,csrf=null) {
      if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw failure('DELETION_ACCESS_DENIED',401);
      const a=get('SELECT deletion_id FROM personal_deletion_access WHERE token_hash=?',digest(token));const t=a?task(a.deletion_id):null;
      if(!t||t.status==='cancelled')throw failure('DELETION_ACCESS_DENIED',401);
      if(t.status==='completed'&&t.receipt_expires_at&&time()>=t.receipt_expires_at)throw failure('DELETION_RECEIPT_EXPIRED',410);
      const result=limitedView(token,t);
      if(csrf!==null&&(typeof csrf!=='string'||!equalSecret(csrf,result.csrfToken)))throw failure('CSRF_DENIED',403);
      return {task:t,...result};
    },
    cancel(token,csrf,input) {
      fields(input,['passphrase','deviceName'],['passphrase','deviceName']);text(input.deviceName,'deviceName',80);
      const verified=this.authenticate(token,csrf).task;
      if(verified.online_deleted_at||!['waiting','failed'].includes(verified.status)||time()>=verified.cancellable_until)throw failure('DELETION_NOT_CANCELLABLE');
      if(repository.recentFailures(new Date(clock().getTime()-15*60000).toISOString())>=10)throw failure('ACCESS_RATE_LIMITED',429);
      // Failed verification audit survives: never write it in the transaction
      // that must roll back an unsuccessful cancellation.
      try{verify(verified,input.passphrase);}catch(error){identity.audit(verified.owner_user_id,'login_failed',null,true);throw error;}
      return database.runInTransaction(()=>{
        const {task:t}=this.authenticate(token,csrf);
        if(t.online_deleted_at||!['waiting','failed'].includes(t.status)||time()>=t.cancellable_until)throw failure('DELETION_NOT_CANCELLABLE');
        run("UPDATE users SET status='active',updated_at=? WHERE user_id=? AND status='deletion_pending'",time(),t.owner_user_id);
        run("UPDATE personal_deletion_tasks SET status='cancelled',inventory_json=NULL,reason=NULL,receipt_expires_at=? WHERE deletion_id=?",new Date(clock().getTime()+30*DAY).toISOString(),t.deletion_id);
        run('DELETE FROM personal_deletion_access WHERE deletion_id=?',t.deletion_id);
        return {status:'cancelled',reauthenticationRequired:true};
      });
    },
    retry(token,csrf,input) {fields(input,[]);const {task:t}=this.authenticate(token,csrf);process(t.deletion_id);return this.authenticate(token,csrf);},
    process,
    sweep() {
      const results=[];
      for(const t of db.prepare("SELECT * FROM personal_deletion_tasks WHERE status NOT IN ('completed','cancelled') AND cancellable_until<=?").all(time()))results.push(process(t.deletion_id));
      // Expired receipts only: unfinished controlled cleanup cannot be erased
      // to hide failure. Unknown/unregistered backups are never restorable.
      run("DELETE FROM personal_deletion_tasks WHERE status IN ('completed','cancelled') AND receipt_expires_at<=?",time());
      return results;
    },
    view:id=>{const t=task(id);if(!t)throw new NotFoundError('Deletion task was not found.');return view(t);},
  };
}
