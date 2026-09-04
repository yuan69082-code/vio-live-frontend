import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { resolve } from 'node:path';

import { createIsolatedTestEnvironment } from '../test-support/isolated-test-environment.js';

async function runTests() {
  // Namespace import is intentional: older Node releases may not export
  // registerHooks. Reject explicitly before any fixture or test child exists.
  const version = /^(\d+)\.(\d+)\.(\d+)$/u.exec(process.versions.node);
  const supportedVersion = version !== null
    && Number(version[1]) === 22
    && (Number(version[2]) > 23
      || (Number(version[2]) === 23 && Number(version[3]) >= 1));
  if (!supportedVersion || typeof nodeModule.registerHooks !== 'function') {
    process.stderr.write(
      'UNSUPPORTED_TEST_RUNTIME: Backend tests require Node.js >=22.23.1 <23.0.0 '
      + 'and node:module.registerHooks; refusing to run without isolation.\n',
    );
    process.exitCode = 2;
    return;
  }

  const backendRoot = resolve(import.meta.dirname, '..');
  const requested = process.argv.slice(2);
  // Default remains exactly the original glob, including future test files.
  // Explicit files allow focused checks, but no test-name/concurrency/skip flags.
  for (const file of requested) {
    if (!/^tests\/[A-Za-z0-9_-]+\.test\.js$/u.test(file)
      || !existsSync(resolve(backendRoot, file))) {
      throw new Error('Only existing tests/*.test.js files may be passed to the test launcher.');
    }
  }
  const files = requested.length === 0 ? ['tests/*.test.js'] : requested;
  const fixture = createIsolatedTestEnvironment();
  let child;
  try {
    child = spawn(process.execPath, ['--test', ...files], {
      cwd: backendRoot,
      env: fixture.environment,
      stdio: 'inherit',
      windowsHide: true,
    });
    // Forward cancellation only to the test process owned by this launcher.
    const stop = () => child.kill();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      process.exitCode = await new Promise((resolveExit, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolveExit(code ?? 1));
      });
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  } finally {
    fixture.remove();
  }
}

await runTests();
