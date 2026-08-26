const Database = require('better-sqlite3');
const { prepareDatabaseStorage } = require('../lib/databasePath');

let db;
let storage;

function isSqlDebugEnabled(env = process.env) {
  return env.NODE_ENV !== 'production' && env.SQL_DEBUG === 'true';
}

function createDatabaseOptions(env = process.env) {
  if (!isSqlDebugEnabled(env)) {
    return {};
  }

  return { verbose: console.log };
}

function getDb() {
  if (!db) {
    storage = prepareDatabaseStorage();
    db = new Database(storage.databasePath, createDatabaseOptions());
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function getDatabaseStorage() {
  if (!storage) storage = prepareDatabaseStorage();
  return storage;
}

module.exports = { createDatabaseOptions, getDatabaseStorage, getDb, isSqlDebugEnabled };
