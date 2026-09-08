import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createTestDatabasePath } from '../test-support/test-application.js';

async function fixture(t) {
  const temp=createTestDatabasePath();
  let time=new Date('2026-09-04T00:00:00Z');
  const options={config:loadConfig({VIO_BACKEND_DB_PATH:temp.databasePath,VIO_BACKEND_PORT:'0'}),environment:{},logger:{error(){}},personalClock:()=>new Date(time)};
  let app;let baseUrl;
  const start=async()=>{app=createApplication(options);const {port}=await app.start();baseUrl=`http://127.0.0.1:${port}`;};
  await start();
  t.after(async()=>{await app.stop();temp.remove();});
  const state={cookie:'',csrf:''};
  const call=async(path,method='GET',body,headers={})=>{
    const response=await fetch(`${baseUrl}${path}`,{method,headers:{cookie:state.cookie,'x-vio-csrf':state.csrf,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
    const json=await response.json();
    if(response.headers.has('set-cookie')) state.cookie=response.headers.get('set-cookie').split(';')[0];
    if(json.data?.csrfToken) state.csrf=json.data.csrfToken;
    return {status:response.status,...json};
  };
  const initialize=async()=>{
    const invitation=app.personalIdentityService.issueInvitation();
    const result=await call('/api/v1/personal/initialize','POST',{invitation,passphrase:'controlled-personal-test-passphrase',agreementVersion:'personal-use/v1'},{'idempotency-key':'init-1'});
    assert.equal(result.status,200,JSON.stringify(result));return result.data;
  };
  return {get app(){return app;},call,initialize,state,temp,advance:ms=>{time=new Date(time.getTime()+ms);},restart:async()=>{await app.stop();await start();}};
}
test('R2 initialization is controlled, stable and does not claim development identity',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/api/v1/users/current')).status,401);
  assert.equal((await f.call('/api/v1/users/current','GET',undefined,{'x-vio-user-id':'user-001'})).status,401);
  assert.equal((await f.call('/api/v1/personal/sessions','POST',{passphrase:'not-initialized-yet',deviceName:'Unknown browser'})).status,401);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_access_events').get().n,0);
  assert.equal((await f.call('/api/v1/personal/initialize','POST',{invitation:'wrong',passphrase:'controlled-test-phrase',agreementVersion:'personal-use/v1'},{'idempotency-key':'bad'})).status,401);
  const data=await f.initialize();
  assert.notEqual(data.user.userId,'user-001');assert.equal(data.currentAssistantId,null);
  assert.equal(data.onboardingCompleted,false);assert.equal(data.vaultStatus,'ready');
  assert.equal((await f.call('/api/v1/users/current')).data.userId,data.user.userId);
  assert.equal((await f.call('/api/v1/users/another-user')).status,404);
  assert.equal((await f.call('/api/v1/users','POST',{email:'unused@example.test'})).status,403);
  assert.throws(()=>f.app.personalIdentityService.issueInvitation());
  assert.equal(f.app.database.connection.prepare('SELECT count(*) AS n FROM subjects').get().n,0);
});
test('desktop invitation delivery is transactional, reusable and replaces an undeliverable active token',async t=>{
  const f=await fixture(t);let delivered;
  assert.throws(()=>f.app.personalIdentityService.deliverInitializationInvitation({
    deliver(){throw new Error('isolated delivery failure');},
  }),/isolated delivery failure/);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_initialization_invitations').get().n,0);

  const created=f.app.personalIdentityService.deliverInitializationInvitation({deliver(value){delivered=value;}});
  assert.equal(created.action,'created');assert.match(delivered,/^[A-Za-z0-9_-]{43}$/);
  let repeated=false;
  const reused=f.app.personalIdentityService.deliverInitializationInvitation({existingInvitation:delivered,deliver(){repeated=true;}});
  assert.equal(reused.action,'reused');assert.equal(repeated,false);

  let replacement;
  const replaced=f.app.personalIdentityService.deliverInitializationInvitation({deliver(value){replacement=value;}});
  assert.equal(replaced.action,'created');assert.notEqual(replacement,delivered);
  assert.equal(f.app.personalIdentityService.describeInitializationInvitation(delivered).status,'expired');
  assert.equal(f.app.personalIdentityService.describeInitializationInvitation(replacement).status,'active');
  assert.equal(f.app.database.connection.prepare("SELECT count(*) n FROM personal_initialization_invitations WHERE consumed_at IS NULL AND expires_at>?").get(new Date('2026-09-04T00:00:00Z').toISOString()).n,1);
});
test('R2 onboarding and two assistant operations survive replay, selection conflicts and logout',async t=>{
  const f=await fixture(t);await f.initialize();
  const body={displayName:'Owner',avatar:null,assistant:{name:'First',avatar:null,settings:{}},preferences:{storagePreference:'cloud',contextMode:'balanced'}};
  const first=await f.call('/api/v1/personal/onboarding','POST',body,{'idempotency-key':'setup'});
  assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.onboardingCompleted,true);
  const replay=await f.call('/api/v1/personal/onboarding','POST',body,{'idempotency-key':'setup'});
  assert.deepEqual(replay.data,first.data);
  const created=await f.call('/api/v1/personal/assistants','POST',{name:'Second',avatar:null,settings:{}},{'idempotency-key':'second'});
  assert.equal(created.status,201,JSON.stringify(created));
  assert.equal((await f.call('/api/v1/personal/assistants')).data.items.length,2);
  const selected=await f.call('/api/v1/personal/current-assistant','PUT',{assistantId:created.data.assistantId,expectedSelectionVersion:first.data.selectionVersion});
  assert.equal(selected.data.currentAssistantId,created.data.assistantId);
  assert.equal((await f.call('/api/v1/personal/current-assistant','PUT',{assistantId:first.data.currentAssistantId,expectedSelectionVersion:first.data.selectionVersion})).status,409);
  const profile=(await f.call('/api/v1/personal/profile')).data;
  assert.equal(profile.storage.cloudSync,false);
  const changedProfile=await f.call('/api/v1/personal/profile','PATCH',{displayName:'Owner Updated',avatar:null,preferences:{storagePreference:'hybrid',contextMode:'complete'},expectedVersion:profile.version});
  assert.equal(changedProfile.data.displayName,'Owner Updated');assert.equal(changedProfile.data.storage.cloudSync,false);
  assert.equal((await f.call('/api/v1/personal/profile','PATCH',{displayName:'Stale',avatar:null,preferences:{storagePreference:'local',contextMode:'balanced'},expectedVersion:profile.version})).status,409);
  const assistant=(await f.call(`/api/v1/personal/assistants/${created.data.assistantId}`)).data;
  const changedAssistant=await f.call(`/api/v1/personal/assistants/${created.data.assistantId}`,'PATCH',{name:'Second Updated',avatar:null,settings:{positioning:'companion',personality:'steady',persona:'direct',requirements:'careful',contextMode:'balanced'},expectedVersion:assistant.version});
  assert.equal(changedAssistant.data.name,'Second Updated');
  assert.equal((await f.call(`/api/v1/personal/assistants/${created.data.assistantId}`,'PATCH',{name:'Stale',avatar:null,settings:{},expectedVersion:assistant.version})).status,409);
  await f.restart();
  const restored=await f.call('/api/v1/personal/session');
  assert.equal(restored.status,200);assert.equal(restored.data.currentAssistantId,created.data.assistantId);assert.equal(restored.data.user.displayName,'Owner Updated');assert.equal(restored.data.vaultStatus,'locked');
  const cookie=f.state.cookie;
  assert.equal((await f.call('/api/v1/personal/session','DELETE')).status,200);
  assert.equal((await f.call('/api/v1/personal/session','GET',undefined,{cookie})).status,401);
});
test('R2 session recovery, listing, targeted revocation, expiry and login audit stay server-authoritative',async t=>{
  const f=await fixture(t);await f.initialize();
  const firstCookie=f.state.cookie;
  const login=await f.call('/api/v1/personal/sessions','POST',{passphrase:'controlled-personal-test-passphrase',deviceName:'Second browser'});
  assert.equal(login.status,200);const secondCookie=f.state.cookie;
  let list=await f.call('/api/v1/personal/sessions');assert.equal(list.data.items.length,2);
  const old=list.data.items.find(x=>!x.current);assert.ok(old);
  assert.equal((await f.call(`/api/v1/personal/sessions/${old.sessionId}`,'DELETE')).data.status,'revoked');
  assert.equal((await f.call('/api/v1/personal/session','GET',undefined,{cookie:firstCookie})).status,401);
  assert.equal((await f.call('/api/v1/personal/sessions','POST',{passphrase:'wrong-password-value',deviceName:'Intruder'})).status,401);
  assert.equal((await f.call('/api/v1/personal/access-audit')).data.items.some(x=>x.type==='login_failed'&&x.anomaly),true);
  assert.equal((await f.call('/api/v1/personal/session','GET',undefined,{cookie:secondCookie})).status,200);
  f.advance(8*86400000);
  assert.equal((await f.call('/api/v1/personal/session','GET',undefined,{cookie:secondCookie})).status,401);
});
