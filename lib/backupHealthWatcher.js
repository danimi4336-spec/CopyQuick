const fs = require('fs');
const { inspectStorageHealth } = require('./storageHealth');
const { CONDITION_DETAILS, SEVERITY_RANK, evaluateBackupHealth } = require('./backupHealthPolicy');
const {
  readBackupAlertState,
  resolveBackupAlertConfig,
  writeBackupAlertState
} = require('./backupAlertState');
const { createOperatorNotifier } = require('./operatorNotification');

const DEFAULT_EVALUATION_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_STARTUP_GRACE_MS = 3 * 60 * 1000;
const DEFAULT_NOTIFICATION_RETRY_MS = 60 * 60 * 1000;
const DEFAULT_SHUTDOWN_GRACE_MS = 10 * 1000;

function timestamp(value) {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function createBackupHealthWatcher({
  env = process.env,
  db,
  fsApi = fs,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  inspectHealth = inspectStorageHealth,
  evaluatePolicy = evaluateBackupHealth,
  notifier,
  logger = event => console.log(JSON.stringify(event)),
  config: suppliedConfig
} = {}) {
  const alertConfig = { ...resolveBackupAlertConfig(env, fsApi), ...(suppliedConfig || {}) };
  const service = notifier || createOperatorNotifier({ env });
  const intervalMs = suppliedConfig?.intervalMs || DEFAULT_EVALUATION_INTERVAL_MS;
  const startupGraceMs = suppliedConfig?.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
  const notificationRetryMs = suppliedConfig?.notificationRetryMs || DEFAULT_NOTIFICATION_RETRY_MS;
  const shutdownGraceMs = suppliedConfig?.shutdownGraceMs || DEFAULT_SHUTDOWN_GRACE_MS;
  const reminderMs = alertConfig.reminderHours * 60 * 60 * 1000;
  let timer = null;
  let stopping = false;
  let activeEvaluation = null;

  function log(event, details = {}) {
    try { logger({ event, ...details }); } catch (_) {}
  }

  function persist(state) {
    state.updatedAt = new Date(now()).toISOString();
    writeBackupAlertState(alertConfig, state, fsApi);
  }

  async function deliver(state, action, observedAt) {
    const record = state.conditions[action.id];
    record.lastNotificationAttemptAt = observedAt;
    record.nextNotificationEligibleAt = new Date(now() + notificationRetryMs).toISOString();
    // Persist before delivery. A crash after delivery can cause a delayed retry,
    // but cannot create an immediate restart notification storm.
    persist(state);
    const result = await service.send({ condition: action.condition, kind: action.kind, observedAt });
    if (result?.sent) {
      if (action.kind === 'recovery') {
        record.recoveryNotificationAt = observedAt;
        record.recoveryPending = false;
      } else {
        record.lastNotificationSuccessAt = observedAt;
        record.nextNotificationEligibleAt = new Date(now() + reminderMs).toISOString();
      }
      log('backup_health_alert_sent', { conditionId: action.id, notificationKind: action.kind });
    } else {
      log('backup_health_alert_failed', { conditionId: action.id, code: result?.code || 'BACKUP_ALERT_DELIVERY_FAILED' });
    }
    persist(state);
  }

  async function processHealth(health) {
    const observedAt = new Date(now()).toISOString();
    const currentConditions = evaluatePolicy(health, { env });
    const currentById = new Map(currentConditions.map(item => [item.id, item]));
    const state = readBackupAlertState(alertConfig, fsApi);
    if (state.stateInvalid) log('backup_health_alert_state_invalid');
    const actions = [];

    for (const condition of currentConditions) {
      const previous = state.conditions[condition.id];
      const reopening = !previous?.active;
      const record = previous || { conditionId: condition.id };
      const previousSeverity = record.severity;
      record.conditionId = condition.id;
      record.active = true;
      record.severity = condition.severity;
      record.firstObservedAt = reopening ? observedAt : (record.firstObservedAt || observedAt);
      record.lastObservedAt = observedAt;
      record.lastEvidenceFingerprint = condition.evidenceFingerprint;
      if (reopening) {
        record.recoveryNotificationAt = null;
        record.recoveryPending = false;
        log('backup_health_condition_opened', { conditionId: condition.id, severity: condition.severity });
      }
      state.conditions[condition.id] = record;

      const eligibleAt = timestamp(record.nextNotificationEligibleAt) || 0;
      let kind = null;
      if (reopening) kind = 'alert';
      else if ((SEVERITY_RANK[condition.severity] || 0) > (SEVERITY_RANK[previousSeverity] || 0)) kind = 'escalation';
      else if (!record.lastNotificationSuccessAt && now() >= eligibleAt) kind = 'alert';
      else if (record.lastNotificationSuccessAt && now() >= eligibleAt) kind = 'reminder';
      if (kind) actions.push({ id: condition.id, kind, condition: { ...condition, firstObservedAt: record.firstObservedAt } });
    }

    for (const [id, record] of Object.entries(state.conditions)) {
      if (currentById.has(id)) continue;
      if (record.active) {
        record.active = false;
        record.lastObservedAt = observedAt;
        record.recoveryPending = Boolean(alertConfig.recoveryNotificationsEnabled && record.lastNotificationSuccessAt && !record.recoveryNotificationAt);
        if (record.recoveryPending) record.nextNotificationEligibleAt = observedAt;
        log('backup_health_condition_recovered', { conditionId: id });
      }
      if (record.recoveryPending && now() >= (timestamp(record.nextNotificationEligibleAt) || 0)) {
        const details = CONDITION_DETAILS[id] || {};
        actions.push({
          id,
          kind: 'recovery',
          condition: {
            id,
            severity: record.severity,
            firstObservedAt: record.firstObservedAt,
            description: 'The operational condition has returned to a healthy state.',
            suggestedAction: details.action || 'Confirm normal operation and continue monitoring.'
          }
        });
      }
    }

    persist(state);
    if (alertConfig.requested && alertConfig.recipient) {
      for (const action of actions) await deliver(state, action, observedAt);
    }
    log('backup_health_evaluation_completed', { conditionCount: currentConditions.length });
    return { health, conditions: currentConditions, actionsAttempted: alertConfig.requested && alertConfig.recipient ? actions.length : 0 };
  }

  async function evaluate() {
    if (stopping || activeEvaluation) return { skipped: true };
    activeEvaluation = Promise.resolve().then(() => inspectHealth({ env, db, fsApi })).then(processHealth).catch(() => {
      log('backup_health_evaluation_failed', { code: 'BACKUP_HEALTH_INSPECTION_FAILED' });
      return { failed: true };
    });
    try { return await activeEvaluation; }
    finally { activeEvaluation = null; }
  }

  function schedule(delayMs) {
    if (stopping) return;
    timer = setTimeoutFn(async () => {
      timer = null;
      await evaluate();
      schedule(intervalMs);
    }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function start() {
    if (timer || activeEvaluation || stopping) return { started: false };
    log('backup_health_watcher_started', {
      alertsEnabled: Boolean(alertConfig.requested && alertConfig.recipient),
      evaluationIntervalMinutes: Math.round(intervalMs / 60000)
    });
    if (alertConfig.requested && !alertConfig.recipient) {
      log('backup_health_alerting_unavailable', { code: 'BACKUP_ALERT_RECIPIENT_REQUIRED' });
    }
    schedule(startupGraceMs);
    return { started: true };
  }

  async function stop() {
    stopping = true;
    if (timer) clearTimeoutFn(timer);
    timer = null;
    if (!activeEvaluation) {
      log('backup_health_watcher_stopped', { drained: true });
      return { drained: true };
    }
    let timeout;
    const drained = await Promise.race([
      activeEvaluation.then(() => true),
      new Promise(resolve => { timeout = setTimeoutFn(() => resolve(false), shutdownGraceMs); })
    ]);
    if (timeout) clearTimeoutFn(timeout);
    log('backup_health_watcher_stopped', { drained });
    return { drained };
  }

  return { start, stop, evaluate, isRunning: () => Boolean(activeEvaluation), config: alertConfig };
}

module.exports = {
  DEFAULT_EVALUATION_INTERVAL_MS,
  DEFAULT_NOTIFICATION_RETRY_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DEFAULT_STARTUP_GRACE_MS,
  createBackupHealthWatcher
};
