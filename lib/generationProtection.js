const { createExpiringBucketStore } = require('./authProtection');
const { requestPrefersJson } = require('./errorHandler');
const { writeOperationalEvent } = require('./operationalLogger');

const GENERATION_RATE_LIMIT_ERROR = 'Too many generation requests. Please wait a moment and try again.';
const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_ACTIONS = 12;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function authenticatedUserKey(req) {
  const userId = req.session?.userId || req.session?.passport?.user || req.user?.id;
  return `user:${String(userId || 'unknown')}`;
}

function createGenerationActionRateLimiter({
  windowMs = process.env.AI_ACTION_RATE_LIMIT_WINDOW_MS,
  maxActions = process.env.AI_ACTION_RATE_LIMIT_PER_WINDOW,
  maxKeys = 10000,
  now = () => Date.now(),
  logger = writeOperationalEvent
} = {}) {
  const boundedWindowMs = positiveInteger(windowMs, DEFAULT_WINDOW_MS);
  const boundedMaxActions = positiveInteger(maxActions, DEFAULT_MAX_ACTIONS);
  const store = createExpiringBucketStore({ windowMs: boundedWindowMs, maxKeys, now });

  function authenticatedGenerationRateLimit(req, res, next) {
    const key = authenticatedUserKey(req);
    const bucket = store.get(key);
    if (bucket.count >= boundedMaxActions) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      logger({
        event: 'generation_rate_limited',
        requestId: req.requestId,
        code: 'GENERATION_RATE_LIMITED'
      });
      res.status(429);
      if (requestPrefersJson(req)) {
        return res.json({ error: GENERATION_RATE_LIMIT_ERROR, code: 'GENERATION_RATE_LIMITED' });
      }
      return res.render('error', {
        title: 'Please Wait - CopyQuick',
        currentPage: 'dashboard',
        message: GENERATION_RATE_LIMIT_ERROR
      });
    }
    store.increment(key);
    return next();
  }

  return {
    middleware: authenticatedGenerationRateLimit,
    store,
    config: Object.freeze({ windowMs: boundedWindowMs, maxActions: boundedMaxActions })
  };
}

const defaultGenerationActionRateLimiter = createGenerationActionRateLimiter();

module.exports = {
  DEFAULT_MAX_ACTIONS,
  DEFAULT_WINDOW_MS,
  GENERATION_RATE_LIMIT_ERROR,
  authenticatedUserKey,
  createGenerationActionRateLimiter,
  generationActionRateLimit: defaultGenerationActionRateLimiter.middleware
};
