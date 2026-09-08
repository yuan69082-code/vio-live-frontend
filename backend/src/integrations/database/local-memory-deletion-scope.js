export function memoryDeletionRows(db, userId, assistantId, memoryId) {
  const tables = ['personal_local_memory_references', 'personal_local_memory_versions',
    'personal_local_memories'];
  return tables.flatMap(table => db.prepare(`SELECT rowid FROM ${table}
    WHERE user_id=? AND assistant_id=? AND memory_id=? ORDER BY rowid`)
    .all(userId, assistantId, memoryId).map(row => ({ table, rowid: row.rowid })));
}

export function installMemoryDeletionAuthority(db) {
  let active = null;
  db.function('vio_memory_deletion_authorized', (table, rowid) =>
    active?.rows.has(`${table}/${rowid}`) ? 1 : 0);
  return (deletionId, userId, assistantId, memoryId, rows, execute) => {
    if (active) throw new Error('Nested memory deletion authority is forbidden.');
    const task = db.prepare(`SELECT 1 FROM personal_local_memory_deletions d
      JOIN personal_local_memories m ON m.memory_id=d.memory_id
       AND m.user_id=d.user_id AND m.assistant_id=d.assistant_id
      WHERE d.deletion_id=? AND d.user_id=? AND d.assistant_id=? AND d.memory_id=?
       AND d.status='pending' AND m.status='deletion_pending'`).get(
      deletionId, userId, assistantId, memoryId,
    );
    if (!task) throw new Error('Scoped memory deletion is not pending.');
    const actual = memoryDeletionRows(db, userId, assistantId, memoryId);
    if (JSON.stringify(actual) !== JSON.stringify(rows)) {
      throw new Error('Memory deletion inventory changed.');
    }
    active = { rows: new Set(rows.map(row => `${row.table}/${row.rowid}`)) };
    try { return execute(); } finally { active = null; }
  };
}

export function deleteMemoryRows(db, rows) {
  db.exec('PRAGMA defer_foreign_keys=ON');
  const order = new Map([
    ['personal_local_memories', 0],
    ['personal_local_memory_references', 1],
    ['personal_local_memory_versions', 2],
  ]);
  for (const row of [...rows].sort((a, b) => order.get(a.table) - order.get(b.table))) {
    db.prepare(`DELETE FROM ${row.table} WHERE rowid=?`).run(row.rowid);
  }
}
