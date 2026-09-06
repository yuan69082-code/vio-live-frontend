import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';

import {
  approveAndResumeTurn,
  createStandaloneChatFixture,
  responseTurn,
} from '../test-support/standalone-chat-r1-fixtures.js';

async function createConversation(f, title, key) {
  const response = await f.call('/chat/conversations', 'POST', {title}, {'idempotency-key': key});
  assert.equal(response.status, 201, JSON.stringify(response));
  return response.data.conversation;
}

async function selectConversation(f, conversation, selectionVersion, key) {
  const response = await f.call(`/chat/conversations/${conversation.conversationId}/selection`, 'POST',
    {expectedSelectionVersion: selectionVersion}, {'idempotency-key': key});
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.data;
}

async function createR3Turn(f, conversation, content, key) {
  const response = await f.call(`/chat/conversations/${conversation.conversationId}/turns`, 'POST', {
    branchId: conversation.currentBranchId,
    content,
    attachmentIds: [],
  }, {'idempotency-key': key});
  assert.equal(response.status, 200, JSON.stringify(response));
  const completed = await approveAndResumeTurn(f, response, key);
  assert.equal(completed.turn.status, 'completed', JSON.stringify(completed.response));
  return completed.turn;
}

test('R3 catalog isolates two owners with two assistants and three conversations per assistant',async t=>{
  const fixtures=[await createStandaloneChatFixture(t,{configure:false}),await createStandaloneChatFixture(t,{configure:false})];
  const all=[];
  for(const [ownerIndex,f] of fixtures.entries()){
    for(const [assistantIndex,assistantId] of [f.firstAssistantId,f.secondAssistantId].entries()){
      await f.selectAssistant(assistantId);
      const created=[];
      for(let index=0;index<3;index+=1)created.push(await createConversation(f,`Owner ${ownerIndex+1} assistant ${assistantIndex+1} chat ${index+1}`,`r3-matrix-${ownerIndex}-${assistantIndex}-${index}-0001`));
      const listed=await f.call('/chat/conversations?status=all&sort=created_asc');
      assert.equal(listed.status,200,JSON.stringify(listed));assert.equal(listed.data.conversations.length,3);
      assert.deepEqual(new Set(listed.data.conversations.map(item=>item.conversationId)),new Set(created.map(item=>item.conversationId)));
      all.push(...created.map(item=>item.conversationId));
    }
  }
  assert.equal(new Set(all).size,12);
  await fixtures[0].selectAssistant(fixtures[0].firstAssistantId);
  assert.equal((await fixtures[0].call(`/chat/conversations/${all.at(-1)}`)).status,404);
  assert.equal(fixtures[0].loopback.requests.length,0);assert.equal(fixtures[1].loopback.requests.length,0);
});

test('R3 conversation cursors are stable, scoped to the exact list, and side-effect free',async t=>{
  const f=await createStandaloneChatFixture(t,{configure:false});
  const created=[];
  for(let index=0;index<3;index+=1)created.push(await createConversation(f,`Cursor chat ${index+1}`,`r3-cursor-create-${index}-0001`));
  const first=await f.call('/chat/conversations?status=active&sort=created_asc&limit=2');
  assert.equal(first.status,200,JSON.stringify(first));assert.deepEqual(first.data.conversations.map(item=>item.conversationId),created.slice(0,2).map(item=>item.conversationId));
  assert.equal(typeof first.data.nextCursor,'string');
  const second=await f.call(`/chat/conversations?status=active&sort=created_asc&limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`);
  assert.equal(second.status,200,JSON.stringify(second));assert.deepEqual(second.data.conversations.map(item=>item.conversationId),[created[2].conversationId]);assert.equal(second.data.nextCursor,null);
  const mismatched=await f.call(`/chat/conversations?status=active&sort=created_desc&limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`);
  assert.equal(mismatched.status,400);assert.equal(mismatched.error.code,'CONVERSATION_CURSOR_INVALID');
  const malformed=await f.call('/chat/conversations?status=active&sort=created_asc&limit=2&cursor=not%2Ba%2Fcursor');
  assert.equal(malformed.status,400);assert.equal(malformed.error.code,'CONVERSATION_CURSOR_INVALID');
  assert.equal(f.loopback.requests.length,0);
});

test('R3 conversation catalog, selection, turns and assistant isolation use verified personal scope', async (t) => {
  const f = await createStandaloneChatFixture(t, {
    providerResponses: [
      {type: 'success', content: 'First R3 answer.'},
      {type: 'success', content: 'Second R3 answer.'},
      {type: 'success', content: 'Other assistant answer.'},
    ],
  });
  const empty = await f.call('/chat/conversations');
  assert.equal(empty.status, 200, JSON.stringify(empty));
  assert.deepEqual(empty.data.conversations, []);
  assert.equal(empty.data.selectionVersion, 0);

  const first = await createConversation(f, 'First R3 conversation', 'r3-create-first-0001');
  const second = await createConversation(f, 'Second R3 conversation', 'r3-create-second-0001');
  assert.notEqual(first.conversationId, second.conversationId);
  assert.equal(f.loopback.requests.length, 0);
  const replay = await f.call('/chat/conversations', 'POST', {title: 'First R3 conversation'}, {'idempotency-key': 'r3-create-first-0001'});
  assert.deepEqual(replay.data.conversation, first);

  const selected = await selectConversation(f, first, 0, 'r3-select-first-0001');
  assert.equal(selected.selectionVersion, 1);
  const firstTurn = await createR3Turn(f, first, 'First R3 user message.', 'r3-first-turn-0001');
  assert.equal(firstTurn.assistantMessage.content, 'First R3 answer.');
  const secondSelected = await selectConversation(f, second, 1, 'r3-select-second-0001');
  assert.equal(secondSelected.selectionVersion, 2);
  await createR3Turn(f, second, 'Second conversation message.', 'r3-second-turn-0001');

  const firstRead = await f.call(`/chat/conversations/${first.conversationId}`);
  assert.deepEqual(firstRead.data.messages.map(message => message.content), [
    'First R3 user message.', 'First R3 answer.',
  ]);
  const secondRead = await f.call(`/chat/conversations/${second.conversationId}`);
  assert.deepEqual(secondRead.data.messages.map(message => message.content), [
    'Second conversation message.', 'Second R3 answer.',
  ]);

  await f.selectAssistant(f.secondAssistantId);
  const isolated = await f.call('/chat/conversations?status=all');
  assert.deepEqual(isolated.data.conversations, []);
  assert.equal((await f.call(`/chat/conversations/${first.conversationId}`)).status, 404);
  const other = await createConversation(f, 'Other assistant conversation', 'r3-other-assistant-0001');
  await selectConversation(f, other, 0, 'r3-other-select-0001');
  await createR3Turn(f, other, 'Other assistant question.', 'r3-other-turn-0001');
  assert.equal(f.loopback.requests.length, 3);

  await f.selectAssistant(f.firstAssistantId);
  const restored = await f.call('/chat/conversations/current');
  assert.equal(restored.data.conversation.conversationId, second.conversationId);
  assert.deepEqual(restored.data.messages.map(message => message.content), [
    'Second conversation message.', 'Second R3 answer.',
  ]);
});

test('R3 multi-turn Provider context is bounded to the selected conversation and branch versions',async t=>{
  const f=await createStandaloneChatFixture(t,{providerResponses:[
    {type:'success',content:'First bounded answer.'},{type:'success',content:'Second bounded answer.'},
  ]});
  const c=await createConversation(f,'Bounded context','r3-context-create-0001');
  await createR3Turn(f,c,'First bounded question.','r3-context-turn-one');
  await createR3Turn(f,c,'Second bounded question.','r3-context-turn-two');
  assert.equal(f.loopback.requests.length,2);
  const messages=f.loopback.requests[1].body.messages;
  assert.deepEqual(messages.slice(1).map(item=>[item.role,item.content]),[
    ['user','First bounded question.'],['assistant','First bounded answer.'],['user','Second bounded question.'],
  ]);
  assert.equal(messages[0].role,'system');assert.match(messages[0].content,/First controlled assistant/);
  assert.equal(JSON.stringify(messages).includes('Second controlled assistant'),false);
});

test('R3 rename archive restore delete and operation replay are versioned and side-effect free', async (t) => {
  const f = await createStandaloneChatFixture(t, {configure:false});
  let c = await createConversation(f, 'Lifecycle', 'r3-life-create-0001');
  const renamed = await f.call(`/chat/conversations/${c.conversationId}`, 'PATCH', {title:'Renamed',expectedVersion:c.version}, {'idempotency-key':'r3-life-rename-0001'});
  assert.equal(renamed.status,200,JSON.stringify(renamed));c=renamed.data.conversation;
  assert.equal(c.title,'Renamed');
  const stale = await f.call(`/chat/conversations/${c.conversationId}`, 'PATCH', {title:'Stale',expectedVersion:1}, {'idempotency-key':'r3-life-stale-0001'});
  assert.equal(stale.status,409);
  const archived=await f.call(`/chat/conversations/${c.conversationId}/archive`,'POST',{expectedVersion:c.version},{'idempotency-key':'r3-life-archive-0001'});
  assert.equal(archived.status,200,JSON.stringify(archived));c=archived.data.conversation;
  assert.equal(c.status,'archived');
  const restored=await f.call(`/chat/conversations/${c.conversationId}/restore`,'POST',{expectedVersion:c.version},{'idempotency-key':'r3-life-restore-0001'});
  assert.equal(restored.status,200,JSON.stringify(restored));c=restored.data.conversation;
  const removed=await f.call(`/chat/conversations/${c.conversationId}/deletion`,'POST',{expectedVersion:c.version,confirmation:'delete'},{'idempotency-key':'r3-life-delete-0001'});
  assert.equal(removed.status,200,JSON.stringify(removed));
  assert.equal((await f.call(`/chat/conversations/${c.conversationId}`)).status,404);
  const operation=await f.call('/chat/operations/by-idempotency-key/r3-life-delete-0001');
  assert.equal(operation.status,200);assert.equal(operation.data.status,'completed');
  assert.equal(operation.data.resourceId,c.conversationId);assert.equal(f.loopback.requests.length,0);
});

test('R3 editing, version selection, branch restart, hide and clear preserve immutable versions', async (t) => {
  const f=await createStandaloneChatFixture(t,{providerResponses:[{type:'success',content:'Original answer.'}]});
  let c=await createConversation(f,'Versioned chat','r3-version-create-0001');await selectConversation(f,c,0,'r3-version-select-0001');
  const turn=await createR3Turn(f,c,'Original user text.','r3-version-turn-0001');
  let view=(await f.call(`/chat/conversations/${c.conversationId}`)).data;c=view.conversation;
  const user=view.messages[0];const subject=view.messages[1];const branch=view.branch;
  const edited=await f.call(`/chat/conversations/${c.conversationId}/messages/${user.messageId}`,'PATCH',{branchId:branch.branchId,baseVersionId:user.messageVersionId,content:'Edited user text.'},{'idempotency-key':'r3-edit-message-0001'});
  assert.equal(edited.status,200,JSON.stringify(edited));assert.equal(edited.data.message.content,'Edited user text.');
  const versions=await f.call(`/chat/conversations/${c.conversationId}/messages/${user.messageId}/versions`);
  assert.equal(versions.data.versions.length,2);assert.equal(versions.data.versions[0].content,'Original user text.');
  assert.deepEqual(versions.data.versions.map(v=>v.messageId),[user.messageId,user.messageId]);
  assert.deepEqual(versions.data.versions.map(v=>v.createdAt),[user.createdAt,user.createdAt]);
  assert.equal(versions.data.versions[1].versionCreatedAt,edited.data.message.versionCreatedAt);
  const selected=await f.call(`/chat/conversations/${c.conversationId}/messages/${user.messageId}/version-selection`,'POST',{branchId:branch.branchId,messageVersionId:user.messageVersionId,expectedBranchVersion:edited.data.branch.version},{'idempotency-key':'r3-select-version-0001'});
  assert.equal(selected.status,200,JSON.stringify(selected));assert.equal(selected.data.message.content,'Original user text.');
  const branched=await f.call(`/chat/conversations/${c.conversationId}/branches`,'POST',{sourceBranchId:branch.branchId,restartAfterMessageId:user.messageId,title:'Alternative'},{'idempotency-key':'r3-branch-create-0001'});
  assert.equal(branched.status,201,JSON.stringify(branched));assert.notEqual(branched.data.branch.branchId,branch.branchId);
  const hidden=await f.call(`/chat/conversations/${c.conversationId}/messages/${user.messageId}/deletion`,'POST',{branchId:branched.data.branch.branchId,expectedBranchVersion:branched.data.branch.version},{'idempotency-key':'r3-hide-message-0001'});
  assert.equal(hidden.status,200,JSON.stringify(hidden));
  const oldBranch=await f.call(`/chat/conversations/${c.conversationId}/branches/${branch.branchId}/selection`,'POST',{expectedConversationVersion:branched.data.conversation.version},{'idempotency-key':'r3-old-branch-select-0001'});
  assert.equal(oldBranch.status,200,JSON.stringify(oldBranch));
  const unchanged=await f.call(`/chat/conversations/${c.conversationId}`);
  assert.deepEqual(unchanged.data.messages.map(m=>m.content),['Original user text.','Original answer.']);
  const cleared=await f.call(`/chat/conversations/${c.conversationId}/clear`,'POST',{branchId:branch.branchId,expectedBranchVersion:selected.data.branch.version},{'idempotency-key':'r3-clear-0001'});
  assert.equal(cleared.status,200,JSON.stringify(cleared));assert.deepEqual(cleared.data.messages,[]);
  const listedAfterClear=await f.call('/chat/conversations?status=active&sort=updated_desc');
  assert.equal(listedAfterClear.status,200,JSON.stringify(listedAfterClear));
  assert.equal(listedAfterClear.data.conversations.find(item=>item.conversationId===c.conversationId).messageCount,0);
  assert.equal(responseTurn({data:turn}).turnId,turn.turnId);
});

test('R3 controlled attachments and conversation exports preserve scope and hide storage facts', async (t) => {
  const f=await createStandaloneChatFixture(t,{providerResponses:[{type:'success',content:'Answer with attachment context.'}]});
  const c=await createConversation(f,'Attachment chat','r3-attachment-create-conversation');
  const bytes=Buffer.from('controlled attachment bytes','utf8');
  const sha256=`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const created=await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',{
    fileName:'notes.txt',mediaType:'text/plain',kind:'file',sizeBytes:bytes.length,sha256,contentBase64:bytes.toString('base64'),
  },{'idempotency-key':'r3-attachment-create-0001'});
  assert.equal(created.status,201,JSON.stringify(created));
  const attachment=created.data.attachment;
  assert.equal(attachment.sha256,sha256);
  assert.equal(JSON.stringify(created).includes('storageRef'),false);
  const content=await f.call(`/chat/conversations/${c.conversationId}/attachments/${attachment.attachmentId}/content`);
  assert.equal(Buffer.from(content.data.contentBase64,'base64').toString('utf8'),'controlled attachment bytes');
  const turnResponse=await f.call(`/chat/conversations/${c.conversationId}/turns`,'POST',{
    branchId:c.currentBranchId,content:'Use the attached fact.',attachmentIds:[attachment.attachmentId],
  },{'idempotency-key':'r3-attachment-turn-0001'});
  assert.equal(turnResponse.status,200,JSON.stringify(turnResponse));
  const completed=await approveAndResumeTurn(f,turnResponse,'r3-attachment-turn-0001');
  assert.equal(completed.turn.status,'completed');
  const view=await f.call(`/chat/conversations/${c.conversationId}`);
  assert.deepEqual(view.data.messages[0].attachmentIds,[attachment.attachmentId]);
  const linkedDelete=await f.call(`/chat/conversations/${c.conversationId}/attachments/${attachment.attachmentId}/deletion`,'POST',{}, {'idempotency-key':'r3-linked-delete-0001'});
  assert.equal(linkedDelete.status,409);
  const exported=await f.call(`/chat/conversations/${c.conversationId}/exports`,'POST',{format:'json'},{'idempotency-key':'r3-export-json-0001'});
  assert.equal(exported.status,200,JSON.stringify(exported));
  const exportValue=JSON.parse(exported.data.export.content);
  assert.equal(exportValue.schemaVersion,'vio-personal-conversation-export/v1');
  assert.equal(exportValue.messages.length,2);
  assert.deepEqual(exportValue.attachments.map(item=>item.fileName),['notes.txt']);
  assert.equal(JSON.stringify(exported).includes(f.testCredential),false);
  assert.equal(JSON.stringify(exported).includes('storageRef'),false);

  const invalid=await f.call(`/chat/conversations/${c.conversationId}/attachments`,'POST',{
    fileName:'../escape.txt',mediaType:'text/plain',kind:'file',sizeBytes:bytes.length,sha256,contentBase64:bytes.toString('base64'),
  },{'idempotency-key':'r3-attachment-invalid-0001'});
  assert.equal(invalid.status,400);
  assert.equal(f.loopback.requests.length,1);
});

test('R3 explicit subject regeneration records a new execution and immutable regenerated version', async (t) => {
  const f=await createStandaloneChatFixture(t,{providerResponses:[
    {type:'success',content:'Original subject answer.',inputTokens:10,outputTokens:4},
    {type:'success',content:'Regenerated subject answer.',inputTokens:14,outputTokens:5},
  ]});
  f.app.permissionService.createPermission(f.ownerId,{
    subjectId:null,resourceType:'api',resourceId:f.providerId,action:'execute',permissionLevel:'always_allow',status:'active',
  });
  const c=await createConversation(f,'Regeneration chat','r3-regeneration-create-0001');
  const turn=await createR3Turn(f,c,'Generate then regenerate.','r3-regeneration-turn-0001');
  const view=(await f.call(`/chat/conversations/${c.conversationId}`)).data;
  const subject=view.messages.find(message=>message.messageId===turn.assistantMessage.messageId);
  const confirmationRequired=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',{
    branchId:view.branch.branchId,baseVersionId:subject.messageVersionId,
  },{'idempotency-key':'r3-regeneration-confirm-0001'});
  assert.equal(confirmationRequired.status,200,JSON.stringify(confirmationRequired));
  assert.equal(confirmationRequired.data.operationStatus,'confirmation_required');
  assert.equal(confirmationRequired.data.externalCall,'not_performed');
  assert.equal(f.loopback.requests.length,1);
  const confirmationId=confirmationRequired.data.confirmation.confirmationId;
  assert.equal((await f.call(`/confirmations/${confirmationId}/decision`,'POST',{decision:'approve'})).status,200);
  const regenerated=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',{
    branchId:view.branch.branchId,baseVersionId:subject.messageVersionId,confirmationId,confirmationKind:'security',
  },{'idempotency-key':'r3-regeneration-run-0001'});
  assert.equal(regenerated.status,200,JSON.stringify(regenerated));
  assert.equal(regenerated.data.message.content,'Regenerated subject answer.');
  assert.notEqual(regenerated.data.message.messageVersionId,subject.messageVersionId);
  assert.equal(regenerated.data.execution.totalTokens,19);
  assert.equal(f.loopback.requests.length,2);
  const replay=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/regenerations`,'POST',{
    branchId:view.branch.branchId,baseVersionId:subject.messageVersionId,confirmationId,confirmationKind:'security',
  },{'idempotency-key':'r3-regeneration-run-0001'});
  assert.deepEqual(replay.data,regenerated.data);
  assert.equal(f.loopback.requests.length,2);
  const versions=await f.call(`/chat/conversations/${c.conversationId}/messages/${subject.messageId}/versions`);
  assert.deepEqual(versions.data.versions.map(v=>v.versionKind),['original','regenerated']);
  const row=f.app.database.connection.prepare('SELECT status,attempt_count,input_tokens,output_tokens,total_tokens FROM personal_chat_regenerations').get();
  assert.deepEqual({...row},{status:'completed',attempt_count:1,input_tokens:14,output_tokens:5,total_tokens:19});
  assert.equal(f.app.database.connection.prepare('SELECT COUNT(*) AS count FROM personal_chat_operations WHERE operation_type = ?').get('message.regenerate').count,2);
});
