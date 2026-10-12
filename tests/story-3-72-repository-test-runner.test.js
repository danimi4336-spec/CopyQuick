const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runRepositoryTests } = require('../scripts/run-tests');
const {
  TEST_DATABASE_PATH_ENV,
  TEST_DATABASE_ROOT_ENV,
  TEST_PROCESS_TOKEN_ENV,
  TEST_RUN_MARKER_ENV,
  TEST_RUN_MARKER_VALUE,
  TEST_RUN_TOKEN_ENV
} = require('../lib/testDatabaseIsolation');

function createFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-test-runner-'));
  const testsDirectory = path.join(root, 'tests');
  fs.mkdirSync(testsDirectory);
  files.forEach(file => fs.writeFileSync(path.join(testsDirectory, file), ''));
  return { root, testsDirectory };
}

function run() {
  const fixture = createFixture(['z-last.test.js', 'notes.txt', 'a-first.test.js']);
  const calls = [];
  const messages = [];
  let processTokenIndex = 0;
  const status = runRepositoryTests({
    repositoryRoot: fixture.root,
    testsDirectory: fixture.testsDirectory,
    nodePath: '/pinned/node',
    env: {
      STORY: '3.72',
      DATABASE_PATH: '/var/data/copyquick.db',
      DATABASE_URL: '/tmp/unsafe-legacy.sqlite',
      PERSISTENT_DATA_DIR: '/var/data',
      DATABASE_BACKUP_DIR: '/var/data/backups',
      [TEST_RUN_MARKER_ENV]: 'forged-inherited-marker',
      [TEST_DATABASE_ROOT_ENV]: '/var/data/forged-test-root',
      [TEST_DATABASE_PATH_ENV]: '/var/data/forged-test.sqlite',
      [TEST_RUN_TOKEN_ENV]: 'forged-inherited-run-token',
      [TEST_PROCESS_TOKEN_ENV]: 'forged-inherited-process-token'
    },
    randomToken: () => 'story-3-72-owned-test-root',
    randomProcessToken: () => `story-3-72-process-${++processTokenIndex}`,
    logger: { log: message => messages.push(message), error: message => messages.push(message) },
    spawnSync: (executable, args, options) => {
      calls.push({ executable, args, options });
      return { status: 0 };
    }
  });
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(calls.map(call => call.args[0]), [
    path.join('tests', 'a-first.test.js'),
    path.join('tests', 'z-last.test.js')
  ]);
  assert(calls.every(call => call.executable === '/pinned/node'));
  assert(calls.every(call => call.options.cwd === fixture.root && call.options.stdio === 'inherit'));
  assert(calls.every(call => call.options.env.NODE_ENV === 'test'));
  assert(calls.every(call => call.options.env[TEST_RUN_MARKER_ENV] === TEST_RUN_MARKER_VALUE));
  assert(calls.every(call => call.options.env[TEST_RUN_TOKEN_ENV] === 'story-3-72-owned-test-root'));
  assert.strictEqual(new Set(calls.map(call => call.options.env[TEST_PROCESS_TOKEN_ENV])).size, 2,
    'every test process must receive a unique ownership token');
  assert(calls.every(call => call.options.env[TEST_DATABASE_ROOT_ENV]));
  assert(calls.every(call => call.options.env[TEST_DATABASE_PATH_ENV]));
  assert.strictEqual(new Set(calls.map(call => call.options.env[TEST_DATABASE_PATH_ENV])).size, 2,
    'every test process must receive a unique database path');
  assert(calls.every(call => !('DATABASE_PATH' in call.options.env)));
  assert(calls.every(call => !('DATABASE_URL' in call.options.env)));
  assert(calls.every(call => !('PERSISTENT_DATA_DIR' in call.options.env)));
  assert(calls.every(call => !('DATABASE_BACKUP_DIR' in call.options.env)));
  assert(calls.every(call => path.basename(call.options.env[TEST_DATABASE_PATH_ENV]) === 'copyquick.test.sqlite'));
  assert.strictEqual(fs.existsSync(calls[0].options.env[TEST_DATABASE_ROOT_ENV]), false,
    'successful suite cleanup must remove the suite-owned root');
  assert.deepStrictEqual(messages, ['Complete repository suite passed (2 files).']);

  const failedCalls = [];
  let failedRoot;
  const failure = runRepositoryTests({
    repositoryRoot: fixture.root,
    testsDirectory: fixture.testsDirectory,
    logger: { log: () => {}, error: () => {} },
    spawnSync: (_executable, args, options) => {
      failedCalls.push(args[0]);
      failedRoot = options.env[TEST_DATABASE_ROOT_ENV];
      return { status: 7 };
    }
  });
  assert.strictEqual(failure, 7);
  assert.strictEqual(failedCalls.length, 1, 'the runner must stop on the first failed test');
  assert.strictEqual(fs.existsSync(failedRoot), false, 'early failure must still remove isolated storage');

  let interruptedRoot;
  const interrupted = runRepositoryTests({
    repositoryRoot: fixture.root,
    testsDirectory: fixture.testsDirectory,
    logger: { log: () => {}, error: () => {} },
    spawnSync: (_executable, _args, options) => {
      interruptedRoot = options.env[TEST_DATABASE_ROOT_ENV];
      return { status: null, signal: 'SIGINT' };
    }
  });
  assert.strictEqual(interrupted, 1);
  assert.strictEqual(fs.existsSync(interruptedRoot), false, 'interrupted children must not leave isolated storage');

  const empty = createFixture(['README.md']);
  const emptyErrors = [];
  assert.strictEqual(runRepositoryTests({
    repositoryRoot: empty.root,
    testsDirectory: empty.testsDirectory,
    logger: { log: () => {}, error: message => emptyErrors.push(message) }
  }), 1);
  assert.deepStrictEqual(emptyErrors, ['No repository test files were found.']);

  fs.rmSync(fixture.root, { recursive: true, force: true });
  fs.rmSync(empty.root, { recursive: true, force: true });
  console.log('Story 3.72 repository test runner tests passed');
}

run();
