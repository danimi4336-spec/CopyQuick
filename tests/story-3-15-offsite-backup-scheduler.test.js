const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  acquireBackupOperationLock,
  getBackupOperationLockPath,
  inspectBackupOperationLock
} = require('../lib/backupOperationLock');
const {
  createOffsiteBackupScheduler,
  inspectScheduleState,
  resolveScheduleConfig
} = require('../lib/offsiteBackupScheduler');
const { resolveOffsiteConfig, writeOffsiteState } = require('../lib/offsiteBackup');
const { inspectStorageHealth } = require('../lib/storageHealth');

function iso(ms) { return new Date(ms).toISOString(); }

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-315-'));
  const backupDirectory = path.join(root, 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const databasePath = path.join(root, 'copyquick.db');
  fs.writeFileSync(databasePath, 'fixture');
  const env = {
    NODE_ENV: 'test', DATABASE_PATH: databasePath, DATABASE_BACKUP_DIR: backupDirectory,
    OFFSITE_BACKUP_ENABLED: 'true', OFFSITE_BACKUP_SCHEDULE_ENABLED: 'true',
    OFFSITE_BACKUP_INTERVAL_HOURS: '24', OFFSITE_BACKUP_RETENTION: '30'
  };

  assert.strictEqual(resolveScheduleConfig({}).enabled, false, 'scheduling must default disabled');
  assert.strictEqual(resolveScheduleConfig({ OFFSITE_BACKUP_SCHEDULE_ENABLED: 'true' }).enabled, false,
    'off-site backup enablement is also required');

  const day = 24 * 3600000;
  const retry = 3600000;
  const now = Date.parse('2026-08-27T12:00:00.000Z');
  assert.strictEqual(inspectScheduleState({ state: { lastSuccessAt: iso(now - day + 1) }, now }).due, false);
  assert.strictEqual(inspectScheduleState({ state: { lastSuccessAt: iso(now - day) }, now }).due, true);
  assert.strictEqual(inspectScheduleState({ state: {}, now }).due, true, 'never succeeded is catch-up due');
  assert.strictEqual(inspectScheduleState({ state: { lastSuccessAt: iso(now - day - 1) }, now }).due, true,
    'stale success is catch-up due');
  const failed = inspectScheduleState({ state: { lastAttemptAt: iso(now), retryEligibleAt: iso(now + retry) }, now });
  assert.strictEqual(failed.due, false);
  assert.strictEqual(inspectScheduleState({ state: { lastAttemptAt: iso(now - retry), retryEligibleAt: iso(now) }, now }).due, true);
  assert.strictEqual(inspectScheduleState({ state: { lastAttemptAt: iso(now) }, now }).due, false,
    'an interrupted attempt has an inferred retry window');

  let scheduled;
  let scheduledDelay;
  let runs = 0;
  let clock = now;
  const config = resolveOffsiteConfig(env, { requireSecrets: false, createDirectories: true });
  const scheduler = createOffsiteBackupScheduler({
    env,
    now: () => clock,
    setTimeoutFn(callback, delay) { scheduled = callback; scheduledDelay = delay; return { unref() {} }; },
    clearTimeoutFn() {},
    runBackup: async () => {
      runs += 1;
      writeOffsiteState(config, {
        lastAttemptAt: iso(clock), lastSuccessAt: iso(clock),
        lastSuccessObjectKey: 'copyquick/production/2026/08/27/copyquick-2026-08-27T120000Z-v1.cqbackup',
        lastFailureCode: null, retryEligibleAt: null, keyId: 'v1', artifactSizeBytes: 100,
        ciphertextSha256: 'a'.repeat(64)
      });
    }
  });
  assert.strictEqual(scheduler.start().started, true);
  assert.strictEqual(scheduledDelay, 60000, 'startup grace must be respected');
  await scheduled();
  assert.strictEqual(runs, 1, 'startup catch-up should run once');
  await scheduler.tick();
  assert.strictEqual(runs, 1, 'polling must not repeat after verified success');
  clock += day;
  await scheduler.tick();
  assert.strictEqual(runs, 2, 'backup becomes due at interval boundary');

  let releaseFailure;
  let failureRuns = 0;
  const failureScheduler = createOffsiteBackupScheduler({
    env, now: () => clock,
    runBackup: async () => { failureRuns += 1; throw Object.assign(new Error('remote'), { code: 'NETWORK_FAILURE' }); },
    logger() {},
    config: { ...resolveScheduleConfig(env), startupGraceMs: 0 }
  });
  // Make work due, then verify scheduler contains ordinary operation failure.
  writeOffsiteState(config, { lastSuccessAt: iso(clock - day), lastAttemptAt: null });
  releaseFailure = await failureScheduler.tick();
  assert.strictEqual(releaseFailure.success, false);
  assert.strictEqual(failureRuns, 1);

  const first = acquireBackupOperationLock(backupDirectory, {
    identity: { pid: 101, hostname: 'test-host', processStartId: 'boot:1', processStartedAt: iso(now) },
    inspectProcess: () => ({ alive: true, processStartId: 'boot:1' })
  });
  assert.throws(() => acquireBackupOperationLock(backupDirectory, {
    identity: { pid: 102, hostname: 'test-host', processStartId: 'boot:2', processStartedAt: iso(now) },
    inspectProcess: () => ({ alive: true, processStartId: 'boot:1' })
  }), error => error.code === 'BACKUP_OPERATION_LOCKED');
  assert.strictEqual(first.renew(), true);
  assert.strictEqual(first.release().released, true);

  const old = acquireBackupOperationLock(backupDirectory, {
    identity: { pid: 201, hostname: 'test-host', processStartId: 'boot:old', processStartedAt: iso(now) },
    inspectProcess: () => ({ alive: true, processStartId: 'boot:old' })
  });
  const ownerPath = path.join(getBackupOperationLockPath(backupDirectory), 'owner.json');
  const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  owner.heartbeatAt = iso(now - 10 * 60 * 1000);
  fs.writeFileSync(ownerPath, JSON.stringify(owner));
  const replacement = acquireBackupOperationLock(backupDirectory, {
    now: () => now,
    identity: { pid: 202, hostname: 'other-host', processStartId: 'boot:new', processStartedAt: iso(now) },
    hostname: 'other-host', leaseMs: 1000,
    inspectProcess: () => ({ alive: false, processStartId: null })
  });
  assert.strictEqual(old.release().ownershipLost, true, 'old token cannot release replacement lock');
  assert.strictEqual(old.renew(), false, 'old token cannot renew replacement lock');
  replacement.release();
  assert.strictEqual(inspectBackupOperationLock(backupDirectory).active, false);

  const held = acquireBackupOperationLock(backupDirectory);
  const child = spawnSync(process.execPath, ['scripts/backup-database.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, ...env }, encoding: 'utf8'
  });
  assert.notStrictEqual(child.status, 0, 'manual backup processes must be mutually excluded');
  assert.match(child.stderr, /BACKUP_OPERATION_LOCKED/);
  held.release();

  let overlapRelease;
  const overlapScheduler = createOffsiteBackupScheduler({
    env, now: () => clock, logger() {},
    runBackup: async () => { throw new Error('must not run'); }
  });
  writeOffsiteState(config, { lastSuccessAt: iso(clock - day) });
  overlapRelease = acquireBackupOperationLock(backupDirectory);
  const deferred = await overlapScheduler.tick();
  assert.strictEqual(deferred.deferred, true, 'manual and scheduled work must be mutually excluded');
  overlapRelease.release();

  let resolveActive;
  const drainingScheduler = createOffsiteBackupScheduler({
    env, now: () => clock, logger() {},
    runBackup: () => new Promise(resolve => { resolveActive = resolve; }),
    config: { ...resolveScheduleConfig(env), shutdownGraceMs: 5 }
  });
  writeOffsiteState(config, { lastSuccessAt: iso(clock - day) });
  const activeTick = drainingScheduler.tick();
  await new Promise(resolve => setImmediate(resolve));
  const stopResult = await drainingScheduler.stop();
  assert.strictEqual(stopResult.drained, false, 'shutdown drain is bounded');
  resolveActive();
  await activeTick;
  assert.strictEqual((await drainingScheduler.tick()).skipped, true, 'shutdown prevents future scheduling');

  // Health exposes only non-secret schedule timestamps and configuration state.
  const fakeDb = { pragma: () => [{ quick_check: 'ok' }] };
  const health = inspectStorageHealth({ env, db: fakeDb });
  assert.strictEqual(health.offsiteBackup.scheduleEnabled, true);
  assert('nextEligibleAttemptAt' in health.offsiteBackup);
  assert(!JSON.stringify(health).includes('secretAccessKey'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('Story 3.15 automatic off-site backup scheduler tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
