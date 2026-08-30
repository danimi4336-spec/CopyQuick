const crypto = require('crypto');
const Database = require('better-sqlite3');
const { BASELINE_INDEXES, BASELINE_SCHEMA_SQL, BASELINE_TABLES } = require('./schema');

const MIN_SUPPORTED_SCHEMA_VERSION = 1;
const MAX_SUPPORTED_SCHEMA_VERSION = 1;
const LEDGER_TABLE = 'schema_migrations';
const LEDGER_SQL = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK(version > 0),
    name TEXT UNIQUE NOT NULL,
    checksum TEXT NOT NULL CHECK(length(checksum) = 64),
    applied_at TEXT NOT NULL,
    application_revision TEXT,
    rollback_compatible INTEGER NOT NULL CHECK(rollback_compatible IN (0, 1))
  )
`;

class MigrationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.details = details;
  }
}

const BASELINE_MIGRATION = Object.freeze({
  version: 1,
  name: 'current_schema_baseline',
  kind: 'baseline',
  policy: 'additive',
  rollbackCompatible: true,
  statements: Object.freeze([BASELINE_SCHEMA_SQL])
});

const MIGRATIONS = Object.freeze([BASELINE_MIGRATION]);

function migrationChecksum(migration) {
  const material = JSON.stringify({
    version: migration.version,
    name: migration.name,
    kind: migration.kind || 'migration',
    policy: migration.policy,
    rollbackCompatible: migration.rollbackCompatible === true,
    statements: migration.statements
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

function sqlCodeOnly(statement) {
  const input = String(statement || '');
  let output = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (lineComment) {
      if (char === '\n') { lineComment = false; output += ' '; }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; output += ' '; }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote && quote !== ']') { index += 1; continue; }
        quote = null;
      }
      output += ' ';
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; output += ' '; continue; }
    if (char === '[') { quote = ']'; output += ' '; continue; }
    output += char;
  }
  return output;
}

function validateAdditiveStatement(statement) {
  const code = sqlCodeOnly(statement).trim();
  const withoutFinalTerminator = code.replace(/;\s*$/, '');
  if (withoutFinalTerminator.includes(';')) return false;
  const normalized = withoutFinalTerminator.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (/\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\b[\s\S]*\b(?:RENAME|DROP)\b|\bCREATE\s+TABLE\b[\s\S]*\bAS\s+SELECT\b/i.test(normalized)) {
    return false;
  }
  return /^(?:CREATE\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE\s+[A-Za-z_][A-Za-z0-9_]*\s+ADD\s+COLUMN)\b/i.test(normalized);
}

function validateMigrationRegistry(registry = MIGRATIONS) {
  if (!Array.isArray(registry) || registry.length === 0) {
    throw new MigrationError('Migration registry is invalid.', 'MIGRATION_REGISTRY_INVALID');
  }
  let previous = 0;
  const names = new Set();
  registry.forEach((migration, index) => {
    if (!Number.isInteger(migration.version) || migration.version !== previous + 1 ||
        !/^[a-z0-9_]{1,80}$/.test(String(migration.name || '')) || names.has(migration.name)) {
      throw new MigrationError('Migration ordering or identity is invalid.', 'MIGRATION_REGISTRY_INVALID');
    }
    if (migration.policy !== 'additive' || migration.destructive === true || !Array.isArray(migration.statements)) {
      throw new MigrationError('Destructive migrations are not supported.', 'DESTRUCTIVE_MIGRATION_REJECTED');
    }
    if (index === 0) {
      if (migration.kind !== 'baseline') {
        throw new MigrationError('Migration registry baseline is invalid.', 'MIGRATION_REGISTRY_INVALID');
      }
    } else if (migration.statements.some(statement => !validateAdditiveStatement(statement))) {
      throw new MigrationError('Migration contains an operation outside the additive V1 policy.', 'DESTRUCTIVE_MIGRATION_REJECTED');
    }
    previous = migration.version;
    names.add(migration.name);
  });
  return registry;
}

function safeRevision(value) {
  const revision = String(value || '').trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(revision) ? revision : null;
}

function getApplicationRevision(env = process.env) {
  return safeRevision(env.RENDER_GIT_COMMIT || env.APPLICATION_REVISION);
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function userTables(db) {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);
}

function normalizeColumn(row) {
  return {
    name: row.name,
    type: String(row.type || '').toUpperCase(),
    notnull: Number(row.notnull),
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    primaryKey: Number(row.pk)
  };
}

function normalizeForeignKey(row) {
  return {
    table: row.table,
    from: row.from,
    to: row.to,
    onUpdate: row.on_update,
    onDelete: row.on_delete,
    match: row.match
  };
}

function indexShape(db, name) {
  const row = db.prepare(`SELECT name, tbl_name AS tableName, sql FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name);
  if (!row) return null;
  const owner = db.prepare(`SELECT [unique], partial FROM pragma_index_list(?) WHERE name = ?`).get(row.tableName, name);
  const columns = db.prepare(`SELECT name, desc, key FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno`).all(name)
    .map(column => ({ name: column.name, desc: Number(column.desc) }));
  const whereMatch = String(row.sql || '').match(/\bWHERE\b([\s\S]+)$/i);
  const where = whereMatch ? whereMatch[1].replace(/\s+/g, ' ').trim().toLowerCase() : null;
  return { tableName: row.tableName, unique: Number(owner?.unique || 0), partial: Number(owner?.partial || 0), columns, where };
}

function uniqueConstraintShapes(db, table) {
  return db.prepare(`SELECT name FROM pragma_index_list(?) WHERE [unique] = 1 AND origin IN ('u', 'pk')`).all(table)
    .map(row => db.prepare(`SELECT name FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno`).all(row.name)
      .map(column => column.name))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function structuralReference() {
  const reference = new Database(':memory:');
  try {
    reference.pragma('foreign_keys = ON');
    reference.exec(BASELINE_SCHEMA_SQL);
    const tables = {};
    BASELINE_TABLES.forEach(table => {
      tables[table] = {
        columns: reference.pragma(`table_info(${quoteIdentifier(table)})`).map(normalizeColumn).sort((a, b) => a.name.localeCompare(b.name)),
        foreignKeys: reference.pragma(`foreign_key_list(${quoteIdentifier(table)})`).map(normalizeForeignKey)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        uniqueConstraints: uniqueConstraintShapes(reference, table)
      };
    });
    const indexes = Object.fromEntries(BASELINE_INDEXES.map(name => [name, indexShape(reference, name)]));
    return { tables, indexes };
  } finally {
    reference.close();
  }
}

let cachedReference;
function expectedStructure() {
  if (!cachedReference) cachedReference = structuralReference();
  return cachedReference;
}

function verifyBaselineStructure(db, { exact = false } = {}) {
  const expected = expectedStructure();
  const actualTables = userTables(db).filter(name => name !== LEDGER_TABLE);
  const missingTables = BASELINE_TABLES.filter(name => !actualTables.includes(name));
  const unexpectedTables = exact ? actualTables.filter(name => !BASELINE_TABLES.includes(name)) : [];
  if (missingTables.length || unexpectedTables.length) {
    throw new MigrationError('Database does not match the approved CopyQuick baseline.', 'BASELINE_STRUCTURE_INVALID');
  }

  for (const table of BASELINE_TABLES) {
    const actualColumns = db.pragma(`table_info(${quoteIdentifier(table)})`).map(normalizeColumn);
    const byName = new Map(actualColumns.map(column => [column.name, column]));
    const expectedColumns = expected.tables[table].columns;
    if ((exact && actualColumns.length !== expectedColumns.length) ||
        expectedColumns.some(column => JSON.stringify(byName.get(column.name)) !== JSON.stringify(column))) {
      throw new MigrationError('Database does not match the approved CopyQuick baseline.', 'BASELINE_STRUCTURE_INVALID');
    }
    const actualForeignKeys = db.pragma(`foreign_key_list(${quoteIdentifier(table)})`).map(normalizeForeignKey)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (JSON.stringify(actualForeignKeys) !== JSON.stringify(expected.tables[table].foreignKeys)) {
      throw new MigrationError('Database constraints do not match the approved CopyQuick baseline.', 'BASELINE_STRUCTURE_INVALID');
    }
    if (JSON.stringify(uniqueConstraintShapes(db, table)) !== JSON.stringify(expected.tables[table].uniqueConstraints)) {
      throw new MigrationError('Database constraints do not match the approved CopyQuick baseline.', 'BASELINE_STRUCTURE_INVALID');
    }
  }

  for (const name of BASELINE_INDEXES) {
    if (JSON.stringify(indexShape(db, name)) !== JSON.stringify(expected.indexes[name])) {
      throw new MigrationError('Database indexes do not match the approved CopyQuick baseline.', 'BASELINE_STRUCTURE_INVALID');
    }
  }
  return true;
}

let cachedLedgerShape;
function ledgerShape(db) {
  return {
    columns: db.pragma(`table_info(${quoteIdentifier(LEDGER_TABLE)})`).map(normalizeColumn).sort((a, b) => a.name.localeCompare(b.name)),
    uniqueConstraints: uniqueConstraintShapes(db, LEDGER_TABLE),
    sql: String(db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(LEDGER_TABLE)?.sql || '')
      .replace(/\s+/g, ' ').trim().toLowerCase()
  };
}

function expectedLedgerShape() {
  if (!cachedLedgerShape) {
    const reference = new Database(':memory:');
    try {
      reference.exec(LEDGER_SQL);
      cachedLedgerShape = ledgerShape(reference);
    } finally { reference.close(); }
  }
  return cachedLedgerShape;
}

function verifyLedgerStructure(db) {
  if (JSON.stringify(ledgerShape(db)) !== JSON.stringify(expectedLedgerShape())) {
    throw new MigrationError('Migration ledger structure is invalid.', 'MIGRATION_LEDGER_INVALID');
  }
}

function readLedger(db, registry, maxVersion) {
  verifyLedgerStructure(db);
  const rows = db.prepare(`SELECT version, name, checksum, applied_at, application_revision, rollback_compatible FROM ${LEDGER_TABLE} ORDER BY version`).all();
  if (rows.some(row => row.version > maxVersion)) {
    throw new MigrationError('Database schema is newer than this application supports.', 'SCHEMA_VERSION_TOO_NEW');
  }
  rows.forEach((row, index) => {
    const expected = registry[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name ||
        row.checksum !== migrationChecksum(expected) || row.rollback_compatible !== Number(expected.rollbackCompatible === true)) {
      throw new MigrationError('Migration history failed integrity validation.', 'MIGRATION_CHECKSUM_MISMATCH');
    }
  });
  return rows;
}

function resolveCompatibility({ currentVersion, minVersion, maxVersion, fresh, adoptable }) {
  if (fresh || adoptable) return;
  if (currentVersion < minVersion) {
    throw new MigrationError('Database schema is older than this application supports.', 'SCHEMA_VERSION_TOO_OLD');
  }
  if (currentVersion > maxVersion) {
    throw new MigrationError('Database schema is newer than this application supports.', 'SCHEMA_VERSION_TOO_NEW');
  }
}

function inspectMigrationStatus(db, options = {}) {
  const registry = validateMigrationRegistry(options.registry || MIGRATIONS);
  const minVersion = options.minVersion ?? MIN_SUPPORTED_SCHEMA_VERSION;
  const maxVersion = options.maxVersion ?? MAX_SUPPORTED_SCHEMA_VERSION;
  if (!Number.isInteger(minVersion) || !Number.isInteger(maxVersion) || minVersion < 1 ||
      minVersion > maxVersion || maxVersion !== registry.at(-1).version) {
    throw new MigrationError('Application schema compatibility configuration is invalid.', 'SCHEMA_COMPATIBILITY_CONFIG_INVALID');
  }
  const tables = userTables(db);
  const fresh = tables.length === 0;
  const hasLedger = tables.includes(LEDGER_TABLE);
  let adoptable = false;
  let rows = [];

  if (fresh) {
    // The baseline migration is the sole schema constructor for a new database.
  } else if (!hasLedger) {
    verifyBaselineStructure(db, { exact: true });
    adoptable = true;
  } else {
    rows = readLedger(db, registry, maxVersion);
    verifyBaselineStructure(db);
  }

  const currentVersion = adoptable ? BASELINE_MIGRATION.version : (rows.at(-1)?.version || 0);
  resolveCompatibility({ currentVersion, minVersion, maxVersion, fresh, adoptable });
  const pending = fresh ? registry : registry.filter(migration => migration.version > currentVersion);
  return {
    currentVersion,
    minSupportedVersion: minVersion,
    maxSupportedVersion: maxVersion,
    baselineStatus: fresh ? 'new_database' : adoptable ? 'adoption_required' : 'recorded',
    pendingCount: adoptable ? 0 : pending.length,
    pendingVersions: adoptable ? [] : pending.map(migration => migration.version),
    compatible: true,
    fresh,
    adoptable,
    hasLedger
  };
}

function insertLedgerRow(db, migration, { applicationRevision, now }) {
  db.prepare(`
    INSERT INTO schema_migrations (
      version, name, checksum, applied_at, application_revision, rollback_compatible
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    migration.version,
    migration.name,
    migrationChecksum(migration),
    now().toISOString(),
    applicationRevision,
    Number(migration.rollbackCompatible === true)
  );
}

function applyOneMigration(db, migration, options) {
  const started = Date.now();
  options.logger?.({ event: 'migration_started', version: migration.version, name: migration.name });
  try {
    db.transaction(() => {
      migration.statements.forEach(statement => db.exec(statement));
      if (migration.version === BASELINE_MIGRATION.version) verifyBaselineStructure(db);
      if (typeof migration.validate === 'function') migration.validate(db);
      insertLedgerRow(db, migration, options);
    })();
    options.logger?.({ event: 'migration_completed', version: migration.version, name: migration.name, durationMs: Date.now() - started });
  } catch (error) {
    options.logger?.({ event: 'migration_failed', version: migration.version, name: migration.name });
    throw new MigrationError('Database migration failed.', 'MIGRATION_FAILED', { version: migration.version, causeCode: error.code || null });
  }
}

function runMigrationEngine(db, options = {}) {
  const registry = validateMigrationRegistry(options.registry || MIGRATIONS);
  const status = inspectMigrationStatus(db, { ...options, registry });
  const applicationRevision = safeRevision(options.applicationRevision) || getApplicationRevision(options.env);
  const context = {
    applicationRevision,
    now: options.now || (() => new Date()),
    logger: options.logger
  };

  if (status.adoptable) {
    db.transaction(() => {
      db.exec(LEDGER_SQL);
      insertLedgerRow(db, registry[0], context);
    })();
    options.logger?.({ event: 'migration_baseline_recorded', version: registry[0].version, name: registry[0].name });
  } else if (status.fresh) {
    db.transaction(() => {
      db.exec(LEDGER_SQL);
      registry[0].statements.forEach(statement => db.exec(statement));
      verifyBaselineStructure(db);
      insertLedgerRow(db, registry[0], context);
    })();
    options.logger?.({ event: 'migration_completed', version: registry[0].version, name: registry[0].name, durationMs: 0 });
  }

  const afterBaseline = inspectMigrationStatus(db, { ...options, registry });
  registry.filter(migration => migration.version > afterBaseline.currentVersion)
    .forEach(migration => applyOneMigration(db, migration, context));

  const finalStatus = inspectMigrationStatus(db, { ...options, registry });
  const integrity = db.pragma('quick_check', { simple: true });
  if (integrity !== 'ok') throw new MigrationError('SQLite integrity validation failed.', 'SQLITE_INTEGRITY_FAILED');
  return { ...finalStatus, integrity };
}

async function executeMigrationsWithProductionBackup(db, options = {}) {
  const registry = validateMigrationRegistry(options.registry || MIGRATIONS);
  const status = inspectMigrationStatus(db, { ...options, registry });
  const production = (options.env || process.env).NODE_ENV === 'production';
  const realPending = !status.fresh && !status.adoptable && status.pendingCount > 0;
  if (production && realPending) {
    const createBackup = options.createBackup || (backupOptions => require('../lib/databaseBackup').createDatabaseBackup(backupOptions));
    const backup = await createBackup({ db, env: options.env || process.env, logger: options.backupLogger });
    if (backup?.success !== true) {
      throw new MigrationError('Verified pre-migration backup was not confirmed.', 'PREMIGRATION_BACKUP_FAILED');
    }
  }
  return runMigrationEngine(db, { ...options, registry });
}

module.exports = {
  BASELINE_MIGRATION,
  LEDGER_SQL,
  LEDGER_TABLE,
  MAX_SUPPORTED_SCHEMA_VERSION,
  MIGRATIONS,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MigrationError,
  executeMigrationsWithProductionBackup,
  getApplicationRevision,
  inspectMigrationStatus,
  migrationChecksum,
  runMigrationEngine,
  validateMigrationRegistry,
  verifyBaselineStructure
};
