#!/usr/bin/env node
require('dotenv').config();
const { getDatabaseStorage, getDb } = require('../db/database');
const { initializeDatabase } = require('../db/init');
const {
  DEFAULT_LEASE_MS,
  acquireRuntimeLock,
  startRuntimeLockHeartbeat
} = require('../lib/databaseRuntimeLock');

let releaseLock;
let stopHeartbeat = () => {};

const PRODUCTION_CONFIRMATION_FLAG = '--confirm-production-migration';

function requireProductionConfirmation(env = process.env, args = process.argv.slice(2)) {
  if (env.NODE_ENV !== 'production') return;
  if (args.includes(PRODUCTION_CONFIRMATION_FLAG)) return;
  const error = new Error('Production migration requires explicit operator confirmation.');
  error.code = 'PRODUCTION_MIGRATION_CONFIRMATION_REQUIRED';
  throw error;
}

async function main() {
  requireProductionConfirmation();
  const storage = getDatabaseStorage();
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

if (require.main === module) {
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
}

module.exports = { PRODUCTION_CONFIRMATION_FLAG, main, requireProductionConfirmation };
