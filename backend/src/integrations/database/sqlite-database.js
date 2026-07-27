import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { runMigrations } from './migrations.js';

export function createSqliteDatabase({ databasePath, migrationsPath }) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const connection = new DatabaseSync(databasePath);
  let transactionDepth = 0;
  try {
    connection.exec('PRAGMA foreign_keys = ON;');
    connection.exec('PRAGMA busy_timeout = 5000;');

    if (databasePath !== ':memory:') {
      connection.exec('PRAGMA journal_mode = WAL;');
    }

    runMigrations(connection, migrationsPath);
  } catch (error) {
    connection.close();
    throw error;
  }

  return {
    connection,
    runInTransaction(operation) {
      if (transactionDepth > 0) {
        return operation();
      }

      connection.exec('BEGIN IMMEDIATE;');
      transactionDepth += 1;

      try {
        const result = operation();
        connection.exec('COMMIT;');
        return result;
      } catch (error) {
        connection.exec('ROLLBACK;');
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
    ping() {
      const row = connection.prepare('SELECT 1 AS healthy').get();
      return row?.healthy === 1;
    },
    close() {
      connection.close();
    },
  };
}
