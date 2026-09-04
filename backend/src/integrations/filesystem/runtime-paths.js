import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Path discovery only: no filesystem probes, environment overrides or test mode.
// Tests replace this dependency at module loading, never the protection checks.
export function discoverRuntimePaths() {
  const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
  const engineRepositoryRoot = resolve(repositoryRoot, '..', 'continuity-engine');
  const userHome = homedir();
  return Object.freeze({
    repositoryRoot,
    engineRepositoryRoot,
    defaultVioDatabasePath: join(repositoryRoot, 'backend', 'data', 'vio-live.dev.sqlite'),
    defaultEngineDataDir: join(engineRepositoryRoot, '.continuity-data'),
    userHome,
    documentsDirectory: join(userHome, 'Documents'),
  });
}
