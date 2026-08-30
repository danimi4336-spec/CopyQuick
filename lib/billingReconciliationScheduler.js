const { stripe } = require('./stripe');
const { reconcileBilling } = require('./billingReconciliation');
const {
  acquireBillingReconciliationLock,
  DEFAULT_RECONCILIATION_LOCK_LEASE_MS,
  startBillingReconciliationHeartbeat
} = require('./billingReconciliationLock');

const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_POLL_MS = 60 * 60 * 1000;
const DEFAULT_STARTUP_GRACE_MS = 60 * 1000;
const DEFAULT_SHUTDOWN_GRACE_MS = 15 * 1000;

function flag(value) { return String(value || '').trim().toLowerCase() === 'true'; }

function parseIntervalHours(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_INTERVAL_HOURS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 24 * 30) throw new Error('Stripe reconciliation interval is invalid.');
  return parsed;
}

function resolveBillingScheduleConfig(env = process.env) {
  const intervalHours = parseIntervalHours(env.STRIPE_RECONCILIATION_INTERVAL_HOURS);
  return {
    enabled: flag(env.STRIPE_RECONCILIATION_ENABLED),
    intervalHours,
    intervalMs: intervalHours * 60 * 60 * 1000,
    pollMs: DEFAULT_POLL_MS,
    startupGraceMs: DEFAULT_STARTUP_GRACE_MS,
    shutdownGraceMs: DEFAULT_SHUTDOWN_GRACE_MS,
    lockLeaseMs: DEFAULT_RECONCILIATION_LOCK_LEASE_MS
  };
}

function createBillingReconciliationScheduler({
  db,
  env = process.env,
  stripeClient = stripe,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  runReconciliation = reconcileBilling,
  acquireLock = acquireBillingReconciliationLock,
  startHeartbeat = startBillingReconciliationHeartbeat,
  logger = entry => console.log(JSON.stringify(entry)),
  config: suppliedConfig
} = {}) {
  const config = { ...resolveBillingScheduleConfig(env), ...(suppliedConfig || {}) };
  let timer = null;
  let active = null;
  let stopping = false;

  function log(event, details = {}) { try { logger({ event, ...details }); } catch (_) {} }
  function schedule(delay) {
    if (stopping || !config.enabled) return;
    timer = setTimeoutFn(async () => {
      timer = null;
      await tick();
      schedule(config.pollMs);
    }, delay);
    if (timer?.unref) timer.unref();
  }
  async function tick() {
    if (stopping || !config.enabled || active) return { attempted: false };
    const last = db.prepare(`
      SELECT completed_at FROM billing_reconciliation_runs
      WHERE status='completed' AND mode='apply' ORDER BY id DESC LIMIT 1
    `).get();
    const lastMs = last?.completed_at ? Date.parse(last.completed_at) : 0;
    if (Number.isFinite(lastMs) && lastMs > 0 && now() - lastMs < config.intervalMs) return { attempted: false };
    active = (async () => {
      let lock;
      let stopHeartbeat = () => {};
      try {
        lock = acquireLock({ env, leaseMs: config.lockLeaseMs });
        stopHeartbeat = startHeartbeat(lock, { leaseMs: config.lockLeaseMs });
        await runReconciliation({ db, stripeClient, mode: 'apply', env, logger });
        return { attempted: true, success: true };
      } catch (error) {
        const code = error?.code === 'RECONCILIATION_LOCKED' ? 'RECONCILIATION_LOCKED' : 'RECONCILIATION_FAILED';
        log('billing_reconciliation_scheduler_failed', { code });
        return { attempted: code !== 'RECONCILIATION_LOCKED', success: false, code };
      } finally {
        stopHeartbeat();
        if (lock) lock.release();
      }
    })();
    try { return await active; } finally { active = null; }
  }
  function start() {
    if (!config.enabled || timer || active || stopping) return { started: false, enabled: config.enabled };
    log('billing_reconciliation_scheduler_started', { intervalHours: config.intervalHours });
    schedule(config.startupGraceMs);
    return { started: true, enabled: true };
  }
  async function stop() {
    stopping = true;
    if (timer) clearTimeoutFn(timer);
    timer = null;
    if (!active) { log('billing_reconciliation_scheduler_stopped'); return { drained: true }; }
    let timeout;
    const drained = await Promise.race([
      active.then(() => true),
      new Promise(resolve => { timeout = setTimeoutFn(() => resolve(false), config.shutdownGraceMs); })
    ]);
    if (timeout) clearTimeoutFn(timeout);
    log('billing_reconciliation_scheduler_stopped', { drained });
    return { drained };
  }
  return { start, stop, tick, isRunning: () => Boolean(active), config };
}

module.exports = {
  DEFAULT_INTERVAL_HOURS,
  createBillingReconciliationScheduler,
  parseIntervalHours,
  resolveBillingScheduleConfig
};
