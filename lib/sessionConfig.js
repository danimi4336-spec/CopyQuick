const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEVELOPMENT_SESSION_SECRET = 'copyquick-development-session-secret';

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function getSessionSecret(env = process.env) {
  const configuredSecret = String(env.SESSION_SECRET || '').trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (isProduction(env)) {
    throw new Error('SESSION_SECRET is required in production.');
  }

  return DEVELOPMENT_SESSION_SECRET;
}

function getSessionSecretStatus(env = process.env) {
  if (String(env.SESSION_SECRET || '').trim()) return 'present';
  return isProduction(env) ? 'missing' : 'using development fallback';
}

function createSessionConfig({ store, env = process.env } = {}) {
  return {
    store,
    secret: getSessionSecret(env),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction(env),
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS
    }
  };
}

module.exports = {
  DEVELOPMENT_SESSION_SECRET,
  SESSION_MAX_AGE_MS,
  createSessionConfig,
  getSessionSecret,
  getSessionSecretStatus,
  isProduction
};
