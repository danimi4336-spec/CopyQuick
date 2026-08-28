const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const { evaluateBackupHealth } = require('../lib/backupHealthPolicy');
const {
  readBackupAlertState,
  resolveBackupAlertConfig,
  writeBackupAlertState
} = require('../lib/backupAlertState');
const { createOperatorNotifier } = require('../lib/operatorNotification');
const { createBackupHealthWatcher } = require('../lib/backupHealthWatcher');
const { createHealthRouter } = require('../routes/health');
const { inspectStorageHealth } = require('../lib/storageHealth');

function healthy(overrides = {}) {
  return {
    status: 'healthy',
    database: { quickCheck: 'ok', readable: true, writable: true },
    capacity: { status: 'healthy' },
    backups: { status: 'healthy', directoryStatus: 'writable', recognizedCount: 1, latestVerifiedBackupAt: '2026-08-27T00:00:00.000Z' },
    offsiteBackup: {
      enabled: true, status: 'healthy', scheduleEnabled: true,
      lastSuccessAt: '2026-08-27T00:00:00.000Z', lastFailureCode: null,
      lastAttemptAt: '2026-08-27T00:00:00.000Z', lastFailureAt: null,
      consecutiveFailureCount: 0
    },
    ...overrides
  };
}

function ids(health, env = {}) {
  return evaluateBackupHealth(health, { env }).map(item => item.id);
}

async function request(server) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: address.port, path: '/healthz' }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-316-'));
  try {
    const databasePath = path.join(root, 'copyquick.db');
    fs.writeFileSync(databasePath, 'fixture');
    const baseEnv = {
      NODE_ENV: 'test', DATABASE_PATH: databasePath,
      OFFSITE_BACKUP_ENABLED: 'true', OFFSITE_BACKUP_SCHEDULE_ENABLED: 'true',
      BACKUP_HEALTH_ALERTS_ENABLED: 'true', BACKUP_ALERT_EMAIL: 'ops@example.com',
      BACKUP_ALERT_REMINDER_HOURS: '24', BACKUP_RECOVERY_NOTIFICATIONS_ENABLED: 'true'
    };
    assert.strictEqual(resolveBackupAlertConfig({ NODE_ENV: 'test', DATABASE_PATH: databasePath }).requested, false);
    assert.strictEqual(resolveBackupAlertConfig({ ...baseEnv, BACKUP_ALERT_EMAIL: '' }).recipient, null);

    assert.deepStrictEqual(ids(healthy()), []);
    assert(ids(healthy({ offsiteBackup: { ...healthy().offsiteBackup, status: 'never_succeeded', lastSuccessAt: null } })).includes('OFFSITE_NEVER_SUCCEEDED'));
    assert(ids(healthy({ offsiteBackup: { ...healthy().offsiteBackup, status: 'warning' } })).includes('OFFSITE_BACKUP_STALE'));
    assert(ids(healthy({ offsiteBackup: { ...healthy().offsiteBackup, status: 'critical' } })).includes('OFFSITE_BACKUP_CRITICAL'));
    assert(ids(healthy({ database: { quickCheck: 'failed' } })).includes('SQLITE_INTEGRITY_FAILED'));
    assert(ids(healthy({ capacity: { status: 'critical' } })).includes('DATABASE_STORAGE_CRITICAL'));
    assert(ids(healthy({ backups: { status: 'unavailable', directoryStatus: 'unavailable' } })).includes('LOCAL_BACKUP_DIRECTORY_UNWRITABLE'));
    assert(ids(healthy({ backups: { status: 'missing', directoryStatus: 'writable' } })).includes('LOCAL_BACKUP_MISSING_OR_INVALID'));
    const healthBackupDirectory = path.join(root, 'health-backups');
    fs.mkdirSync(healthBackupDirectory);
    const healthEnv = {
      NODE_ENV: 'test', DATABASE_PATH: databasePath,
      DATABASE_BACKUP_DIR: healthBackupDirectory, OFFSITE_BACKUP_ENABLED: 'false'
    };
    const inspectedMissing = inspectStorageHealth({ env: healthEnv, db: { pragma: () => [{ quick_check: 'ok' }] } });
    assert.strictEqual(inspectedMissing.backups.status, 'missing');
    assert.strictEqual(inspectedMissing.status, 'warning');
    fs.writeFileSync(path.join(healthBackupDirectory, 'copyquick-2026-08-27T120000Z.db'), 'invalid');
    const inspectedInvalid = inspectStorageHealth({ env: healthEnv, db: { pragma: () => [{ quick_check: 'ok' }] } });
    assert.strictEqual(inspectedInvalid.backups.status, 'invalid');
    const failedOffsite = { ...healthy().offsiteBackup, lastFailureCode: 'REMOTE_TIMEOUT', lastFailureAt: '2026-08-27T01:00:00.000Z', consecutiveFailureCount: 3 };
    const failureIds = ids(healthy({ offsiteBackup: failedOffsite }));
    assert(failureIds.includes('OFFSITE_BACKUP_ATTEMPT_FAILED'));
    assert(failureIds.includes('OFFSITE_BACKUP_REPEATED_FAILURE'));
    assert(!ids(healthy({ offsiteBackup: { ...healthy().offsiteBackup, scheduleEnabled: false } }), {
      NODE_ENV: 'test', OFFSITE_BACKUP_ENABLED: 'true', BACKUP_HEALTH_ALERTS_ENABLED: 'true'
    }).includes('OFFSITE_SCHEDULER_DISABLED'));
    assert(ids(healthy({ offsiteBackup: { ...healthy().offsiteBackup, scheduleEnabled: false } }), {
      NODE_ENV: 'production', OFFSITE_BACKUP_ENABLED: 'true', BACKUP_HEALTH_ALERTS_ENABLED: 'true'
    }).includes('OFFSITE_SCHEDULER_DISABLED'));

    const config = resolveBackupAlertConfig(baseEnv);
    writeBackupAlertState(config, { version: 1, updatedAt: null, conditions: { TEST: { conditionId: 'TEST', active: true, severity: 'warning' } } });
    assert.strictEqual(fs.statSync(config.statePath).mode & 0o777, 0o600);
    assert(readBackupAlertState(config).conditions.TEST.active);
    fs.writeFileSync(config.statePath, '{broken');
    assert.strictEqual(readBackupAlertState(config).stateInvalid, true);

    let clock = Date.parse('2026-08-27T12:00:00.000Z');
    const sent = [];
    const notifier = { send: async payload => { sent.push(payload); return { sent: true }; } };
    let currentHealth = healthy({ offsiteBackup: { ...healthy().offsiteBackup, status: 'warning' } });
    const watcher = createBackupHealthWatcher({
      env: baseEnv, now: () => clock, inspectHealth: () => currentHealth,
      notifier, logger() {}, config: { startupGraceMs: 0, intervalMs: 1000 }
    });
    await watcher.evaluate();
    assert.strictEqual(sent.length, 1, 'first transition sends one alert');
    await watcher.evaluate();
    assert.strictEqual(sent.length, 1, 'repeated evaluation is deduplicated');
    const restarted = createBackupHealthWatcher({
      env: baseEnv, now: () => clock, inspectHealth: () => currentHealth,
      notifier, logger() {}, config: { startupGraceMs: 0, intervalMs: 1000 }
    });
    await restarted.evaluate();
    assert.strictEqual(sent.length, 1, 'durable state deduplicates after restart');
    clock += 24 * 3600000;
    await restarted.evaluate();
    assert.strictEqual(sent.at(-1).kind, 'reminder');

    // A severity change for the same policy condition sends one escalation.
    let severity = 'warning';
    const escalationWatcher = createBackupHealthWatcher({
      env: { ...baseEnv, DATABASE_PATH: path.join(root, 'escalation.db') }, now: () => clock,
      inspectHealth: () => healthy(), notifier, logger() {},
      evaluatePolicy: () => [{ id: 'TEST_ESCALATION', severity, description: 'Safe status.', suggestedAction: 'Inspect.', evidenceFingerprint: severity }],
      config: { statePath: path.join(root, 'escalation-state.json') }
    });
    fs.writeFileSync(path.join(root, 'escalation.db'), 'fixture');
    const beforeEscalation = sent.length;
    await escalationWatcher.evaluate();
    severity = 'critical';
    await escalationWatcher.evaluate();
    await escalationWatcher.evaluate();
    assert.strictEqual(sent.length, beforeEscalation + 2);
    assert.strictEqual(sent.at(-1).kind, 'escalation');

    // Independent conditions retain independent durable state and delivery.
    const coexistDb = path.join(root, 'coexist.db'); fs.writeFileSync(coexistDb, 'fixture');
    const coexistSent = [];
    const coexistStatePath = path.join(root, 'coexist-state.json');
    const coexistWatcher = createBackupHealthWatcher({
      env: { ...baseEnv, DATABASE_PATH: coexistDb }, now: () => clock,
      inspectHealth: () => healthy({
        capacity: { status: 'critical' },
        offsiteBackup: { ...healthy().offsiteBackup, status: 'warning' }
      }), logger() {},
      notifier: { send: async payload => { coexistSent.push(payload); return { sent: true }; } },
      config: { statePath: coexistStatePath }
    });
    await coexistWatcher.evaluate();
    assert.deepStrictEqual(coexistSent.map(item => item.condition.id).sort(), [
      'DATABASE_STORAGE_CRITICAL', 'OFFSITE_BACKUP_STALE'
    ]);
    const coexistState = readBackupAlertState({ statePath: coexistStatePath });
    assert(coexistState.conditions.DATABASE_STORAGE_CRITICAL.active);
    assert(coexistState.conditions.OFFSITE_BACKUP_STALE.active);

    currentHealth = healthy();
    await restarted.evaluate();
    assert.strictEqual(sent.at(-1).kind, 'recovery');
    const afterRecovery = sent.length;
    await restarted.evaluate();
    assert.strictEqual(sent.length, afterRecovery, 'recovery sends once');

    // Failed delivery is contained and retry eligible; without successful alert there is no recovery.
    const failureDb = path.join(root, 'failure.db'); fs.writeFileSync(failureDb, 'fixture');
    let failedCalls = 0;
    let failureHealth = healthy({ capacity: { status: 'critical' } });
    const failingWatcher = createBackupHealthWatcher({
      env: { ...baseEnv, DATABASE_PATH: failureDb }, now: () => clock,
      inspectHealth: () => failureHealth, logger() {},
      notifier: { send: async () => { failedCalls += 1; return { sent: false, code: 'BACKUP_ALERT_EMAIL_FAILED' }; } },
      config: { statePath: path.join(root, 'failure-state.json') }
    });
    await failingWatcher.evaluate();
    assert.strictEqual(failedCalls, 1);
    await failingWatcher.evaluate();
    assert.strictEqual(failedCalls, 1, 'failed delivery observes retry delay');
    const failedState = readBackupAlertState({ statePath: path.join(root, 'failure-state.json') });
    assert(failedState.conditions.DATABASE_STORAGE_CRITICAL.nextNotificationEligibleAt);
    clock += 3600000;
    await failingWatcher.evaluate();
    assert.strictEqual(failedCalls, 2, 'failed notification becomes retry eligible');
    failureHealth = healthy();
    await failingWatcher.evaluate();
    assert.strictEqual(failedCalls, 2, 'undelivered alert cannot emit recovery');

    const noRecoveryDb = path.join(root, 'no-recovery.db'); fs.writeFileSync(noRecoveryDb, 'fixture');
    let noRecoveryHealth = healthy({ capacity: { status: 'critical' } });
    const noRecoverySent = [];
    const noRecoveryWatcher = createBackupHealthWatcher({
      env: { ...baseEnv, DATABASE_PATH: noRecoveryDb, BACKUP_RECOVERY_NOTIFICATIONS_ENABLED: 'false' },
      now: () => clock, inspectHealth: () => noRecoveryHealth, logger() {},
      notifier: { send: async payload => { noRecoverySent.push(payload); return { sent: true }; } },
      config: { statePath: path.join(root, 'no-recovery-state.json') }
    });
    await noRecoveryWatcher.evaluate();
    noRecoveryHealth = healthy();
    await noRecoveryWatcher.evaluate();
    assert.strictEqual(noRecoverySent.length, 1);

    // Disabled alerting still evaluates safely but sends nothing.
    const disabledDb = path.join(root, 'disabled.db'); fs.writeFileSync(disabledDb, 'fixture');
    let disabledCalls = 0;
    const disabledWatcher = createBackupHealthWatcher({
      env: { ...baseEnv, DATABASE_PATH: disabledDb, BACKUP_HEALTH_ALERTS_ENABLED: 'false' },
      now: () => clock, inspectHealth: () => healthy({ capacity: { status: 'critical' } }), logger() {},
      notifier: { send: async () => { disabledCalls += 1; return { sent: true }; } },
      config: { statePath: path.join(root, 'disabled-state.json') }
    });
    await disabledWatcher.evaluate();
    assert.strictEqual(disabledCalls, 0);

    // Missing recipient uses the safe notifier result and never throws.
    const missingDb = path.join(root, 'missing-recipient.db'); fs.writeFileSync(missingDb, 'fixture');
    const missingWatcher = createBackupHealthWatcher({
      env: { ...baseEnv, DATABASE_PATH: missingDb, BACKUP_ALERT_EMAIL: '', RESEND_API_KEY: '' },
      now: () => clock, inspectHealth: () => healthy({ capacity: { status: 'critical' } }), logger() {},
      config: { statePath: path.join(root, 'missing-recipient-state.json') }
    });
    await missingWatcher.evaluate();

    // Startup grace, non-overlap, timer cancellation, and bounded drain.
    const lifecycleDb = path.join(root, 'lifecycle.db'); fs.writeFileSync(lifecycleDb, 'fixture');
    let callback; let delay; let clearCount = 0; let resolveInspection;
    const lifecycle = createBackupHealthWatcher({
      env: { ...baseEnv, DATABASE_PATH: lifecycleDb }, logger() {},
      setTimeoutFn(fn, ms) {
        if (ms === 1) return setTimeout(fn, 0);
        callback = fn; delay = ms; return { unref() {} };
      },
      clearTimeoutFn(handle) { clearCount += 1; if (handle && typeof handle.hasRef === 'function') clearTimeout(handle); },
      inspectHealth: () => new Promise(resolve => { resolveInspection = resolve; }),
      notifier,
      config: { startupGraceMs: 180000, intervalMs: 3600000, shutdownGraceMs: 1, statePath: path.join(root, 'lifecycle-state.json') }
    });
    lifecycle.start();
    assert.strictEqual(delay, 180000);
    const active = callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual((await lifecycle.evaluate()).skipped, true);
    const stopped = await lifecycle.stop();
    assert.strictEqual(stopped.drained, false);
    resolveInspection(healthy());
    await active;
    assert(clearCount >= 1);
    assert.strictEqual((await lifecycle.evaluate()).skipped, true);

    const resendPayloads = [];
    const operationalNotifier = createOperatorNotifier({
      env: baseEnv,
      resendClient: { emails: { send: async payload => { resendPayloads.push(payload); return { data: { id: 'safe' } }; } } }
    });
    await operationalNotifier.send({
      condition: { id: 'SQLITE_INTEGRITY_FAILED', severity: 'critical', description: 'Integrity failed.', suggestedAction: 'Use the runbook.', firstObservedAt: new Date(clock).toISOString() },
      kind: 'alert', observedAt: new Date(clock).toISOString()
    });
    const serializedEmail = JSON.stringify(resendPayloads);
    assert(!serializedEmail.includes('SESSION_SECRET'));
    assert(!serializedEmail.includes(databasePath));

    // Public readiness is minimal and does not inspect backup state.
    let readinessQueries = 0;
    const app = express();
    app.use(createHealthRouter({ getDatabase: () => ({ prepare(sql) {
      readinessQueries += 1;
      assert.strictEqual(sql, 'SELECT 1 AS ready');
      return { get: () => ({ ready: 1 }) };
    } }) }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const ok = await request(server);
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(JSON.parse(ok.body), { status: 'ok' });
    assert.strictEqual(readinessQueries, 1);
    await new Promise(resolve => server.close(resolve));

    const failedApp = express();
    failedApp.use(createHealthRouter({ getDatabase: () => { throw new Error('private failure'); } }));
    const failedServer = failedApp.listen(0, '127.0.0.1');
    await new Promise(resolve => failedServer.once('listening', resolve));
    const unavailable = await request(failedServer);
    assert.strictEqual(unavailable.status, 503);
    assert.deepStrictEqual(JSON.parse(unavailable.body), { status: 'unavailable' });
    assert(!unavailable.body.includes('private failure'));
    await new Promise(resolve => failedServer.close(resolve));

    assert(!JSON.stringify(readBackupAlertState(config)).includes('ops@example.com'));
    console.log('Story 3.16 Operational Backup Health Alerts tests passed.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
