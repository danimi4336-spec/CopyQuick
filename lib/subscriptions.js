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

function getCurrentMonthWindow(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function getUsagePeriodById(db, usagePeriodId) {
  if (!usagePeriodId) return null;

  return db.prepare(`
    SELECT * FROM usage_periods WHERE id = ?
  `).get(usagePeriodId);
}

function ensureCurrentUsagePeriod(db, { userId, planTier, monthlyLimit, now = new Date() }) {
  const nowIso = now.toISOString();
  const user = db.prepare(`
    SELECT id, plan_tier, monthly_limit, current_usage_period_id
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    throw new Error(`User ${userId} not found for usage tracking`);
  }

  const currentUsagePeriod = getUsagePeriodById(db, user.current_usage_period_id);
  if (currentUsagePeriod && currentUsagePeriod.period_start <= nowIso && currentUsagePeriod.period_end > nowIso) {
    return currentUsagePeriod;
  }

  const activeSubscription = db.prepare(`
    SELECT *
    FROM subscriptions
    WHERE user_id = ?
      AND current_period_start <= ?
      AND current_period_end > ?
    ORDER BY current_period_end DESC
    LIMIT 1
  `).get(userId, nowIso, nowIso);

  let usagePeriod;
  if (activeSubscription) {
    usagePeriod = ensureUsagePeriod(db, {
      userId,
      subscriptionId: activeSubscription.id,
      periodStart: activeSubscription.current_period_start,
      periodEnd: activeSubscription.current_period_end,
      planTier: activeSubscription.plan_tier || planTier || user.plan_tier,
      monthlyLimit: monthlyLimit ?? user.monthly_limit
    });
  } else {
    const currentMonthWindow = getCurrentMonthWindow(now);
    usagePeriod = ensureUsagePeriod(db, {
      userId,
      subscriptionId: null,
      periodStart: currentMonthWindow.periodStart,
      periodEnd: currentMonthWindow.periodEnd,
      planTier: planTier || user.plan_tier || 'free',
      monthlyLimit: monthlyLimit ?? user.monthly_limit ?? 10
    });
  }

  if (!usagePeriod) {
    throw new Error(`Unable to resolve usage period for user ${userId}`);
  }

  db.prepare(`
    UPDATE users
    SET current_usage_period_id = ?, current_period_used = ?, usage_tracking_version = 'ledger_ready'
    WHERE id = ?
  `).run(usagePeriod.id, usagePeriod.usage_count, userId);

  return usagePeriod;
}

function recordUsageEvent(db, {
  userId,
  generationId,
  eventType,
  creditsUsed,
  sourceRoute,
  metadata
}) {
  if (!userId) throw new Error('recordUsageEvent requires userId');
  if (!generationId) throw new Error('recordUsageEvent requires generationId');
  if (!eventType) throw new Error('recordUsageEvent requires eventType');
  if (!Number.isInteger(creditsUsed) || creditsUsed <= 0) {
    throw new Error('recordUsageEvent requires creditsUsed to be a positive integer');
  }

  const user = db.prepare(`
    SELECT id, plan_tier, monthly_limit
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    throw new Error(`User ${userId} not found for usage event`);
  }

  const usagePeriod = ensureCurrentUsagePeriod(db, {
    userId,
    planTier: user.plan_tier,
    monthlyLimit: user.monthly_limit
  });

  const metadataJson = metadata ? JSON.stringify(metadata) : '';
  db.prepare(`
    INSERT INTO usage_events (
      user_id, usage_period_id, generation_id, event_type, credits_used, units, source_route, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    usagePeriod.id,
    generationId,
    eventType,
    creditsUsed,
    creditsUsed,
    sourceRoute || '',
    metadataJson
  );

  db.prepare(`
    UPDATE usage_periods
    SET usage_count = usage_count + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(creditsUsed, usagePeriod.id);

  const updatedUsagePeriod = getUsagePeriodById(db, usagePeriod.id);

  db.prepare(`
    UPDATE users
    SET current_usage_period_id = ?, current_period_used = ?, usage_tracking_version = 'ledger_ready'
    WHERE id = ?
  `).run(updatedUsagePeriod.id, updatedUsagePeriod.usage_count, userId);

  return updatedUsagePeriod;
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
  monthlyLimit
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
      current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    endedAtIso
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
  syncSubscriptionRecord,
  ensureCurrentUsagePeriod,
  recordUsageEvent
};
