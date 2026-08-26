const assert = require('assert');
const fs = require('fs');
const path = require('path');

const databaseModulePath = require.resolve('../db/database');
const initModulePath = require.resolve('../db/init');

const originalEnv = { ...process.env };
const originalConsoleLog = console.log;

function cleanupDatabaseFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch (err) {
      // Temp database file may not exist yet.
    }
  }
}

function resetDatabaseModules() {
  delete require.cache[databaseModulePath];
  delete require.cache[initModulePath];
}

function withCapturedLogs(fn) {
  const logs = [];
  console.log = (...args) => {
    logs.push(args.map(String).join(' '));
  };

  try {
    return fn(logs);
  } finally {
    console.log = originalConsoleLog;
  }
}

function runDatabaseScenario({ nodeEnv, sqlDebug }) {
  resetDatabaseModules();

  const dbPath = path.join('/tmp', `copyquick-bug-002s-${nodeEnv || 'unset'}-${sqlDebug || 'unset'}-${Date.now()}-${Math.random()}.sqlite`);
  cleanupDatabaseFiles(dbPath);

  process.env = {
    ...originalEnv,
    DATABASE_URL: dbPath
  };
  delete process.env.DATABASE_PATH;
  delete process.env.PERSISTENT_DATA_DIR;

  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }

  if (nodeEnv === 'production') {
    process.env.DATABASE_PATH = dbPath;
    process.env.PERSISTENT_DATA_DIR = '/tmp';
  }

  if (sqlDebug === undefined) {
    delete process.env.SQL_DEBUG;
  } else {
    process.env.SQL_DEBUG = sqlDebug;
  }

  return withCapturedLogs((logs) => {
    const { initDb } = require('../db/init');
    const { getDb } = require('../db/database');

    initDb();
    const db = getDb();
    const initLogs = logs.splice(0);

    const markers = {
      email: 'sql-log-email-marker@example.invalid',
      copy: 'SQL_LOG_GENERATED_COPY_MARKER',
      stripe: 'cus_SQL_LOG_STRIPE_MARKER',
      usage: 'SQL_LOG_USAGE_MARKER'
    };

    db.prepare(`
      INSERT INTO users (email, name, stripe_customer_id, generations_used)
      VALUES (?, ?, ?, ?)
    `).run(markers.email, markers.copy, markers.stripe, 7);
    db.prepare('SELECT * FROM users WHERE email = ?').get(markers.email);
    db.prepare('UPDATE users SET name = ? WHERE email = ?').run(markers.usage, markers.email);
    db.prepare('DELETE FROM users WHERE email = ?').run(markers.email);

    const queryBehavior = db.prepare('SELECT ? AS value').get('query-behavior-ok');
    assert.strictEqual(queryBehavior.value, 'query-behavior-ok');
    const queryLogs = [...logs];

    db.close();
    cleanupDatabaseFiles(dbPath);

    return { initLogs, queryLogs, markers };
  });
}

function assertNoSensitiveSqlLogging(logs, markers) {
  const combined = logs.join('\n');

  for (const marker of Object.values(markers)) {
    assert(!combined.includes(marker), `Log output leaked marker: ${marker}`);
  }

  for (const sqlText of ['INSERT', 'SELECT', 'UPDATE', 'DELETE']) {
    assert(!combined.includes(sqlText), `Log output leaked SQL text: ${sqlText}`);
  }
}

function assertNoQueryLogs(queryLogs) {
  assert.strictEqual(queryLogs.length, 0, `Expected sample queries to produce no console.log output, got:\n${queryLogs.join('\n')}`);
}

function run() {
  try {
    const databaseConfig = require('../db/database');

    assert.strictEqual(databaseConfig.isSqlDebugEnabled({ NODE_ENV: 'production', SQL_DEBUG: 'true' }), false);
    assert.deepStrictEqual(databaseConfig.createDatabaseOptions({ NODE_ENV: 'production', SQL_DEBUG: 'true' }), {});
    assert.strictEqual(databaseConfig.isSqlDebugEnabled({ NODE_ENV: 'development', SQL_DEBUG: 'true' }), true);
    assert.strictEqual(typeof databaseConfig.createDatabaseOptions({ NODE_ENV: 'development', SQL_DEBUG: 'true' }).verbose, 'function');
    assert.strictEqual(databaseConfig.isSqlDebugEnabled({ NODE_ENV: 'test' }), false);
    assert.deepStrictEqual(databaseConfig.createDatabaseOptions({ NODE_ENV: 'test' }), {});

    const productionDefault = runDatabaseScenario({ nodeEnv: 'production' });
    assertNoSensitiveSqlLogging([...productionDefault.initLogs, ...productionDefault.queryLogs], productionDefault.markers);
    assertNoQueryLogs(productionDefault.queryLogs);

    const productionDebugFlag = runDatabaseScenario({ nodeEnv: 'production', sqlDebug: 'true' });
    assertNoSensitiveSqlLogging([...productionDebugFlag.initLogs, ...productionDebugFlag.queryLogs], productionDebugFlag.markers);
    assertNoQueryLogs(productionDebugFlag.queryLogs);

    const testDefault = runDatabaseScenario({ nodeEnv: 'test' });
    assertNoSensitiveSqlLogging([...testDefault.initLogs, ...testDefault.queryLogs], testDefault.markers);
    assertNoQueryLogs(testDefault.queryLogs);

    const developmentDebug = runDatabaseScenario({ nodeEnv: 'development', sqlDebug: 'true' });
    assert(developmentDebug.queryLogs.length > 0, 'Expected SQL_DEBUG=true outside production to enable SQL logging');
    assert(developmentDebug.queryLogs.some((line) => line.includes('INSERT')), 'Expected explicit development SQL debug logs to include SQL text');

    console.log('BUG-002S production SQL logging tests passed');
  } finally {
    process.env = originalEnv;
    console.log = originalConsoleLog;
    resetDatabaseModules();
  }
}

run();
