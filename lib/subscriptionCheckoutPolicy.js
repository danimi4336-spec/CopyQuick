function canStartSubscriptionCheckout(user) {
  return Boolean(user) && user.plan_tier === 'free';
}

module.exports = { canStartSubscriptionCheckout };
