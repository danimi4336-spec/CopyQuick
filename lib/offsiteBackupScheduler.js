const fs = require('fs');
const {
  DEFAULT_FAILURE_RETRY_MS,
  createOffsiteBackup,
  normalizeOperationalCode,
  readOffsiteState,
  resolveOffsiteConfig
} = require('./offsiteBackup');
const {
  DEFAULT_BACKUP_OPERATION_LEASE_MS,
  acquireBackupOperationLock,
  startBackupOperationHeartbeat
} = require('./backupOperationLock');

const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_POLL_MS = 5 * 60 * 1000;
const DEFAULT_STARTUP_GRACE_MS = 60 * 1000;
const DEFAULT_SHUTDOWN_GRACE_MS = 15 * 1000;

function flag(value) { return String(value || '').trim().toLowerCase() === 'true'; }

function parseIntervalHours(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_INTERVAL_HOURS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 24 * 30) {
    throw new Error('OFFSITE_BACKUP_INTERVAL_HOURS must be between 1 and 720.');
  }
  return parsed;
}

function strictTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed.getTime() : null;
}

function resolveScheduleConfig(env = process.env) {
  return {
    enabled: flag(env.OFFSITE_BACKUP_ENABLED) && flag(env.OFFSITE_BACKUP_SCHEDULE_ENABLED),
    scheduleEnabled: flag(env.OFFSITE_BACKUP_SCHEDULE_ENABLED),
    intervalHours: parseIntervalHours(env.OFFSITE_BACKUP_INTERVAL_HOURS),
    intervalMs: parseIntervalHours(env.OFFSITE_BACKUP_INTERVAL_HOURS) * 60 * 60 * 1000,
    pollMs: DEFAULT_POLL_MS,
    startupGraceMs: DEFAULT_STARTUP_GRACE_MS,
    retryDelayMs: DEFAULT_FAILURE_RETRY_MS,
    shutdownGraceMs: DEFAULT_SHUTDOWN_GRACE_MS,
    lockLeaseMs: DEFAULT_BACKUP_OPERATION_LEASE_MS
  };
}

function inspectScheduleState({ state, now = Date.now(), intervalMs = DEFAULT_INTERVAL_HOURS * 3600000, retryDelayMs = DEFAULT_FAILURE_RETRY_MS }) {
  const successAt = strictTimestamp(state?.lastSuccessAt);
  const attemptAt = strictTimestamp(state?.lastAttemptAt);
  const persistedRetryAt = strictTimestamp(state?.retryEligibleAt);
  const dueAt = successAt == null ? 0 : successAt + intervalMs;
  // A crash after recording an attempt but before recording its outcome must
  // not produce a restart storm. The attempt timestamp supplies a bounded
  // retry window when no explicit retry timestamp was persisted.
  const inferredRetryAt = attemptAt != null && (successAt == null || attemptAt > successAt)
    ? attemptAt + retryDelayMs
    : 0;
  const retryEligibleAt = Math.max(persistedRetryAt || 0, inferredRetryAt);
  const nextEligibleMs = Math.max(dueAt, retryEligibleAt);
  return {
    due: now >= nextEligibleMs,
    nextEligibleAttemptAt: nextEligibleMs > 0 ? new Date(nextEligibleMs).toISOString() : null,
    retryEligibleAt: retryEligibleAt > 0 ? new Date(retryEligibleAt).toISOString() : null,
    lastSuccessAt: successAt == null ? null : new Date(successAt).toISOString()
  };
}

function createOffsiteBackupScheduler({
  env = process.env,
  fsApi = fs,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  runBackup = createOffsiteBackup,
  acquireLock = acquireBackupOperationLock,
  startHeartbeat = startBackupOperationHeartbeat,
  logger = entry => console.log(JSON.stringify(entry)),
  config: suppliedConfig
} = {}) {
  const schedule = { ...resolveScheduleConfig(env), ...(suppliedConfig || {}) };
  let timer = null;
  let stopping = false;
  let activeOperation = null;

  function log(event, details = {}) {
    try { logger({ event, ...details }); } catch (_) {}
  }

  function scheduleNext(delayMs) {
    if (stopping || !schedule.enabled) return;
    timer = setTimeoutFn(async () => {
      timer = null;
      await tick();
      scheduleNext(schedule.pollMs);
    }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  async function executeDueBackup(offsiteConfig) {
    let operationLock;
    let stopHeartbeat = () => {};
    try {
      operationLock = acquireLock(offsiteConfig.local.backupDirectory, { fsApi, leaseMs: schedule.lockLeaseMs });
      stopHeartbeat = startHeartbeat(operationLock, {
        leaseMs: schedule.lockLeaseMs,
        onFailure: () => log('offsite_scheduler_lock_renewal_failed')
      });
    } catch (error) {
      if (operationLock) operationLock.release();
      if (error.code === 'BACKUP_OPERATION_LOCKED') {
        log('offsite_scheduler_backup_deferred', { code: 'BACKUP_OPERATION_LOCKED' });
        return { attempted: false, deferred: true };
      }
      throw error;
    }
    try {
      await runBackup({ env, fsApi, operationLock, failureRetryMs: schedule.retryDelayMs, logger });
      log('offsite_scheduler_backup_completed');
      return { attempted: true, success: true };
    } catch (error) {
      log('offsite_scheduler_backup_failed', {
        code: normalizeOperationalCode(error.code, 'OFFSITE_SCHEDULED_BACKUP_FAILED')
      });
      return { attempted: true, success: false };
    } finally {
      stopHeartbeat();
      const released = operationLock.release();
      if (!released.released) log('offsite_scheduler_lock_release_failed', { code: released.code || 'BACKUP_LOCK_RELEASE_FAILED' });
    }
  }

  async function tick() {
    if (stopping || !schedule.enabled || activeOperation) return { attempted: false, skipped: true };
    let offsiteConfig;
    try {
      offsiteConfig = resolveOffsiteConfig(env, { requireSecrets: false, createDirectories: true, fsApi });
      const state = readOffsiteState(offsiteConfig, fsApi);
      const decision = inspectScheduleState({ state, now: now(), intervalMs: schedule.intervalMs, retryDelayMs: schedule.retryDelayMs });
      if (!decision.due) return { attempted: false, decision };
      activeOperation = executeDueBackup(offsiteConfig);
      return await activeOperation;
    } catch (_) {
      log('offsite_scheduler_evaluation_failed', { code: 'OFFSITE_SCHEDULER_FAILED' });
      return { attempted: false, failed: true };
    } finally {
      activeOperation = null;
    }
  }

  function start() {
    if (!schedule.enabled || timer || activeOperation || stopping) return { started: false, enabled: schedule.enabled };
    log('offsite_scheduler_started', { intervalHours: schedule.intervalHours });
    scheduleNext(schedule.startupGraceMs);
    return { started: true, enabled: true };
  }

  async function stop() {
    stopping = true;
    if (timer) clearTimeoutFn(timer);
    timer = null;
    if (!activeOperation) return { drained: true };
    let timeout;
    const drained = await Promise.race([
      activeOperation.then(() => true),
      new Promise(resolve => { timeout = setTimeoutFn(() => resolve(false), schedule.shutdownGraceMs); })
    ]);
    if (timeout) clearTimeoutFn(timeout);
    return { drained };
  }

  return { start, stop, tick, isRunning: () => Boolean(activeOperation), config: schedule };
}

module.exports = {
  DEFAULT_INTERVAL_HOURS,
  DEFAULT_POLL_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DEFAULT_STARTUP_GRACE_MS,
  createOffsiteBackupScheduler,
  inspectScheduleState,
  parseIntervalHours,
  resolveScheduleConfig
};
