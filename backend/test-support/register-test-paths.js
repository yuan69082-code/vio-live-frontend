import { registerHooks } from 'node:module';

import { requireIsolatedTestPaths } from './isolated-test-environment.js';

// NODE_OPTIONS propagates this test-only preload through Node's test workers,
// pnpm, and the unmodified production CLI entry points spawned by the tests.
requireIsolatedTestPaths();
const productionDependency = new URL('../src/integrations/filesystem/runtime-paths.js', import.meta.url).href;
const testDependency = new URL('./runtime-paths-fixture.js', import.meta.url).href;

// Synchronous hooks preserve native error identity (including pnpm's optional
// config import checks) and do not add a loader worker to each test process.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    return resolved.url === productionDependency
      ? { ...resolved, url: testDependency }
      : resolved;
  },
});
