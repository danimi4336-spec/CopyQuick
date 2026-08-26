#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function absoluteExplicitPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} path is required.`);
  return path.resolve(value.trim());
}

function tableCounts(db) {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return Object.fromEntries(tables.map(function(row) {
    const identifier = `"${row.name.replace(/"/g, '""')}"`;
    return [row.name, db.prepare(`SELECT COUNT(*) AS count FROM ${identifier}`).get().count];
  }));
}

function assertIntegrity(db, label) {
  const result = db.pragma('quick_check', { simple: true });
  if (result !== 'ok') throw new Error(`${label} database failed SQLite quick_check.`);
}

async function migrateSqliteStorage({ sourcePath, destinationPath }) {
  const source = absoluteExplicitPath(sourcePath, 'Source');
  const destination = absoluteExplicitPath(destinationPath, 'Destination');
  if (source === destination) throw new Error('Source and destination must be different paths.');
  if (!fs.existsSync(source)) throw new Error('Source database does not exist.');
  if (fs.existsSync(destination)) throw new Error('Destination already exists; refusing to overwrite it.');
  const destinationDirectory = path.dirname(destination);
  if (!fs.existsSync(destinationDirectory)) throw new Error('Destination directory does not exist.');
  fs.accessSync(source, fs.constants.R_OK);
  fs.accessSync(destinationDirectory, fs.constants.W_OK);

  const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
  let sourceCounts;
  try {
    assertIntegrity(sourceDb, 'Source');
    sourceCounts = tableCounts(sourceDb);
    await sourceDb.backup(destination);
  } finally {
    sourceDb.close();
  }

  const destinationDb = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    assertIntegrity(destinationDb, 'Destination');
    const destinationCounts = tableCounts(destinationDb);
    if (JSON.stringify(sourceCounts) !== JSON.stringify(destinationCounts)) {
      throw new Error('Destination verification failed: table counts differ from source.');
    }
    return { source, destination, integrity: 'ok', tableCounts: destinationCounts };
  } catch (err) {
    destinationDb.close();
    throw err;
  } finally {
    if (destinationDb.open) destinationDb.close();
  }
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

if (require.main === module) {
  migrateSqliteStorage({
    sourcePath: argumentValue(process.argv.slice(2), '--source'),
    destinationPath: argumentValue(process.argv.slice(2), '--destination')
  }).then(function(result) {
    console.log(`SQLite migration verified successfully (${Object.keys(result.tableCounts).length} tables).`);
    console.log(`Destination: ${result.destination}`);
  }).catch(function(err) {
    console.error(`SQLite migration failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { migrateSqliteStorage, tableCounts };
