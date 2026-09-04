import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { runMigrations } from './migrations.js';
import { installOwnerDeletionAuthority } from './personal-deletion-scope.js';

export function createSqliteDatabase({ databasePath, migrationsPath }) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const connection = new DatabaseSync(databasePath);
  const withOwnerDeletion = installOwnerDeletionAuthority(connection);
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
    withOwnerDeletion(taskId,owner,rows,operation) {
      if(transactionDepth<1)throw new Error('Owner deletion requires an active managed transaction.');
      return withOwnerDeletion(taskId,owner,rows,()=>{
        const result=operation();
        if(result&&typeof result.then==='function')throw new Error('Owner deletion authority cannot cross an asynchronous boundary.');
        return result;
      });
    },
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
