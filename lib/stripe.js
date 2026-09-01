const Stripe = require('stripe');
const stripeKey = String(process.env.STRIPE_KEY || '').trim();
const isBillingEnabled = Boolean(stripeKey);

if (!isBillingEnabled && process.env.NODE_ENV === 'production') {
  throw new Error('Stripe billing configuration error: STRIPE_KEY is required when NODE_ENV=production.');
}

if (!isBillingEnabled) {
  console.warn('⚠️ Stripe billing disabled.');
  console.warn('Local development mode.');
  console.warn('Billing routes unavailable until STRIPE_KEY is configured.');
}

class BillingDisabledError extends Error {
  constructor() {
    super('Stripe billing is unavailable until STRIPE_KEY is configured.');
    this.name = 'BillingDisabledError';
    this.code = 'BILLING_DISABLED';
  }
}

const stripe = isBillingEnabled ? Stripe(stripeKey) : null;

function requireBilling() {
  if (!isBillingEnabled) throw new BillingDisabledError();
}

const createCheckoutSession = async (customerEmail, priceId, successUrl, cancelUrl, idempotencyKey, userId) => {
  requireBilling();
  const userReference = String(userId);
  return await stripe.checkout.sessions.create({
    client_reference_id: userReference,
    customer_email: customerEmail,
    metadata: { copyquick_user_id: userReference },
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    subscription_data: { metadata: { copyquick_user_id: userReference } },
    success_url: successUrl,
    cancel_url: cancelUrl,
  }, { idempotencyKey });
};

const createCustomerPortalSession = async (customerId, returnUrl) => {
  requireBilling();
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
};

module.exports = {
  stripe,
  isBillingEnabled,
  BillingDisabledError,
  createCheckoutSession,
  createCustomerPortalSession,
};
