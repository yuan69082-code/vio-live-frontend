import { closeSync,existsSync,lstatSync,openSync,realpathSync,writeFileSync } from 'node:fs';
import { dirname,isAbsolute,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { parseStrictArguments } from './live-chat-script-support.js';

let application;
try {
  const {values,flags}=parseStrictArguments(process.argv.slice(2),{valueOptions:['--database','--invitation-file'],flags:['--acknowledge-owner-initialization']});
  const database=values.get('--database');const output=values.get('--invitation-file');
  if(!database||!output||!isAbsolute(database)||!isAbsolute(output)||!flags.has('--acknowledge-owner-initialization')) throw new Error('Explicit absolute database/invitation paths and owner initialization acknowledgement are required.');
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  const outside=p=>{const rel=relative(repo,p);return rel.startsWith('..')||isAbsolute(rel);};
  if(!outside(resolve(database))||!outside(resolve(output))||resolve(database)===resolve(output))throw new Error('Use separate paths outside the repository.');
  for(const file of [database,output]) {
    let path=dirname(resolve(file));
    while(path!==dirname(path)) {
      if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error('Linked runtime directories are not allowed.');
      path=dirname(path);
    }
    if(!existsSync(dirname(file))||!outside(realpathSync(dirname(file))))throw new Error('Create a private runtime directory outside the repository first.');
    if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw new Error('Linked runtime files are not allowed.');
  }
  if(existsSync(output))throw new Error('Invitation output already exists; it will not be overwritten.');
  application=createApplication({config:loadConfig({VIO_BACKEND_DB_PATH:database}),environment:{},logger:{error(){}}});
  const descriptor=openSync(output,'wx',0o600);
  try {const invitation=application.personalIdentityService.issueInvitation();writeFileSync(descriptor,invitation,{encoding:'utf8'});}
  finally {closeSync(descriptor);}
  process.stdout.write(JSON.stringify({status:'created',expiresInMinutes:15,invitation:'written_to_private_file',externalCall:'not_performed'})+'\n');
} catch {
  process.stderr.write('PERSONAL_INITIALIZATION_REFUSED: verify the explicit private paths, acknowledgement and installation state.\n');process.exitCode=2;
} finally {await application?.stop();}
