const fs = require('fs');
const path = require('path');
const { prepareDatabaseStorage } = require('./databasePath');
const {
  parseReminderHours,
  readBackupAlertState,
  validRecipient,
  writeBackupAlertState
} = require('./backupAlertState');

function enabled(value) { return String(value || '').trim().toLowerCase() === 'true'; }

function resolveOperationalAlertConfig(env = process.env, fsApi = fs) {
  const storage = prepareDatabaseStorage(env, fsApi);
  const stateRoot = storage.production ? storage.persistentDataDir : storage.parentDirectory;
  return {
    requested: enabled(env.OPERATIONAL_HEALTH_ALERTS_ENABLED),
    recipient: validRecipient(env.OPERATIONAL_ALERT_EMAIL),
    recoveryNotificationsEnabled: env.OPERATIONAL_RECOVERY_NOTIFICATIONS_ENABLED === undefined
      ? true
      : enabled(env.OPERATIONAL_RECOVERY_NOTIFICATIONS_ENABLED),
    reminderHours: parseReminderHours(env.OPERATIONAL_ALERT_REMINDER_HOURS, 'OPERATIONAL_ALERT_REMINDER_HOURS'),
    statePath: path.join(stateRoot, '.operational-health-alert-state.json'),
    production: storage.production
  };
}

module.exports = {
  readOperationalAlertState: readBackupAlertState,
  resolveOperationalAlertConfig,
  writeOperationalAlertState: writeBackupAlertState
};
