const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DATABASE_PATH_ENV = 'TEST_DATABASE_PATH';
const TEST_DATABASE_ROOT_ENV = 'COPYQUICK_TEST_DATABASE_ROOT';
const TEST_RUN_MARKER_ENV = 'COPYQUICK_INTERNAL_TEST_RUN';
const TEST_RUN_MARKER_VALUE = 'isolated-repository-test-v1';
const TEST_RUN_TOKEN_ENV = 'COPYQUICK_TEST_RUN_TOKEN';
const TEST_PROCESS_TOKEN_ENV = 'COPYQUICK_TEST_PROCESS_TOKEN';
const TEST_ROOT_SENTINEL = '.copyquick-test-root';
const TEST_PROCESS_SENTINEL = '.copyquick-test-process';
const DEFAULT_PERSISTENT_DATA_DIR = '/var/data';

class TestDatabaseIsolationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TestDatabaseIsolationError';
    this.code = code;
  }
}

function configuredValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isWithinDirectory(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function canonicalPath(candidate, fsApi = fs) {
  const absolute = path.resolve(candidate);
  let existing = absolute;
  const remainder = [];

  while (!fsApi.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    remainder.unshift(path.basename(existing));
    existing = parent;
  }

  const base = fsApi.realpathSync(existing);
  return path.join(base, ...remainder);
}

function isolationError(code, message) {
  return new TestDatabaseIsolationError(message, code);
}

function lstatIfPresent(candidate, fsApi = fs) {
  try {
    return fsApi.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertSecureOwnedRoot(root, token, fsApi = fs) {
  let rootStats;
  try {
    rootStats = fsApi.lstatSync(root);
  } catch (_) {
    throw isolationError('TEST_DATABASE_ROOT_INVALID', 'Test database isolation failed: the test-owned root is unavailable.');
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw isolationError('TEST_DATABASE_ROOT_INVALID', 'Test database isolation failed: the test-owned root is invalid.');
  }
  if (typeof process.getuid === 'function' && Number.isInteger(rootStats.uid) && rootStats.uid !== process.getuid()) {
    throw isolationError('TEST_DATABASE_ROOT_NOT_OWNED', 'Test database isolation failed: the test-owned root has the wrong owner.');
  }
  if ((rootStats.mode & 0o022) !== 0) {
    throw isolationError('TEST_DATABASE_ROOT_PERMISSIONS_UNSAFE', 'Test database isolation failed: the test-owned root permissions are unsafe.');
  }

  const sentinel = path.join(root, TEST_ROOT_SENTINEL);
  let sentinelStats;
  let sentinelValue;
  try {
    sentinelStats = fsApi.lstatSync(sentinel);
    sentinelValue = fsApi.readFileSync(sentinel, 'utf8');
  } catch (_) {
    throw isolationError('TEST_DATABASE_OWNERSHIP_UNPROVEN', 'Test database isolation failed: test ownership could not be proven.');
  }
  if (!sentinelStats.isFile() || sentinelStats.isSymbolicLink() || sentinelValue !== token
      || (typeof process.getuid === 'function' && Number.isInteger(sentinelStats.uid) && sentinelStats.uid !== process.getuid())
      || (sentinelStats.mode & 0o022) !== 0) {
    throw isolationError('TEST_DATABASE_OWNERSHIP_UNPROVEN', 'Test database isolation failed: test ownership could not be proven.');
  }
}

function assertSecureOwnedProcessRoot(processRoot, token, fsApi = fs) {
  let processStats;
  let sentinelStats;
  let sentinelValue;
  try {
    processStats = fsApi.lstatSync(processRoot);
    const sentinel = path.join(processRoot, TEST_PROCESS_SENTINEL);
    sentinelStats = fsApi.lstatSync(sentinel);
    sentinelValue = fsApi.readFileSync(sentinel, 'utf8');
  } catch (_) {
    throw isolationError('TEST_DATABASE_PROCESS_OWNERSHIP_UNPROVEN', 'Test database isolation failed: process ownership could not be proven.');
  }
  if (!processStats.isDirectory() || processStats.isSymbolicLink()
      || (typeof process.getuid === 'function' && Number.isInteger(processStats.uid) && processStats.uid !== process.getuid())
      || (processStats.mode & 0o022) !== 0
      || !sentinelStats.isFile() || sentinelStats.isSymbolicLink() || sentinelValue !== token
      || (typeof process.getuid === 'function' && Number.isInteger(sentinelStats.uid) && sentinelStats.uid !== process.getuid())
      || (sentinelStats.mode & 0o022) !== 0) {
    throw isolationError('TEST_DATABASE_PROCESS_OWNERSHIP_UNPROVEN', 'Test database isolation failed: process ownership could not be proven.');
  }
}

function resolveTestDatabasePath(env = process.env, fsApi = fs) {
  if (env.NODE_ENV !== 'test' || configuredValue(env[TEST_RUN_MARKER_ENV]) !== TEST_RUN_MARKER_VALUE) {
    throw isolationError('TEST_DATABASE_ISOLATION_REQUIRED', 'Test database initialization requires the isolated repository test runner.');
  }

  const requested = configuredValue(env[TEST_DATABASE_PATH_ENV]);
  const configuredRoot = configuredValue(env[TEST_DATABASE_ROOT_ENV]);
  const token = configuredValue(env[TEST_RUN_TOKEN_ENV]);
  const processToken = configuredValue(env[TEST_PROCESS_TOKEN_ENV]);
  if (!requested) {
    throw isolationError('TEST_DATABASE_PATH_REQUIRED', 'Test database initialization requires TEST_DATABASE_PATH.');
  }
  if (!configuredRoot || !token || !processToken) {
    throw isolationError('TEST_DATABASE_OWNERSHIP_UNPROVEN', 'Test database isolation failed: test ownership could not be proven.');
  }

  const requestedRoot = path.resolve(configuredRoot);
  const requestedRootStats = lstatIfPresent(requestedRoot, fsApi);
  if (requestedRootStats && requestedRootStats.isSymbolicLink()) {
    throw isolationError('TEST_DATABASE_ROOT_INVALID', 'Test database isolation failed: the test-owned root is invalid.');
  }
  const root = canonicalPath(requestedRoot, fsApi);
  assertSecureOwnedRoot(root, token, fsApi);

  if (requested.split(/[\\/]+/).includes('..')) {
    throw isolationError('TEST_DATABASE_PATH_TRAVERSAL_UNSAFE', 'Test database isolation rejected a traversing database path.');
  }
  const requestedAbsolute = path.resolve(requested);
  const requestedStats = lstatIfPresent(requestedAbsolute, fsApi);
  if (requestedStats) {
    if (requestedStats.isSymbolicLink()) {
      throw isolationError('TEST_DATABASE_PATH_SYMLINK_UNSAFE', 'Test database isolation rejected a symbolic-link database path.');
    }
    if (requestedStats.isDirectory()) {
      throw isolationError('TEST_DATABASE_PATH_IS_DIRECTORY', 'Test database isolation rejected a directory database path.');
    }
    if (!requestedStats.isFile()) {
      throw isolationError('TEST_DATABASE_PATH_INVALID', 'Test database isolation rejected an invalid database path.');
    }
  }

  const databasePath = canonicalPath(requestedAbsolute, fsApi);
  const defaultLocalPath = canonicalPath(path.join(__dirname, '..', 'db', 'copyquick.db'), fsApi);
  if (databasePath === defaultLocalPath) {
    throw isolationError('TEST_DATABASE_PATH_LOCAL_DATABASE', 'Test database isolation rejected the normal local development database.');
  }

  const persistentRoots = new Set([
    canonicalPath(DEFAULT_PERSISTENT_DATA_DIR, fsApi),
    canonicalPath(configuredValue(env.PERSISTENT_DATA_DIR) || DEFAULT_PERSISTENT_DATA_DIR, fsApi),
    ...[configuredValue(env.DATABASE_BACKUP_DIR)].filter(Boolean).map(value => canonicalPath(value, fsApi))
  ]);
  for (const persistentRoot of persistentRoots) {
    if (databasePath === persistentRoot || isWithinDirectory(databasePath, persistentRoot)) {
      throw isolationError('TEST_DATABASE_PATH_PERSISTENT_STORAGE', 'Test database isolation rejected a persistent-storage path.');
    }
  }

  const conflictingPaths = [
    configuredValue(env.DATABASE_PATH),
    ...[...persistentRoots].map(persistentRoot => path.join(persistentRoot, 'copyquick.db'))
  ].filter(Boolean).map(value => canonicalPath(value, fsApi));
  if (conflictingPaths.includes(databasePath)) {
    throw isolationError('TEST_DATABASE_PATH_CONFLICT', 'Test database isolation rejected a production database path conflict.');
  }

  const parentDirectory = path.dirname(databasePath);
  let parentStats;
  try {
    parentStats = fsApi.statSync(parentDirectory);
  } catch (_) {
    throw isolationError('TEST_DATABASE_PARENT_MISSING', 'Test database isolation requires an existing test-owned parent directory.');
  }
  if (!parentStats.isDirectory()) {
    throw isolationError('TEST_DATABASE_PARENT_INVALID', 'Test database isolation rejected an invalid parent directory.');
  }
  if (!isWithinDirectory(databasePath, root)) {
    throw isolationError('TEST_DATABASE_PATH_NOT_OWNED', 'Test database isolation rejected a path outside the test-owned root.');
  }
  const relativeParts = path.relative(root, databasePath).split(path.sep).filter(Boolean);
  const processRoot = relativeParts.length > 1 ? path.join(root, relativeParts[0]) : null;
  if (!processRoot || !isWithinDirectory(databasePath, processRoot)) {
    throw isolationError('TEST_DATABASE_PROCESS_OWNERSHIP_UNPROVEN', 'Test database isolation failed: process ownership could not be proven.');
  }
  assertSecureOwnedProcessRoot(processRoot, processToken, fsApi);

  try {
    fsApi.accessSync(parentDirectory, fs.constants.R_OK | fs.constants.W_OK);
    if (fsApi.existsSync(databasePath)) fsApi.accessSync(databasePath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (_) {
    throw isolationError('TEST_DATABASE_PATH_NOT_WRITABLE', 'Test database isolation rejected an inaccessible test database path.');
  }

  return databasePath;
}

function requireIsolatedTestDatabase(env = process.env, fsApi = fs) {
  return resolveTestDatabasePath(env, fsApi);
}

function createTestRunRoot(options = {}) {
  const fsApi = options.fsApi || fs;
  const osApi = options.osApi || os;
  const token = options.token;
  if (!token) throw isolationError('TEST_DATABASE_TOKEN_REQUIRED', 'A test-run ownership token is required.');
  const root = fsApi.mkdtempSync(path.join(options.tempDirectory || osApi.tmpdir(), 'copyquick-isolated-tests-'));
  fsApi.chmodSync(root, 0o700);
  fsApi.writeFileSync(path.join(root, TEST_ROOT_SENTINEL), token, { mode: 0o600, flag: 'wx' });
  assertSecureOwnedRoot(fsApi.realpathSync(root), token, fsApi);
  return fsApi.realpathSync(root);
}

function createTestProcessRoot(options = {}) {
  const fsApi = options.fsApi || fs;
  const root = options.root;
  const token = options.token;
  if (!root || !token) throw isolationError('TEST_DATABASE_PROCESS_TOKEN_REQUIRED', 'A test-process ownership token is required.');
  const processRoot = fsApi.mkdtempSync(path.join(root, 'process-'));
  fsApi.chmodSync(processRoot, 0o700);
  fsApi.writeFileSync(path.join(processRoot, TEST_PROCESS_SENTINEL), token, { mode: 0o600, flag: 'wx' });
  assertSecureOwnedProcessRoot(processRoot, token, fsApi);
  return processRoot;
}

function removeTestProcessRoot(processRoot, token, fsApi = fs) {
  assertSecureOwnedProcessRoot(processRoot, token, fsApi);
  fsApi.rmSync(processRoot, { recursive: true, force: false });
}

function removeTestRunRoot(root, token, fsApi = fs) {
  assertSecureOwnedRoot(root, token, fsApi);
  fsApi.rmSync(root, { recursive: true, force: false });
}

module.exports = {
  DEFAULT_PERSISTENT_DATA_DIR,
  TEST_DATABASE_PATH_ENV,
  TEST_DATABASE_ROOT_ENV,
  TEST_PROCESS_SENTINEL,
  TEST_PROCESS_TOKEN_ENV,
  TEST_ROOT_SENTINEL,
  TEST_RUN_MARKER_ENV,
  TEST_RUN_MARKER_VALUE,
  TEST_RUN_TOKEN_ENV,
  TestDatabaseIsolationError,
  canonicalPath,
  createTestProcessRoot,
  createTestRunRoot,
  isWithinDirectory,
  removeTestProcessRoot,
  removeTestRunRoot,
  requireIsolatedTestDatabase,
  resolveTestDatabasePath
};
