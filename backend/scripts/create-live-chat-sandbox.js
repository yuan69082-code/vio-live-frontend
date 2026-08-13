import { createLiveChatSandbox } from '../src/modules/continuity-integration/live-chat-sandbox-service.js';
import { parseStrictArguments, publicError, writeJson } from './live-chat-script-support.js';

try {
  const arguments_ = parseStrictArguments(process.argv.slice(2), { valueOptions: ['--root'] });
  const root = arguments_.values.get('--root');
  if (!root) throw new Error('Usage: pnpm run create:live-chat-sandbox -- --root <new-absolute-path>');
  writeJson(createLiveChatSandbox({ root }));
} catch (error) {
  writeJson(publicError(error), process.stderr);
  process.exitCode = 2;
}
