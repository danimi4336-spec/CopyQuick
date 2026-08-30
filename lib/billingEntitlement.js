const FREE_ENTITLEMENT = Object.freeze({ entitled: false, planTier: 'free', monthlyLimit: 10 });
const ENTITLED_STATUSES = new Set(['active', 'trialing']);
const TERMINAL_STATUSES = new Set(['unpaid', 'incomplete', 'incomplete_expired', 'paused', 'canceled', 'deleted']);
const KNOWN_STATUSES = new Set([...ENTITLED_STATUSES, ...TERMINAL_STATUSES, 'past_due']);
const DEFAULT_PAST_DUE_GRACE_HOURS = 72;

class BillingPolicyError extends Error {
  constructor(code) {
    super('Stripe subscription state could not be safely mapped to an entitlement.');
    this.name = 'BillingPolicyError';
    this.code = code;
  }
}

function parseGraceHours(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_PAST_DUE_GRACE_HOURS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 24 * 30) {
    throw new BillingPolicyError('STRIPE_GRACE_CONFIGURATION_INVALID');
  }
  return parsed;
}

function planForPrice(priceId, env = process.env) {
  if (typeof priceId !== 'string' || !priceId) return null;
  if (priceId === env.STRIPE_PRO_PRICE) return { planTier: 'pro', monthlyLimit: 200, priceId };
  if (priceId === env.STRIPE_UNLIMITED_PRICE) return { planTier: 'unlimited', monthlyLimit: 999999, priceId };
  return null;
}

function subscriptionPriceId(subscription) {
  const items = subscription?.items?.data;
  if (!Array.isArray(items) || items.length !== 1) return null;
  return typeof items[0]?.price?.id === 'string' ? items[0].price.id : null;
}

function subscriptionCustomerId(subscription) {
  const customer = subscription?.customer;
  if (typeof customer === 'string' && customer) return customer;
  if (customer && typeof customer === 'object' && !Array.isArray(customer)) {
    if (customer.deleted === true) throw new BillingPolicyError('STRIPE_CUSTOMER_MISSING');
    if (typeof customer.id === 'string' && customer.id) return customer.id;
  }
  throw new BillingPolicyError('STRIPE_CUSTOMER_MISSING');
}

function strictUnixTimestamp(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function strictIsoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function validateStripeSubscription(subscription, { env = process.env, expectedCustomerId, expectedSubscriptionId } = {}) {
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
    throw new BillingPolicyError('STRIPE_RECORD_INCOMPLETE');
  }
  if (typeof subscription.id !== 'string' || !subscription.id) {
    throw new BillingPolicyError('STRIPE_RECORD_INCOMPLETE');
  }
  const customerId = subscriptionCustomerId(subscription);
  if (expectedSubscriptionId && subscription.id !== expectedSubscriptionId) {
    throw new BillingPolicyError('CUSTOMER_SUBSCRIPTION_MISMATCH');
  }
  if (expectedCustomerId && customerId !== expectedCustomerId) {
    throw new BillingPolicyError('CUSTOMER_SUBSCRIPTION_MISMATCH');
  }
  if (typeof subscription.status !== 'string' || !KNOWN_STATUSES.has(subscription.status)) {
    throw new BillingPolicyError('STRIPE_STATUS_UNKNOWN');
  }
  const priceId = subscriptionPriceId(subscription);
  const plan = planForPrice(priceId, env);
  if (!plan) throw new BillingPolicyError(priceId ? 'STRIPE_PRICE_UNKNOWN' : 'STRIPE_RECORD_INCOMPLETE');
  const periodStart = strictUnixTimestamp(subscription.current_period_start);
  const periodEnd = strictUnixTimestamp(subscription.current_period_end);
  if (!periodStart || !periodEnd || periodEnd <= periodStart) {
    throw new BillingPolicyError('STRIPE_RECORD_INCOMPLETE');
  }
  return {
    id: subscription.id,
    customerId,
    status: subscription.status,
    priceId,
    plan,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: strictUnixTimestamp(subscription.canceled_at),
    endedAt: strictUnixTimestamp(subscription.ended_at)
  };
}

function evaluateStripeEntitlement(subscription, {
  env = process.env,
  now = new Date(),
  pastDueSince = null,
  expectedCustomerId,
  expectedSubscriptionId
} = {}) {
  const validated = validateStripeSubscription(subscription, { env, expectedCustomerId, expectedSubscriptionId });
  if (ENTITLED_STATUSES.has(validated.status)) {
    return { ...validated, ...validated.plan, entitled: true, classification: 'entitled', pastDueSince: null };
  }
  if (TERMINAL_STATUSES.has(validated.status)) {
    return { ...validated, ...FREE_ENTITLEMENT, classification: 'not_entitled', pastDueSince: null };
  }
  const start = strictIsoTimestamp(pastDueSince);
  if (!start) {
    return {
      ...validated,
      ...FREE_ENTITLEMENT,
      classification: 'not_entitled',
      pastDueSince: null,
      issueCode: 'STRIPE_PAST_DUE_SINCE_UNKNOWN'
    };
  }
  const observedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(observedAt.getTime()) || start.getTime() > observedAt.getTime()) {
    throw new BillingPolicyError('STRIPE_RECORD_INCOMPLETE');
  }
  const graceHours = parseGraceHours(env.STRIPE_PAST_DUE_GRACE_HOURS);
  const inGrace = observedAt.getTime() - start.getTime() <= graceHours * 60 * 60 * 1000;
  return {
    ...validated,
    ...(inGrace ? validated.plan : FREE_ENTITLEMENT),
    entitled: inGrace,
    classification: inGrace ? 'past_due_grace' : 'not_entitled',
    pastDueSince: start.toISOString(),
    graceExpiresAt: new Date(start.getTime() + graceHours * 60 * 60 * 1000).toISOString()
  };
}

module.exports = {
  BillingPolicyError,
  DEFAULT_PAST_DUE_GRACE_HOURS,
  ENTITLED_STATUSES,
  FREE_ENTITLEMENT,
  TERMINAL_STATUSES,
  evaluateStripeEntitlement,
  parseGraceHours,
  planForPrice,
  subscriptionPriceId,
  subscriptionCustomerId,
  validateStripeSubscription
};
