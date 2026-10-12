const fs = require('fs');
const path = require('path');
const {
  TEST_DATABASE_PATH_ENV,
  TEST_DATABASE_ROOT_ENV,
  TEST_PROCESS_TOKEN_ENV,
  TEST_RUN_MARKER_ENV,
  TEST_RUN_TOKEN_ENV,
  requireIsolatedTestDatabase
} = require('../../lib/testDatabaseIsolation');

function assertIsolatedTestDatabase() {
  return requireIsolatedTestDatabase(process.env);
}

function isolatedTestProcessRoot() {
  return path.dirname(assertIsolatedTestDatabase());
}

function createIsolatedTestDirectory(prefix = 'fixture-') {
  return fs.mkdtempSync(path.join(isolatedTestProcessRoot(), prefix));
}

function isolatedTestEnvironment(databasePath, overrides = {}) {
  const env = { ...process.env };
  for (const key of ['DATABASE_PATH', 'DATABASE_URL', 'PERSISTENT_DATA_DIR']) delete env[key];
  const safeOverrides = { ...overrides };
  for (const key of [
    'DATABASE_PATH', 'DATABASE_URL', 'PERSISTENT_DATA_DIR', TEST_DATABASE_PATH_ENV,
    TEST_DATABASE_ROOT_ENV, TEST_PROCESS_TOKEN_ENV, TEST_RUN_MARKER_ENV, TEST_RUN_TOKEN_ENV
  ]) delete safeOverrides[key];
  Object.assign(env, safeOverrides, { NODE_ENV: 'test', [TEST_DATABASE_PATH_ENV]: path.resolve(databasePath) });
  requireIsolatedTestDatabase(env);
  return env;
}

module.exports = {
  assertIsolatedTestDatabase,
  createIsolatedTestDirectory,
  isolatedTestEnvironment,
  isolatedTestProcessRoot
};
