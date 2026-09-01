const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again later.';
const { writeOperationalEvent } = require('./operationalLogger');

function getErrorStatus(err, res) {
  const status = Number(err?.statusCode || err?.status || res?.statusCode);
  return status >= 400 && status < 600 ? status : 500;
}

function requestPrefersJson(req) {
  if (req.xhr) return true;
  if (typeof req.is === 'function' && req.is('json')) return true;
  if (String(req.headers?.['content-type'] || '').includes('application/json')) return true;

  const accepted = typeof req.accepts === 'function' ? req.accepts(['html', 'json']) : null;
  if (accepted) return accepted === 'json';

  return String(req.headers?.accept || '').includes('application/json');
}

function logServerError(err, req, statusCode, logger = writeOperationalEvent) {
  const code = err?.type === 'entity.too.large'
    ? 'REQUEST_BODY_TOO_LARGE'
    : err?.type === 'parameters.too.many'
      ? 'TOO_MANY_FORM_PARAMETERS'
      : (typeof err?.code === 'string' ? err.code : 'UNHANDLED_REQUEST_ERROR');
  logger({
    event: 'http_request_failed',
    requestId: req.requestId,
    method: req.method,
    route: req.route?.path || 'unmatched',
    statusCode,
    code
  });
}

function createGlobalErrorHandler(options = {}) {
  const getNodeEnv = options.getNodeEnv || (() => process.env.NODE_ENV);
  const logger = options.logger || writeOperationalEvent;

  return function globalErrorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    const statusCode = getErrorStatus(err, res);
    const isProduction = getNodeEnv() === 'production';
    const message = isProduction ? GENERIC_ERROR_MESSAGE : (err?.message || 'Internal server error');
    const stack = isProduction ? null : err?.stack;

    logServerError(err, req, statusCode, logger);
    res.status(statusCode);

    if (requestPrefersJson(req)) {
      const payload = { error: message };
      if (req.requestId) payload.requestId = req.requestId;
      if (!isProduction && stack) payload.stack = stack;
      return res.json(payload);
    }

    const stackHtml = !isProduction && stack
      ? `<hr><pre style="font-size:0.8rem;color:#999;overflow:auto">${escapeHtml(stack.split('\n').slice(0, 5).join('\n'))}</pre>`
      : '';

    const reference = req.requestId ? `<p style="color:#666">Reference: ${escapeHtml(req.requestId)}</p>` : '';
    return res.send(`<html><body style="font-family:system-ui;padding:2rem;max-width:600px"><h2>Something went wrong</h2><p style="color:#666">${escapeHtml(message)}</p>${reference}${stackHtml}</body></html>`);
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  GENERIC_ERROR_MESSAGE,
  createGlobalErrorHandler,
  getErrorStatus,
  logServerError,
  requestPrefersJson
};
