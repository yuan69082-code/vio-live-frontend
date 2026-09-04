import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { startPersonalTestApplication,sealTestCredential } from '../test-support/personal-test-application.js';
import { createProviderConnectionChecker } from '../src/integrations/model-providers/provider-connection-check.js';

test('R2 account-scoped provider/credential/model checks use real loopback HTTP, encrypted storage and stable recovery',async t=>{
  const requests=[];const server=createServer((req,res)=>{requests.push({path:req.url,auth:req.headers.authorization});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'controlled-model'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const f=await startPersonalTestApplication(t,{providerConnectionChecker:createProviderConnectionChecker({allowedLoopbackOrigins:[origin]})});await f.initialize();
  const body={displayName:'Controlled local provider',providerType:'custom',baseUrl:origin,interfaceFormat:'openai_compatible',status:'enabled'};
  const created=await f.secured('/providers','POST',body,'provider-1');const id=created.provider.providerId;
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM subjects').get().n,0,'account confirmation must not invent an assistant');
  const transport=(await f.call('/vault')).data.transport;
  const fakeCredential='local-fixture-value';
  const sealed=sealTestCredential(transport,fakeCredential);
  const saved=await f.secured(`/providers/${id}/credential`,'PUT',sealed,'credential-1');
  assert.equal(saved.provider.credentials.apiKey.status,'configured');
  const model=await f.secured('/models','POST',{providerId:id,modelName:'controlled-model',modelType:'chat',capabilities:['chat'],defaultForChat:true},'model-1');
  assert.equal(model.model.defaultForChat,true);
  const checked=await f.secured(`/providers/${id}/connection-tests`,'POST',{scope:'authentication'},'check-1');
  assert.equal(checked.test.status,'succeeded');assert.equal(checked.test.generation,'not_performed');
  assert.deepEqual(requests,[{path:'/models',auth:`Bearer ${fakeCredential}`}]);
  const recoveredOperation=await f.call(`/operations?operation=connection/${id}&key=check-1`);
  assert.equal(recoveredOperation.data.status,'completed');assert.deepEqual(recoveredOperation.data.result.test,checked.test);
  const replay=await f.call(`/providers/${id}/connection-tests`,'POST',{scope:'authentication'},{'idempotency-key':'check-1'});
  assert.equal(replay.data.test.testId,checked.test.testId);assert.equal(requests.length,1);
  assert.equal(JSON.stringify((await f.call('/providers')).data).includes(fakeCredential),false);
  for(const suffix of ['', '-wal']) {try{assert.equal(readFileSync(f.temp.databasePath+suffix).includes(Buffer.from(fakeCredential)),false);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const rotated=await f.secured(`/providers/${id}/credential`,'PUT',sealTestCredential(transport,'second-local-fixture-value'),'credential-2');
  assert.equal(rotated.provider.credentials.apiKey.status,'configured');
  assert.equal(f.app.database.connection.prepare("SELECT count(*) n FROM personal_credential_secrets WHERE status='revoked'").get().n,1);
  assert.equal(f.app.database.connection.prepare("SELECT count(*) n FROM personal_credential_secrets WHERE status='active'").get().n,1);
  await f.restart();assert.equal((await f.call('/session')).data.vaultStatus,'locked');
  const after=await f.call(`/providers/${id}/connection-tests/${checked.test.testId}`);
  assert.equal(after.data.testId,checked.test.testId);assert.equal(requests.length,1);
  await f.call('/vault/unlock','POST',{passphrase:'controlled-personal-test-passphrase'});
  const revoked=await f.secured(`/providers/${id}/credential`,'DELETE',{},'revoke-1');assert.equal(revoked.provider.credentials.apiKey.status,'revoked');
  const rejected=await f.secured(`/providers/${id}/connection-tests`,'POST',{scope:'authentication'},'check-2');
  assert.equal(rejected.test.reason,'credential_unavailable');assert.equal(requests.length,1);
});

test('R2 rejects dangerous targets, plaintext credentials, changed confirmations and forged CSRF',async t=>{
  const f=await startPersonalTestApplication(t);await f.initialize();
  for(const baseUrl of ['http://example.test','https://127.0.0.1','https://u:p@example.test','https://example.test/?x=1','https://example.test/#f']) {
    assert.equal((await f.call('/providers','POST',{displayName:'bad',providerType:'custom',baseUrl,interfaceFormat:'openai_compatible',status:'enabled'},{'idempotency-key':baseUrl})).status,400);
  }
  assert.equal((await f.call('/providers','POST',{}, {'x-vio-csrf':'forged'})).status,403);
  const body={displayName:'Test',providerType:'custom',baseUrl:'https://controlled-provider.example',interfaceFormat:'openai_compatible',status:'enabled'};
  const waiting=await f.call('/providers','POST',body,{'idempotency-key':'pending'});
  const duplicate=await f.call('/providers','POST',body,{'idempotency-key':'pending'});
  assert.equal(waiting.data.security.confirmation.confirmationId,duplicate.data.security.confirmation.confirmationId);
  assert.equal((await f.call('/providers','POST',{...body,displayName:'changed'},{'idempotency-key':'pending'})).status,409);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM security_confirmations').get().n,1);
  const created=await f.secured('/providers','POST',body,'plaintext-check-provider');
  const id=created.provider.providerId;
  for(const field of ['apiKey','token','secret','secretRef']) {
    const response=await f.call(`/providers/${id}/credential`,'PUT',{[field]:'non-real-field-rejection-fixture'},{'idempotency-key':`raw-${field}`});
    assert.equal(response.status,400,field);
    assert.equal(JSON.stringify(response).includes('non-real-field-rejection-fixture'),false);
  }
  assert.equal((await f.call('/providers','POST',body,{origin:'https://untrusted.example','idempotency-key':'foreign-origin'})).status,403);
  assert.equal((await f.call('/providers','POST',body,{'sec-fetch-site':'cross-site','idempotency-key':'cross-site'})).status,403);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_credential_secrets').get().n,0);
  // An unrelated owner in the same isolated database stays outside the session.
  // This is explicit test setup, not a public registration or production identity.
  const foreignUser='isolated-other-owner';const time='2026-09-04T00:00:00Z';
  f.app.database.connection.prepare('INSERT INTO users VALUES(?,NULL,NULL,?,?,?)').run(foreignUser,'active',time,time);
  const foreign=f.app.apiProviderService.createProvider(foreignUser,body);
  assert.equal((await f.call(`/api/v1/users/${foreignUser}/api-providers/${foreign.providerId}`)).status,404);
  const confirmationsBefore=f.app.database.connection.prepare('SELECT count(*) n FROM security_confirmations').get().n;
  const cross=await f.call(`/providers/${foreign.providerId}`,'PATCH',{displayName:'Denied',baseUrl:body.baseUrl,interfaceFormat:body.interfaceFormat,status:'disabled',expectedVersion:1},{'idempotency-key':'cross-owner'});
  assert.equal(cross.status,404);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM security_confirmations').get().n,confirmationsBefore);
  assert.equal(f.app.apiProviderService.getProvider(foreignUser,foreign.providerId).status,'enabled');
});

test('R2 operation recovery and explicit cancellation distinguish abort from completed fact',async t=>{
  const f=await startPersonalTestApplication(t);await f.initialize();
  const body={displayName:'Test',providerType:'custom',baseUrl:'https://controlled-provider.example',interfaceFormat:'openai_compatible',status:'enabled'};
  const waiting=await f.call('/providers','POST',body,{'idempotency-key':'cancel-me'});
  assert.equal(waiting.data.operationStatus,'confirmation_required');
  assert.equal((await f.call('/operations?operation=create-provider&key=cancel-me')).data.status,'confirmation_required');
  assert.equal((await f.call('/operation-cancellations','POST',{operation:'create-provider',key:'cancel-me'})).data.status,'cancelled');
  assert.equal((await f.call('/providers','POST',body,{'idempotency-key':'cancel-me'})).data.operationStatus,'cancelled');
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM api_providers').get().n,0);
  const done=await f.secured('/providers','POST',body,'completed');
  const recovered=await f.call('/operations?operation=create-provider&key=completed');
  assert.equal(recovered.data.status,'completed');assert.equal(recovered.data.result.provider.providerId,done.provider.providerId);
  const cancellation=await f.call('/operation-cancellations','POST',{operation:'create-provider',key:'completed'});
  assert.equal(cancellation.data.status,'completed');assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM api_providers').get().n,1);
});

test('R2 connection checker maps timeout, invalid JSON, redirects and oversized responses without generation',async t=>{
  const modes=['timeout','invalid','redirect','large'];
  for(const mode of modes) {
    const server=createServer((_req,res)=>{
      if(mode==='timeout')return;
      if(mode==='redirect'){res.writeHead(302,{location:'https://elsewhere.example'});res.end();return;}
      res.writeHead(200,{'content-type':'application/json'});res.end(mode==='invalid'?'not-json':JSON.stringify({data:'x'.repeat(2000)}));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const checker=createProviderConnectionChecker({allowedLoopbackOrigins:[origin],timeoutMs:30,maxBytes:100});
    const result=await checker.check({baseUrl:origin,interfaceFormat:'openai_compatible',resolveApiKey:()=> 'local-fixture-value'});
    assert.equal(result.status,'failed');assert.equal({timeout:'timeout',invalid:'invalid_response',redirect:'redirect_refused',large:'response_too_large'}[mode],result.reason);
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('personal sessions cannot bypass R2 confirmation or versions using legacy configuration writes',async t=>{
  const f=await startPersonalTestApplication(t);const initialized=await f.initialize();
  const owner=initialized.data.user.userId;
  const prefix=`/api/v1/users/${owner}`;
  const bypasses=[
    [`${prefix}/api-providers`,'POST',{displayName:'Bypass',providerType:'custom',baseUrl:'https://controlled-provider.example',interfaceFormat:'openai_compatible',status:'enabled'}],
    [`${prefix}/api-providers/not-created/status`,'PATCH',{status:'disabled'}],
    [`${prefix}/api-providers/not-created/credential-reference`,'PATCH',{}],
    [`${prefix}/api-providers/not-created/models`,'POST',{}],
    [`${prefix}/model-routing-rules`,'POST',{}],
    [`${prefix}/model-routing-rules/chat`,'PATCH',{}],
    [`${prefix}/subjects`,'POST',{name:'Bypass assistant'}],
    [`${prefix}/subjects/not-created`,'PATCH',{}],
    [`${prefix}/subjects/not-created/global-settings`,'PATCH',{}],
    [`${prefix}/user-space/current-assistant`,'PATCH',{}],
  ];
  for(const [url,method,body]of bypasses) {
    const response=await f.call(url,method,body);
    assert.equal(response.status,403,url);
    assert.equal(response.error.code,'PERSONAL_WRITE_ROUTE_REQUIRED',url);
  }
  assert.equal((await f.call(`${prefix}/api-providers`)).status,200,'authorized legacy reads remain compatible');
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM api_providers').get().n,0);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM subjects').get().n,0);
});
