import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from '../src/config.js';

export function normalizeScriptArguments(argv) {
  return argv[0] === '--' ? argv.slice(1) : [...argv];
}

export function parseFlags(argv, allowed) {
  const flags = new Set();
  for (const value of normalizeScriptArguments(argv)) {
    if (!allowed.includes(value)) throw new Error(`Unsupported argument: ${value}`);
    if (flags.has(value)) throw new Error(`Duplicate argument: ${value}`);
    flags.add(value);
  }
  return flags;
}

export function parseStrictArguments(argv, { valueOptions = [], flags = [] } = {}) {
  const normalized = normalizeScriptArguments(argv);
  const values = new Map();
  const parsedFlags = new Set();
  for (let index = 0; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (valueOptions.includes(argument)) {
      if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
      const value = normalized[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for argument: ${argument}`);
      values.set(argument, value);
      index += 1;
      continue;
    }
    if (flags.includes(argument)) {
      if (parsedFlags.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
      parsedFlags.add(argument);
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return Object.freeze({ values, flags: parsedFlags });
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
    status: error?.status ?? 'conflict',
    error: error?.code ?? 'preparation_failed',
    message: error instanceof Error ? error.message : 'Live chat preparation failed.',
    details: error?.details ?? (error?.reason ? { reason: error.reason } : null),
  });
}
