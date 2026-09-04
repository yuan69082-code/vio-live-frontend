import { ConflictError } from '../../core/errors.js';

const quote = value => `"${value.replaceAll('"','""')}"`;
const control = name => name.startsWith('personal_deletion_') || name === 'personal_managed_copies' || name === 'schema_migrations' || name.startsWith('sqlite_');

// Inventory keys and FK edges only: never copy message bodies or ciphertext
// into the deletion task. Global/unowned rows are not selected by table name.
export function ownerDeletionInventory(db, owner) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name).filter(n=>!control(n));
  const metadata = new Map(tables.map(name=>{
    const columns=db.prepare(`PRAGMA table_info(${quote(name)})`).all();
    const groups=new Map();
    for(const fk of db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all()) {
      if(!groups.has(fk.id))groups.set(fk.id,[]);groups.get(fk.id).push(fk);
    }
    return [name,{name,columns,edges:[...groups.values()].map(g=>g.sort((a,b)=>a.seq-b.seq)),rows:new Map()}];
  }));
  function add(table,row) {
    for(const c of ['user_id','owner_user_id'])if(table.columns.some(x=>x.name===c)&&row[c]!=null&&row[c]!==owner)throw new ConflictError('Deletion scope crosses owner boundary.');
    if(table.rows.has(row._scope_rowid))return false;
    table.rows.set(row._scope_rowid,row);return true;
  }
  for(const table of metadata.values()) {
    const owners=table.columns.filter(c=>['user_id','owner_user_id'].includes(c.name));
    if(!owners.length)continue;
    const keys=new Set([...owners.map(c=>c.name),...table.columns.filter(c=>c.pk).map(c=>c.name),...table.edges.flatMap(g=>g.map(f=>f.from))]);
    // Parent referenced columns may not be the primary key.
    for(const child of metadata.values())for(const edge of child.edges)for(const fk of edge)if(fk.table===table.name&&fk.to)keys.add(fk.to);
    table.keys=keys;
    const sql=`SELECT rowid AS _scope_rowid,${[...keys].map(quote).join(',')} FROM ${quote(table.name)} WHERE ${owners.map(c=>`${quote(c.name)}=?`).join(' OR ')}`;
    for(const row of db.prepare(sql).all(...owners.map(()=>owner)))add(table,row);
  }
  let changed=true;
  while(changed) {
    changed=false;
    for(const table of metadata.values())for(const edge of table.edges) {
      const parent=metadata.get(edge[0].table);if(!parent?.rows.size)continue;
      const keys=new Set([...table.columns.filter(c=>c.pk||['user_id','owner_user_id'].includes(c.name)).map(c=>c.name),...table.edges.flatMap(g=>g.map(f=>f.from))]);
      for(const child of metadata.values())for(const group of child.edges)for(const fk of group)if(fk.table===table.name&&fk.to)keys.add(fk.to);
      for(const row of parent.rows.values()) {
        const values=edge.map(f=>row[f.to||parent.columns.find(c=>c.pk===f.seq+1)?.name]);
        if(values.some(v=>v==null))continue;
        const sql=`SELECT rowid AS _scope_rowid${keys.size?','+[...keys].map(quote).join(','):''} FROM ${quote(table.name)} WHERE ${edge.map(f=>`${quote(f.from)}=?`).join(' AND ')}`;
        for(const found of db.prepare(sql).all(...values))changed=add(table,found)||changed;
      }
    }
  }
  const rows=[];const dependencies=[];
  for(const table of metadata.values())if(table.rows.size) {
    for(const row of table.rows.values())rows.push({table:table.name,rowid:row._scope_rowid,key:Object.fromEntries(table.columns.filter(c=>c.pk).map(c=>[c.name,row[c.name]]))});
    dependencies.push({table:table.name,references:[...new Set(table.edges.map(g=>g[0].table))]});
  }
  return {rows,dependencies};
}

export function installOwnerDeletionAuthority(db) {
  let active=null;
  db.function('vio_owner_deletion_authorized',(table,rowid)=>active?.rows.has(`${table}/${rowid}`)?1:0);
  return (taskId,owner,rows,execute)=>{
    if(active)throw new Error('Nested deletion authority is forbidden.');
    const task=db.prepare("SELECT 1 FROM personal_deletion_tasks t JOIN users u ON u.user_id=t.owner_user_id WHERE t.deletion_id=? AND t.owner_user_id=? AND t.status='processing' AND u.status='deletion_pending'").get(taskId,owner);
    if(!task)throw new Error('Scoped deletion task is not executing.');
    const actual=ownerDeletionInventory(db,owner);
    if(JSON.stringify(actual.rows)!==JSON.stringify(rows))throw new Error('Deletion inventory changed.');
    active={taskId,owner,rows:new Set(rows.map(r=>`${r.table}/${r.rowid}`))};
    try{return execute();}finally{active=null;}
  };
}

export function deleteInventory(db,rows) {
  // Deferred FK checking handles existing message/current-version cycles.
  // Foreign keys remain ON and are explicitly verified before commit.
  db.exec('PRAGMA defer_foreign_keys=ON');
  for(const row of rows)db.prepare(`DELETE FROM ${quote(row.table)} WHERE rowid=?`).run(row.rowid);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Deletion foreign-key verification failed.');
}
