#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const fs = require('fs');
const Database = require('better-sqlite3');
const { prepareDatabaseStorage } = require('../lib/databasePath');
const { inspectMigrationStatus } = require('../db/migrations');
const { evaluateMigrationCompatibility, classifyMigrationInspectionError } = require('../lib/migrationCompatibility');
const { inspectStorageHealth } = require('../lib/storageHealth');
const { getBillingReconciliationStatus } = require('../lib/billingReconciliation');
const { getGenerationControlState } = require('../lib/generationControls');
const { inspectProductionRecovery } = require('../lib/productionRecovery');
const { buildOperationalStatus, exitCodeForOperationalStatus } = require('../lib/operationalStatus');

function migrationSummary(db) {
  try {
    const inspected = inspectMigrationStatus(db);
    const policy = evaluateMigrationCompatibility(inspected);
    return {
      safe: policy.safe,
      code: policy.condition,
      currentVersion: inspected.currentVersion,
      pendingCount: inspected.pendingCount
    };
  } catch (error) {
    const policy = classifyMigrationInspectionError(error);
    return { safe: false, code: policy.condition, currentVersion: null, pendingCount: null };
  }
}

function storageSummary(health) {
  return {
    status: health.status,
    quickCheck: health.database?.quickCheck,
    capacityStatus: health.capacity?.status,
    freePercent: health.capacity?.freePercent,
    localBackupStatus: health.backups?.status,
    latestVerifiedBackupAt: health.backups?.latestVerifiedBackupAt,
    offsiteEnabled: health.offsiteBackup?.enabled,
    offsiteStatus: health.offsiteBackup?.status,
    offsiteScheduleEnabled: health.offsiteBackup?.scheduleEnabled,
    offsiteLastSuccessAt: health.offsiteBackup?.lastSuccessAt
  };
}
function researchSummary(db) {
  const rows = db.prepare("SELECT structured_result FROM generations WHERE deliverable_id = 'research_evidence_pack' AND is_deleted = 0 ORDER BY id DESC LIMIT 100").all();
  const values = rows.map(row => { try { return JSON.parse(row.structured_result || '{}').researchOperations; } catch (_) { return null; } }).filter(Boolean);
  const count = values.length, supported = values.filter(item => ['SUPPORTED', 'PARTIAL'].includes(item.status)).length, insufficient = values.filter(item => ['INSUFFICIENT', 'BLOCKED'].includes(item.status)).length;
  const failures = values.flatMap(item => item.providerFailures || []);
  return { status: failures.some(item => ['AUTHORIZATION_FAILURE', 'BILLING_FAILURE'].includes(item.failureCategory)) ? 'unavailable' : failures.length ? 'degraded' : 'healthy', openCircuitCount: 0,
    authorizationFailureCount: failures.filter(item => item.failureCategory === 'AUTHORIZATION_FAILURE').length, rateLimitedCount: failures.filter(item => item.failureCategory === 'RATE_LIMITED').length,
    timeoutCount: failures.filter(item => item.failureCategory === 'TIMEOUT').length, recentRunCount: count, supportRate: count ? supported / count : 0, insufficientRate: count ? insufficient / count : 0,
    fallbackRate: count ? values.filter(item => ['PARTIAL', 'PROVIDER_UNAVAILABLE', 'BUDGET_EXHAUSTED'].includes(item.status)).length / count : 0,
    meanLatencyMs: count ? values.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0) / count : 0, estimatedCostUsd: values.reduce((sum, item) => sum + (Number(item.estimatedCostUsd) || 0), 0) };
}

function main(args = process.argv.slice(2)) {
  if (args.length) {
    console.error(JSON.stringify({ status: 'critical', code: 'OPERATIONS_STATUS_ARGUMENTS_INVALID' }));
    return 2;
  }
  let db;
  try {
    const storage = prepareDatabaseStorage(process.env, fs);
    db = new Database(storage.databasePath, { readonly: true, fileMustExist: true });
    db.pragma('foreign_keys = ON');
    const migration = migrationSummary(db);
    const storageHealth = inspectStorageHealth({ env: process.env, db, fsApi: fs, logger: () => {} });
    const compatible = migration.safe;
    const billing = compatible
      ? getBillingReconciliationStatus(db, {
        enabled: String(process.env.STRIPE_RECONCILIATION_ENABLED || '').toLowerCase() === 'true'
      })
      : { enabled: false };
    const productionRecovery = compatible ? inspectProductionRecovery(db, { limit: 1 }) : {};
    const result = buildOperationalStatus({
      production: process.env.NODE_ENV === 'production',
      migration,
      storage: storageSummary(storageHealth),
      billing,
      generation: getGenerationControlState({ env: process.env, fsApi: fs }),
      productionRecovery
      ,research: researchSummary(db)
    });
    console.log(JSON.stringify(result, null, 2));
    return exitCodeForOperationalStatus(result);
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code : 'OPERATIONS_STATUS_UNAVAILABLE';
    console.error(JSON.stringify({ status: 'critical', code }));
    return 2;
  } finally {
    if (db) db.close();
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, migrationSummary, researchSummary, storageSummary };
