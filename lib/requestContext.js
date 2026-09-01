const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const requestContext = new AsyncLocalStorage();

function skipCompletionEvent(pathname) {
  return pathname === '/healthz'
    || ['/css/', '/js/', '/images/'].some(prefix => pathname.startsWith(prefix));
}

function currentOperationalContext() {
  return requestContext.getStore() || {};
}

function runWithOperationalContext(values, callback) {
  return requestContext.run({ ...currentOperationalContext(), ...values }, callback);
}

function createRequestContextMiddleware({
  idFactory = crypto.randomUUID,
  now = Date.now,
  logger = () => {}
} = {}) {
  return function requestContextMiddleware(req, res, next) {
    const requestId = idFactory();
    const startedAt = now();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    requestContext.run({ requestId }, function() {
      res.once('finish', function() {
        if (skipCompletionEvent(req.path)) return;
        logger({
          event: 'http_request_completed',
          requestId,
          method: req.method,
          route: req.route?.path || 'unmatched',
          statusCode: res.statusCode,
          durationMs: Math.max(0, now() - startedAt)
        });
      });
      next();
    });
  };
}

module.exports = {
  createRequestContextMiddleware,
  currentOperationalContext,
  runWithOperationalContext,
  skipCompletionEvent
};
