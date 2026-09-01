const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]{1,251}$/;

function isStripeCustomerExclusivelyOwned(db, { userId, customerId }) {
  if (!db || !Number.isSafeInteger(userId) || userId < 1 ||
      typeof customerId !== 'string' || !STRIPE_CUSTOMER_ID.test(customerId)) return false;
  const conflictingUser = db.prepare(`
    SELECT 1 FROM users WHERE stripe_customer_id = ? AND id != ? LIMIT 1
  `).get(customerId, userId);
  if (conflictingUser) return false;
  const conflictingSubscription = db.prepare(`
    SELECT 1 FROM subscriptions WHERE stripe_customer_id = ? AND user_id != ? LIMIT 1
  `).get(customerId, userId);
  return !conflictingSubscription;
}

module.exports = { isStripeCustomerExclusivelyOwned };
