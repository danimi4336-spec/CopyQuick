#!/usr/bin/env node
require('dotenv').config();
const { getDb } = require('../db/database');
const { requireCompatibleMigrationState } = require('../lib/migrationStartupGate');
const { stripe, isBillingEnabled } = require('../lib/stripe');
const { normalizeBillingCode, reconcileBilling } = require('../lib/billingReconciliation');
const {
  acquireBillingReconciliationLock,
  startBillingReconciliationHeartbeat
} = require('../lib/billingReconciliationLock');

const args = new Set(process.argv.slice(2));
const mode = args.has('--dry-run') && !args.has('--apply')
  ? 'dry_run'
  : args.has('--apply') && !args.has('--dry-run') ? 'apply' : null;
if (!mode) {
  console.error(JSON.stringify({ event: 'billing_reconciliation_rejected', code: 'RECONCILIATION_MODE_REQUIRED' }));
  process.exit(2);
}
if (!isBillingEnabled || !stripe) {
  console.error(JSON.stringify({ event: 'billing_reconciliation_failed', code: 'STRIPE_API_UNAVAILABLE' }));
  process.exit(2);
}

let lock;
let stopHeartbeat = () => {};
try {
  const db = getDb();
  requireCompatibleMigrationState({ db, logger: () => {} });
  lock = acquireBillingReconciliationLock();
  stopHeartbeat = startBillingReconciliationHeartbeat(lock);
  reconcileBilling({ db, stripeClient: stripe, mode, logger: () => {} }).then(summary => {
    console.log(JSON.stringify({
      event: 'reconciliation_completed', mode, inspectedCount: summary.inspectedCount,
      driftCount: summary.driftCount, repairedCount: summary.repairedCount,
      unresolvedCount: summary.unresolvedCount
    }, null, 2));
  }).catch(error => {
    console.error(JSON.stringify({ event: 'reconciliation_failed', code: normalizeBillingCode(error.code) }));
    process.exitCode = 2;
  }).finally(() => {
    stopHeartbeat();
    if (lock) lock.release();
  });
} catch (error) {
  stopHeartbeat();
  if (lock) lock.release();
  console.error(JSON.stringify({ event: 'reconciliation_failed', code: normalizeBillingCode(error.code) }));
  process.exitCode = 2;
}
