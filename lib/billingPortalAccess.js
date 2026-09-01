const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]{1,251}$/;
const { isStripeCustomerExclusivelyOwned } = require('./billingCustomerOwnership');

function resolveOwnedPortalCustomerId(db, user) {
  const customerId = typeof user?.stripe_customer_id === 'string' ? user.stripe_customer_id.trim() : '';
  if (!db || !Number.isSafeInteger(user?.id) || !STRIPE_CUSTOMER_ID.test(customerId)) return null;
  const relationships = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN stripe_customer_id = ? THEN 1 ELSE 0 END) AS matching
    FROM subscriptions
    WHERE user_id = ?
  `).get(customerId, user.id);
  const total = Number(relationships?.total || 0);
  const matching = Number(relationships?.matching || 0);
  return total > 0 && matching === total && isStripeCustomerExclusivelyOwned(db, { userId: user.id, customerId })
    ? customerId
    : null;
}

module.exports = { resolveOwnedPortalCustomerId };
