import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';

import {createSqliteDatabase} from '../src/integrations/database/sqlite-database.js';

const MIGRATION='026_create_personal_multi_conversation.sql';
const R3_TABLES=[
  'personal_chat_conversations','personal_chat_branches','personal_chat_current_conversations',
  'personal_chat_branch_messages','personal_chat_turn_branches','personal_chat_operations',
  'personal_chat_message_version_facts','personal_chat_regenerations','personal_chat_attachments',
  'personal_chat_exports','personal_chat_events',
];
const NOW='2026-09-06T00:00:00.000Z';
const launcherRoot=process.env.VIO_TEST_PATHS_ROOT??null;

function temporaryRoot(prefix){return mkdtempSync(join(launcherRoot??tmpdir(),prefix));}
function removeStandaloneRoot(root){if(!launcherRoot)rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}

function migrationsThrough025(root){
  const path=join(root,'migrations-025');
  cpSync(resolve('migrations'),path,{recursive:true});
  rmSync(join(path,MIGRATION));
  rmSync(join(path,'027_create_context_assembly_ledger.sql'));
  rmSync(join(path,'028_create_local_long_term_memory.sql'));
  rmSync(join(path,'029_create_unified_capability_execution.sql'));
  return path;
}

function seedR1Default(connection){
  connection.exec('BEGIN');
  try{
    connection.prepare(`INSERT INTO users(user_id,primary_email,display_name,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?)`).run('r3-upgrade-owner',null,'Upgrade owner','active',NOW,NOW);
    connection.prepare(`INSERT INTO subjects(subject_id,owner_user_id,name,avatar_ref,basic_settings_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run('r3-upgrade-assistant','r3-upgrade-owner','Upgrade assistant',null,'{}','active',NOW,NOW);
    connection.prepare(`INSERT INTO personal_identities(user_id,password_salt,password_verifier,wrapped_vault_key,avatar,preferences_json,onboarding_completed,profile_version,selection_version,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('r3-upgrade-owner','salt','verifier','wrapped',null,'{"storagePreference":"local","contextMode":"balanced"}',1,1,1,NOW);
    connection.prepare(`INSERT INTO personal_sessions(session_id,user_id,token_hash,device_name,created_at,last_seen_at,expires_at,revoked_at)
      VALUES(?,?,?,?,?,?,?,NULL)`).run('r1-preserved-session','r3-upgrade-owner','r1-preserved-token-hash','Migration test',NOW,NOW,'2027-09-06T00:00:00.000Z');
    connection.prepare(`INSERT INTO conversations(conversation_id,user_id,subject_id,title,status,created_at,updated_at,last_activity_at)
      VALUES(?,?,?,?,?,?,?,?)`).run('r1-preserved-conversation','r3-upgrade-owner','r3-upgrade-assistant','Preserved R1 chat','active',NOW,NOW,NOW);
    connection.prepare(`INSERT INTO standalone_chat_default_conversations(user_id,assistant_id,conversation_id,created_at)
      VALUES(?,?,?,?)`).run('r3-upgrade-owner','r3-upgrade-assistant','r1-preserved-conversation',NOW);
    connection.prepare(`INSERT INTO messages(message_id,user_id,subject_id,conversation_id,sender_type,status,sequence_number,current_version_id,created_at,updated_at)
      VALUES(?,?,?,?,?,'active',1,NULL,?,?)`).run('r1-preserved-message','r3-upgrade-owner','r3-upgrade-assistant','r1-preserved-conversation','user',NOW,NOW);
    connection.prepare(`INSERT INTO message_versions(message_version_id,user_id,subject_id,conversation_id,message_id,version_number,sender_type,change_reason,content,parent_version_id,created_at)
      VALUES(?,?,?,?,?,1,'user','original',?,NULL,?)`).run('r1-preserved-version','r3-upgrade-owner','r3-upgrade-assistant','r1-preserved-conversation','r1-preserved-message','Preserve this exact R1 fact.',NOW);
    connection.prepare('UPDATE messages SET current_version_id=? WHERE message_id=?').run('r1-preserved-version','r1-preserved-message');
    connection.prepare(`INSERT INTO events(event_id,user_id,subject_id,event_type,source_type,source_ref,occurred_at,recorded_at,event_data_json,summary,status)
      VALUES(?,?,?,'message_created','message-service','r1-preserved-message',?,?,?,'Preserved R1 source event','consumed')`)
      .run('r1-preserved-event','r3-upgrade-owner','r3-upgrade-assistant',NOW,NOW,'{"messageId":"r1-preserved-message"}');
    connection.prepare(`INSERT INTO standalone_chat_turns(turn_id,user_id,assistant_id,conversation_id,created_by_session_id,idempotency_key,input_content_hash,
      user_message_id,user_message_version_id,source_event_id,assistant_message_id,assistant_message_version_id,confirmation_id,confirmation_kind,status,public_failure_code,recovery_reason,created_at,updated_at,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'processing',NULL,NULL,?,?,NULL)`).run('r1-preserved-turn','r3-upgrade-owner','r3-upgrade-assistant','r1-preserved-conversation','r1-preserved-session','r1-preserved-idempotency','sha256:0000000000000000000000000000000000000000000000000000000000000000','r1-preserved-message','r1-preserved-version','r1-preserved-event',NOW,NOW);
    connection.exec('COMMIT');
  }catch(error){connection.exec('ROLLBACK');throw error;}
}

test('026 installs a fresh R3 ledger with foreign keys and immutable protections',()=>{
  const root=temporaryRoot('vio-r3-fresh-');
  try{
    const database=createSqliteDatabase({databasePath:join(root,'fresh.sqlite'),migrationsPath:resolve('migrations')});
    try{
      assert.equal(database.connection.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=?').get(MIGRATION).n,1);
      for(const table of R3_TABLES)assert.equal(database.connection.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n,1,table);
      assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(),[]);
      assert.equal(database.connection.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'protect_personal_chat_%'").get().n>0,true);
    }finally{database.close();}
  }finally{removeStandaloneRoot(root);}
});

test('001-025 upgrades to 026 by preserving the exact R1 conversation and MessageVersion',()=>{
  const root=temporaryRoot('vio-r3-upgrade-');
  const file=join(root,'upgrade.sqlite');
  try{
    const old=createSqliteDatabase({databasePath:file,migrationsPath:migrationsThrough025(root)});
    seedR1Default(old.connection);old.close();
    const upgraded=createSqliteDatabase({databasePath:file,migrationsPath:resolve('migrations')});
    try{
      assert.deepEqual({...upgraded.connection.prepare(`SELECT user_id,assistant_id,conversation_id,is_r1_default
        FROM standalone_chat_default_conversations`).get()},{user_id:'r3-upgrade-owner',assistant_id:'r3-upgrade-assistant',conversation_id:'r1-preserved-conversation',is_r1_default:1});
      const catalog=upgraded.connection.prepare(`SELECT conversation_id,user_id,assistant_id,current_branch_id,status
        FROM personal_chat_conversations`).get();
      assert.equal(catalog.conversation_id,'r1-preserved-conversation');
      assert.equal(catalog.user_id,'r3-upgrade-owner');assert.equal(catalog.assistant_id,'r3-upgrade-assistant');assert.equal(catalog.status,'active');
      assert.deepEqual({...upgraded.connection.prepare(`SELECT conversation_id,selection_version FROM personal_chat_current_conversations`).get()},
        {conversation_id:'r1-preserved-conversation',selection_version:1});
      assert.deepEqual(upgraded.connection.prepare(`SELECT message_id,selected_version_id,sequence_number,hidden
        FROM personal_chat_branch_messages WHERE branch_id=? ORDER BY sequence_number`).all(catalog.current_branch_id).map(row=>({...row})),[
        {message_id:'r1-preserved-message',selected_version_id:'r1-preserved-version',sequence_number:1,hidden:0},
      ]);
      assert.equal(upgraded.connection.prepare('SELECT content FROM message_versions WHERE message_version_id=?').get('r1-preserved-version').content,'Preserve this exact R1 fact.');
      assert.deepEqual({...upgraded.connection.prepare('SELECT turn_id,user_id,assistant_id,conversation_id,status FROM standalone_chat_turns').get()},
        {turn_id:'r1-preserved-turn',user_id:'r3-upgrade-owner',assistant_id:'r3-upgrade-assistant',conversation_id:'r1-preserved-conversation',status:'processing'});
      assert.equal(upgraded.connection.prepare('SELECT branch_id FROM personal_chat_turn_branches WHERE turn_id=?').get('r1-preserved-turn').branch_id,catalog.current_branch_id);
      assert.deepEqual(upgraded.connection.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{upgraded.close();}
  }finally{removeStandaloneRoot(root);}
});

test('a failing 026 rolls back completely and leaves the 001-025 schema and facts intact',()=>{
  const root=temporaryRoot('vio-r3-rollback-');const file=join(root,'rollback.sqlite');
  try{
    const old=createSqliteDatabase({databasePath:file,migrationsPath:migrationsThrough025(root)});seedR1Default(old.connection);old.close();
    const broken=join(root,'migrations-broken');cpSync(resolve('migrations'),broken,{recursive:true});
    rmSync(join(broken,'027_create_context_assembly_ledger.sql'));
    rmSync(join(broken,'028_create_local_long_term_memory.sql'));
    rmSync(join(broken,'029_create_unified_capability_execution.sql'));
    const migration=join(broken,MIGRATION);writeFileSync(migration,readFileSync(migration,'utf8').replace(
      'CREATE TABLE personal_chat_conversations',
      'CREATE TABLE r3_partial_failure_probe(value TEXT);\nTHIS IS NOT SQL;\nCREATE TABLE personal_chat_conversations',
    ),'utf8');
    assert.throws(()=>createSqliteDatabase({databasePath:file,migrationsPath:broken}),/026_create_personal_multi_conversation/);
    const inspected=new DatabaseSync(file);
    try{
      assert.equal(inspected.prepare('SELECT count(*) AS n FROM schema_migrations').get().n,25);
      assert.equal(inspected.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=?').get(MIGRATION).n,0);
      assert.equal(inspected.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='r3_partial_failure_probe'").get().n,0);
      for(const table of R3_TABLES)assert.equal(inspected.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n,0,table);
      assert.equal(inspected.prepare('SELECT conversation_id FROM standalone_chat_default_conversations').get().conversation_id,'r1-preserved-conversation');
      assert.equal(inspected.prepare("SELECT count(*) AS n FROM pragma_table_info('standalone_chat_default_conversations') WHERE name='is_r1_default'").get().n,0);
      assert.deepEqual(inspected.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{inspected.close();}
  }finally{removeStandaloneRoot(root);}
});
