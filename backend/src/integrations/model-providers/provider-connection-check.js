import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { ValidationError } from '../../core/errors.js';

const denied=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) denied.addSubnet(address,prefix,'ipv4');
const globalIpv6=new BlockList();
globalIpv6.addSubnet('2000::',3,'ipv6');
const deniedIpv6=new BlockList();
for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) deniedIpv6.addSubnet(address,prefix,'ipv6');

function safeDnsAddress(entry) {
  if(!entry||typeof entry.address!=='string'||![4,6].includes(entry.family)||isIP(entry.address)!==entry.family)return false;
  if(entry.family===4)return !denied.check(entry.address,'ipv4');
  // IPv6 is validated even though this checker only connects over IPv4. Do not
  // ignore a private/loopback/link-local/mapped address in a mixed DNS answer.
  return globalIpv6.check(entry.address,'ipv6')&&!deniedIpv6.check(entry.address,'ipv6');
}
export function validateProviderTarget(value,{allowedLoopbackOrigins=[]}={}) {
  let url;try{url=new URL(value);}catch{throw new ValidationError('Provider target is invalid.',{field:'baseUrl'});}
  const testLoopback=url.protocol==='http:'&&url.hostname==='127.0.0.1'&&allowedLoopbackOrigins.includes(url.origin);
  if(url.username||url.password||url.search||url.hash||(!testLoopback&&url.protocol!=='https:')
      ||(!testLoopback&&(url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local')||isIP(url.hostname)!==0))) {
    throw new ValidationError('Provider target is not an authorized public HTTPS hostname.',{field:'baseUrl'});
  }
  return url;
}
export function createProviderConnectionChecker({allowedLoopbackOrigins=[],resolveAddresses=lookup,requestHttps=httpsRequest,timeoutMs=5000,maxBytes=65536}={}) {
  return {
    validateTarget:value=>validateProviderTarget(value,{allowedLoopbackOrigins}),
    async check({baseUrl,resolveApiKey,interfaceFormat}) {
      if(interfaceFormat!=='openai_compatible') return {status:'failed',reason:'interface_not_supported'};
      const url=validateProviderTarget(baseUrl,{allowedLoopbackOrigins});
      url.pathname=`${url.pathname.replace(/\/$/,'')}/models`;
      const testLoopback=allowedLoopbackOrigins.includes(url.origin)&&url.hostname==='127.0.0.1';
      let addresses;
      try {
        addresses=testLoopback?[{address:'127.0.0.1',family:4}]:await Promise.race([
          resolveAddresses(url.hostname,{all:true,verbatim:true}),
          new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('DNS timeout')),timeoutMs);t.unref();}),
        ]);
      } catch {return {status:'failed',reason:'network_unavailable'};}
      if(!Array.isArray(addresses)||!addresses.length||(!testLoopback&&addresses.some(entry=>!safeDnsAddress(entry)))) return {status:'failed',reason:'unsafe_target'};
      const selected=addresses.find(entry=>entry.family===4);
      if(!selected)return {status:'failed',reason:'address_family_not_supported'};
      const address=selected.address;
      const secret=resolveApiKey();
      return new Promise(resolve=>{
        let settled=false;let timer;let req;
        const done=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
        try {
          req=(testLoopback?httpRequest:requestHttps)(url,{
            method:'GET',agent:false,
            headers:{authorization:`Bearer ${secret}`,accept:'application/json',connection:'close'},
            lookup:(_host,options,callback)=>options?.all?callback(null,[{address,family:4}]):callback(null,address,4),
          },response=>{
            const code=response.statusCode??0;
            if(code>=300&&code<400){done({status:'failed',reason:'redirect_refused'});response.destroy();return;}
            if(code===401||code===403){done({status:'failed',reason:'authentication_failed'});response.destroy();return;}
            if(code!==200){done({status:'failed',reason:code===429?'rate_limited':'provider_rejected'});response.destroy();return;}
            if(!/^application\/json\b/i.test(response.headers['content-type']??'')){done({status:'failed',reason:'invalid_response'});response.destroy();return;}
            let size=0;const chunks=[];
            response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){done({status:'failed',reason:'response_too_large'});response.destroy();}else chunks.push(chunk);});
            response.on('aborted',()=>done({status:'failed',reason:'response_interrupted'}));
            response.on('error',()=>done({status:'failed',reason:'response_interrupted'}));
            response.on('end',()=>{
              try {const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||!Array.isArray(body.data)||body.data.some(item=>!item||typeof item.id!=='string'))throw new Error('invalid');done({status:'succeeded',reason:'authentication_checked'});}
              catch{done({status:'failed',reason:'invalid_response'});}
            });
          });
          timer=setTimeout(()=>{req.destroy();done({status:'failed',reason:'timeout'});},timeoutMs);
          req.on('error',()=>done({status:'failed',reason:'network_unavailable'}));req.end();
        } catch {req?.destroy();done({status:'failed',reason:'network_unavailable'});}
      });
    },
  };
}
