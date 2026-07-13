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
  recordUsageEvent,
  syncSubscriptionRecord
};
