const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveOperationalAlertConfig } = require('../lib/operationalAlertState');
const { evaluateOperationalHealth } = require('../lib/operationalHealthPolicy');
const { createOperationalHealthWatcher } = require('../lib/operationalHealthWatcher');
const { createOperatorNotifier } = require('../lib/operatorNotification');

function health(overrides = {}) {
  return {
    billing: {
      enabled: true, lastRunAt: '2026-08-31T12:00:00.000Z',
      lastSuccessAt: '2026-08-31T12:01:00.000Z', lastFailureCode: null,
      driftCount: 0, unresolvedCount: 0, lastMode: 'apply'
    },
    productionRecovery: { recoveryRequiredCount: 0, issues: [] },
    ...overrides
  };
}

function ids(value) { return evaluateOperationalHealth(value).map(item => item.id); }

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-operational-alerts-'));
  try {
    const databasePath = path.join(root, 'copyquick.db');
    fs.writeFileSync(databasePath, 'fixture');
    const baseEnv = {
      NODE_ENV: 'test', DATABASE_PATH: databasePath,
      OPERATIONAL_HEALTH_ALERTS_ENABLED: 'true', OPERATIONAL_ALERT_EMAIL: 'ops@example.com',
      OPERATIONAL_ALERT_REMINDER_HOURS: '24', OPERATIONAL_RECOVERY_NOTIFICATIONS_ENABLED: 'true'
    };
    assert.strictEqual(resolveOperationalAlertConfig({ NODE_ENV: 'test', DATABASE_PATH: databasePath }).requested, false);
    const config = resolveOperationalAlertConfig(baseEnv);
    assert.strictEqual(config.recipient, 'ops@example.com');
    assert.match(config.statePath, /\.operational-health-alert-state\.json$/);
    assert.doesNotMatch(config.statePath, /backup-health-alert-state/);
    assert.throws(() => resolveOperationalAlertConfig({
      ...baseEnv, OPERATIONAL_ALERT_REMINDER_HOURS: '0'
    }), /OPERATIONAL_ALERT_REMINDER_HOURS/);

    assert.deepStrictEqual(ids(health()), []);
    assert(ids(health({ billing: { ...health().billing, lastFailureCode: 'STRIPE_API_UNAVAILABLE' } })).includes('BILLING_RECONCILIATION_FAILED'));
    assert(ids(health({ billing: { ...health().billing, unresolvedCount: 2 } })).includes('BILLING_ENTITLEMENT_DRIFT_UNRESOLVED'));
    assert(ids(health({ billing: { ...health().billing, lastSuccessAt: null } })).includes('BILLING_RECONCILIATION_NEVER_SUCCEEDED'));
    assert(ids(health({ billing: { ...health().billing, lastMode: 'dry_run', driftCount: 3 } })).includes('BILLING_DRIFT_DETECTED'));
    assert.deepStrictEqual(ids(health({ billing: {
      ...health().billing, lastSuccessAt: null, lastFailureCode: 'STRIPE_API_UNAVAILABLE'
    } })), ['BILLING_RECONCILIATION_FAILED']);
    assert(!ids(health({ billing: {
      ...health().billing, lastMode: 'dry_run', driftCount: 3, unresolvedCount: 1
    } })).includes('BILLING_DRIFT_DETECTED'));
    assert(ids(health({ productionRecovery: {
      recoveryRequiredCount: 1, issues: [{ runId: 12, jobId: 34 }]
    } })).includes('PRODUCTION_RECOVERY_REQUIRED'));
    assert(!ids(health({ productionRecovery: { recoveryRequiredCount: 0, failedCount: 10 } })).includes('PRODUCTION_RECOVERY_REQUIRED'));
    assert.deepStrictEqual(ids(health({ billing: { enabled: false } })), []);

    let clock = Date.parse('2026-08-31T13:00:00.000Z');
    let currentHealth = health({ billing: { ...health().billing, unresolvedCount: 2 } });
    const sent = [];
    const notifier = { send: async payload => { sent.push(payload); return { sent: true }; } };
    const watcher = createOperationalHealthWatcher({
      env: baseEnv, now: () => clock, inspectHealth: () => currentHealth,
      notifier, logger: () => {}, config: { startupGraceMs: 0, intervalMs: 1000 }
    });
    await watcher.evaluate();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].condition.id, 'BILLING_ENTITLEMENT_DRIFT_UNRESOLVED');
    await watcher.evaluate();
    assert.strictEqual(sent.length, 1, 'active condition is durably deduplicated');
    assert.strictEqual(fs.statSync(config.statePath).mode & 0o777, 0o600);

    const restarted = createOperationalHealthWatcher({
      env: baseEnv, now: () => clock, inspectHealth: () => currentHealth,
      notifier, logger: () => {}, config: { startupGraceMs: 0, intervalMs: 1000 }
    });
    await restarted.evaluate();
    assert.strictEqual(sent.length, 1, 'restart does not duplicate the current alert');
    clock += 24 * 60 * 60 * 1000;
    await restarted.evaluate();
    assert.strictEqual(sent.at(-1).kind, 'reminder');
    currentHealth = health();
    await restarted.evaluate();
    assert.strictEqual(sent.at(-1).kind, 'recovery');
    const afterRecovery = sent.length;
    await restarted.evaluate();
    assert.strictEqual(sent.length, afterRecovery);

    let disabledCalls = 0;
    const disabledDb = path.join(root, 'disabled.db'); fs.writeFileSync(disabledDb, 'fixture');
    const disabled = createOperationalHealthWatcher({
      env: { ...baseEnv, DATABASE_PATH: disabledDb, OPERATIONAL_HEALTH_ALERTS_ENABLED: 'false' },
      inspectHealth: () => health({ productionRecovery: { recoveryRequiredCount: 1, issues: [{ runId: 1, jobId: 2 }] } }),
      notifier: { send: async () => { disabledCalls += 1; return { sent: true }; } },
      logger: () => {}, config: { statePath: path.join(root, 'disabled-state.json') }
    });
    await disabled.evaluate();
    assert.strictEqual(disabledCalls, 0);

    const payloads = [];
    const operator = createOperatorNotifier({
      env: { ...baseEnv, RESEND_API_KEY: 'private-key' },
      recipient: 'billing-ops@example.com', codePrefix: 'OPERATIONAL_ALERT',
      resendClient: { emails: { send: async payload => { payloads.push(payload); return { data: { id: 'accepted' } }; } } }
    });
    const delivered = await operator.send({
      condition: evaluateOperationalHealth(health({ productionRecovery: {
        recoveryRequiredCount: 1, issues: [{ runId: 7, jobId: 8 }]
      } }))[0],
      kind: 'alert', observedAt: new Date(clock).toISOString()
    });
    assert.strictEqual(delivered.sent, true);
    const serialized = JSON.stringify(payloads);
    assert(!serialized.includes('private-key'));
    assert(!serialized.includes(databasePath));
    const content = `${payloads[0].subject}\n${payloads[0].text}\n${payloads[0].html}`;
    assert(!content.includes('billing-ops@example.com'), 'operator address is not embedded in notification content');
    const ambiguous = createOperatorNotifier({
      env: baseEnv, recipient: 'ops@example.com', codePrefix: 'OPERATIONAL_ALERT',
      resendClient: { emails: { send: async () => undefined } }
    });
    assert.deepStrictEqual(await ambiguous.send({ condition: { id: 'TEST', severity: 'warning' } }), {
      sent: false, code: 'OPERATIONAL_ALERT_EMAIL_FAILED'
    });

    console.log('Story 3.33 Operational Health Alerts tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
