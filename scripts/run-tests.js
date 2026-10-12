const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  TEST_DATABASE_PATH_ENV,
  TEST_DATABASE_ROOT_ENV,
  TEST_PROCESS_TOKEN_ENV,
  TEST_RUN_MARKER_ENV,
  TEST_RUN_MARKER_VALUE,
  TEST_RUN_TOKEN_ENV,
  createTestProcessRoot,
  createTestRunRoot,
  removeTestProcessRoot,
  removeTestRunRoot
} = require('../lib/testDatabaseIsolation');

function listTestFiles(testsDirectory) {
  return fs.readdirSync(testsDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => entry.name)
    .sort();
}

function normalizeRequestedTestFiles(requestedFiles, testsDirectory) {
  if (!requestedFiles || !requestedFiles.length) return listTestFiles(testsDirectory);
  return requestedFiles.map(requested => {
    const absolute = path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(path.dirname(testsDirectory), requested);
    const relative = path.relative(testsDirectory, absolute);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !relative.endsWith('.test.js')) {
      throw new Error('Requested test file is outside the repository test directory.');
    }
    if (!fs.statSync(absolute).isFile()) throw new Error('Requested test path is not a file.');
    return relative;
  }).sort();
}

function runRepositoryTests(options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, '..');
  const testsDirectory = options.testsDirectory || path.join(repositoryRoot, 'tests');
  const spawn = options.spawnSync || spawnSync;
  const nodePath = options.nodePath || process.execPath;
  const environment = options.env || process.env;
  const logger = options.logger || console;
  const fsApi = options.fsApi || fs;
  let testFiles;
  try {
    testFiles = normalizeRequestedTestFiles(options.testFiles, testsDirectory);
  } catch (_) {
    logger.error('One or more requested test files are invalid.');
    return 1;
  }

  if (!testFiles.length) {
    logger.error('No repository test files were found.');
    return 1;
  }

  const token = (options.randomToken || (() => crypto.randomBytes(24).toString('hex')))();
  let testRoot;
  try {
    testRoot = createTestRunRoot({ token, fsApi, osApi: options.osApi });
  } catch (error) {
    logger.error(`Unable to establish isolated test storage: ${error.code || 'TEST_DATABASE_ROOT_INVALID'}.`);
    return 1;
  }

  let outcome = 0;
  try {
    for (const testFile of testFiles) {
      const relativePath = path.join('tests', testFile);
      const processToken = (options.randomProcessToken || (() => crypto.randomBytes(24).toString('hex')))();
      const processRoot = createTestProcessRoot({ root: testRoot, token: processToken, fsApi });
      const testDatabasePath = path.join(processRoot, 'copyquick.test.sqlite');
      const childEnvironment = { ...environment };
      for (const key of ['DATABASE_PATH', 'DATABASE_URL', 'PERSISTENT_DATA_DIR', 'DATABASE_BACKUP_DIR']) {
        delete childEnvironment[key];
      }
      Object.assign(childEnvironment, {
        NODE_ENV: 'test',
        [TEST_RUN_MARKER_ENV]: TEST_RUN_MARKER_VALUE,
        [TEST_DATABASE_ROOT_ENV]: testRoot,
        [TEST_DATABASE_PATH_ENV]: testDatabasePath,
        [TEST_RUN_TOKEN_ENV]: token,
        [TEST_PROCESS_TOKEN_ENV]: processToken
      });
      if (['DATABASE_PATH', 'DATABASE_URL', 'PERSISTENT_DATA_DIR', 'DATABASE_BACKUP_DIR']
        .some(key => Object.prototype.hasOwnProperty.call(childEnvironment, key))) {
        logger.error('Unable to sanitize inherited database or persistent-storage configuration.');
        return 1;
      }

      let result;
      try {
        result = spawn(nodePath, [relativePath], {
          cwd: repositoryRoot,
          env: childEnvironment,
          stdio: 'inherit'
        });
      } finally {
        removeTestProcessRoot(processRoot, processToken, fsApi);
      }

      if (result.error) {
        logger.error(`Unable to run ${relativePath}.`);
        outcome = 1;
        break;
      }
      if (result.status !== 0) {
        outcome = Number.isInteger(result.status) ? result.status : 1;
        break;
      }
    }
  } catch (error) {
    logger.error(`Repository test isolation failed: ${error.code || 'TEST_DATABASE_CLEANUP_FAILED'}.`);
    outcome = 1;
  } finally {
    try {
      removeTestRunRoot(testRoot, token, fsApi);
    } catch (error) {
      logger.error(`Unable to remove isolated test storage: ${error.code || 'TEST_DATABASE_CLEANUP_FAILED'}.`);
      outcome = 1;
    }
  }

  if (outcome === 0) logger.log(`Complete repository suite passed (${testFiles.length} files).`);
  return outcome;
}

if (require.main === module) {
  process.exitCode = runRepositoryTests({ testFiles: process.argv.slice(2) });
}

module.exports = { listTestFiles, normalizeRequestedTestFiles, runRepositoryTests };
