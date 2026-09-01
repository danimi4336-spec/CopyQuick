const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runRepositoryTests } = require('../scripts/run-tests');

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
  const status = runRepositoryTests({
    repositoryRoot: fixture.root,
    testsDirectory: fixture.testsDirectory,
    nodePath: '/pinned/node',
    env: { STORY: '3.72' },
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
  assert.deepStrictEqual(messages, ['Complete repository suite passed (2 files).']);

  const failedCalls = [];
  const failure = runRepositoryTests({
    repositoryRoot: fixture.root,
    testsDirectory: fixture.testsDirectory,
    logger: { log: () => {}, error: () => {} },
    spawnSync: (_executable, args) => {
      failedCalls.push(args[0]);
      return { status: 7 };
    }
  });
  assert.strictEqual(failure, 7);
  assert.strictEqual(failedCalls.length, 1, 'the runner must stop on the first failed test');

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
