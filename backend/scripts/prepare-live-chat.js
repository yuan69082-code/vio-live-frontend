import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  createLiveChatPreparationService,
  inspectLiveChatEnvironment,
} from '../src/modules/continuity-integration/live-chat-preparation-service.js';
import {
  openReadonlyDatabase,
  parseFlags,
  publicError,
  writeJson,
} from './live-chat-script-support.js';

const flags = parseFlags(process.argv.slice(2), [
  '--plan',
  '--apply',
  '--acknowledge-external-provider',
  '--acknowledge-possible-charges',
]);
const apply = flags.has('--apply');
if (apply && flags.has('--plan')) throw new Error('--plan and --apply are mutually exclusive.');
if (!apply && (flags.has('--acknowledge-external-provider') || flags.has('--acknowledge-possible-charges'))) {
  throw new Error('Acknowledgements are accepted only together with --apply.');
}

let application = null;
let readonly = null;
try {
  if (!apply) {
    readonly = openReadonlyDatabase(process.env);
    const service = createLiveChatPreparationService({
      connection: readonly.connection,
      environment: process.env,
    });
    const result = service.plan();
    writeJson({ ...result, mode: 'plan', database: readonly.exists ? 'present' : 'missing' });
    if (result.status !== 'configured') process.exitCode = 2;
  } else {
    const environment = inspectLiveChatEnvironment(process.env);
    if (!flags.has('--acknowledge-external-provider') || !flags.has('--acknowledge-possible-charges')) {
      throw new Error('Both external Provider and possible charge acknowledgements are required.');
    }
    if (environment.issues.length > 0) {
      const error = new Error('Live chat environment is missing or unsafe.');
      error.details = { issues: environment.issues };
      throw error;
    }
    application = createApplication({ config: loadConfig(process.env), environment: process.env });
    const result = application.liveChatPreparationService.apply({
      acknowledgeExternalProvider: flags.has('--acknowledge-external-provider'),
      acknowledgePossibleCharges: flags.has('--acknowledge-possible-charges'),
    });
    writeJson({ ...result, mode: 'apply' });
  }
} catch (error) {
  writeJson(publicError(error), process.stderr);
  process.exitCode = 2;
} finally {
  readonly?.connection.close();
  await application?.stop();
}
