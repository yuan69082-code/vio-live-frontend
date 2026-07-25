import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function migrationFiles(migrationsPath) {
  return readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function runMigrations(connection, migrationsPath) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedVersions = new Set(
    connection
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.version),
  );

  const recordMigration = connection.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const filename of migrationFiles(migrationsPath)) {
    if (appliedVersions.has(filename)) {
      continue;
    }

    const sql = readFileSync(join(migrationsPath, filename), 'utf8');

    connection.exec('BEGIN IMMEDIATE');
    try {
      connection.exec(sql);
      recordMigration.run(filename, new Date().toISOString());
      connection.exec('COMMIT');
    } catch (error) {
      connection.exec('ROLLBACK');
      throw new Error(`Database migration failed: ${filename}`, { cause: error });
    }
  }
}
