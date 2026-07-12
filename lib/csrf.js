const crypto = require('crypto');
const { requestPrefersJson } = require('./errorHandler');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_ERROR_MESSAGE = 'Invalid CSRF token';

function base64Url(buffer) {
  return buffer.toString('base64url');
}

function ensureCsrfSecret(req) {
  if (!req.session) return null;
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = base64Url(crypto.randomBytes(32));
  }
  return req.session.csrfSecret;
}

function createToken(secret) {
  const nonce = base64Url(crypto.randomBytes(24));
  const digest = crypto
    .createHmac('sha256', secret)
    .update(nonce)
    .digest('base64url');
  return `${nonce}.${digest}`;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isValidToken(secret, token) {
  if (!secret || !token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

  const expectedDigest = crypto
    .createHmac('sha256', secret)
    .update(parts[0])
    .digest('base64url');

  return timingSafeEqual(parts[1], expectedDigest);
}

function getSubmittedToken(req) {
  return req.get('X-CSRF-Token') || req.body?._csrf || null;
}

function sendCsrfFailure(req, res) {
  res.status(403);

  if (requestPrefersJson(req)) {
    return res.json({ error: CSRF_ERROR_MESSAGE });
  }

  return res.send('<!DOCTYPE html><html><body><h1>Forbidden</h1><p>Invalid request. Please go back and try again.</p></body></html>');
}

function createCsrfProtection() {
  return function csrfProtection(req, res, next) {
    const secret = ensureCsrfSecret(req);

    req.csrfToken = function csrfToken() {
      return secret ? createToken(secret) : '';
    };
    res.locals.csrfToken = req.csrfToken();

    if (SAFE_METHODS.has(req.method)) return next();

    const token = getSubmittedToken(req);
    if (!isValidToken(secret, token)) {
      return sendCsrfFailure(req, res);
    }

    return next();
  };
}

module.exports = {
  CSRF_ERROR_MESSAGE,
  createCsrfProtection,
  isValidToken
};
