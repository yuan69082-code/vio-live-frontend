import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import test from 'node:test';

import {createStandaloneChatFixture} from '../test-support/standalone-chat-r1-fixtures.js';

async function conversation(f,title,key){
  const response=await f.call('/chat/conversations','POST',{title},{'idempotency-key':key});
  assert.equal(response.status,201,JSON.stringify(response));return response.data.conversation;
}

test('R3 public writes reject forged identity and bind exact concurrent idempotency facts',async t=>{
  const f=await createStandaloneChatFixture(t,{configure:false});
  const unauthenticated=await fetch(`${f.baseUrl}/api/v1/personal/chat/conversations`);
  assert.equal(unauthenticated.status,401);
  const forged=await f.call('/chat/conversations','POST',{title:'Forged',userId:f.ownerId},{'idempotency-key':'r3-forged-create-0001'});
  assert.equal(forged.status,400);
  const results=await Promise.all([
    f.call('/chat/conversations','POST',{title:'Exactly once'},{'idempotency-key':'r3-concurrent-create-0001'}),
    f.call('/chat/conversations','POST',{title:'Exactly once'},{'idempotency-key':'r3-concurrent-create-0001'}),
  ]);
  assert.deepEqual(results.map(result=>result.status),[201,201]);
  assert.deepEqual(results[0].data,results[1].data);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) AS n FROM personal_chat_operations WHERE idempotency_key='r3-concurrent-create-0001'").get().n,1);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) AS n FROM personal_chat_conversations").get().n,1);
  const conflict=await f.call('/chat/conversations','POST',{title:'Different facts'},{'idempotency-key':'r3-concurrent-create-0001'});
  assert.equal(conflict.status,409);assert.equal(conflict.error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(JSON.stringify(results).includes(f.testCredential),false);
});

test('R3 reads, search and sorting are side-effect free and never disclose execution secrets',async t=>{
  const f=await createStandaloneChatFixture(t);
  const alpha=await conversation(f,'Alpha record','r3-read-alpha-0001');
  const beta=await conversation(f,'Beta record','r3-read-beta-0001');
  const before={operations:f.app.database.connection.prepare('SELECT count(*) AS n FROM personal_chat_operations').get().n,
    events:f.app.database.connection.prepare('SELECT count(*) AS n FROM personal_chat_events').get().n};
  const searched=await f.call('/chat/conversations?status=active&query=alpha&sort=title_asc&limit=10');
  assert.equal(searched.status,200,JSON.stringify(searched));assert.deepEqual(searched.data.conversations.map(item=>item.conversationId),[alpha.conversationId]);
  for(let index=0;index<3;index+=1){assert.equal((await f.call(`/chat/conversations/${beta.conversationId}`)).status,200);assert.equal((await f.call('/chat/conversations/current')).status,200);}
  assert.equal(f.loopback.requests.length,0);
  assert.deepEqual({operations:f.app.database.connection.prepare('SELECT count(*) AS n FROM personal_chat_operations').get().n,
    events:f.app.database.connection.prepare('SELECT count(*) AS n FROM personal_chat_events').get().n},before);
  assert.equal(JSON.stringify(searched).includes(f.testCredential),false);
  for(const forbidden of ['authorization','credentialBindingId','storageRef','databasePath','baseUrl'])assert.equal(JSON.stringify(searched).includes(forbidden),false,forbidden);
  assert.equal((await f.call('/chat/conversations?status=invalid')).status,400);
  assert.equal((await f.call('/chat/conversations?sort=invalid')).status,400);
  assert.equal((await f.call('/chat/conversations?cursor=unissued')).status,400);
});

test('R3 attachment boundaries reject unsafe bytes and preserve assistant scope and orphan cleanup',async t=>{
  const f=await createStandaloneChatFixture(t,{configure:false});const c=await conversation(f,'Attachment scope','r3-attachment-scope-create');
  const bytes=Buffer.from('safe attachment','utf8');const sha256=`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const base={fileName:'safe.txt',mediaType:'text/plain',kind:'file',sizeBytes:bytes.length,sha256,contentBase64:bytes.toString('base64')};
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',{...base,unexpected:true},{'idempotency-key':'r3-attachment-unknown-field'})).status,400);
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',{...base,mediaType:'text/html'},{'idempotency-key':'r3-attachment-media-invalid'})).status,415);
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',{...base,sizeBytes:bytes.length+1},{'idempotency-key':'r3-attachment-size-invalid'})).status,409);
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',{...base,sha256:`sha256:${'0'.repeat(64)}`},{'idempotency-key':'r3-attachment-hash-invalid'})).status,409);
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',{...base,contentBase64:'c2FmZQ'},{'idempotency-key':'r3-attachment-base64-invalid'})).status,400);
  const created=await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',base,{'idempotency-key':'r3-attachment-safe-create'});
  assert.equal(created.status,201,JSON.stringify(created));const id=created.data.attachment.attachmentId;
  const stored=f.app.database.connection.prepare('SELECT storage_ref,managed_copy_id FROM personal_chat_attachments WHERE attachment_id=?').get(id);
  const storedPath=join(dirname(f.temp.databasePath),'standalone-chat-attachments',stored.storage_ref.slice(0,2),stored.storage_ref);
  assert.equal(existsSync(storedPath),true);
  assert.equal(f.app.database.connection.prepare('SELECT status FROM personal_managed_copies WHERE copy_id=?').get(stored.managed_copy_id).status,'active');
  await f.selectAssistant(f.secondAssistantId);
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}/attachments/${id}`)).status,404);
  await f.selectAssistant(f.firstAssistantId);
  const removed=await f.call(`/chat/conversations/${c.conversationId}/attachments/${id}/deletion`,'POST',{}, {'idempotency-key':'r3-attachment-safe-delete'});
  assert.equal(removed.status,200,JSON.stringify(removed));assert.equal(removed.data.status,'deleted');
  assert.equal(existsSync(storedPath),false);
  assert.equal(f.app.database.connection.prepare('SELECT status FROM personal_managed_copies WHERE copy_id=?').get(stored.managed_copy_id).status,'removed');
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}/attachments/${id}`)).status,404);
  assert.equal(f.loopback.requests.length,0);
});

test('R3 enforces one active turn per conversation without an implicit Provider retry',async t=>{
  const f=await createStandaloneChatFixture(t);const c=await conversation(f,'One active turn','r3-active-create');
  const first=await f.call(`/chat/conversations/${c.conversationId}/turns`,'POST',{branchId:c.currentBranchId,content:'First pending turn.',attachmentIds:[]},{'idempotency-key':'r3-active-turn-first'});
  assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.status,'waiting_confirmation');
  const second=await f.call(`/chat/conversations/${c.conversationId}/turns`,'POST',{branchId:c.currentBranchId,content:'Second forbidden turn.',attachmentIds:[]},{'idempotency-key':'r3-active-turn-second'});
  assert.equal(second.status,409,JSON.stringify(second));assert.equal(second.error.code,'TURN_ALREADY_ACTIVE');
  const replay=await f.call(`/chat/conversations/${c.conversationId}/turns`,'POST',{branchId:c.currentBranchId,content:'First pending turn.',attachmentIds:[]},{'idempotency-key':'r3-active-turn-first'});
  assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.data.turnId,first.data.turnId);
  assert.equal(f.loopback.requests.length,0);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) AS n FROM standalone_chat_turns WHERE conversation_id=?').get(c.conversationId).n,1);
});

test('R3 governed owner deletion removes catalog facts and registered attachment bytes only after the deadline',async t=>{
  let now=Date.parse('2026-09-06T00:00:00.000Z');
  const f=await createStandaloneChatFixture(t,{configure:false,applicationOptions:{personalClock:()=>new Date(now)}});
  const c=await conversation(f,'Governed R3 deletion','r3-owner-delete-create');
  const bytes=Buffer.from('owned R3 attachment','utf8');
  const upload=await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',{
    fileName:'owned.txt',mediaType:'text/plain',kind:'file',sizeBytes:bytes.length,
    sha256:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,contentBase64:bytes.toString('base64'),
  },{'idempotency-key':'r3-owner-delete-attachment'});
  assert.equal(upload.status,201,JSON.stringify(upload));
  const stored=f.app.database.connection.prepare('SELECT storage_ref,managed_copy_id FROM personal_chat_attachments').get();
  const storedPath=join(dirname(f.temp.databasePath),'standalone-chat-attachments',stored.storage_ref.slice(0,2),stored.storage_ref);
  assert.equal(existsSync(storedPath),true);
  const requested=await f.secured('/deletions','POST',{},'r3-owner-delete-request');
  assert.equal(requested.deletion.status,'waiting');assert.equal(existsSync(storedPath),true);
  now+=7*86400000;
  const completed=f.app.personalDeletionService.sweep();
  assert.equal(completed.length,1);assert.equal(completed[0].status,'completed');assert.equal(existsSync(storedPath),false);
  for(const table of ['personal_chat_conversations','personal_chat_branches','personal_chat_current_conversations',
    'personal_chat_branch_messages','personal_chat_turn_branches','personal_chat_operations','personal_chat_message_version_facts','personal_chat_regenerations',
    'personal_chat_attachments','personal_chat_exports','personal_chat_events']){
    assert.equal(f.app.database.connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,table);
  }
  assert.equal(f.app.database.connection.prepare('SELECT count(*) AS n FROM personal_managed_copies WHERE copy_id=?').get(stored.managed_copy_id).n,0);
  assert.deepEqual(f.app.database.connection.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(f.loopback.requests.length,0);
});
