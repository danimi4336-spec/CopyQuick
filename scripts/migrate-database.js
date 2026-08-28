#!/usr/bin/env node
require('dotenv').config();
const { getDatabaseStorage, getDb } = require('../db/database');
const { initializeDatabase } = require('../db/init');
const {
  DEFAULT_LEASE_MS,
  acquireRuntimeLock,
  startRuntimeLockHeartbeat
} = require('../lib/databaseRuntimeLock');

const storage = getDatabaseStorage();
let releaseLock;
let stopHeartbeat = () => {};

async function main() {
  releaseLock = acquireRuntimeLock(storage.databasePath, { waitForStaleMs: DEFAULT_LEASE_MS + 5000 });
  stopHeartbeat = startRuntimeLockHeartbeat(releaseLock);
  const result = await initializeDatabase({ db: getDb(), env: process.env });
  console.log(JSON.stringify({
    event: 'database_migration_complete',
    currentVersion: result.currentVersion,
    pendingCount: result.pendingCount,
    compatible: result.compatible
  }));
}

main().catch(error => {
  console.error(`Database migration failed: ${error.code || 'MIGRATION_FAILED'}`);
  process.exitCode = 1;
}).finally(() => {
  stopHeartbeat();
  if (releaseLock) {
    const result = releaseLock();
    if (!result.released || result.cleanupFailed) {
      console.error(`Database runtime lock release failed: ${result.code || 'OWNERSHIP_LOST'}`);
      process.exitCode = 1;
    }
  }
});
