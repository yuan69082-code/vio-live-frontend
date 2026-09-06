import assert from 'node:assert/strict';
import test from 'node:test';

import {approveAndResumeTurn,createStandaloneChatFixture,responseTurn} from '../test-support/standalone-chat-r1-fixtures.js';

async function createConversation(f,title,key){
  const response=await f.call('/chat/conversations','POST',{title},{'idempotency-key':key});
  assert.equal(response.status,201,JSON.stringify(response));return response.data.conversation;
}

async function createCompletedR3Turn(f,conversation,content,key){
  const response=await f.call(`/chat/conversations/${conversation.conversationId}/turns`,'POST',{
    branchId:conversation.currentBranchId,content,attachmentIds:[],
  },{'idempotency-key':key});
  assert.equal(response.status,200,JSON.stringify(response));
  const completed=await approveAndResumeTurn(f,response,key);
  assert.equal(completed.turn.status,'completed',JSON.stringify(completed.response));return completed.turn;
}

async function requestRegenerationConfirmation(f,conversationId,message,branchId,key){
  const response=await f.call(`/chat/conversations/${conversationId}/messages/${message.messageId}/regenerations`,'POST',{
    branchId,baseVersionId:message.messageVersionId,
  },{'idempotency-key':key});
  assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.data.operationStatus,'confirmation_required');
  assert.equal(response.data.externalCall,'not_performed');return response.data.confirmation;
}

async function approve(f,confirmationId){
  const response=await f.call(`/confirmations/${confirmationId}/decision`,'POST',{decision:'approve'});
  assert.equal(response.status,200,JSON.stringify(response));
}

test('R3 response-loss recovery queries and exactly replays one persisted local operation after restart',async t=>{
  const f=await createStandaloneChatFixture(t,{configure:false});
  const created=await createConversation(f,'Response loss','r3-recovery-create-0001');
  const queried=await f.call('/chat/operations/by-idempotency-key/r3-recovery-create-0001');
  assert.equal(queried.status,200,JSON.stringify(queried));assert.equal(queried.data.status,'completed');
  assert.deepEqual(queried.data.result.conversation,created);
  await f.restart();
  const replay=await f.call('/chat/conversations','POST',{title:'Response loss'},{'idempotency-key':'r3-recovery-create-0001'});
  assert.equal(replay.status,201,JSON.stringify(replay));assert.deepEqual(replay.data.conversation,created);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) AS n FROM personal_chat_conversations").get().n,1);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) AS n FROM personal_chat_operations WHERE operation_type='conversation.create'").get().n,1);
  assert.equal(f.loopback.requests.length,0);
});

test('R3 branch turn restarts from one durable Provider result and publishes one subject message',async t=>{
  let fail=true;
  const f=await createStandaloneChatFixture(t,{
    providerResponses:[{type:'success',content:'One locked R3 result.'}],
    applicationOptions:{standaloneChatFaultInjector:{afterResultPersisted(){if(fail){fail=false;throw new Error('controlled R3 publication crash');}}}},
  });
  const c=await createConversation(f,'Turn recovery','r3-turn-recovery-create');
  const initial=await f.call(`/chat/conversations/${c.conversationId}/turns`,'POST',{branchId:c.currentBranchId,content:'Persist once.',attachmentIds:[]},{'idempotency-key':'r3-turn-recovery-run'});
  const waiting=responseTurn(initial);const confirmationId=waiting.confirmation.confirmationId;await approve(f,confirmationId);
  const interrupted=await f.call(`/chat/turns/${waiting.turnId}/recovery`,'POST',{action:'resume',confirmationId},{'idempotency-key':'r3-turn-recovery-resume'});
  assert.equal(interrupted.status,500,JSON.stringify(interrupted));assert.equal(f.loopback.requests.length,1);
  assert.equal(f.app.database.connection.prepare('SELECT status FROM standalone_chat_turns WHERE turn_id=?').get(waiting.turnId).status,'result_ready');
  await f.restart();
  const view=await f.call(`/chat/conversations/${c.conversationId}`);assert.equal(view.data.activeTurn.status,'result_ready');
  const recovered=await f.call(`/chat/turns/${waiting.turnId}/recovery`,'POST',{action:'resume'},{'idempotency-key':'r3-turn-recovery-publish'});
  assert.equal(recovered.status,200,JSON.stringify(recovered));assert.equal(responseTurn(recovered).status,'completed');
  const finalView=await f.call(`/chat/conversations/${c.conversationId}`);
  assert.deepEqual(finalView.data.messages.map(message=>message.content),['Persist once.','One locked R3 result.']);
  assert.equal(f.loopback.requests.length,1);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) AS n FROM messages WHERE conversation_id=? AND sender_type='subject'").get(c.conversationId).n,1);
});

test('R3 regeneration restart publishes the same locked result without a second Provider call',async t=>{
  let fail=true;
  const f=await createStandaloneChatFixture(t,{
    providerResponses:[{type:'success',content:'Original.'},{type:'success',content:'Locked regenerated result.',inputTokens:15,outputTokens:6}],
    applicationOptions:{standaloneChatFaultInjector:{afterRegenerationResultPersisted(){if(fail){fail=false;throw new Error('controlled regeneration publication crash');}}}},
  });
  f.app.permissionService.createPermission(f.ownerId,{subjectId:null,resourceType:'api',resourceId:f.providerId,action:'execute',permissionLevel:'always_allow',status:'active'});
  const c=await createConversation(f,'Regeneration recovery','r3-regen-recovery-create');
  const turn=await createCompletedR3Turn(f,c,'Create original.','r3-regen-recovery-turn');
  const view=(await f.call(`/chat/conversations/${c.conversationId}`)).data;
  const subject=view.messages.find(message=>message.messageId===turn.assistantMessage.messageId);
  const confirmation=await requestRegenerationConfirmation(f,c.conversationId,subject,view.branch.branchId,'r3-regen-recovery-confirm');await approve(f,confirmation.confirmationId);
  const body={branchId:view.branch.branchId,baseVersionId:subject.messageVersionId,confirmationId:confirmation.confirmationId,confirmationKind:'security'};
  const interrupted=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',body,{'idempotency-key':'r3-regen-recovery-run'});
  assert.equal(interrupted.status,500,JSON.stringify(interrupted));assert.equal(f.loopback.requests.length,2);
  assert.equal(f.app.database.connection.prepare('SELECT status FROM personal_chat_regenerations').get().status,'result_ready');
  const pending=await f.call('/chat/operations/by-idempotency-key/r3-regen-recovery-run');
  assert.equal(pending.status,200,JSON.stringify(pending));assert.equal(pending.data.status,'processing');assert.equal(pending.data.resourceType,'messageVersion');
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}`)).data.messages.at(-1).content,'Original.');
  await f.restart();
  const recovered=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',body,{'idempotency-key':'r3-regen-recovery-run'});
  assert.equal(recovered.status,200,JSON.stringify(recovered));assert.equal(recovered.data.message.content,'Locked regenerated result.');
  assert.equal(f.loopback.requests.length,2);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) AS n FROM personal_chat_regenerations').get().n,1);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) AS n FROM message_versions WHERE message_id=? AND change_reason='regenerated'").get(subject.messageId).n,1);
  const replay=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',body,{'idempotency-key':'r3-regen-recovery-run'});
  assert.deepEqual(replay.data,recovered.data);assert.equal(f.loopback.requests.length,2);
});

test('R3 regeneration outcome_unknown remains fail-closed across replay and restart',async t=>{
  const f=await createStandaloneChatFixture(t,{providerResponses:[{type:'success',content:'Original before unknown.'},{type:'disconnect'}]});
  f.app.permissionService.createPermission(f.ownerId,{subjectId:null,resourceType:'api',resourceId:f.providerId,action:'execute',permissionLevel:'always_allow',status:'active'});
  const c=await createConversation(f,'Unknown regeneration','r3-unknown-create');
  const turn=await createCompletedR3Turn(f,c,'Create original.','r3-unknown-turn');
  const view=(await f.call(`/chat/conversations/${c.conversationId}`)).data;
  const subject=view.messages.find(message=>message.messageId===turn.assistantMessage.messageId);
  const confirmation=await requestRegenerationConfirmation(f,c.conversationId,subject,view.branch.branchId,'r3-unknown-confirm');await approve(f,confirmation.confirmationId);
  const body={branchId:view.branch.branchId,baseVersionId:subject.messageVersionId,confirmationId:confirmation.confirmationId,confirmationKind:'security'};
  const unknown=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',body,{'idempotency-key':'r3-unknown-run'});
  assert.equal(unknown.status,200,JSON.stringify(unknown));assert.equal(unknown.data.status,'outcome_unknown');assert.equal(unknown.data.externalCall,'outcome_unknown');
  assert.equal(f.loopback.requests.length,2);
  const replay=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',body,{'idempotency-key':'r3-unknown-run'});
  assert.deepEqual(replay.data,unknown.data);assert.equal(f.loopback.requests.length,2);
  await f.restart();
  const afterRestart=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',body,{'idempotency-key':'r3-unknown-run'});
  assert.deepEqual(afterRestart.data,unknown.data);assert.equal(f.loopback.requests.length,2);
  const operation=await f.call('/chat/operations/by-idempotency-key/r3-unknown-run');assert.equal(operation.data.status,'outcome_unknown');
  assert.equal(f.app.database.connection.prepare('SELECT count(*) AS n FROM personal_chat_regenerations').get().n,1);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) AS n FROM message_versions WHERE message_id=? AND change_reason='regenerated'").get(subject.messageId).n,0);
});

test('R3 explicit retry uses a new regeneration execution after a conclusive 429',async t=>{
  const f=await createStandaloneChatFixture(t,{providerResponses:[
    {type:'success',content:'Original before retry.'},{type:'rate_limit'},{type:'success',content:'Successful explicit retry.',inputTokens:13,outputTokens:7},
  ]});
  f.app.permissionService.createPermission(f.ownerId,{subjectId:null,resourceType:'api',resourceId:f.providerId,action:'execute',permissionLevel:'always_allow',status:'active'});
  const c=await createConversation(f,'Retryable regeneration','r3-retryable-create');
  const turn=await createCompletedR3Turn(f,c,'Create original.','r3-retryable-turn');
  const view=(await f.call(`/chat/conversations/${c.conversationId}`)).data;
  const subject=view.messages.find(message=>message.messageId===turn.assistantMessage.messageId);
  const firstConfirmation=await requestRegenerationConfirmation(f,c.conversationId,subject,view.branch.branchId,'r3-retryable-confirm-one');await approve(f,firstConfirmation.confirmationId);
  const first=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',{
    branchId:view.branch.branchId,baseVersionId:subject.messageVersionId,confirmationId:firstConfirmation.confirmationId,confirmationKind:'security',
  },{'idempotency-key':'r3-retryable-execution-one'});
  assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.status,'failed');assert.equal(first.data.error.code,'PROVIDER_RATE_LIMITED');
  assert.equal(first.data.externalCall,'performed');assert.equal(f.loopback.requests.length,2);
  const replay=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',{
    branchId:view.branch.branchId,baseVersionId:subject.messageVersionId,confirmationId:firstConfirmation.confirmationId,confirmationKind:'security',
  },{'idempotency-key':'r3-retryable-execution-one'});
  assert.deepEqual(replay.data,first.data);assert.equal(f.loopback.requests.length,2);
  const secondConfirmation=await requestRegenerationConfirmation(f,c.conversationId,subject,view.branch.branchId,'r3-retryable-confirm-two');await approve(f,secondConfirmation.confirmationId);
  const second=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',{
    branchId:view.branch.branchId,baseVersionId:subject.messageVersionId,confirmationId:secondConfirmation.confirmationId,confirmationKind:'security',
  },{'idempotency-key':'r3-retryable-execution-two'});
  assert.equal(second.status,200,JSON.stringify(second));assert.equal(second.data.message.content,'Successful explicit retry.');
  assert.equal(f.loopback.requests.length,3);
  assert.deepEqual(f.app.database.connection.prepare('SELECT status FROM personal_chat_regenerations ORDER BY started_at,execution_id').all().map(row=>row.status),['retryable','completed']);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) AS n FROM message_versions WHERE message_id=? AND change_reason='regenerated'").get(subject.messageId).n,1);
});
