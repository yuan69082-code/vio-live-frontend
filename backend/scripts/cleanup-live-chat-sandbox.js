import {
  cleanupLiveChatSandbox,
  planLiveChatSandboxCleanup,
} from '../src/modules/continuity-integration/live-chat-sandbox-service.js';
import { parseStrictArguments, publicError, writeJson } from './live-chat-script-support.js';

try {
  const arguments_ = parseStrictArguments(process.argv.slice(2), {
    valueOptions: ['--manifest'],
    flags: [
      '--plan',
      '--apply',
      '--acknowledge-services-stopped',
      '--acknowledge-destroy-entire-sandbox',
    ],
  });
  const manifestPath = arguments_.values.get('--manifest');
  if (!manifestPath) throw new Error('Sandbox manifest path is required.');
  const plan = arguments_.flags.has('--plan');
  const apply = arguments_.flags.has('--apply');
  if (plan === apply) throw new Error('Exactly one of --plan or --apply is required.');
  if (plan && (
    arguments_.flags.has('--acknowledge-services-stopped')
    || arguments_.flags.has('--acknowledge-destroy-entire-sandbox')
  )) {
    throw new Error('Cleanup acknowledgements are accepted only with --apply.');
  }
  const result = plan
    ? planLiveChatSandboxCleanup({ manifestPath })
    : cleanupLiveChatSandbox({
      manifestPath,
      acknowledgeServicesStopped: arguments_.flags.has('--acknowledge-services-stopped'),
      acknowledgeDestroyEntireSandbox:
        arguments_.flags.has('--acknowledge-destroy-entire-sandbox'),
    });
  writeJson(result);
} catch (error) {
  writeJson(publicError(error), process.stderr);
  process.exitCode = 2;
}
