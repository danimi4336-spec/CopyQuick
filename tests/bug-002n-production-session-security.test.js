const assert = require('assert');
const {
  DEVELOPMENT_SESSION_SECRET,
  SESSION_MAX_AGE_MS,
  createSessionConfig,
  getSessionSecret,
  getSessionSecretStatus
} = require('../lib/sessionConfig');

function env(overrides = {}) {
  return { ...overrides };
}

function assertProductionSecretMissing(sessionEnv) {
  assert.throws(
    () => getSessionSecret(sessionEnv),
    /SESSION_SECRET is required in production/
  );
  assert.throws(
    () => createSessionConfig({ env: sessionEnv }),
    /SESSION_SECRET is required in production/
  );
}

function run() {
  assertProductionSecretMissing(env({ NODE_ENV: 'production' }));
  assertProductionSecretMissing(env({ NODE_ENV: 'production', SESSION_SECRET: '' }));
  assertProductionSecretMissing(env({ NODE_ENV: 'production', SESSION_SECRET: '   \t\n   ' }));

  const productionSecret = 'dummy-production-session-secret';
  const productionConfig = createSessionConfig({
    store: 'store-placeholder',
    env: env({ NODE_ENV: 'production', SESSION_SECRET: `  ${productionSecret}  ` })
  });

  assert.strictEqual(productionConfig.secret, productionSecret);
  assert.strictEqual(productionConfig.store, 'store-placeholder');
  assert.strictEqual(productionConfig.resave, false);
  assert.strictEqual(productionConfig.saveUninitialized, false);
  assert.deepStrictEqual(productionConfig.cookie, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS
  });

  const developmentConfig = createSessionConfig({
    env: env({ NODE_ENV: 'development', SESSION_SECRET: '' })
  });
  assert.strictEqual(developmentConfig.secret, DEVELOPMENT_SESSION_SECRET);
  assert.strictEqual(developmentConfig.cookie.httpOnly, true);
  assert.strictEqual(developmentConfig.cookie.secure, false);
  assert.strictEqual(developmentConfig.cookie.sameSite, 'lax');
  assert.strictEqual(developmentConfig.cookie.maxAge, SESSION_MAX_AGE_MS);

  const testConfig = createSessionConfig({
    env: env({ NODE_ENV: 'test', SESSION_SECRET: 'test-session-secret' })
  });
  assert.strictEqual(testConfig.secret, 'test-session-secret');
  assert.strictEqual(testConfig.cookie.secure, false);

  assert.notStrictEqual(DEVELOPMENT_SESSION_SECRET, 'copyquick-secret');
  assert.throws(() => getSessionSecret(env({ NODE_ENV: 'production' })), (err) => {
    assert(!String(err.message).includes(productionSecret));
    return true;
  });

  const configuredStatus = getSessionSecretStatus(env({ SESSION_SECRET: productionSecret }));
  const fallbackStatus = getSessionSecretStatus(env({ SESSION_SECRET: '   ' }));
  const missingProductionStatus = getSessionSecretStatus(env({ NODE_ENV: 'production', SESSION_SECRET: '   ' }));
  assert.strictEqual(configuredStatus, 'present');
  assert.strictEqual(fallbackStatus, 'using development fallback');
  assert.strictEqual(missingProductionStatus, 'missing');
  assert(!configuredStatus.includes(productionSecret));
  assert(!configuredStatus.includes(productionSecret.slice(0, 8)));
  assert(!fallbackStatus.includes(DEVELOPMENT_SESSION_SECRET));

  console.log('BUG-002N production session security tests passed');
}

run();
