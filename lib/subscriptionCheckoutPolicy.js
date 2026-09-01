const REPLACEABLE_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired']);

function canStartSubscriptionCheckout(user, db) {
  if (!user || user.plan_tier !== 'free' || !Number.isSafeInteger(user.id) || !db) return false;
  const relationships = db.prepare(`
    SELECT status FROM subscriptions WHERE user_id = ? ORDER BY id
  `).all(user.id);
  return relationships.every(relationship => REPLACEABLE_SUBSCRIPTION_STATUSES.has(relationship.status));
}

module.exports = { REPLACEABLE_SUBSCRIPTION_STATUSES, canStartSubscriptionCheckout };
