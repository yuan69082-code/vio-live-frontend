// Opt-in disposable UI integration server. It never uses ambient database,
// credential, proxy, runtime or Engine configuration.
import { createServer } from 'node:http';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createIsolatedTestEnvironment } from './isolated-test-environment.js';
const fixture=createIsolatedTestEnvironment({PATH:process.env.PATH,PATHEXT:process.env.PATHEXT,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP});
process.env.VIO_TEST_PATHS_ROOT=fixture.root;
process.env.VIO_CONTINUITY_ENGINE_PATH=fixture.environment.VIO_CONTINUITY_ENGINE_PATH;
await import('./register-test-paths.js');
const {createApplication}=await import('../src/app.js');
const {loadConfig}=await import('../src/config.js');
const {createProviderConnectionChecker}=await import('../src/integrations/model-providers/provider-connection-check.js');
const provider=createServer((request,response)=>{
  if(request.url==='/models'&&request.headers.authorization==='Bearer local-fixture-value') {
    response.writeHead(200,{'content-type':'application/json'});response.end('{"data":[{"id":"fixture-model"}]}');return;
  }
  response.writeHead(401,{'content-type':'application/json'});response.end('{"error":"denied"}');
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const providerOrigin=`http://127.0.0.1:${provider.address().port}`;
let now=new Date();let failDeletion=false;
const managedRoot=join(fixture.root,'managed');mkdirSync(managedRoot);
const backupPath=join(managedRoot,'controlled.backup');
const backupContents='Disposable R2 browser copy; no user data.';
const makeApp=()=>createApplication({config:loadConfig({VIO_BACKEND_HOST:'127.0.0.1',VIO_BACKEND_PORT:'8787',VIO_BACKEND_DB_PATH:join(fixture.root,'r2-integration.sqlite')}),environment:{},logger:{error(){}},
  personalClock:()=>new Date(now),personalManagedRoot:managedRoot,
  personalDeletionBeforeOnlineDelete:()=>{if(failDeletion)throw new Error('Controlled pre-delete failure');},
  providerConnectionChecker:createProviderConnectionChecker({allowedLoopbackOrigins:[providerOrigin]})});
let app=makeApp();
const invitation=app.personalIdentityService.issueInvitation();
const initializeInBrowser=process.argv.includes('--initialize-in-browser');
if(!initializeInBrowser)app.personalIdentityService.initialize({invitation,passphrase:'R2-only-non-secret-local-fixture!',agreementVersion:'personal-use/v1'},'ui-fixture-initialize');
await app.start();
// This invitation belongs only to this newly created disposable test database.
// It is never obtained from environment, a real credential store or user data.
process.stdout.write(`${JSON.stringify({status:'ready',backend:'http://127.0.0.1:8787',providerBaseUrl:providerOrigin,loginPassphrase:'R2-only-non-secret-local-fixture!',providerCredential:'local-fixture-value',...(initializeInBrowser?{disposableTestInvitation:invitation}:{}),externalCall:'loopback_only',providerCharge:'not_incurred'})}\n`);
// Test-only stdin control, never a production HTTP endpoint. Each command
// affects only the fixture this process created; output is metadata only.
const commands=createInterface({input:process.stdin});let stopping=false;
const shutdown=async()=>{if(stopping)return;stopping=true;commands.close();await app.stop();await new Promise(resolve=>provider.close(resolve));fixture.remove();process.stdout.write('fixture_removed=true\n');process.exit(0);};
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
for await(const command of commands) {
  try {
    const owner=()=>app.database.connection.prepare('SELECT owner_user_id FROM personal_installation WHERE singleton=1').get()?.owner_user_id;
    switch(command.trim()) {
      case 'lock-vault':app.personalVault.lock(owner());break;
      case 'register-blocked-backup':
        writeFileSync(backupPath,backupContents,{flag:'wx'});
        app.personalManagedCopies.register({ownerUserId:owner(),kind:'backup',rootPath:managedRoot,relativePath:'controlled.backup'});
        writeFileSync(backupPath,'Controlled changed file: cleanup must remain pending.');break;
      case 'repair-backup':writeFileSync(backupPath,backupContents);break;
      case 'fail-deletion':failDeletion=true;break;
      case 'allow-deletion':failDeletion=false;break;
      case 'advance-to-deadline': {
        const task=app.database.connection.prepare("SELECT cancellable_until FROM personal_deletion_tasks WHERE status NOT IN ('completed','cancelled') ORDER BY requested_at DESC LIMIT 1").get();
        if(!task)throw new Error('No disposable pending deletion');now=new Date(task.cancellable_until);break;
      }
      case 'stop-http':await app.stop();break;
      case 'restart':await app.stop();app=makeApp();await app.start();break;
      case 'status': {
        const counts={};for(const table of ['users','subjects','personal_deletion_tasks','personal_managed_copies','personal_credential_secrets'])counts[table]=app.database.connection.prepare(`SELECT count(*) n FROM ${table}`).get().n;
        process.stdout.write(`${JSON.stringify({counts,clock:now.toISOString(),externalCall:'loopback_only'})}\n`);break;
      }
      case 'stop':await shutdown();break;
      default:throw new Error('Unsupported test control');
    }
    process.stdout.write(`${JSON.stringify({command:command.trim(),status:'completed'})}\n`);
  } catch {process.stdout.write(`${JSON.stringify({command:command.trim(),status:'failed'})}\n`);}
}
await new Promise(()=>{});
