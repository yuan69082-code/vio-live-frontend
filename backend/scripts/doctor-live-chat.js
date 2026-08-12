import {
  doctorLiveChat,
} from '../src/modules/continuity-integration/live-chat-preparation-service.js';
import {
  openReadonlyDatabase,
  parseFlags,
  publicError,
  writeJson,
} from './live-chat-script-support.js';

parseFlags(process.argv.slice(2), []);
let readonly;
try {
  readonly = openReadonlyDatabase(process.env);
  const result = doctorLiveChat({ connection: readonly.connection, environment: process.env });
  writeJson({ ...result, database: readonly.exists ? 'present' : 'missing' });
  if (result.status !== 'ready') process.exitCode = 2;
} catch (error) {
  writeJson(publicError(error), process.stderr);
  process.exitCode = 2;
} finally {
  readonly?.connection.close();
}
