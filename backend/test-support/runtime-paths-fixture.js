import { requireIsolatedTestPaths } from './isolated-test-environment.js';

export function discoverRuntimePaths() {
  return requireIsolatedTestPaths();
}
