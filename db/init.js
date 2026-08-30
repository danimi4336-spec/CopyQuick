const { getDb } = require('./database');
const {
  MigrationError,
  executeMigrationsWithProductionBackup,
  inspectMigrationStatus,
  runMigrationEngine
} = require('./migrations');

function configureRuntimeDatabase(db) {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
}

function safeMigrationLogger(entry) {
  console.log(JSON.stringify({
    event: entry.event,
    version: entry.version,
    name: entry.name,
    durationMs: entry.durationMs
  }));
}

function initializeDatabaseRuntime(options = {}) {
  const db = options.db || getDb();
  configureRuntimeDatabase(db);
  const integrity = db.pragma('quick_check', { simple: true });
  if (integrity !== 'ok') {
    throw new MigrationError('SQLite integrity validation failed.', 'SQLITE_INTEGRITY_FAILED');
  }
  console.log('Database runtime initialized successfully.');
  return { integrity };
}

// Isolated tests and explicit local tooling can use this synchronous migration
// entry point. Normal server startup never calls it.
function initDb(options = {}) {
  const db = options.db || getDb();
  const env = options.env || process.env;
  configureRuntimeDatabase(db);
  const status = inspectMigrationStatus(db, options);
  if (env.NODE_ENV === 'production' && !status.fresh && !status.adoptable && status.pendingCount > 0) {
    throw new MigrationError(
      'Production pending migrations require the verified-backup startup path.',
      'PREMIGRATION_BACKUP_REQUIRED'
    );
  }
  const result = runMigrationEngine(db, {
    ...options,
    env,
    logger: options.logger || safeMigrationLogger
  });
  console.log('Database initialized successfully.');
  return result;
}

async function initializeDatabase(options = {}) {
  const db = options.db || getDb();
  configureRuntimeDatabase(db);
  const result = await executeMigrationsWithProductionBackup(db, {
    ...options,
    env: options.env || process.env,
    logger: options.logger || safeMigrationLogger
  });
  console.log('Database initialized successfully.');
  return result;
}

if (require.main === module) {
  initializeDatabase().then(() => {
    console.log('Migration complete.');
  }).catch(error => {
    console.error(`Migration failed: ${error.code || 'MIGRATION_FAILED'}`);
    process.exitCode = 1;
  });
}

module.exports = {
  configureRuntimeDatabase,
  initDb,
  initializeDatabase,
  initializeDatabaseRuntime
};
