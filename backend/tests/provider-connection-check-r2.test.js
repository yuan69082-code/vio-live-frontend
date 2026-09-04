import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request as httpRequest } from 'node:http';
import { createProviderConnectionChecker } from '../src/integrations/model-providers/provider-connection-check.js';

const publicV4={address:'8.8.8.8',family:4};
const publicV6={address:'2001:4860:4860::8888',family:6};
const fixtureCredential='controlled-local-connection-test-value';
const checkInput={baseUrl:'https://controlled-provider.example/v1',interfaceFormat:'openai_compatible',resolveApiKey:()=>fixtureCredential};

async function localTransport(t,handler) {
  const requests=[];
  const server=createServer((req,res)=>{requests.push({method:req.method,path:req.url,authorization:req.headers.authorization});handler(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const invocations=[];
  return {
    requests,invocations,
    requestHttps(url,options,callback) {
      const single=[];const all=[];
      options.lookup(url.hostname,{},(...args)=>single.push(args));
      options.lookup(url.hostname,{all:true},(...args)=>all.push(args));
      invocations.push({url:url.href,method:options.method,agent:options.agent,single,all});
      // Explicit transport DI keeps the production public URL and pinned-address
      // checks observable, while every real socket belongs to this local fixture.
      return httpRequest(new URL(`${url.pathname}${url.search}`,origin),{
        method:options.method,agent:options.agent,headers:options.headers,
      },callback);
    },
  };
}

test('R2 safe dual-stack DNS selects and pins IPv4 and performs one controlled HTTP authentication check',async t=>{
  const local=await localTransport(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture-model'}]}));});
  const lookups=[];let credentials=0;
  const checker=createProviderConnectionChecker({
    resolveAddresses:async(host,options)=>{lookups.push({host,options});return [publicV6,publicV4,{address:'1.1.1.1',family:4}];},
    requestHttps:local.requestHttps,
  });
  const result=await checker.check({...checkInput,resolveApiKey:()=>{credentials++;return fixtureCredential;}});
  assert.deepEqual(result,{status:'succeeded',reason:'authentication_checked'});
  assert.equal(credentials,1);
  assert.deepEqual(lookups,[{host:'controlled-provider.example',options:{all:true,verbatim:true}}]);
  assert.deepEqual(local.invocations,[{url:'https://controlled-provider.example/v1/models',method:'GET',agent:false,single:[[null,publicV4.address,4]],all:[[null,[publicV4]]]}]);
  assert.deepEqual(local.requests,[{method:'GET',path:'/v1/models',authorization:`Bearer ${fixtureCredential}`}]);
  assert.equal(JSON.stringify(result).includes(fixtureCredential),false);
});

test('R2 IPv4-first dual-stack answer retains safe IPv4 behavior without trying the second address',async t=>{
  const local=await localTransport(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"data":[]}');});
  const checker=createProviderConnectionChecker({resolveAddresses:async()=>[publicV4,publicV6],requestHttps:local.requestHttps});
  assert.deepEqual(await checker.check(checkInput),{status:'succeeded',reason:'authentication_checked'});
  assert.equal(local.requests.length,1);assert.equal(local.invocations.length,1);
  assert.deepEqual(local.invocations[0].single,[[null,publicV4.address,4]]);
});

test('R2 safe IPv6-only DNS reports unsupported address family before credentials or transport',async()=>{
  let credentials=0;let requests=0;
  const checker=createProviderConnectionChecker({resolveAddresses:async()=>[publicV6],requestHttps:()=>{requests++;throw new Error('must not connect');}});
  const result=await checker.check({...checkInput,resolveApiKey:()=>{credentials++;return fixtureCredential;}});
  assert.deepEqual(result,{status:'failed',reason:'address_family_not_supported'});
  assert.equal(credentials,0);assert.equal(requests,0);
});

test('R2 dangerous IPv4 or IPv6 in a mixed DNS answer rejects the entire target before credential use',async()=>{
  const unsafe=[
    {address:'127.0.0.1',family:4},{address:'10.0.0.1',family:4},{address:'169.254.169.254',family:4},
    {address:'192.168.1.1',family:4},{address:'100.64.0.1',family:4},{address:'224.0.0.1',family:4},
    {address:'::',family:6},{address:'::1',family:6},{address:'fd00::1',family:6},
    {address:'fe80::1',family:6},{address:'ff02::1',family:6},{address:'::ffff:127.0.0.1',family:6},
    {address:'2001:db8::1',family:6},{address:'2002:7f00:1::',family:6},{address:'3fff::1',family:6},
  ];
  let credentials=0;let requests=0;
  for(const entry of unsafe) {
    const checker=createProviderConnectionChecker({resolveAddresses:async()=>[publicV4,entry,publicV6],requestHttps:()=>{requests++;throw new Error('must not connect');}});
    assert.deepEqual(await checker.check({...checkInput,resolveApiKey:()=>{credentials++;return fixtureCredential;}}),{status:'failed',reason:'unsafe_target'},entry.address);
  }
  assert.equal(credentials,0);assert.equal(requests,0);
});

test('R2 malformed DNS results fail closed and DNS failures remain network failures',async()=>{
  let credentials=0;let requests=0;
  for(const answer of [null,[],[null],[{address:'invalid',family:4}],[{address:'8.8.8.8',family:6}],[{address:'::1',family:4}],[{address:'8.8.8.8',family:'4'}]]) {
    const checker=createProviderConnectionChecker({resolveAddresses:async()=>answer,requestHttps:()=>{requests++;throw new Error('must not connect');}});
    assert.deepEqual(await checker.check({...checkInput,resolveApiKey:()=>{credentials++;return fixtureCredential;}}),{status:'failed',reason:'unsafe_target'});
  }
  const checker=createProviderConnectionChecker({resolveAddresses:async()=>{throw new Error('fixture DNS failure');},requestHttps:()=>{requests++;throw new Error('must not connect');}});
  assert.deepEqual(await checker.check({...checkInput,resolveApiKey:()=>{credentials++;return fixtureCredential;}}),{status:'failed',reason:'network_unavailable'});
  assert.equal(credentials,0);assert.equal(requests,0);
});

test('R2 dual-stack connection refuses redirects without following or returning the target',async t=>{
  const local=await localTransport(t,(_req,res)=>{res.writeHead(302,{location:'http://169.254.169.254/internal'});res.end();});
  const checker=createProviderConnectionChecker({resolveAddresses:async()=>[publicV6,publicV4],requestHttps:local.requestHttps});
  const result=await checker.check(checkInput);
  assert.deepEqual(result,{status:'failed',reason:'redirect_refused'});
  assert.equal(local.requests.length,1);assert.equal(local.invocations.length,1);
  assert.equal(JSON.stringify(result).includes('169.254'),false);
});

test('R2 dual-stack connection still enforces response size and does not expose provider bodies',async t=>{
  const local=await localTransport(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture-model'}],sensitiveFixture:'x'.repeat(512)}));});
  const checker=createProviderConnectionChecker({resolveAddresses:async()=>[publicV4,publicV6],requestHttps:local.requestHttps,maxBytes:64});
  const result=await checker.check(checkInput);
  assert.deepEqual(result,{status:'failed',reason:'response_too_large'});
  assert.equal(local.requests.length,1);
  assert.equal(JSON.stringify(result).includes('sensitiveFixture'),false);
  assert.equal(JSON.stringify(result).includes(fixtureCredential),false);
});

test('R2 dual-stack connection still times out without a second connection attempt',async t=>{
  const local=await localTransport(t,()=>{});
  const checker=createProviderConnectionChecker({resolveAddresses:async()=>[publicV6,publicV4],requestHttps:local.requestHttps,timeoutMs:100});
  assert.deepEqual(await checker.check(checkInput),{status:'failed',reason:'timeout'});
  assert.equal(local.invocations.length,1);
  assert.equal(local.requests.length,1);
});
