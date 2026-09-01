const crypto = require('crypto');

const CHECKOUT_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const VALID_PLANS = new Set(['pro', 'unlimited']);
const REPLACEABLE_TERMINAL_STATUSES = new Set(['canceled', 'incomplete_expired']);

function strictDate(value) {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function acquireSubscriptionCheckoutIntent(db, {
  userId,
  planTier,
  priceId,
  now = new Date(),
  randomUUID = crypto.randomUUID,
  allowExpiredReplacement = false
} = {}) {
  const currentTime = now instanceof Date ? now : new Date(now);
  if (!db || !Number.isSafeInteger(userId) || userId < 1 || !VALID_PLANS.has(planTier) ||
      typeof priceId !== 'string' || !priceId || !Number.isFinite(currentTime.getTime())) {
    throw new Error('Subscription checkout intent input is invalid.');
  }

  return db.transaction(() => {
    const existing = db.prepare(`
      SELECT idempotency_key, price_id, stripe_checkout_session_id, expires_at
      FROM subscription_checkout_intents
      WHERE user_id = ? AND plan_tier = ?
    `).get(userId, planTier);
    const existingExpiry = strictDate(existing?.expires_at);
    if (existing && existing.price_id !== priceId && !allowExpiredReplacement) {
      return {
        idempotencyKey: existing.idempotency_key,
        expiresAt: existingExpiry,
        stripeCheckoutSessionId: existing.stripe_checkout_session_id,
        reused: true,
        expired: Boolean(!existingExpiry || existingExpiry <= currentTime),
        requiresInspection: true
      };
    }
    if (existing && existing.price_id === priceId && existingExpiry && existingExpiry > currentTime) {
      return {
        idempotencyKey: existing.idempotency_key,
        expiresAt: existingExpiry,
        stripeCheckoutSessionId: existing.stripe_checkout_session_id,
        reused: true,
        expired: false,
        requiresInspection: false
      };
    }
    if (existing && existing.price_id === priceId && !allowExpiredReplacement) {
      return {
        idempotencyKey: existing.idempotency_key,
        expiresAt: existingExpiry,
        stripeCheckoutSessionId: existing.stripe_checkout_session_id,
        reused: true,
        expired: true,
        requiresInspection: true
      };
    }

    const idempotencyKey = randomUUID();
    const expiresAt = new Date(currentTime.getTime() + CHECKOUT_INTENT_TTL_MS);
    db.prepare(`
      INSERT INTO subscription_checkout_intents(
        user_id, plan_tier, price_id, idempotency_key, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, plan_tier) DO UPDATE SET
        price_id = excluded.price_id,
        idempotency_key = excluded.idempotency_key,
        stripe_checkout_session_id = NULL,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      userId,
      planTier,
      priceId,
      idempotencyKey,
      expiresAt.toISOString(),
      currentTime.toISOString(),
      currentTime.toISOString()
    );
    return {
      idempotencyKey,
      expiresAt,
      stripeCheckoutSessionId: null,
      reused: false,
      expired: false,
      requiresInspection: false
    };
  })();
}

function recordSubscriptionCheckoutSession(db, {
  userId,
  planTier,
  idempotencyKey,
  stripeCheckoutSessionId
}) {
  if (!Number.isSafeInteger(userId) || !VALID_PLANS.has(planTier) ||
      typeof idempotencyKey !== 'string' || !idempotencyKey ||
      typeof stripeCheckoutSessionId !== 'string' || !/^cs_[A-Za-z0-9_]{3,255}$/.test(stripeCheckoutSessionId)) {
    throw new Error('Subscription checkout session result is invalid.');
  }
  const changed = db.prepare(`
    UPDATE subscription_checkout_intents
    SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND plan_tier = ? AND idempotency_key = ?
  `).run(stripeCheckoutSessionId, userId, planTier, idempotencyKey).changes;
  if (changed !== 1) throw new Error('Subscription checkout intent ownership changed.');
}

function getConflictingSubscriptionCheckoutIntent(db, { userId, planTier } = {}) {
  if (!db || !Number.isSafeInteger(userId) || userId < 1 || !VALID_PLANS.has(planTier)) {
    throw new Error('Subscription checkout intent lookup input is invalid.');
  }
  return db.prepare(`
    SELECT plan_tier AS planTier, idempotency_key AS idempotencyKey,
      stripe_checkout_session_id AS stripeCheckoutSessionId, expires_at AS expiresAt
    FROM subscription_checkout_intents
    WHERE user_id = ? AND plan_tier != ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(userId, planTier) || null;
}

function clearSubscriptionCheckoutIntentIfMatches(db, {
  userId,
  planTier,
  idempotencyKey,
  stripeCheckoutSessionId
} = {}) {
  if (!db || !Number.isSafeInteger(userId) || userId < 1 || !VALID_PLANS.has(planTier) ||
      typeof idempotencyKey !== 'string' || !idempotencyKey ||
      typeof stripeCheckoutSessionId !== 'string' || !/^cs_[A-Za-z0-9_]{3,255}$/.test(stripeCheckoutSessionId)) {
    return false;
  }
  return db.prepare(`
    DELETE FROM subscription_checkout_intents
    WHERE user_id = ? AND plan_tier = ? AND idempotency_key = ?
      AND stripe_checkout_session_id = ?
  `).run(userId, planTier, idempotencyKey, stripeCheckoutSessionId).changes === 1;
}

function clearSubscriptionCheckoutIntents(db, { userId, planTier } = {}) {
  if (!db || !Number.isSafeInteger(userId) || userId < 1 ||
      (planTier !== undefined && !VALID_PLANS.has(planTier))) {
    throw new Error('Subscription checkout intent cleanup input is invalid.');
  }
  return planTier === undefined
    ? db.prepare('DELETE FROM subscription_checkout_intents WHERE user_id = ?').run(userId).changes
    : db.prepare('DELETE FROM subscription_checkout_intents WHERE user_id = ? AND plan_tier = ?').run(userId, planTier).changes;
}

function canReplaceCompletedCheckoutIntent(db, { userId, stripeSubscriptionId } = {}) {
  if (!db || !Number.isSafeInteger(userId) || userId < 1 ||
      typeof stripeSubscriptionId !== 'string' || !/^sub_[A-Za-z0-9_]{3,255}$/.test(stripeSubscriptionId)) {
    return false;
  }
  const relationship = db.prepare(`
    SELECT status FROM subscriptions
    WHERE user_id = ? AND stripe_subscription_id = ?
    LIMIT 1
  `).get(userId, stripeSubscriptionId);
  return REPLACEABLE_TERMINAL_STATUSES.has(relationship?.status);
}

module.exports = {
  CHECKOUT_INTENT_TTL_MS,
  acquireSubscriptionCheckoutIntent,
  canReplaceCompletedCheckoutIntent,
  clearSubscriptionCheckoutIntentIfMatches,
  clearSubscriptionCheckoutIntents,
  getConflictingSubscriptionCheckoutIntent,
  recordSubscriptionCheckoutSession
};
