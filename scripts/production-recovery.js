#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const fs = require('fs');
const Database = require('better-sqlite3');
const { prepareDatabaseStorage } = require('../lib/databasePath');
const { acquireRuntimeLock } = require('../lib/databaseRuntimeLock');
const { requireCompatibleMigrationState } = require('../lib/migrationStartupGate');
const { applyProductionRecovery, inspectProductionRecovery } = require('../lib/productionRecovery');

function parsedInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseArguments(args) {
  if (!args.length || (args.length === 1 && args[0] === '--status')) return { mode: 'status' };
  const actionFlags = [
    ['--safe-retry', 'safe_retry'],
    ['--mark-failed', 'mark_failed'],
    ['--mark-completed', 'mark_completed']
  ].filter(([flag]) => args.includes(flag));
  const allowed = new Set([
    '--safe-retry', '--mark-failed', '--mark-completed', '--verified-safe',
    '--run-id', '--job-id', '--generation-id'
  ]);
  const seenFlags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!allowed.has(value)) return null;
    if (seenFlags.has(value)) return null;
    seenFlags.add(value);
    if (['--run-id', '--job-id', '--generation-id'].includes(value)) index += 1;
  }
  if (actionFlags.length !== 1 || !args.includes('--verified-safe')) return null;
  if (actionFlags[0][1] !== 'mark_completed' && args.includes('--generation-id')) return null;
  const parsed = {
    mode: 'apply',
    action: actionFlags[0][1],
    productionRunId: parsedInteger(valueAfter(args, '--run-id')),
    productionJobId: parsedInteger(valueAfter(args, '--job-id')),
    verifiedSafe: true
  };
  if (parsed.action === 'mark_completed') parsed.generationId = parsedInteger(valueAfter(args, '--generation-id'));
  return parsed.productionRunId && parsed.productionJobId
    && (parsed.action !== 'mark_completed' || parsed.generationId) ? parsed : null;
}

function normalizedFailure(error) {
  if (String(error?.message || '').includes('already in use')) return 'PRODUCTION_RUNTIME_ACTIVE';
  return typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : 'PRODUCTION_RECOVERY_FAILED';
}

function main(args = process.argv.slice(2)) {
  const command = parseArguments(args);
  if (!command) {
    console.error(JSON.stringify({ status: 'failed', code: 'PRODUCTION_RECOVERY_ARGUMENTS_INVALID' }));
    return 2;
  }
  let db;
  let runtimeLock;
  try {
    const storage = prepareDatabaseStorage(process.env, fs);
    if (!fs.existsSync(storage.databasePath)) throw Object.assign(new Error('Database unavailable'), { code: 'DATABASE_NOT_FOUND' });
    if (command.mode === 'apply') runtimeLock = acquireRuntimeLock(storage.databasePath);
    db = new Database(storage.databasePath, { readonly: command.mode === 'status', fileMustExist: true });
    db.pragma('foreign_keys = ON');
    requireCompatibleMigrationState({ db, databaseExists: true, logger: () => {} });
    if (command.mode === 'status') {
      console.log(JSON.stringify(inspectProductionRecovery(db), null, 2));
      return 0;
    }
    if (db.pragma('quick_check', { simple: true }) !== 'ok') {
      throw Object.assign(new Error('SQLite integrity check failed.'), { code: 'SQLITE_INTEGRITY_FAILED' });
    }
    const result = applyProductionRecovery(db, command);
    if (!result.valid) {
      console.error(JSON.stringify({ status: 'rejected', code: result.code }));
      return 2;
    }
    console.log(JSON.stringify({ status: 'applied', code: result.code, runStatus: result.status || null }));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: normalizedFailure(error) }));
    return 1;
  } finally {
    if (db) db.close();
    if (runtimeLock) runtimeLock();
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, normalizedFailure, parseArguments };
