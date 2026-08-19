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

const createCheckoutSession = async (customerEmail, priceId, successUrl, cancelUrl) => {
  requireBilling();
  return await stripe.checkout.sessions.create({
    customer_email: customerEmail,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
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
