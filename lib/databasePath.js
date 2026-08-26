const fs = require('fs');
const path = require('path');

const DEFAULT_PERSISTENT_DATA_DIR = '/var/data';
const DEFAULT_LOCAL_DATABASE_PATH = path.join(__dirname, '..', 'db', 'copyquick.db');

class DatabaseConfigurationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DatabaseConfigurationError';
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

function resolveDatabasePath(env = process.env) {
  const explicitPath = configuredValue(env.DATABASE_PATH);
  if (env.NODE_ENV === 'production' && !explicitPath) {
    throw new DatabaseConfigurationError(
      'Production database configuration is unsafe: DATABASE_PATH must point to configured persistent storage.',
      'PRODUCTION_DATABASE_PATH_REQUIRED'
    );
  }
  const legacyDevelopmentPath = env.NODE_ENV === 'production' ? '' : configuredValue(env.DATABASE_URL);
  return path.resolve(explicitPath || legacyDevelopmentPath || DEFAULT_LOCAL_DATABASE_PATH);
}

function resolvePersistentDataDir(env = process.env) {
  return path.resolve(configuredValue(env.PERSISTENT_DATA_DIR) || DEFAULT_PERSISTENT_DATA_DIR);
}

function prepareDatabaseStorage(env = process.env, fsApi = fs) {
  const databasePath = resolveDatabasePath(env);
  const parentDirectory = path.dirname(databasePath);
  const production = env.NODE_ENV === 'production';
  const persistentDataDir = resolvePersistentDataDir(env);

  if (production && persistentDataDir === path.parse(persistentDataDir).root) {
    throw new DatabaseConfigurationError(
      'Production persistent-data root is too broad to provide a safe storage guard.',
      'PRODUCTION_PERSISTENT_ROOT_UNSAFE'
    );
  }

  if (production && !isWithinDirectory(databasePath, persistentDataDir)) {
    throw new DatabaseConfigurationError(
      'Production database configuration is unsafe: DATABASE_PATH must point to configured persistent storage.',
      'PRODUCTION_DATABASE_OUTSIDE_PERSISTENT_ROOT'
    );
  }

  if (!fsApi.existsSync(parentDirectory)) {
    if (production) {
      throw new DatabaseConfigurationError(
        'Production database directory is unavailable. Confirm that persistent storage is mounted.',
        'PRODUCTION_DATABASE_DIRECTORY_MISSING'
      );
    }
    fsApi.mkdirSync(parentDirectory, { recursive: true });
  }

  let directoryStats;
  try {
    directoryStats = fsApi.statSync(parentDirectory);
    if (!directoryStats.isDirectory()) throw new Error('Not a directory');
    fsApi.accessSync(parentDirectory, fs.constants.W_OK);
    if (fsApi.existsSync(databasePath)) fsApi.accessSync(databasePath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    throw new DatabaseConfigurationError(
      production
        ? 'Production database directory is not writable.'
        : 'Local database directory is not writable.',
      production ? 'PRODUCTION_DATABASE_DIRECTORY_NOT_WRITABLE' : 'DATABASE_DIRECTORY_NOT_WRITABLE'
    );
  }

  return {
    databasePath,
    parentDirectory,
    persistentDataDir,
    production,
    mode: production ? 'persistent-production' : 'local-development',
    existedBeforeStartup: fsApi.existsSync(databasePath),
    writable: true
  };
}

function safeStorageDiagnostics(storage) {
  return {
    mode: storage.mode,
    path: storage.production ? storage.databasePath : null,
    writable: storage.writable
  };
}

module.exports = {
  DatabaseConfigurationError,
  DEFAULT_LOCAL_DATABASE_PATH,
  DEFAULT_PERSISTENT_DATA_DIR,
  isWithinDirectory,
  prepareDatabaseStorage,
  resolveDatabasePath,
  resolvePersistentDataDir,
  safeStorageDiagnostics
};
