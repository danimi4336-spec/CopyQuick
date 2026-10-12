const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  DEFAULT_LOCAL_DATABASE_PATH,
  prepareDatabaseStorage,
  resolveDatabasePath
} = require('../lib/databasePath');
const {
  TEST_DATABASE_PATH_ENV,
  TEST_DATABASE_ROOT_ENV,
  TEST_PROCESS_TOKEN_ENV,
  TEST_RUN_MARKER_ENV,
  TEST_RUN_MARKER_VALUE,
  TEST_RUN_TOKEN_ENV,
  createTestProcessRoot,
  createTestRunRoot,
  resolveTestDatabasePath
} = require('../lib/testDatabaseIsolation');

const repositoryRoot = path.join(__dirname, '..');

function code(expected) {
  return error => error && error.code === expected;
}

function run() {
  const token = 'security-test-database-isolation-token';
  const root = createTestRunRoot({ token });
  const processToken = 'security-test-process-token';
  const processRoot = createTestProcessRoot({ root, token: processToken });
  const safePath = path.join(processRoot, 'safe.sqlite');
  const base = {
    NODE_ENV: 'test',
    [TEST_RUN_MARKER_ENV]: TEST_RUN_MARKER_VALUE,
    [TEST_DATABASE_ROOT_ENV]: root,
    [TEST_RUN_TOKEN_ENV]: token,
    [TEST_PROCESS_TOKEN_ENV]: processToken,
    [TEST_DATABASE_PATH_ENV]: safePath
  };
  const localDatabaseExistedBefore = fs.existsSync(DEFAULT_LOCAL_DATABASE_PATH);

  try {
    // Guarded TEST_DATABASE_PATH is authoritative even if dangerous inherited variables exist.
    assert.strictEqual(resolveDatabasePath({
      ...base,
      DATABASE_PATH: '/var/data/copyquick.db',
      DATABASE_URL: path.join(os.tmpdir(), 'legacy-test.sqlite')
    }), safePath);
    assert.strictEqual(fs.existsSync(safePath), false, 'path validation must not create the database');

    assert.throws(
      () => resolveDatabasePath({ NODE_ENV: 'test', DATABASE_PATH: '/var/data/copyquick.db', DATABASE_URL: safePath }),
      code('TEST_DATABASE_ISOLATION_REQUIRED')
    );
    assert.strictEqual(fs.existsSync(safePath), false, 'rejected inherited configuration must not create a database');

    assert.throws(
      () => resolveTestDatabasePath({ ...base, DATABASE_PATH: safePath }),
      code('TEST_DATABASE_PATH_CONFLICT')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_PATH_ENV]: '/var/data/copyquick.db' }),
      code('TEST_DATABASE_PATH_PERSISTENT_STORAGE')
    );

    const prohibitedSymlink = path.join(processRoot, 'prohibited-link.sqlite');
    fs.symlinkSync('/var/data/copyquick.db', prohibitedSymlink);
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_PATH_ENV]: prohibitedSymlink }),
      code('TEST_DATABASE_PATH_SYMLINK_UNSAFE')
    );

    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_RUN_MARKER_ENV]: '' }),
      code('TEST_DATABASE_ISOLATION_REQUIRED')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_RUN_MARKER_ENV]: 'forged-test-marker' }),
      code('TEST_DATABASE_ISOLATION_REQUIRED')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_PATH_ENV]: '' }),
      code('TEST_DATABASE_PATH_REQUIRED')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_PATH_ENV]: processRoot }),
      code('TEST_DATABASE_PATH_IS_DIRECTORY')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_PATH_ENV]: path.join(root, 'missing', 'database.sqlite') }),
      code('TEST_DATABASE_PARENT_MISSING')
    );
    assert.throws(
      () => resolveTestDatabasePath({
        ...base,
        [TEST_DATABASE_PATH_ENV]: `${processRoot}${path.sep}..${path.sep}traversal.sqlite`
      }),
      code('TEST_DATABASE_PATH_TRAVERSAL_UNSAFE')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_PATH_ENV]: path.join(os.tmpdir(), 'unowned-copyquick-test.sqlite') }),
      code('TEST_DATABASE_PATH_NOT_OWNED')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_PATH_ENV]: DEFAULT_LOCAL_DATABASE_PATH }),
      code('TEST_DATABASE_PATH_LOCAL_DATABASE')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, PERSISTENT_DATA_DIR: root }),
      code('TEST_DATABASE_PATH_PERSISTENT_STORAGE')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, DATABASE_BACKUP_DIR: processRoot }),
      code('TEST_DATABASE_PATH_PERSISTENT_STORAGE')
    );

    const externalParent = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-external-parent-'));
    const parentLink = path.join(root, 'linked-process-root');
    fs.symlinkSync(externalParent, parentLink);
    try {
      assert.throws(
        () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_PATH_ENV]: path.join(parentLink, 'linked.sqlite') }),
        code('TEST_DATABASE_PATH_NOT_OWNED')
      );
    } finally {
      fs.unlinkSync(parentLink);
      fs.rmSync(externalParent, { recursive: true, force: true });
    }

    const rootLink = path.join(os.tmpdir(), `copyquick-test-root-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(root, rootLink);
    try {
      assert.throws(
        () => resolveTestDatabasePath({ ...base, [TEST_DATABASE_ROOT_ENV]: rootLink }),
        code('TEST_DATABASE_ROOT_INVALID')
      );
    } finally {
      fs.unlinkSync(rootLink);
    }
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_RUN_TOKEN_ENV]: 'incorrect-token' }),
      code('TEST_DATABASE_OWNERSHIP_UNPROVEN')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_RUN_TOKEN_ENV]: '' }),
      code('TEST_DATABASE_OWNERSHIP_UNPROVEN')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_PROCESS_TOKEN_ENV]: 'reused-or-incorrect-token' }),
      code('TEST_DATABASE_PROCESS_OWNERSHIP_UNPROVEN')
    );
    assert.throws(
      () => resolveTestDatabasePath({ ...base, [TEST_PROCESS_TOKEN_ENV]: '' }),
      code('TEST_DATABASE_OWNERSHIP_UNPROVEN')
    );

    fs.chmodSync(root, 0o777);
    try {
      assert.throws(() => resolveTestDatabasePath(base), code('TEST_DATABASE_ROOT_PERMISSIONS_UNSAFE'));
    } finally {
      fs.chmodSync(root, 0o700);
    }

    assert.strictEqual(resolveTestDatabasePath(base), safePath);
    const storage = prepareDatabaseStorage(base);
    assert.strictEqual(storage.databasePath, safePath);
    assert.strictEqual(storage.mode, 'isolated-test');
    assert.strictEqual(fs.existsSync(safePath), false, 'storage preparation must not create SQLite files');

    const simulatedPersistentRoot = path.join(root, 'simulated-persistent');
    fs.mkdirSync(simulatedPersistentRoot, { mode: 0o700 });
    const simulatedProductionPath = path.join(simulatedPersistentRoot, 'copyquick.db');
    const productionSentinel = Buffer.from('not-a-test-database');
    fs.writeFileSync(simulatedProductionPath, productionSentinel);
    const incidentPath = path.join(processRoot, 'incident-regression.sqlite');
    const incident = spawnSync(process.execPath, ['-e', [
      "const { initDb } = require('./db/init');",
      "const { getDb, getDatabaseStorage } = require('./db/database');",
      'initDb();',
      "if (getDatabaseStorage().databasePath !== process.env.TEST_DATABASE_PATH) process.exit(9);",
      'getDb().close();'
    ].join(' ')], {
      cwd: repositoryRoot,
      env: {
        ...base,
        [TEST_DATABASE_PATH_ENV]: incidentPath,
        DATABASE_PATH: simulatedProductionPath,
        DATABASE_URL: path.join(processRoot, 'legacy-incident.sqlite'),
        PERSISTENT_DATA_DIR: simulatedPersistentRoot
      },
      encoding: 'utf8'
    });
    assert.strictEqual(incident.status, 0, incident.stderr);
    assert.strictEqual(fs.existsSync(incidentPath), true, 'the guarded child must initialize only its isolated database');
    assert.deepStrictEqual(fs.readFileSync(simulatedProductionPath), productionSentinel,
      'the inherited production database candidate must remain byte-for-byte unchanged');
    assert.strictEqual(fs.existsSync(path.join(processRoot, 'legacy-incident.sqlite')), false,
      'legacy DATABASE_URL must not be used in guarded test mode');

    const productionPath = path.join(processRoot, 'production-semantics.sqlite');
    assert.strictEqual(resolveDatabasePath({
      NODE_ENV: 'production', DATABASE_PATH: productionPath, PERSISTENT_DATA_DIR: processRoot
    }), productionPath);
    assert.strictEqual(resolveDatabasePath({
      NODE_ENV: 'development', DATABASE_PATH: productionPath, DATABASE_URL: path.join(processRoot, 'ignored.sqlite')
    }), productionPath);

    const directEnvironment = { PATH: process.env.PATH, NODE_ENV: 'test' };
    const directHistorical = spawnSync(process.execPath, ['tests/story-3-258-historical-v1-production-read-compatibility.test.js'], {
      cwd: repositoryRoot,
      env: directEnvironment,
      encoding: 'utf8'
    });
    assert.notStrictEqual(directHistorical.status, 0, 'direct vulnerable-test execution must fail without isolated runner state');
    assert.match(directHistorical.stderr, /isolated repository test runner/);
    assert.strictEqual(fs.existsSync(DEFAULT_LOCAL_DATABASE_PATH), localDatabaseExistedBefore,
      'direct execution must not create or remove the local development database');

    const directBuildPlan = spawnSync(process.execPath, ['tests/story-3-7-build-plan-approval.test.js'], {
      cwd: repositoryRoot,
      env: directEnvironment,
      encoding: 'utf8'
    });
    assert.notStrictEqual(directBuildPlan.status, 0, 'the formerly unconfigured singleton test must fail closed');
    assert.match(directBuildPlan.stderr, /isolated repository test runner/);

    console.log('Security test database isolation tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
