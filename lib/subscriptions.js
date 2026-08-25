const { getDb } = require('../db/database');

function getPlanConfigFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRO_PRICE) {
    return { planTier: 'pro', monthlyLimit: 200 };
  }

  if (priceId === process.env.STRIPE_UNLIMITED_PRICE) {
    return { planTier: 'unlimited', monthlyLimit: 999999 };
  }

  return { planTier: 'free', monthlyLimit: 10 };
}

function getSubscriptionSyncIssues({
  stripeCustomerId,
  stripeSubscriptionId,
  status,
  priceId,
  currentPeriodStart,
  currentPeriodEnd
}) {
  const issues = [];

  if (!stripeCustomerId) issues.push('missing stripe_customer_id');
  if (!stripeSubscriptionId) issues.push('missing stripe_subscription_id');
  if (!status) issues.push('missing status');
  if (!priceId) issues.push('missing price_id');
  if (!currentPeriodStart) issues.push('missing current_period_start');
  if (!currentPeriodEnd) issues.push('missing current_period_end');

  return issues;
}

function normalizeStripeTimestamp(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toISOString();
}

function ensureUsagePeriod(db, { userId, subscriptionId, periodStart, periodEnd, planTier, monthlyLimit }) {
  if (!periodStart || !periodEnd) return null;

  db.prepare(`
    INSERT OR IGNORE INTO usage_periods (
      user_id, subscription_id, period_start, period_end, plan_tier, monthly_limit, usage_count
    ) VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(userId, subscriptionId, periodStart, periodEnd, planTier, monthlyLimit);

  db.prepare(`
    UPDATE usage_periods
    SET subscription_id = ?, plan_tier = ?, monthly_limit = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND period_start = ? AND period_end = ?
  `).run(subscriptionId, planTier, monthlyLimit, userId, periodStart, periodEnd);

  return db.prepare(`
    SELECT * FROM usage_periods
    WHERE user_id = ? AND period_start = ? AND period_end = ?
  `).get(userId, periodStart, periodEnd);
}

function getCalendarMonthPeriod(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function getCurrentSubscriptionPeriod(db, userId) {
  return db.prepare(`
    SELECT *
    FROM subscriptions
    WHERE user_id = ?
      AND status IN ('active', 'trialing', 'past_due')
      AND datetime(current_period_start) <= datetime('now')
      AND datetime(current_period_end) > datetime('now')
    ORDER BY datetime(current_period_end) DESC
    LIMIT 1
  `).get(userId);
}

function getCurrentUsageSnapshot(db, user) {
  const userMonthlyLimit = Number(user.monthly_limit);
  const monthlyLimit = user.monthly_limit !== null && user.monthly_limit !== undefined && Number.isFinite(userMonthlyLimit)
    ? userMonthlyLimit
    : 10;
  const subscription = getCurrentSubscriptionPeriod(db, user.id);
  const fallbackPeriod = getCalendarMonthPeriod();

  const usagePeriod = ensureUsagePeriod(db, {
    userId: user.id,
    subscriptionId: subscription?.id || null,
    periodStart: subscription?.current_period_start || fallbackPeriod.periodStart,
    periodEnd: subscription?.current_period_end || fallbackPeriod.periodEnd,
    planTier: user.plan_tier || subscription?.plan_tier || 'free',
    monthlyLimit
  });

  const used = usagePeriod?.usage_count || 0;
  const remaining = Math.max(monthlyLimit - used, 0);

  if (usagePeriod) {
    db.prepare(`
      UPDATE users
      SET current_usage_period_id = ?,
          current_period_used = ?,
          usage_tracking_version = 'ledger_ready',
          quota_enforcement_mode = 'billing_period'
      WHERE id = ?
    `).run(usagePeriod.id, used, user.id);
  }

  return {
    usagePeriod,
    used,
    monthlyLimit,
    remaining,
    isOverLimit: used >= monthlyLimit
  };
}

function getCurrentUsageSnapshotReadOnly(db, user) {
  const userMonthlyLimit = Number(user.monthly_limit);
  const monthlyLimit = user.monthly_limit !== null && user.monthly_limit !== undefined && Number.isFinite(userMonthlyLimit)
    ? userMonthlyLimit
    : 10;
  const subscription = getCurrentSubscriptionPeriod(db, user.id);
  const fallbackPeriod = getCalendarMonthPeriod();
  const periodStart = subscription?.current_period_start || fallbackPeriod.periodStart;
  const periodEnd = subscription?.current_period_end || fallbackPeriod.periodEnd;
  const planTier = user.plan_tier || subscription?.plan_tier || 'free';

  const usagePeriod = db.prepare(`
    SELECT *
    FROM usage_periods
    WHERE user_id = ? AND period_start = ? AND period_end = ?
    LIMIT 1
  `).get(user.id, periodStart, periodEnd) || {
    id: null,
    user_id: user.id,
    subscription_id: subscription?.id || null,
    period_start: periodStart,
    period_end: periodEnd,
    plan_tier: planTier,
    monthly_limit: monthlyLimit,
    usage_count: 0
  };

  const used = usagePeriod?.usage_count || 0;
  const remaining = Math.max(monthlyLimit - used, 0);

  return {
    usagePeriod,
    used,
    monthlyLimit,
    remaining,
    isOverLimit: used >= monthlyLimit
  };
}

function recordUsageEvent(db, { userId, usagePeriodId, generationId, eventType, sourceRoute, metadata = {}, units = 1 }) {
  db.prepare(`
    INSERT INTO usage_events (
      user_id, usage_period_id, generation_id, event_type, units, source_route, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    usagePeriodId,
    generationId,
    eventType,
    units,
    sourceRoute,
    JSON.stringify(metadata)
  );

  db.prepare(`
    UPDATE usage_periods
    SET usage_count = usage_count + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(units, usagePeriodId);

  const usagePeriod = db.prepare('SELECT usage_count FROM usage_periods WHERE id = ?').get(usagePeriodId);
  db.prepare(`
    UPDATE users
    SET current_usage_period_id = ?,
        current_period_used = ?,
        usage_tracking_version = 'ledger_ready',
        quota_enforcement_mode = 'billing_period'
    WHERE id = ?
  `).run(usagePeriodId, usagePeriod?.usage_count || 0, userId);
}

class UsageLimitExceededError extends Error {
  constructor(message = 'Monthly limit reached') {
    super(message);
    this.name = 'UsageLimitExceededError';
    this.code = 'USAGE_LIMIT_EXCEEDED';
  }
}

function persistGenerationUsageTransaction(db, {
  userId,
  usagePeriodId,
  eventType,
  sourceRoute,
  metadata = {},
  units = 1,
  persistGeneration
}) {
  return persistUsageTransaction(db, {
    userId,
    usagePeriodId,
    eventType,
    sourceRoute,
    metadata,
    units,
    persistResource: (txDb) => ({ generationId: persistGeneration(txDb) }),
    buildUsageReference: (resource) => ({ generationId: resource.generationId })
  });
}

function persistUsageTransaction(db, {
  userId,
  usagePeriodId,
  eventType,
  sourceRoute,
  metadata = {},
  units = 1,
  persistResource,
  buildUsageReference = () => ({}),
  finalizeResource = null
}) {
  if (!usagePeriodId) {
    throw new Error('Missing usage period for usage transaction');
  }

  return db.transaction(() => {
    const resource = persistResource(db);
    if (resource?.duplicate) return resource;
    const reference = buildUsageReference(resource) || {};

    const legacyResult = db.prepare(`
      UPDATE users
      SET generations_used = generations_used + ?
      WHERE id = ?
    `).run(units, userId);
    if (legacyResult.changes !== 1) {
      throw new Error('Failed to update legacy generation counter');
    }

    db.prepare(`
      INSERT INTO usage_events (
        user_id, usage_period_id, generation_id, production_run_id, event_type, units, source_route, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      usagePeriodId,
      reference.generationId || null,
      reference.productionRunId || null,
      eventType,
      units,
      sourceRoute,
      JSON.stringify(metadata)
    );
    const usageEventId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

    const usageResult = db.prepare(`
      UPDATE usage_periods
      SET usage_count = usage_count + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND user_id = ?
        AND usage_count + ? <= monthly_limit
    `).run(units, usagePeriodId, userId, units);

    if (usageResult.changes !== 1) {
      throw new UsageLimitExceededError();
    }

    const usagePeriod = db.prepare('SELECT usage_count FROM usage_periods WHERE id = ? AND user_id = ?').get(usagePeriodId, userId);
    db.prepare(`
      UPDATE users
      SET current_usage_period_id = ?,
          current_period_used = ?,
          usage_tracking_version = 'ledger_ready',
          quota_enforcement_mode = 'billing_period'
      WHERE id = ?
    `).run(usagePeriodId, usagePeriod?.usage_count || 0, userId);

    const result = { ...resource, usageEventId, usageCount: usagePeriod?.usage_count || 0 };
    if (finalizeResource) finalizeResource(db, result);
    return result;
  })();
}

function syncSubscriptionRecord({
  userId,
  stripeCustomerId,
  stripeSubscriptionId,
  status,
  planTier,
  priceId,
  currentPeriodStart,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  canceledAt,
  endedAt,
  monthlyLimit,
  latestStripeEventCreated,
  latestStripeEventId
}) {
  const db = getDb();
  const issues = getSubscriptionSyncIssues({
    stripeCustomerId,
    stripeSubscriptionId,
    status,
    priceId,
    currentPeriodStart,
    currentPeriodEnd
  });

  if (issues.length > 0) {
    return { skipped: true, issues };
  }

  const periodStart = normalizeStripeTimestamp(currentPeriodStart);
  const periodEnd = normalizeStripeTimestamp(currentPeriodEnd);
  const canceledAtIso = normalizeStripeTimestamp(canceledAt);
  const endedAtIso = normalizeStripeTimestamp(endedAt);

  db.prepare(`
    INSERT INTO subscriptions (
      user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier, price_id,
      current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at,
      latest_stripe_event_created, latest_stripe_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET
      user_id = excluded.user_id,
      stripe_customer_id = excluded.stripe_customer_id,
      status = excluded.status,
      plan_tier = excluded.plan_tier,
      price_id = excluded.price_id,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      canceled_at = excluded.canceled_at,
      ended_at = excluded.ended_at,
      latest_stripe_event_created = excluded.latest_stripe_event_created,
      latest_stripe_event_id = excluded.latest_stripe_event_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    userId,
    stripeCustomerId,
    stripeSubscriptionId,
    status,
    planTier,
    priceId,
    periodStart,
    periodEnd,
    cancelAtPeriodEnd ? 1 : 0,
    canceledAtIso,
    endedAtIso,
    latestStripeEventCreated || 0,
    latestStripeEventId || null
  );

  const subscription = db.prepare(`
    SELECT * FROM subscriptions WHERE stripe_subscription_id = ?
  `).get(stripeSubscriptionId);

  const usagePeriod = ensureUsagePeriod(db, {
    userId,
    subscriptionId: subscription.id,
    periodStart,
    periodEnd,
    planTier,
    monthlyLimit
  });

  if (usagePeriod) {
    db.prepare(`
      UPDATE users
      SET current_usage_period_id = ?, current_period_used = ?, usage_tracking_version = 'ledger_ready'
      WHERE id = ?
    `).run(usagePeriod.id, usagePeriod.usage_count, userId);
  }

  return { subscription, usagePeriod };
}

module.exports = {
  getPlanConfigFromPriceId,
  getSubscriptionSyncIssues,
  getCurrentUsageSnapshot,
  getCurrentUsageSnapshotReadOnly,
  recordUsageEvent,
  persistUsageTransaction,
  persistGenerationUsageTransaction,
  UsageLimitExceededError,
  syncSubscriptionRecord
};
