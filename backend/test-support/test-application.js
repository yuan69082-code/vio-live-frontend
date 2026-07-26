import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const silentLogger = {
  error() {},
};

export function createTestDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'vio-live-backend-'));
  return {
    directory,
    databasePath: join(directory, 'test.sqlite'),
    remove() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export async function startTestApplication(databasePath) {
  const config = loadConfig({
    VIO_BACKEND_HOST: '127.0.0.1',
    VIO_BACKEND_PORT: '0',
    VIO_BACKEND_DB_PATH: databasePath,
  });
  const application = createApplication({ config, logger: silentLogger });
  const address = await application.start();

  return {
    application,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

export async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    response,
    body: await response.json(),
  };
}

export async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return {
    response,
    body: await response.json(),
  };
}

export async function patchJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return {
    response,
    body: await response.json(),
  };
}

export async function deleteJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
  });

  return {
    response,
    body: await response.json(),
  };
}
