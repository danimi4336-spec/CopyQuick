const Stripe = require('stripe');
const stripeKey = String(process.env.STRIPE_KEY || '').trim();
const isBillingEnabled = Boolean(stripeKey);
const DEFAULT_STRIPE_TIMEOUT_MS = 20 * 1000;
const MAX_STRIPE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_STRIPE_NETWORK_RETRIES = 1;
const MAX_STRIPE_NETWORK_RETRIES = 2;

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function resolveStripeClientConfig(env = process.env) {
  return Object.freeze({
    timeout: boundedInteger(env.STRIPE_API_TIMEOUT_MS, DEFAULT_STRIPE_TIMEOUT_MS, 1000, MAX_STRIPE_TIMEOUT_MS),
    maxNetworkRetries: boundedInteger(
      env.STRIPE_API_MAX_NETWORK_RETRIES,
      DEFAULT_STRIPE_NETWORK_RETRIES,
      0,
      MAX_STRIPE_NETWORK_RETRIES
    )
  });
}

function createStripeClient(apiKey, { StripeApi = Stripe, env = process.env } = {}) {
  const key = String(apiKey || '').trim();
  return key ? StripeApi(key, resolveStripeClientConfig(env)) : null;
}

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

const stripeClientConfig = resolveStripeClientConfig();
const stripe = createStripeClient(stripeKey);

function requireBilling() {
  if (!isBillingEnabled) throw new BillingDisabledError();
}

const createCheckoutSessionWithClient = async (stripeClient, customerEmail, priceId, successUrl, cancelUrl, idempotencyKey, userId, expiresAt) => {
  const userReference = String(userId);
  return await stripeClient.checkout.sessions.create({
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
    expires_at: expiresAt,
    subscription_data: { metadata: { copyquick_user_id: userReference } },
    success_url: successUrl,
    cancel_url: cancelUrl,
  }, { idempotencyKey });
};

const createCheckoutSession = async (customerEmail, priceId, successUrl, cancelUrl, idempotencyKey, userId, expiresAt) => {
  requireBilling();
  return createCheckoutSessionWithClient(
    stripe, customerEmail, priceId, successUrl, cancelUrl, idempotencyKey, userId, expiresAt
  );
};

const createCustomerPortalSession = async (customerId, returnUrl) => {
  requireBilling();
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
};

const retrieveCheckoutSession = async (sessionId) => {
  requireBilling();
  return stripe.checkout.sessions.retrieve(sessionId);
};

module.exports = {
  DEFAULT_STRIPE_NETWORK_RETRIES,
  DEFAULT_STRIPE_TIMEOUT_MS,
  MAX_STRIPE_NETWORK_RETRIES,
  MAX_STRIPE_TIMEOUT_MS,
  stripe,
  stripeClientConfig,
  isBillingEnabled,
  BillingDisabledError,
  createStripeClient,
  createCheckoutSession,
  createCheckoutSessionWithClient,
  createCustomerPortalSession,
  retrieveCheckoutSession,
  resolveStripeClientConfig,
};
