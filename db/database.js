const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_URL || path.join(__dirname, 'copyquick.db');

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

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
    db = new Database(dbPath, createDatabaseOptions());
    db.pragma('foreign_keys = ON');
  }
  return db;
}

module.exports = { createDatabaseOptions, getDb, isSqlDebugEnabled };
