import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const application = createApplication({ config: loadConfig(process.env) });

try {
  const profile = application.fixedLocalChatProfileService.prepare();
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
} finally {
  await application.stop();
}
