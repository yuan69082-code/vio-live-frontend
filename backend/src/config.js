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

function readBoolean(value, name, defaultValue = false) {
  if (value === undefined || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function readPositiveInteger(value, name, defaultValue) {
  const number = Number.parseInt(value ?? String(defaultValue), 10);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function readContinuityEngineConfig(environment) {
  const enabled = readBoolean(
    environment.VIO_CONTINUITY_ENGINE_ENABLED,
    'VIO_CONTINUITY_ENGINE_ENABLED',
  );
  const rawBaseUrl = environment.VIO_CONTINUITY_ENGINE_BASE_URL?.trim() ?? '';
  const token = environment.VIO_CONTINUITY_ENGINE_TOKEN ?? '';
  if (enabled && !rawBaseUrl) {
    throw new Error('VIO_CONTINUITY_ENGINE_BASE_URL is required when integration is enabled.');
  }
  if (enabled && token.length < 32) {
    throw new Error(
      'VIO_CONTINUITY_ENGINE_TOKEN must contain at least 32 characters when integration is enabled.',
    );
  }
  let baseUrl = rawBaseUrl || 'http://127.0.0.1:8766';
  try {
    const parsed = new URL(baseUrl);
    if (
      parsed.protocol !== 'http:'
      || parsed.hostname !== '127.0.0.1'
      || parsed.username
      || parsed.password
      || (parsed.pathname !== '/' && parsed.pathname !== '')
      || parsed.search
      || parsed.hash
    ) {
      throw new TypeError('not a loopback origin');
    }
    baseUrl = parsed.origin;
  } catch {
    throw new Error(
      'VIO_CONTINUITY_ENGINE_BASE_URL must be a credential-free 127.0.0.1 HTTP origin.',
    );
  }
  return Object.freeze({
    enabled,
    baseUrl,
    token,
    connectTimeoutMs: readPositiveInteger(
      environment.VIO_CONTINUITY_ENGINE_CONNECT_TIMEOUT_MS,
      'VIO_CONTINUITY_ENGINE_CONNECT_TIMEOUT_MS',
      2_000,
    ),
    responseTimeoutMs: readPositiveInteger(
      environment.VIO_CONTINUITY_ENGINE_RESPONSE_TIMEOUT_MS,
      'VIO_CONTINUITY_ENGINE_RESPONSE_TIMEOUT_MS',
      20_000,
    ),
    maxResponseBytes: readPositiveInteger(
      environment.VIO_CONTINUITY_ENGINE_MAX_RESPONSE_BYTES,
      'VIO_CONTINUITY_ENGINE_MAX_RESPONSE_BYTES',
      1_048_576,
    ),
  });
}

export function loadConfig(environment = process.env) {
  return Object.freeze({
    host: environment.VIO_BACKEND_HOST?.trim() || '127.0.0.1',
    port: readPort(environment.VIO_BACKEND_PORT),
    databasePath: readDatabasePath(environment.VIO_BACKEND_DB_PATH),
    migrationsPath: join(backendRoot, 'migrations'),
    serviceName: 'vio-live-backend',
    serviceVersion: '0.18.0',
    continuityEngine: readContinuityEngineConfig(environment),
  });
}
