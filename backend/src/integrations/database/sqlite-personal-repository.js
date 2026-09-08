export function createSqlitePersonalRepository(db) {
  const get = (sql, ...args) => db.prepare(sql).get(...args) ?? null;
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  return {
    owner: () => get('SELECT owner_user_id FROM personal_installation WHERE singleton=1')?.owner_user_id ?? null,
    identity: (id) => get(`SELECT p.*,u.display_name,u.status,s.current_assistant_id FROM personal_identities p
      JOIN users u ON u.user_id=p.user_id JOIN user_spaces s ON s.user_id=p.user_id WHERE p.user_id=?`, id),
    addInvitation: (hash, expires) => run('INSERT INTO personal_initialization_invitations(invitation_hash,expires_at) VALUES (?,?)',hash,expires),
    activeInvitation: (now) => get('SELECT 1 FROM personal_initialization_invitations WHERE consumed_at IS NULL AND expires_at>? LIMIT 1',now),
    expireOpenInvitations: (now) => run('UPDATE personal_initialization_invitations SET expires_at=? WHERE consumed_at IS NULL AND expires_at>?',now,now),
    invitation: (hash) => get('SELECT * FROM personal_initialization_invitations WHERE invitation_hash=?',hash),
    consumeInvitation: (hash, time, key, user) => run('UPDATE personal_initialization_invitations SET consumed_at=?,initialization_key=?,owner_user_id=? WHERE invitation_hash=? AND consumed_at IS NULL',time,key,user,hash),
    createIdentity: (p) => {
      run('INSERT INTO personal_identities(user_id,password_salt,password_verifier,wrapped_vault_key,created_at) VALUES (?,?,?,?,?)',p.userId,p.salt,p.verifier,p.wrapped,p.now);
      run('INSERT INTO personal_installation(singleton,owner_user_id) VALUES(1,?)',p.userId);
    },
    addSession: (s) => run(`INSERT INTO personal_sessions(session_id,user_id,token_hash,device_name,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?,?)`,s.id,s.user,s.hash,s.device,s.now,s.now,s.expires),
    session: (hash) => get('SELECT s.*,u.status AS user_status FROM personal_sessions s JOIN users u ON u.user_id=s.user_id WHERE token_hash=?',hash),
    touchSession: (id, time) => run('UPDATE personal_sessions SET last_seen_at=? WHERE session_id=?',time,id),
    sessions: (user) => all('SELECT * FROM personal_sessions WHERE user_id=? ORDER BY created_at DESC,session_id',user),
    revokeSession: (user,id,now) => run('UPDATE personal_sessions SET revoked_at=? WHERE user_id=? AND session_id=? AND revoked_at IS NULL',now,user,id),
    audit: (e) => run('INSERT INTO personal_access_events(event_id,user_id,event_type,occurred_at,session_id,anomaly) VALUES(?,?,?,?,?,?)',e.id,e.user,e.type,e.now,e.session??null,e.anomaly?1:0),
    recentFailures: (since) => get("SELECT count(*) AS n FROM personal_access_events WHERE event_type='login_failed' AND occurred_at>?",since).n,
    audits: (user) => all('SELECT event_id,event_type,occurred_at,anomaly FROM personal_access_events WHERE user_id=? ORDER BY occurred_at DESC LIMIT 100',user),
    operation: (user,op,key) => get('SELECT * FROM personal_operations WHERE user_id=? AND operation=? AND idempotency_key=?',user,op,key),
    addOperation: (user,op,key,hash,result,now) => run('INSERT INTO personal_operations VALUES(?,?,?,?,?,?)',user,op,key,hash,JSON.stringify(result),now),
    profile: (user,p) => {
      run('UPDATE users SET display_name=?,updated_at=? WHERE user_id=?',p.displayName,p.now,user);
      run('UPDATE personal_identities SET avatar=?,preferences_json=?,profile_version=profile_version+1 WHERE user_id=?',p.avatar,JSON.stringify(p.preferences),user);
    },
    onboard: (user) => run('UPDATE personal_identities SET onboarding_completed=1 WHERE user_id=?',user),
    assistantVersion: (user,id) => get('SELECT version,avatar FROM personal_assistant_versions WHERE user_id=? AND assistant_id=?',user,id),
    addAssistant: (user,id,avatar) => run('INSERT INTO personal_assistant_versions(user_id,assistant_id,avatar) VALUES(?,?,?)',user,id,avatar),
    updateAssistant: (user,id,avatar) => run('UPDATE personal_assistant_versions SET version=version+1,avatar=? WHERE user_id=? AND assistant_id=?',avatar,user,id),
    select: (user) => run('UPDATE personal_identities SET selection_version=selection_version+1 WHERE user_id=?',user),
    credential: (id) => get('SELECT * FROM personal_credential_secrets WHERE credential_id=?',id),
    activeCredential: (user,provider) => get("SELECT * FROM personal_credential_secrets WHERE user_id=? AND provider_id=? AND status='active'",user,provider),
    revokeCredentials: (user,provider,now) => run("UPDATE personal_credential_secrets SET status='revoked',revoked_at=? WHERE user_id=? AND provider_id=? AND status='active'",now,user,provider),
    addCredential: (c) => run("INSERT INTO personal_credential_secrets VALUES(?,?,?,?,'active',?,NULL)",c.id,c.user,c.provider,c.encrypted,c.now),
    providerVersion: (user,id) => get('SELECT version FROM personal_provider_versions WHERE user_id=? AND provider_id=?',user,id)?.version ?? 1,
    addProvider: (user,id) => run('INSERT INTO personal_provider_versions(user_id,provider_id) VALUES(?,?)',user,id),
    touchProvider: (user,id) => run('UPDATE personal_provider_versions SET version=version+1 WHERE user_id=? AND provider_id=?',user,id),
    connectionByKey: (user,provider,key) => get('SELECT * FROM personal_connection_tests WHERE user_id=? AND provider_id=? AND idempotency_key=?',user,provider,key),
    connection: (user,provider,id) => get('SELECT * FROM personal_connection_tests WHERE user_id=? AND provider_id=? AND test_id=?',user,provider,id),
    addConnection: (c) => run("INSERT INTO personal_connection_tests VALUES(?,?,?,?,?,'running',NULL,?,NULL)",c.id,c.user,c.provider,c.key,c.hash,c.now),
    finishConnection: (id,status,reason,now) => run("UPDATE personal_connection_tests SET status=?,reason=?,completed_at=? WHERE test_id=? AND status='running'",status,reason,now,id),
    interruptConnections: (now) => run("UPDATE personal_connection_tests SET status='outcome_unknown',reason='process_interrupted',completed_at=? WHERE status='running' AND user_id IN (SELECT user_id FROM users WHERE status='active')",now),
    pendingConfirmation: (user,op,key) => get('SELECT * FROM personal_pending_confirmations WHERE user_id=? AND operation=? AND idempotency_key=?',user,op,key),
    addPendingConfirmation: (user,op,key,hash,id) => run('INSERT INTO personal_pending_confirmations VALUES(?,?,?,?,?)',user,op,key,hash,id),
    cancellation:(user,op,key)=>get('SELECT cancelled_at FROM personal_operation_cancellations WHERE user_id=? AND operation=? AND idempotency_key=?',user,op,key),
    cancelOperation:(user,op,key,now)=>run('INSERT OR IGNORE INTO personal_operation_cancellations VALUES(?,?,?,?)',user,op,key,now),
  };
}
