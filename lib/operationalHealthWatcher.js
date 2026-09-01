const fs = require('fs');
const { createBackupHealthWatcher } = require('./backupHealthWatcher');
const { getBillingReconciliationStatus } = require('./billingReconciliation');
const { inspectProductionRecovery } = require('./productionRecovery');
const { createOperatorNotifier } = require('./operatorNotification');
const {
  readOperationalAlertState,
  resolveOperationalAlertConfig,
  writeOperationalAlertState
} = require('./operationalAlertState');
const { CONDITION_DETAILS, evaluateOperationalHealth } = require('./operationalHealthPolicy');

function inspectOperationalHealth({ db, env = process.env }) {
  return {
    billing: getBillingReconciliationStatus(db, {
      enabled: String(env.STRIPE_RECONCILIATION_ENABLED || '').toLowerCase() === 'true'
    }),
    productionRecovery: inspectProductionRecovery(db, { limit: 1 })
  };
}

function createOperationalHealthWatcher({
  db,
  env = process.env,
  fsApi = fs,
  notifier,
  inspectHealth = inspectOperationalHealth,
  evaluatePolicy = evaluateOperationalHealth,
  config: suppliedConfig,
  ...options
} = {}) {
  const config = { ...resolveOperationalAlertConfig(env, fsApi), ...(suppliedConfig || {}) };
  const service = notifier || createOperatorNotifier({
    env,
    recipient: config.recipient,
    codePrefix: 'OPERATIONAL_ALERT'
  });
  return createBackupHealthWatcher({
    ...options,
    env,
    db,
    fsApi,
    notifier: service,
    inspectHealth: () => inspectHealth({ db, env, fsApi }),
    evaluatePolicy,
    config,
    eventPrefix: 'operational_health',
    conditionDetails: CONDITION_DETAILS,
    recipientRequiredCode: 'OPERATIONAL_ALERT_RECIPIENT_REQUIRED',
    deliveryFailureCode: 'OPERATIONAL_ALERT_DELIVERY_FAILED',
    resolveAlertConfig: () => config,
    readAlertState: readOperationalAlertState,
    writeAlertState: writeOperationalAlertState
  });
}

module.exports = {
  createOperationalHealthWatcher,
  inspectOperationalHealth,
  readOperationalAlertState,
  writeOperationalAlertState
};
