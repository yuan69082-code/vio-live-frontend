import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from '../src/config.js';

export function parseFlags(argv, allowed) {
  const flags = new Set();
  for (const value of argv) {
    if (!allowed.includes(value)) throw new Error(`Unsupported argument: ${value}`);
    if (flags.has(value)) throw new Error(`Duplicate argument: ${value}`);
    flags.add(value);
  }
  return flags;
}

function missingConnection() {
  return Object.freeze({
    prepare() {
      return Object.freeze({ get: () => null, all: () => [] });
    },
    close() {},
  });
}

export function openReadonlyDatabase(environment = process.env) {
  const databasePath = loadConfig(environment).databasePath;
  if (databasePath === ':memory:' || !existsSync(databasePath)) {
    return Object.freeze({ connection: missingConnection(), databasePath, exists: false });
  }
  const connection = new DatabaseSync(databasePath, { readOnly: true });
  connection.exec('PRAGMA foreign_keys = ON;');
  return Object.freeze({ connection, databasePath, exists: true });
}

export function writeJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function publicError(error) {
  return Object.freeze({
    status: 'conflict',
    error: error?.code ?? 'preparation_failed',
    message: error instanceof Error ? error.message : 'Live chat preparation failed.',
    details: error?.details ?? null,
  });
}
