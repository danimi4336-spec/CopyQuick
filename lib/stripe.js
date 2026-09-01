const Stripe = require('stripe');
const stripeKey = String(process.env.STRIPE_KEY || '').trim();
const isBillingEnabled = Boolean(stripeKey);
const DEFAULT_STRIPE_TIMEOUT_MS = 20 * 1000;
const MAX_STRIPE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_STRIPE_NETWORK_RETRIES = 1;
const MAX_STRIPE_NETWORK_RETRIES = 2;
const STRIPE_IDENTIFIER = /^[A-Za-z0-9_]{3,255}$/;

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

function validateProductionBillingConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return { enabled: Boolean(String(env.STRIPE_KEY || '').trim()) };
  const apiKey = String(env.STRIPE_KEY || '').trim();
  if (!apiKey) throw new Error('Stripe billing configuration error: STRIPE_KEY is required when NODE_ENV=production.');
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  const proPrice = String(env.STRIPE_PRO_PRICE || '').trim();
  const unlimitedPrice = String(env.STRIPE_UNLIMITED_PRICE || '').trim();
  if (!/^whsec_[A-Za-z0-9_]{3,255}$/.test(webhookSecret)) {
    throw new Error('Stripe billing configuration error: STRIPE_WEBHOOK_SECRET is missing or invalid.');
  }
  if (!proPrice.startsWith('price_') || !STRIPE_IDENTIFIER.test(proPrice)) {
    throw new Error('Stripe billing configuration error: STRIPE_PRO_PRICE is missing or invalid.');
  }
  if (!unlimitedPrice.startsWith('price_') || !STRIPE_IDENTIFIER.test(unlimitedPrice)) {
    throw new Error('Stripe billing configuration error: STRIPE_UNLIMITED_PRICE is missing or invalid.');
  }
  if (proPrice === unlimitedPrice) {
    throw new Error('Stripe billing configuration error: configured price identifiers must be distinct.');
  }
  return { enabled: true };
}

function createStripeClient(apiKey, { StripeApi = Stripe, env = process.env } = {}) {
  const key = String(apiKey || '').trim();
  return key ? StripeApi(key, resolveStripeClientConfig(env)) : null;
}

validateProductionBillingConfig(process.env);

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

const createCheckoutSessionWithClient = async (stripeClient, customerEmail, priceId, successUrl, cancelUrl, idempotencyKey, userId, expiresAt, customerId = null) => {
  const userReference = String(userId);
  if (customerId !== null && (typeof customerId !== 'string' || !/^cus_[A-Za-z0-9_]{1,251}$/.test(customerId))) {
    throw new Error('Invalid Stripe customer identifier.');
  }
  return await stripeClient.checkout.sessions.create({
    client_reference_id: userReference,
    ...(customerId ? { customer: customerId } : { customer_email: customerEmail }),
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

const createCheckoutSession = async (customerEmail, priceId, successUrl, cancelUrl, idempotencyKey, userId, expiresAt, customerId = null) => {
  requireBilling();
  return createCheckoutSessionWithClient(
    stripe, customerEmail, priceId, successUrl, cancelUrl, idempotencyKey, userId, expiresAt, customerId
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
  validateProductionBillingConfig,
};
