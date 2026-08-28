const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareDatabaseStorage } = require('./databasePath');

const STATE_VERSION = 1;
const DEFAULT_REMINDER_HOURS = 24;

function enabled(value) { return String(value || '').trim().toLowerCase() === 'true'; }

function parseReminderHours(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_REMINDER_HOURS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 24 * 30) {
    throw new Error('BACKUP_ALERT_REMINDER_HOURS must be between 1 and 720.');
  }
  return parsed;
}

function validRecipient(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function resolveBackupAlertConfig(env = process.env, fsApi = fs) {
  const storage = prepareDatabaseStorage(env, fsApi);
  const stateRoot = storage.production ? storage.persistentDataDir : storage.parentDirectory;
  return {
    requested: enabled(env.BACKUP_HEALTH_ALERTS_ENABLED),
    recipient: validRecipient(env.BACKUP_ALERT_EMAIL),
    recoveryNotificationsEnabled: env.BACKUP_RECOVERY_NOTIFICATIONS_ENABLED === undefined
      ? true
      : enabled(env.BACKUP_RECOVERY_NOTIFICATIONS_ENABLED),
    reminderHours: parseReminderHours(env.BACKUP_ALERT_REMINDER_HOURS),
    statePath: path.join(stateRoot, '.backup-health-alert-state.json'),
    production: storage.production
  };
}

function emptyAlertState() {
  return { version: STATE_VERSION, updatedAt: null, conditions: {} };
}

function sanitizeConditionRecord(record = {}) {
  const text = value => typeof value === 'string' ? value.slice(0, 256) : null;
  return {
    conditionId: text(record.conditionId),
    active: Boolean(record.active),
    severity: ['warning', 'critical'].includes(record.severity) ? record.severity : 'warning',
    firstObservedAt: text(record.firstObservedAt),
    lastObservedAt: text(record.lastObservedAt),
    lastEvidenceFingerprint: text(record.lastEvidenceFingerprint),
    lastNotificationAttemptAt: text(record.lastNotificationAttemptAt),
    lastNotificationSuccessAt: text(record.lastNotificationSuccessAt),
    nextNotificationEligibleAt: text(record.nextNotificationEligibleAt),
    recoveryNotificationAt: text(record.recoveryNotificationAt),
    recoveryPending: Boolean(record.recoveryPending)
  };
}

function readBackupAlertState(config, fsApi = fs) {
  try {
    const parsed = JSON.parse(fsApi.readFileSync(config.statePath, 'utf8'));
    if (!parsed || parsed.version !== STATE_VERSION || !parsed.conditions || typeof parsed.conditions !== 'object' || Array.isArray(parsed.conditions)) {
      return { ...emptyAlertState(), stateInvalid: true };
    }
    const conditions = {};
    for (const [id, record] of Object.entries(parsed.conditions)) {
      if (!/^[A-Z0-9_]{1,64}$/.test(id)) continue;
      conditions[id] = sanitizeConditionRecord({ ...record, conditionId: id });
    }
    return { version: STATE_VERSION, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null, conditions };
  } catch (error) {
    return error?.code === 'ENOENT' ? emptyAlertState() : { ...emptyAlertState(), stateInvalid: true };
  }
}

function writeBackupAlertState(config, state, fsApi = fs) {
  const temporaryPath = `${config.statePath}.${crypto.randomUUID()}.tmp`;
  const safeState = { version: STATE_VERSION, updatedAt: state.updatedAt, conditions: {} };
  for (const [id, record] of Object.entries(state.conditions || {})) {
    if (/^[A-Z0-9_]{1,64}$/.test(id)) safeState.conditions[id] = sanitizeConditionRecord({ ...record, conditionId: id });
  }
  try {
    fsApi.writeFileSync(temporaryPath, JSON.stringify(safeState), { mode: 0o600, flag: 'wx' });
    fsApi.chmodSync(temporaryPath, 0o600);
    fsApi.renameSync(temporaryPath, config.statePath);
  } finally {
    if (fsApi.existsSync(temporaryPath)) {
      try { fsApi.unlinkSync(temporaryPath); } catch (_) {}
    }
  }
}

module.exports = {
  DEFAULT_REMINDER_HOURS,
  STATE_VERSION,
  emptyAlertState,
  parseReminderHours,
  readBackupAlertState,
  resolveBackupAlertConfig,
  validRecipient,
  writeBackupAlertState
};
