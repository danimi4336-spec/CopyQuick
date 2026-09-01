const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { evaluateStripeEntitlement, BillingPolicyError } = require('./billingEntitlement');
const { syncSubscriptionRecord } = require('./subscriptions');
const { parseUserReference } = require('./checkoutIdentity');

const SAFE_CODE = /^[A-Z0-9_]{1,64}$/;
const MAX_RECORDS_PER_RUN = 10000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 30 * 60 * 1000;
const MIN_DURATION_MS = 1000;

function reconciliationMaxDurationMs(value = process.env.STRIPE_RECONCILIATION_MAX_DURATION_MS) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= MIN_DURATION_MS && parsed <= MAX_DURATION_MS
    ? parsed
    : DEFAULT_MAX_DURATION_MS;
}

function enforceRuntimeDeadline(startedAt, currentTime, maximumMs) {
  if (currentTime() - startedAt <= maximumMs) return;
  throw Object.assign(new Error('Billing reconciliation runtime bound exceeded.'), {
    code: 'RECONCILIATION_TIME_LIMIT_EXCEEDED'
  });
}

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

function stripeCustomerId(subscription) {
  return typeof subscription?.customer === 'string'
    ? subscription.customer
    : typeof subscription?.customer?.id === 'string' ? subscription.customer.id : null;
}

function orphanAdoptionCandidate(db, subscription) {
  const userId = parseUserReference(subscription?.metadata?.copyquick_user_id);
  if (!userId) return { issueCode: 'LOCAL_SUBSCRIPTION_MISSING' };
  const user = db.prepare(`
    SELECT id, stripe_customer_id, plan_tier AS user_plan_tier, monthly_limit AS user_monthly_limit
    FROM users WHERE id = ?
  `).get(userId);
  if (!user) return { issueCode: 'LOCAL_SUBSCRIPTION_MISSING', userId };
  const customerId = stripeCustomerId(subscription);
  const existing = db.prepare(`SELECT * FROM subscriptions WHERE user_id = ? LIMIT 1`).get(userId);
  if (!customerId ||
      (user.stripe_customer_id && user.stripe_customer_id !== customerId) ||
      (existing && (existing.stripe_subscription_id !== subscription?.id || existing.stripe_customer_id !== customerId))) {
    return { issueCode: 'CUSTOMER_SUBSCRIPTION_MISMATCH', userId };
  }
  return {
    userId,
    local: {
      ...(existing || {}),
      user_id: userId,
      user_customer_id: user.stripe_customer_id,
      user_plan_tier: user.user_plan_tier,
      user_monthly_limit: user.user_monthly_limit,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription?.id,
      past_due_since: existing?.past_due_since || null
    }
  };
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
    const syncResult = syncSubscriptionRecord({
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
    if (syncResult?.skipped) throw new Error('Validated subscription persistence was rejected.');
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
  monotonicNow = () => performance.now(),
  pageSize = DEFAULT_PAGE_SIZE,
  maxRecords = MAX_RECORDS_PER_RUN,
  maxDurationMs = reconciliationMaxDurationMs(env.STRIPE_RECONCILIATION_MAX_DURATION_MS),
  logger = entry => console.log(JSON.stringify(entry))
} = {}) {
  if (!db || !stripeClient?.subscriptions?.list) throw new Error('Billing reconciliation dependencies are unavailable.');
  if (!['dry_run', 'apply'].includes(mode)) throw new Error('Billing reconciliation mode must be explicit.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > MAX_RECORDS_PER_RUN ||
      !Number.isInteger(maxDurationMs) || maxDurationMs < MIN_DURATION_MS || maxDurationMs > MAX_DURATION_MS) {
    throw new Error('Billing reconciliation bounds are invalid.');
  }
  const startedAt = now();
  const startedMs = startedAt.getTime();
  const runtimeStartedAt = monotonicNow();
  const runId = startRun(db, mode, startedAt);
  const summary = {
    runId, mode, status: 'completed', inspectedCount: 0, driftCount: 0,
    repairedCount: 0, unresolvedCount: 0, failureCode: null
  };
  const seenSubscriptions = new Set();
  const seenUsers = new Set();
  const seenStripeCursors = new Set();
  const pendingDrifts = [];
  const pendingAdoptions = new Map();
  const orphanClaimCounts = new Map();
  const pendingSubscriptionOrphans = [];
  const pendingUserOrphans = [];
  let startingAfter;
  try {
    logger({ event: 'reconciliation_started', mode });
    do {
      enforceRuntimeDeadline(runtimeStartedAt, monotonicNow, maxDurationMs);
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
      enforceRuntimeDeadline(runtimeStartedAt, monotonicNow, maxDurationMs);
      if (!page || !Array.isArray(page.data)) throw Object.assign(new Error('Invalid Stripe page.'), { code: 'STRIPE_API_UNAVAILABLE' });
      for (const subscription of page.data) {
        summary.inspectedCount += 1;
        if (summary.inspectedCount > maxRecords) throw Object.assign(new Error('Reconciliation record bound exceeded.'), { code: 'RECONCILIATION_RECORD_LIMIT_EXCEEDED' });
        if (typeof subscription?.id === 'string') seenSubscriptions.add(subscription.id);
        const local = localRelationship(db, subscription || {});
        if (!local) {
          const candidate = orphanAdoptionCandidate(db, subscription || {});
          if (candidate.userId) {
            seenUsers.add(candidate.userId);
            orphanClaimCounts.set(candidate.userId, (orphanClaimCounts.get(candidate.userId) || 0) + 1);
          }
          if (candidate.issueCode) {
            summary.unresolvedCount += 1;
            recordIssue(db, runId, {
              issueType: candidate.issueCode, userId: candidate.userId,
              subscriptionId: subscription?.id, desiredEntitlement: null,
              resolutionStatus: 'unresolved'
            });
            continue;
          }
          try {
            const decision = evaluateStripeEntitlement(subscription, {
              env,
              now: startedAt,
              pastDueSince: candidate.local.past_due_since,
              expectedCustomerId: candidate.local.stripe_customer_id,
              expectedSubscriptionId: candidate.local.stripe_subscription_id
            });
            if (decision.issueCode) {
              summary.unresolvedCount += 1;
              recordIssue(db, runId, {
                issueType: decision.issueCode, userId: candidate.userId,
                subscriptionId: subscription?.id, desiredEntitlement: decision.planTier,
                resolutionStatus: 'unresolved'
              });
            }
            const candidates = pendingAdoptions.get(candidate.userId) || [];
            candidates.push({ local: candidate.local, decision });
            pendingAdoptions.set(candidate.userId, candidates);
          } catch (error) {
            summary.unresolvedCount += 1;
            recordIssue(db, runId, {
              issueType: mapPolicyError(error), userId: candidate.userId,
              subscriptionId: subscription?.id, desiredEntitlement: 'unknown',
              resolutionStatus: 'unresolved'
            });
          }
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
      const nextCursor = page.has_more && page.data.length ? page.data.at(-1).id : null;
      if (page.has_more && !nextCursor) {
        throw Object.assign(new Error('Invalid Stripe pagination.'), { code: 'STRIPE_PAGINATION_INVALID' });
      }
      if (nextCursor && seenStripeCursors.has(nextCursor)) {
        throw Object.assign(new Error('Stripe pagination repeated.'), { code: 'STRIPE_PAGINATION_INVALID' });
      }
      if (nextCursor) seenStripeCursors.add(nextCursor);
      startingAfter = nextCursor;
    } while (startingAfter);

    for (const [userId, candidates] of pendingAdoptions) {
      if (candidates.length === 1 && orphanClaimCounts.get(userId) === 1) {
        summary.driftCount += 1;
        pendingDrifts.push({ ...candidates[0], adoption: true });
        continue;
      }
      summary.unresolvedCount += candidates.length;
      for (const candidate of candidates) {
        recordIssue(db, runId, {
          issueType: 'CUSTOMER_SUBSCRIPTION_MISMATCH', userId,
          subscriptionId: candidate.decision.id, desiredEntitlement: 'unknown',
          resolutionStatus: 'unresolved'
        });
      }
    }

    const localPage = db.prepare(`
      SELECT subscriptions.*, users.plan_tier AS user_plan_tier, users.monthly_limit AS user_monthly_limit
      FROM subscriptions JOIN users ON users.id = subscriptions.user_id
      WHERE subscriptions.id > ? ORDER BY subscriptions.id LIMIT ?
    `);
    let localCursor = 0;
    while (true) {
      enforceRuntimeDeadline(runtimeStartedAt, monotonicNow, maxDurationMs);
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
        pendingSubscriptionOrphans.push({ local, issueType, needsRevoke });
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
      enforceRuntimeDeadline(runtimeStartedAt, monotonicNow, maxDurationMs);
      const paidWithoutSubscription = paidUserPage.all(userCursor, pageSize);
      if (!paidWithoutSubscription.length) break;
      for (const user of paidWithoutSubscription) {
        userCursor = user.id;
        if (seenUsers.has(user.id)) continue;
        summary.inspectedCount += 1;
        if (summary.inspectedCount > maxRecords) throw Object.assign(new Error('Reconciliation record bound exceeded.'), { code: 'RECONCILIATION_RECORD_LIMIT_EXCEEDED' });
        summary.driftCount += 1;
        pendingUserOrphans.push(user);
      }
    }

    // Inventory must complete before any entitlement mutation. The complete
    // repair set and its drift findings then persist atomically, so a later
    // record-bound or database failure cannot leave a partially repaired run.
    enforceRuntimeDeadline(runtimeStartedAt, monotonicNow, maxDurationMs);
    const repairedCount = db.transaction(() => {
      let repaired = 0;
      for (const { local, decision, adoption } of pendingDrifts) {
        if (mode === 'apply') {
          applyDecision(db, local, decision);
          repaired += 1;
        }
        recordIssue(db, runId, {
          issueType: adoption ? 'LOCAL_SUBSCRIPTION_MISSING' : 'LOCAL_ENTITLEMENT_DRIFT', userId: local.user_id,
          subscriptionId: local.stripe_subscription_id,
          desiredEntitlement: decision.planTier,
          resolutionStatus: mode === 'apply' ? 'repaired' : 'detected'
        });
      }
      for (const { local, issueType, needsRevoke } of pendingSubscriptionOrphans) {
        if (mode === 'apply' && needsRevoke) {
          revokeOrphanEntitlement(db, local.user_id);
          repaired += 1;
        }
        recordIssue(db, runId, {
          issueType, userId: local.user_id, subscriptionId: local.stripe_subscription_id,
          desiredEntitlement: 'free', resolutionStatus: mode === 'apply' && needsRevoke ? 'repaired' : 'unresolved'
        });
      }
      for (const user of pendingUserOrphans) {
        if (mode === 'apply') {
          revokeOrphanEntitlement(db, user.id);
          repaired += 1;
        }
        recordIssue(db, runId, {
          issueType: 'LOCAL_SUBSCRIPTION_MISSING', userId: user.id,
          desiredEntitlement: 'free', resolutionStatus: mode === 'apply' ? 'repaired' : 'detected'
        });
      }
      return repaired;
    })();
    summary.repairedCount = repairedCount;
    const completedAt = now();
    finishRun(db, runId, summary, completedAt, startedMs);
    if (summary.driftCount > 0) logger({ event: 'drift_detected', count: summary.driftCount });
    if (summary.repairedCount > 0) logger({ event: 'entitlement_repaired', count: summary.repairedCount });
    if (summary.unresolvedCount > 0) logger({ event: 'unresolved_billing_issue', count: summary.unresolvedCount });
    logger({ event: 'reconciliation_completed', mode, inspectedCount: summary.inspectedCount, driftCount: summary.driftCount, repairedCount: summary.repairedCount, unresolvedCount: summary.unresolvedCount });
    return summary;
  } catch (error) {
    summary.status = 'failed';
    summary.failureCode = [
      'RECONCILIATION_RECORD_LIMIT_EXCEEDED',
      'RECONCILIATION_TIME_LIMIT_EXCEEDED',
      'STRIPE_API_UNAVAILABLE',
      'STRIPE_PAGINATION_INVALID'
    ].includes(error?.code)
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
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_PAGE_SIZE,
  MAX_DURATION_MS,
  MAX_RECORDS_PER_RUN,
  applyDecision,
  getBillingReconciliationStatus,
  normalizeBillingCode,
  reconciliationMaxDurationMs,
  reconcileBilling,
  relationshipDrift,
  safeReference
};
