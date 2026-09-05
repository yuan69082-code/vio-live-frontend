import assert from 'node:assert/strict';
import { createCipheriv,createPublicKey,publicEncrypt,randomBytes } from 'node:crypto';
import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createTestDatabasePath } from './test-application.js';

export async function startPersonalTestApplication(
  t,
  options = {},
  { applicationFactory = createApplication } = {},
) {
  const temp=createTestDatabasePath();
  let app;let baseUrl;
  const state={cookie:'',csrf:''};
  const start=async()=>{
    app=applicationFactory({config:loadConfig({VIO_BACKEND_DB_PATH:temp.databasePath,VIO_BACKEND_PORT:'0'}),environment:{},logger:{error(){}},...options});
    const {port}=await app.start();baseUrl=`http://127.0.0.1:${port}`;
  };
  await start();t.after(async()=>{await app.stop();temp.remove();});
  const call=async(path,method='GET',body,headers={})=>{
    const response=await fetch(`${baseUrl}${path.startsWith('/api/')?path:`/api/v1/personal${path}`}`,{method,headers:{cookie:state.cookie,'x-vio-csrf':state.csrf,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
    const json=await response.json();
    if(response.headers.has('set-cookie')) {
      const jar=new Map(state.cookie.split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
      for(const header of response.headers.getSetCookie()) {
        const pair=header.split(';')[0];const i=pair.indexOf('=');
        if(/Max-Age=0(?:;|$)/i.test(header))jar.delete(pair.slice(0,i));else jar.set(pair.slice(0,i),pair.slice(i+1));
      }
      state.cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
    }
    if(json.data?.csrfToken)state.csrf=json.data.csrfToken;
    return {status:response.status,...json};
  };
  const initialize=async()=>{
    const invitation=app.personalIdentityService.issueInvitation();
    const input={invitation,passphrase:'controlled-personal-test-passphrase',agreementVersion:'personal-use/v1'};
    const result=await call('/initialize','POST',input,{'idempotency-key':'init-1'});
    assert.equal(result.status,200,JSON.stringify(result));return {data:result.data,input};
  };
  const secured=async(path,method,input,key)=>{
    let result=await call(path,method,input,{'idempotency-key':key});
    assert.equal(result.status,200,JSON.stringify(result));
    if(result.data.operationStatus==='confirmation_required') {
      const id=result.data.security.confirmation.confirmationId;
      const decision=await call(`/confirmations/${id}/decision`,'POST',{decision:'approve'});
      assert.equal(decision.status,200,JSON.stringify(decision));
      result=await call(path,method,{...input,confirmationId:id},{'idempotency-key':key});
    }
    assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.operationStatus,'completed',JSON.stringify(result));
    return result.data;
  };
  return {get app(){return app;},get baseUrl(){return baseUrl;},call,initialize,secured,state,temp,restart:async()=>{await app.stop();await start();}};
}
export function sealTestCredential(transport,credential) {
  const key=randomBytes(32);const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(transport.keyId));
  const ciphertext=Buffer.concat([cipher.update(credential),cipher.final(),cipher.getAuthTag()]);
  return {keyId:transport.keyId,sealedCredential:{encryptedKey:publicEncrypt({key:createPublicKey({key:Buffer.from(transport.publicKeySpki,'base64'),format:'der',type:'spki'}),oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64')}};
}
