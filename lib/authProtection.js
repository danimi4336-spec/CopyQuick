const { requestPrefersJson } = require('./errorHandler');

const AUTH_LIMIT_ERROR = 'Too many attempts. Please try again later.';
const LOGIN_FAILURE_ERROR = 'Invalid email or password.';
const SIGNUP_FAILURE_ERROR = 'Email already exists or invalid data.';
const AUTH_VALIDATION_ERROR = 'Please check your details and try again.';

const AUTH_FIELD_LIMITS = {
  name: 120,
  email: 254,
  password: 1024
};

function normalizeAuthText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
  return normalizeAuthText(value).toLowerCase();
}

function hasControlCharacters(value) {
  return /[\r\n]/.test(String(value || ''));
}

function isValidAuthEmail(email) {
  if (!email || email.length > AUTH_FIELD_LIMITS.email || hasControlCharacters(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateLoginInput(body = {}) {
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const errors = [];

  if (!isValidAuthEmail(email)) errors.push('email_invalid');
  if (!password.trim()) errors.push('password_required');
  if (password.length > AUTH_FIELD_LIMITS.password) errors.push('password_too_long');
  if (hasControlCharacters(password)) errors.push('password_invalid');

  return {
    ok: errors.length === 0,
    credentials: { email, password },
    errors
  };
}

function validateSignupInput(body = {}) {
  const name = normalizeAuthText(body.name);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const errors = [];

  if (!name) errors.push('name_required');
  if (!isValidAuthEmail(email)) errors.push('email_invalid');
  if (!password.trim()) errors.push('password_required');
  if (name.length > AUTH_FIELD_LIMITS.name) errors.push('name_too_long');
  if (password.length > AUTH_FIELD_LIMITS.password) errors.push('password_too_long');
  if (hasControlCharacters(name)) errors.push('name_invalid');
  if (hasControlCharacters(password)) errors.push('password_invalid');

  return {
    ok: errors.length === 0,
    signup: { name, email, password },
    errors
  };
}

function sendAuthFailure(req, res, { statusCode = 400, view, title, currentPage, message }) {
  res.status(statusCode);

  if (requestPrefersJson(req)) {
    return res.json({ error: message });
  }

  return res.render(view, {
    title,
    error: message,
    currentPage
  });
}

function createExpiringBucketStore({ windowMs, maxKeys = 10000, now = () => Date.now() }) {
  const buckets = new Map();

  function prune(currentTime = now()) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= currentTime) {
        buckets.delete(key);
      }
    }

    if (buckets.size <= maxKeys) return;

    const overflow = buckets.size - maxKeys;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  function get(key) {
    const currentTime = now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= currentTime) {
      if (bucket) buckets.delete(key);
      return { count: 0, resetAt: currentTime + windowMs };
    }
    return bucket;
  }

  function increment(key) {
    const bucket = get(key);
    bucket.count += 1;
    buckets.set(key, bucket);
    prune();
    return bucket;
  }

  function isLimited(key, max) {
    return get(key).count >= max;
  }

  function reset(key) {
    buckets.delete(key);
  }

  return {
    buckets,
    get,
    increment,
    isLimited,
    prune,
    reset
  };
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function createLoginRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const maxIpFailures = options.maxIpFailures || 20;
  const maxEmailFailures = options.maxEmailFailures || 8;
  // Buckets are intentionally in-memory and per-process; expired keys are pruned on writes.
  const ipStore = createExpiringBucketStore({ windowMs, maxKeys: options.maxIpKeys, now: options.now });
  const emailStore = createExpiringBucketStore({ windowMs, maxKeys: options.maxEmailKeys, now: options.now });

  function middleware(req, res, next) {
    const validation = validateLoginInput(req.body);
    if (!validation.ok) {
      return sendAuthFailure(req, res, {
        statusCode: 400,
        view: 'login',
        title: 'Login - CopyQuick',
        currentPage: 'login',
        message: LOGIN_FAILURE_ERROR
      });
    }

    const ipKey = `ip:${getClientIp(req)}`;
    const emailKey = `email:${validation.credentials.email}`;
    if (ipStore.isLimited(ipKey, maxIpFailures) || emailStore.isLimited(emailKey, maxEmailFailures)) {
      return sendAuthFailure(req, res, {
        statusCode: 429,
        view: 'login',
        title: 'Login - CopyQuick',
        currentPage: 'login',
        message: AUTH_LIMIT_ERROR
      });
    }

    req.authLogin = {
      ...validation.credentials,
      ipKey,
      emailKey
    };
    return next();
  }

  function recordFailure(req) {
    if (!req.authLogin) return;
    ipStore.increment(req.authLogin.ipKey);
    emailStore.increment(req.authLogin.emailKey);
  }

  function recordSuccess(req) {
    if (!req.authLogin) return;
    emailStore.reset(req.authLogin.emailKey);
  }

  return {
    emailStore,
    ipStore,
    middleware,
    recordFailure,
    recordSuccess
  };
}

function createSignupRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 60 * 1000;
  const maxAttempts = options.maxAttempts || 10;
  // Buckets are intentionally in-memory and per-process; expired keys are pruned on writes.
  const ipStore = createExpiringBucketStore({ windowMs, maxKeys: options.maxIpKeys, now: options.now });

  return function signupRateLimiter(req, res, next) {
    const validation = validateSignupInput(req.body);
    if (!validation.ok) {
      return sendAuthFailure(req, res, {
        statusCode: 400,
        view: 'signup',
        title: 'Sign Up - CopyQuick',
        currentPage: 'signup',
        message: AUTH_VALIDATION_ERROR
      });
    }

    const ipKey = `ip:${getClientIp(req)}`;
    if (ipStore.isLimited(ipKey, maxAttempts)) {
      return sendAuthFailure(req, res, {
        statusCode: 429,
        view: 'signup',
        title: 'Sign Up - CopyQuick',
        currentPage: 'signup',
        message: AUTH_LIMIT_ERROR
      });
    }

    ipStore.increment(ipKey);
    req.authSignup = validation.signup;
    return next();
  };
}

module.exports = {
  AUTH_FIELD_LIMITS,
  AUTH_LIMIT_ERROR,
  AUTH_VALIDATION_ERROR,
  LOGIN_FAILURE_ERROR,
  SIGNUP_FAILURE_ERROR,
  createExpiringBucketStore,
  createLoginRateLimiter,
  createSignupRateLimiter,
  normalizeEmail,
  validateLoginInput,
  validateSignupInput
};
