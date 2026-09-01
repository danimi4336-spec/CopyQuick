const PUBLIC_APP_ORIGIN_ERROR = 'PUBLIC_APP_ORIGIN must be an absolute application origin.';

function parseConfiguredOrigin(value, { production = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch (err) {
    throw new Error(PUBLIC_APP_ORIGIN_ERROR);
  }

  const validProtocol = parsed.protocol === 'https:' || (!production && parsed.protocol === 'http:');
  const isOriginOnly = parsed.pathname === '/' && !parsed.search && !parsed.hash;
  if (!validProtocol || !parsed.hostname || parsed.username || parsed.password || !isOriginOnly) {
    throw new Error(PUBLIC_APP_ORIGIN_ERROR);
  }

  return parsed.origin;
}

function getPublicAppOrigin({ env = process.env, req } = {}) {
  const configured = String(env.PUBLIC_APP_ORIGIN || '').trim();
  const production = env.NODE_ENV === 'production';
  if (configured) return parseConfiguredOrigin(configured, { production });

  if (production) {
    throw new Error('PUBLIC_APP_ORIGIN is required for production billing redirects.');
  }

  if (!req) return null;
  return parseConfiguredOrigin(`${req.protocol}://${req.get('host')}`);
}

function validateBillingReturnOrigin(env = process.env) {
  const billingEnabled = Boolean(String(env.STRIPE_KEY || '').trim());
  if (env.NODE_ENV !== 'production' || !billingEnabled) return;
  getPublicAppOrigin({ env });
}

module.exports = {
  PUBLIC_APP_ORIGIN_ERROR,
  getPublicAppOrigin,
  parseConfiguredOrigin,
  validateBillingReturnOrigin
};
