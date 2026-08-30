const crypto = require('crypto');
const { evaluateStripeEntitlement, BillingPolicyError } = require('./billingEntitlement');
const { syncSubscriptionRecord } = require('./subscriptions');

const SAFE_CODE = /^[A-Z0-9_]{1,64}$/;
const MAX_RECORDS_PER_RUN = 10000;
const DEFAULT_PAGE_SIZE = 100;

function normalizeBillingCode(value, fallback = 'RECONCILIATION_FAILED') {
  const candidate = String(value || '');
  return SAFE_CODE.test(candidate) ? candidate : fallback;
}

function safeReference(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(`copyquick-billing:${String(value)}`).digest('hex').slice(0, 24);
}

function startRun(db, mode, now) {
  return Number(db.prepare(`
    INSERT INTO billing_reconciliation_runs(mode, status, started_at)
    VALUES (?, 'running', ?)
  `).run(mode, now.toISOString()).lastInsertRowid);
}

function finishRun(db, runId, summary, now, startedMs) {
  db.prepare(`
    UPDATE billing_reconciliation_runs
    SET status = ?, completed_at = ?, inspected_count = ?, drift_count = ?, repaired_count = ?,
        unresolved_count = ?, failure_code = ?, duration_ms = ?
    WHERE id = ?
  `).run(
    summary.status, now.toISOString(), summary.inspectedCount, summary.driftCount,
    summary.repairedCount, summary.unresolvedCount, summary.failureCode || null,
    Math.max(0, now.getTime() - startedMs), runId
  );
}

function recordIssue(db, runId, {
  issueType,
  userId,
  subscriptionId,
  desiredEntitlement,
  resolutionStatus
}) {
  db.prepare(`
    INSERT INTO billing_reconciliation_issues(
      reconciliation_run_id, issue_type, user_reference, subscription_reference,
      desired_entitlement, resolution_status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    normalizeBillingCode(issueType, 'RECONCILIATION_FAILED'),
    safeReference(userId),
    safeReference(subscriptionId),
    desiredEntitlement || null,
    resolutionStatus
  );
}

function localRelationship(db, subscription) {
  const customerId = typeof subscription?.customer === 'string'
    ? subscription.customer
    : typeof subscription?.customer?.id === 'string' ? subscription.customer.id : null;
  return db.prepare(`
    SELECT subscriptions.*, users.plan_tier AS user_plan_tier,
      users.monthly_limit AS user_monthly_limit, users.stripe_customer_id AS user_customer_id
    FROM subscriptions JOIN users ON users.id = subscriptions.user_id
    WHERE subscriptions.stripe_subscription_id = ? OR subscriptions.stripe_customer_id = ?
    ORDER BY subscriptions.stripe_subscription_id = ? DESC LIMIT 1
  `).get(subscription?.id || null, customerId, subscription?.id || null);
}

function relationshipDrift(local, decision) {
  if (!local) return true;
  return local.stripe_subscription_id !== decision.id ||
    local.stripe_customer_id !== decision.customerId ||
    local.user_customer_id !== decision.customerId ||
    local.status !== decision.status ||
    local.plan_tier !== decision.plan.planTier ||
    local.price_id !== decision.priceId ||
    local.user_plan_tier !== decision.planTier ||
    Number(local.user_monthly_limit) !== decision.monthlyLimit;
}

function applyDecision(db, local, decision) {
  db.transaction(() => {
    syncSubscriptionRecord({
      db,
      userId: local.user_id,
      stripeCustomerId: decision.customerId,
      stripeSubscriptionId: decision.id,
      status: decision.status,
      planTier: decision.plan.planTier,
      priceId: decision.priceId,
      currentPeriodStart: decision.currentPeriodStart,
      currentPeriodEnd: decision.currentPeriodEnd,
      cancelAtPeriodEnd: decision.cancelAtPeriodEnd,
      canceledAt: decision.canceledAt,
      endedAt: decision.endedAt,
      monthlyLimit: decision.plan.monthlyLimit,
      latestStripeEventCreated: local.latest_stripe_event_created || 0,
      latestStripeEventId: local.latest_stripe_event_id,
      pastDueSince: decision.pastDueSince,
      syncUsagePeriod: false
    });
    db.prepare(`UPDATE users SET plan_tier = ?, monthly_limit = ?, stripe_customer_id = ? WHERE id = ?`)
      .run(decision.planTier, decision.monthlyLimit, decision.customerId, local.user_id);
  })();
}

function revokeOrphanEntitlement(db, userId) {
  db.prepare(`UPDATE users SET plan_tier = 'free', monthly_limit = 10 WHERE id = ?`).run(userId);
}

function mapPolicyError(error) {
  return normalizeBillingCode(error instanceof BillingPolicyError ? error.code : 'RECONCILIATION_FAILED');
}

async function reconcileBilling({
  db,
  stripeClient,
  mode = 'dry_run',
  env = process.env,
  now = () => new Date(),
  pageSize = DEFAULT_PAGE_SIZE,
  maxRecords = MAX_RECORDS_PER_RUN,
  logger = entry => console.log(JSON.stringify(entry))
} = {}) {
  if (!db || !stripeClient?.subscriptions?.list) throw new Error('Billing reconciliation dependencies are unavailable.');
  if (!['dry_run', 'apply'].includes(mode)) throw new Error('Billing reconciliation mode must be explicit.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > MAX_RECORDS_PER_RUN) {
    throw new Error('Billing reconciliation bounds are invalid.');
  }
  const startedAt = now();
  const startedMs = startedAt.getTime();
  const runId = startRun(db, mode, startedAt);
  const summary = {
    runId, mode, status: 'completed', inspectedCount: 0, driftCount: 0,
    repairedCount: 0, unresolvedCount: 0, failureCode: null
  };
  const seenSubscriptions = new Set();
  const seenUsers = new Set();
  const pendingDrifts = [];
  let startingAfter;
  try {
    logger({ event: 'reconciliation_started', mode });
    do {
      let page;
      try {
        page = await stripeClient.subscriptions.list({
          limit: pageSize,
          status: 'all',
          expand: ['data.customer'],
          ...(startingAfter ? { starting_after: startingAfter } : {})
        });
      } catch (_) {
        throw Object.assign(new Error('Stripe subscription retrieval failed.'), { code: 'STRIPE_API_UNAVAILABLE' });
      }
      if (!page || !Array.isArray(page.data)) throw Object.assign(new Error('Invalid Stripe page.'), { code: 'STRIPE_API_UNAVAILABLE' });
      for (const subscription of page.data) {
        summary.inspectedCount += 1;
        if (summary.inspectedCount > maxRecords) throw Object.assign(new Error('Reconciliation record bound exceeded.'), { code: 'RECONCILIATION_RECORD_LIMIT_EXCEEDED' });
        if (typeof subscription?.id === 'string') seenSubscriptions.add(subscription.id);
        const local = localRelationship(db, subscription || {});
        if (!local) {
          summary.unresolvedCount += 1;
          recordIssue(db, runId, {
            issueType: 'LOCAL_SUBSCRIPTION_MISSING', subscriptionId: subscription?.id,
            desiredEntitlement: null, resolutionStatus: 'unresolved'
          });
          continue;
        }
        seenUsers.add(local.user_id);
        try {
          const decision = evaluateStripeEntitlement(subscription, {
            env,
            now: startedAt,
            pastDueSince: local.past_due_since,
            expectedCustomerId: local.stripe_customer_id,
            expectedSubscriptionId: local.stripe_subscription_id
          });
          if (decision.issueCode) {
            summary.unresolvedCount += 1;
            recordIssue(db, runId, {
              issueType: decision.issueCode,
              userId: local.user_id,
              subscriptionId: local.stripe_subscription_id,
              desiredEntitlement: decision.planTier,
              resolutionStatus: 'unresolved'
            });
          }
          if (!relationshipDrift(local, decision)) continue;
          summary.driftCount += 1;
          pendingDrifts.push({ local, decision });
        } catch (error) {
          summary.unresolvedCount += 1;
          recordIssue(db, runId, {
            issueType: mapPolicyError(error), userId: local.user_id,
            subscriptionId: local.stripe_subscription_id,
            desiredEntitlement: 'unknown', resolutionStatus: 'unresolved'
          });
        }
      }
      startingAfter = page.has_more && page.data.length ? page.data.at(-1).id : null;
      if (page.has_more && !startingAfter) throw Object.assign(new Error('Invalid Stripe pagination.'), { code: 'STRIPE_API_UNAVAILABLE' });
    } while (startingAfter);

    // No entitlement repair begins until all Stripe pages have been retrieved
    // successfully. A provider failure therefore cannot leave a partially
    // reconciled local population.
    for (const { local, decision } of pendingDrifts) {
      const repaired = mode === 'apply';
      if (repaired) {
        applyDecision(db, local, decision);
        summary.repairedCount += 1;
      }
      recordIssue(db, runId, {
        issueType: 'LOCAL_ENTITLEMENT_DRIFT', userId: local.user_id,
        subscriptionId: local.stripe_subscription_id,
        desiredEntitlement: decision.planTier,
        resolutionStatus: repaired ? 'repaired' : 'detected'
      });
    }

    const localPage = db.prepare(`
      SELECT subscriptions.*, users.plan_tier AS user_plan_tier, users.monthly_limit AS user_monthly_limit
      FROM subscriptions JOIN users ON users.id = subscriptions.user_id
      WHERE subscriptions.id > ? ORDER BY subscriptions.id LIMIT ?
    `);
    let localCursor = 0;
    while (true) {
      const locals = localPage.all(localCursor, pageSize);
      if (!locals.length) break;
      for (const local of locals) {
        localCursor = local.id;
        if (seenSubscriptions.has(local.stripe_subscription_id)) continue;
        summary.inspectedCount += 1;
        if (summary.inspectedCount > maxRecords) throw Object.assign(new Error('Reconciliation record bound exceeded.'), { code: 'RECONCILIATION_RECORD_LIMIT_EXCEEDED' });
        const issueType = 'STRIPE_SUBSCRIPTION_MISSING';
        const needsRevoke = local.user_plan_tier !== 'free' || Number(local.user_monthly_limit) !== 10;
        if (needsRevoke) summary.driftCount += 1;
        if (mode === 'apply' && needsRevoke) {
          db.transaction(() => revokeOrphanEntitlement(db, local.user_id))();
          summary.repairedCount += 1;
        }
        recordIssue(db, runId, {
          issueType, userId: local.user_id, subscriptionId: local.stripe_subscription_id,
          desiredEntitlement: 'free', resolutionStatus: mode === 'apply' && needsRevoke ? 'repaired' : 'unresolved'
        });
        if (!(mode === 'apply' && needsRevoke)) summary.unresolvedCount += 1;
      }
    }

    const paidUserPage = db.prepare(`
      SELECT users.id FROM users LEFT JOIN subscriptions ON subscriptions.user_id = users.id
      WHERE users.plan_tier != 'free' AND subscriptions.id IS NULL AND users.id > ?
      ORDER BY users.id LIMIT ?
    `);
    let userCursor = 0;
    while (true) {
      const paidWithoutSubscription = paidUserPage.all(userCursor, pageSize);
      if (!paidWithoutSubscription.length) break;
      for (const user of paidWithoutSubscription) {
        userCursor = user.id;
        if (seenUsers.has(user.id)) continue;
        summary.inspectedCount += 1;
        if (summary.inspectedCount > maxRecords) throw Object.assign(new Error('Reconciliation record bound exceeded.'), { code: 'RECONCILIATION_RECORD_LIMIT_EXCEEDED' });
        summary.driftCount += 1;
        if (mode === 'apply') {
          db.transaction(() => revokeOrphanEntitlement(db, user.id))();
          summary.repairedCount += 1;
        }
        recordIssue(db, runId, {
          issueType: 'LOCAL_SUBSCRIPTION_MISSING', userId: user.id,
          desiredEntitlement: 'free', resolutionStatus: mode === 'apply' ? 'repaired' : 'detected'
        });
      }
    }
    const completedAt = now();
    finishRun(db, runId, summary, completedAt, startedMs);
    if (summary.driftCount > 0) logger({ event: 'drift_detected', count: summary.driftCount });
    if (summary.repairedCount > 0) logger({ event: 'entitlement_repaired', count: summary.repairedCount });
    if (summary.unresolvedCount > 0) logger({ event: 'unresolved_billing_issue', count: summary.unresolvedCount });
    logger({ event: 'reconciliation_completed', mode, inspectedCount: summary.inspectedCount, driftCount: summary.driftCount, repairedCount: summary.repairedCount, unresolvedCount: summary.unresolvedCount });
    return summary;
  } catch (error) {
    summary.status = 'failed';
    summary.failureCode = ['RECONCILIATION_RECORD_LIMIT_EXCEEDED', 'STRIPE_API_UNAVAILABLE'].includes(error?.code)
      ? error.code
      : 'RECONCILIATION_FAILED';
    finishRun(db, runId, summary, now(), startedMs);
    logger({ event: 'reconciliation_failed', code: summary.failureCode });
    const failure = new Error('Billing reconciliation failed.');
    failure.code = summary.failureCode;
    throw failure;
  }
}

function getBillingReconciliationStatus(db, { enabled = false } = {}) {
  const lastRun = db.prepare(`SELECT * FROM billing_reconciliation_runs ORDER BY id DESC LIMIT 1`).get();
  const lastSuccess = db.prepare(`SELECT * FROM billing_reconciliation_runs WHERE status='completed' ORDER BY id DESC LIMIT 1`).get();
  return {
    enabled: Boolean(enabled),
    lastRunAt: lastRun?.started_at || null,
    lastSuccessAt: lastSuccess?.completed_at || null,
    lastFailureCode: lastRun?.status === 'failed' ? lastRun.failure_code : null,
    driftCount: Number(lastRun?.drift_count || 0),
    unresolvedCount: Number(lastRun?.unresolved_count || 0),
    durationMs: Number.isInteger(lastRun?.duration_ms) ? lastRun.duration_ms : null,
    lastMode: lastRun?.mode || null
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_RECORDS_PER_RUN,
  applyDecision,
  getBillingReconciliationStatus,
  normalizeBillingCode,
  reconcileBilling,
  relationshipDrift,
  safeReference
};
