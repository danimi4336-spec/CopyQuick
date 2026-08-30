#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const Database = require('better-sqlite3');
const { prepareDatabaseStorage } = require('../lib/databasePath');
const { requireCompatibleMigrationState } = require('../lib/migrationStartupGate');
const { getBillingReconciliationStatus, normalizeBillingCode } = require('../lib/billingReconciliation');

let db;
try {
  const storage = prepareDatabaseStorage(process.env, fs);
  db = new Database(storage.databasePath, { readonly: true, fileMustExist: true });
  requireCompatibleMigrationState({ db, logger: () => {} });
  const status = getBillingReconciliationStatus(db, {
    enabled: String(process.env.STRIPE_RECONCILIATION_ENABLED || '').toLowerCase() === 'true'
  });
  console.log(JSON.stringify({ billingReconciliation: status }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ billingReconciliation: { status: 'unavailable', code: normalizeBillingCode(error.code) } }));
  process.exitCode = 2;
} finally {
  if (db) db.close();
}
