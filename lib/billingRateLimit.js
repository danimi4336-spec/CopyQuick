const { createExpiringBucketStore } = require('./authProtection');
const { authenticatedUserKey } = require('./generationProtection');
const { writeOperationalEvent } = require('./operationalLogger');

const DEFAULT_BILLING_WINDOW_MS = 60 * 1000;
const DEFAULT_BILLING_MAX_ACTIONS = 12;
const MAX_BILLING_ACTIONS = 100;
const MIN_BILLING_WINDOW_MS = 10 * 1000;
const MAX_BILLING_WINDOW_MS = 60 * 60 * 1000;
const BILLING_RATE_LIMIT_ERROR = 'Too many billing requests. Please wait a moment and try again.';

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function createBillingActionRateLimiter({
  windowMs = process.env.BILLING_ACTION_RATE_LIMIT_WINDOW_MS,
  maxActions = process.env.BILLING_ACTION_RATE_LIMIT_PER_WINDOW,
  maxKeys = 10000,
  now = () => Date.now(),
  logger = writeOperationalEvent
} = {}) {
  const boundedWindowMs = boundedInteger(windowMs, DEFAULT_BILLING_WINDOW_MS, MIN_BILLING_WINDOW_MS, MAX_BILLING_WINDOW_MS);
  const boundedMaxActions = boundedInteger(maxActions, DEFAULT_BILLING_MAX_ACTIONS, 1, MAX_BILLING_ACTIONS);
  const store = createExpiringBucketStore({ windowMs: boundedWindowMs, maxKeys, now });

  function billingActionRateLimit(req, res, next) {
    const bucket = store.get(authenticatedUserKey(req));
    if (bucket.count >= boundedMaxActions) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now()) / 1000))));
      logger({ event: 'billing_action_rate_limited', requestId: req.requestId, code: 'BILLING_ACTION_RATE_LIMITED' });
      return res.status(429).send(BILLING_RATE_LIMIT_ERROR);
    }
    store.increment(authenticatedUserKey(req));
    return next();
  }

  return {
    middleware: billingActionRateLimit,
    store,
    config: Object.freeze({ windowMs: boundedWindowMs, maxActions: boundedMaxActions })
  };
}

const defaultBillingActionRateLimiter = createBillingActionRateLimiter();

module.exports = {
  BILLING_RATE_LIMIT_ERROR,
  DEFAULT_BILLING_MAX_ACTIONS,
  DEFAULT_BILLING_WINDOW_MS,
  MAX_BILLING_ACTIONS,
  MAX_BILLING_WINDOW_MS,
  MIN_BILLING_WINDOW_MS,
  billingActionRateLimit: defaultBillingActionRateLimiter.middleware,
  createBillingActionRateLimiter
};
