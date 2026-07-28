import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readPort(value) {
  const port = Number.parseInt(value ?? '8787', 10);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('VIO_BACKEND_PORT must be an integer between 0 and 65535.');
  }

  return port;
}

function readDatabasePath(value) {
  if (!value) {
    return join(backendRoot, 'data', 'vio-live.dev.sqlite');
  }

  if (value === ':memory:' || isAbsolute(value)) {
    return value;
  }

  return resolve(process.cwd(), value);
}

export function loadConfig(environment = process.env) {
  return Object.freeze({
    host: environment.VIO_BACKEND_HOST?.trim() || '127.0.0.1',
    port: readPort(environment.VIO_BACKEND_PORT),
    databasePath: readDatabasePath(environment.VIO_BACKEND_DB_PATH),
    migrationsPath: join(backendRoot, 'migrations'),
    serviceName: 'vio-live-backend',
    serviceVersion: '0.16.0',
  });
}
