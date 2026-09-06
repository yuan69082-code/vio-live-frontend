import { createHash,randomUUID } from 'node:crypto';
import { closeSync,constants,fstatSync,lstatSync,openSync,readSync,realpathSync,unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname,isAbsolute,join,parse,relative,resolve,sep,win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApplicationError } from '../../core/errors.js';
import { digest } from './personal-crypto.js';

const repositoryRoot=fileURLToPath(new URL('../../../../',import.meta.url));
const fingerprint=owner=>digest(`vio-deleted-owner/v1/${owner}`);
const normalized=value=>process.platform==='win32'?resolve(value).toLowerCase():resolve(value);
const same=(a,b)=>normalized(a)===normalized(b);
const inside=(child,parent)=>{const value=relative(normalized(parent),normalized(child));return value!==''&&!value.startsWith(`..${sep}`)&&value!=='..'&&!isAbsolute(value);};
const fail=(code,statusCode=409)=>{throw new ApplicationError('Managed copy operation is unavailable.',{code,statusCode});};
const nowText=clock=>{const value=clock();return (value instanceof Date?value:new Date(value)).toISOString();};

function assertAncestors(path) {
  let current=resolve(path);
  while(true) {
    const info=lstatSync(current);
    // lstat rejects links/junctions without mistaking Windows 8.3 spellings
    // (for example the system TEMP alias) for a redirected filesystem object.
    if(info.isSymbolicLink()||!info.isDirectory())fail('MANAGED_COPY_UNSAFE_PATH');
    const parent=dirname(current);if(parent===current)break;current=parent;
  }
}

function rejectBroadRoot(path) {
  const canonical=resolve(path);
  for(const broad of [parse(canonical).root,homedir(),join(homedir(),'Documents')])if(same(canonical,broad)||inside(broad,canonical))fail('MANAGED_COPY_UNSAFE_PATH');
  if(same(canonical,repositoryRoot)||inside(canonical,repositoryRoot)||inside(repositoryRoot,canonical))fail('MANAGED_COPY_UNSAFE_PATH');
}

function authorizedRoot(root,allowed) {
  const allowedRoots=(Array.isArray(allowed)?allowed:[allowed]).filter(value=>typeof value==='string');
  if(typeof root!=='string'||!isAbsolute(root)||allowedRoots.length===0||allowedRoots.some(value=>!isAbsolute(value)))fail('MANAGED_COPY_UNSAFE_PATH');
  // Reject forbidden broad targets before any filesystem access. This also
  // keeps denied roots independent of their accessibility on the host.
  rejectBroadRoot(root);
  let selected=null;
  for(const configured of allowedRoots) {
    rejectBroadRoot(configured);const syntactic=same(root,configured);
    try {
      assertAncestors(configured);const actual=realpathSync.native(configured);rejectBroadRoot(actual);
      if(syntactic||same(root,actual)){selected={configured,actual};break;}
    } catch(error) {
      if(syntactic||error?.code!=='ENOENT')throw error;
    }
  }
  if(!selected)fail('MANAGED_COPY_UNSAFE_PATH');
  const canonical=resolve(root);
  assertAncestors(canonical);
  const actual=realpathSync.native(canonical);
  if(!same(actual,selected.actual))fail('MANAGED_COPY_UNSAFE_PATH');
  rejectBroadRoot(actual);
  assertAncestors(actual);return actual;
}

function targetFor(root,relativePath) {
  if(typeof relativePath!=='string'||!relativePath||isAbsolute(relativePath)||win32.isAbsolute(relativePath)||/[\u0000-\u001f:]/u.test(relativePath))fail('MANAGED_COPY_UNSAFE_PATH');
  const parts=relativePath.split(/[\\/]/u);
  if(parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/u.test(part)))fail('MANAGED_COPY_UNSAFE_PATH');
  const target=resolve(root,...parts);
  if(!inside(target,root))fail('MANAGED_COPY_UNSAFE_PATH');
  assertAncestors(dirname(target));
  return {target,relativePath:parts.join(sep)};
}

function fileFact(path) {
  const info=lstatSync(path);
  if(info.isSymbolicLink()||!info.isFile()||info.nlink!==1||!same(realpathSync.native(path),path))fail('MANAGED_COPY_UNSAFE_PATH');
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=fstatSync(fd);
    if(!opened.isFile()||opened.nlink!==1||opened.dev!==info.dev||opened.ino!==info.ino)fail('MANAGED_COPY_UNSAFE_PATH');
    const hash=createHash('sha256');const buffer=Buffer.alloc(64*1024);
    try {let count;while((count=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}
    finally {buffer.fill(0);}
    const after=fstatSync(fd);
    if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)fail('MANAGED_COPY_HASH_CONFLICT');
    return {hash:`sha256:${hash.digest('hex')}`,dev:opened.dev,ino:opened.ino,size:opened.size,mtimeMs:opened.mtimeMs,ctimeMs:opened.ctimeMs};
  } finally {closeSync(fd);}
}

function safeReason(error) {
  if(error instanceof ApplicationError)return error.code;
  if(['EACCES','EPERM','EBUSY','ETXTBSY'].includes(error?.code))return 'MANAGED_COPY_BUSY';
  return 'MANAGED_COPY_IO_UNAVAILABLE';
}

// No production creator is enabled by this module. Only an explicitly wired
// Vio-managed, single-owner copy creator may register files under its own root.
// It is not a backup API and never discovers arbitrary files or other repositories.
export function createPersonalManagedCopies({db,clock=()=>new Date(),allowedRootRequired=null}) {
  const rows=owner=>db.prepare('SELECT * FROM personal_managed_copies WHERE owner_user_id=? ORDER BY copy_id').all(owner);
  const activeOwner=owner=>db.prepare("SELECT 1 FROM users WHERE user_id=? AND status='active'").get(owner);
  const blocked=ownerFingerprint=>db.prepare("SELECT 1 FROM personal_deletion_tasks WHERE owner_fingerprint=? AND status<>'cancelled' LIMIT 1").get(ownerFingerprint)
    ||db.prepare('SELECT 1 FROM personal_deletion_tombstones WHERE owner_fingerprint=?').get(ownerFingerprint);
  const inventory=owner=>{
    const result={files:{registered:0,remaining:0,removed:0},backups:{registered:0,remaining:0,removed:0}};
    for(const row of rows(owner)) {const group=result[row.kind==='file'?'files':'backups'];group.registered++;group[row.status==='removed'?'removed':'remaining']++;}
    return result;
  };
  return {
    register({ownerUserId,kind,rootPath,relativePath}) {
      if(typeof ownerUserId!=='string'||!ownerUserId||!['file','backup'].includes(kind))fail('MANAGED_COPY_SCOPE_CONFLICT');
      if(!activeOwner(ownerUserId)||blocked(fingerprint(ownerUserId)))fail('MANAGED_COPY_OWNER_UNAVAILABLE');
      let root;let path;let fact;
      try {root=authorizedRoot(rootPath,allowedRootRequired);path=targetFor(root,relativePath);fact=fileFact(path.target);path.relativePath=relative(root,realpathSync.native(path.target));}
      catch(error){fail(safeReason(error));}
      const old=db.prepare('SELECT * FROM personal_managed_copies WHERE root_path=? AND relative_path=?').get(root,path.relativePath);
      if(old) {
        if(old.owner_user_id!==ownerUserId||old.kind!==kind||old.status!=='active'||old.content_hash!==fact.hash)fail('MANAGED_COPY_SCOPE_CONFLICT');
        return {copyId:old.copy_id};
      }
      const copyId=randomUUID();
      db.prepare("INSERT INTO personal_managed_copies(copy_id,owner_user_id,owner_fingerprint,kind,root_path,relative_path,content_hash,status,created_at) VALUES(?,?,?,?,?,?,?,'active',?)")
        .run(copyId,ownerUserId,fingerprint(ownerUserId),kind,root,path.relativePath,fact.hash,nowText(clock));
      return {copyId};
    },
    remove({ownerUserId,copyId}) {
      if(typeof ownerUserId!=='string'||!ownerUserId||typeof copyId!=='string'||!copyId)fail('MANAGED_COPY_SCOPE_CONFLICT');
      if(!activeOwner(ownerUserId)||blocked(fingerprint(ownerUserId)))fail('MANAGED_COPY_OWNER_UNAVAILABLE');
      const row=db.prepare('SELECT * FROM personal_managed_copies WHERE copy_id=?').get(copyId);
      if(!row||row.owner_user_id!==ownerUserId||row.kind!=='file'||row.owner_fingerprint!==fingerprint(ownerUserId))fail('MANAGED_COPY_SCOPE_CONFLICT');
      if(row.status==='removed')return {copyId:row.copy_id,status:'removed'};
      try {
        const root=authorizedRoot(row.root_path,allowedRootRequired);const path=targetFor(root,row.relative_path);
        let fact;
        try {fact=fileFact(path.target);}catch(error){if(error?.code!=='ENOENT')throw error;}
        if(fact) {
          if(fact.hash!==row.content_hash)fail('MANAGED_COPY_HASH_CONFLICT');
          unlinkSync(path.target);
        }
      } catch(error){fail(safeReason(error));}
      const changed=db.prepare("UPDATE personal_managed_copies SET status='removed',removed_at=? WHERE copy_id=? AND owner_user_id=? AND status='active'")
        .run(nowText(clock),row.copy_id,ownerUserId);
      if(changed.changes!==1)fail('MANAGED_COPY_SCOPE_CONFLICT');
      return {copyId:row.copy_id,status:'removed'};
    },
    inventory,
    cleanup(ownerUserId) {
      const active=rows(ownerUserId).filter(row=>row.status==='active');
      if(active.length&&(activeOwner(ownerUserId)||!db.prepare("SELECT 1 FROM personal_deletion_tasks WHERE owner_fingerprint=? AND status<>'cancelled' AND online_deleted_at IS NOT NULL").get(fingerprint(ownerUserId))))fail('MANAGED_COPY_DELETION_NOT_AUTHORIZED');
      const failures=[];
      for(const row of active) {
        try {
          if(row.owner_fingerprint!==fingerprint(ownerUserId))fail('MANAGED_COPY_SCOPE_CONFLICT');
          const root=authorizedRoot(row.root_path,allowedRootRequired);const path=targetFor(root,row.relative_path);
          let fact;
          try {fact=fileFact(path.target);}catch(error){if(error?.code!=='ENOENT')throw error;}
          if(fact) {
            if(fact.hash!==row.content_hash)fail('MANAGED_COPY_HASH_CONFLICT');
            assertAncestors(dirname(path.target));
            const last=lstatSync(path.target);
            if(!last.isFile()||last.isSymbolicLink()||last.nlink!==1||last.dev!==fact.dev||last.ino!==fact.ino||last.size!==fact.size||last.mtimeMs!==fact.mtimeMs||last.ctimeMs!==fact.ctimeMs)fail('MANAGED_COPY_HASH_CONFLICT');
            // Exact registered single file only. No directory enumeration,
            // recursive root removal, row-name guessing, or unowned deletion.
            unlinkSync(path.target);
          }
          db.prepare("UPDATE personal_managed_copies SET status='removed',removed_at=? WHERE copy_id=? AND status='active'").run(nowText(clock),row.copy_id);
        } catch(error) {failures.push({copyId:row.copy_id,kind:row.kind,reason:safeReason(error)});}
      }
      return {status:failures.length?'pending':'completed',...inventory(ownerUserId),failures};
    },
    assertRestoreAllowed(copyId) {
      const row=db.prepare('SELECT * FROM personal_managed_copies WHERE copy_id=?').get(copyId);
      if(!row)fail('MANAGED_COPY_NOT_FOUND',404);
      if(row.status!=='active'||!activeOwner(row.owner_user_id)||row.owner_fingerprint!==fingerprint(row.owner_user_id)||blocked(row.owner_fingerprint))fail('MANAGED_COPY_RESTORE_BLOCKED');
      try {
        const root=authorizedRoot(row.root_path,allowedRootRequired);const path=targetFor(root,row.relative_path);
        if(fileFact(path.target).hash!==row.content_hash)fail('MANAGED_COPY_HASH_CONFLICT');
      } catch(error){fail(safeReason(error));}
      return {copyId:row.copy_id,restoreAllowed:true};
    },
  };
}
