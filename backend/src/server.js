import { createApplication } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const application = createApplication({ config });
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[vio-live-backend] received ${signal}, shutting down`);

  try {
    await application.stop();
  } catch (error) {
    console.error('[vio-live-backend] shutdown failed', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  const address = await application.start();
  console.log(
    `[vio-live-backend] listening on http://${address.host}:${address.port}`,
  );
} catch (error) {
  console.error('[vio-live-backend] failed to start', error);
  await application.stop();
  process.exitCode = 1;
}
