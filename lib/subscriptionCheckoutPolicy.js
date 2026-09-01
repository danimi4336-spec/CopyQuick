const REPLACEABLE_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired']);
const { isStripeCustomerExclusivelyOwned } = require('./billingCustomerOwnership');

function resolveSubscriptionCheckoutPolicy(user, db) {
  if (!user || user.plan_tier !== 'free' || !Number.isSafeInteger(user.id) || !db) {
    return { allowed: false, customerId: null };
  }
  const relationships = db.prepare(`
    SELECT status, stripe_customer_id FROM subscriptions WHERE user_id = ? ORDER BY id
  `).all(user.id);
  if (relationships.length === 0) return { allowed: true, customerId: null };

  const localUser = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(user.id);
  const customerId = localUser?.stripe_customer_id;
  const historyIsReplaceable = relationships.every(relationship =>
    REPLACEABLE_SUBSCRIPTION_STATUSES.has(relationship.status) &&
    relationship.stripe_customer_id === customerId
  );
  const customerIsExclusive = historyIsReplaceable && isStripeCustomerExclusivelyOwned(db, {
    userId: user.id,
    customerId
  });
  return customerIsExclusive
    ? { allowed: true, customerId }
    : { allowed: false, customerId: null };
}

function canStartSubscriptionCheckout(user, db) {
  return resolveSubscriptionCheckoutPolicy(user, db).allowed;
}

module.exports = {
  REPLACEABLE_SUBSCRIPTION_STATUSES,
  canStartSubscriptionCheckout,
  resolveSubscriptionCheckoutPolicy
};
