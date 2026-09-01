const STRIPE_REDIRECT_HOSTS = Object.freeze({
  checkout: 'checkout.stripe.com',
  portal: 'billing.stripe.com'
});

function getTrustedStripeRedirect(value, kind) {
  const expectedHost = STRIPE_REDIRECT_HOSTS[kind];
  if (!expectedHost || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.port || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch (err) {
    return null;
  }
}

module.exports = { STRIPE_REDIRECT_HOSTS, getTrustedStripeRedirect };
