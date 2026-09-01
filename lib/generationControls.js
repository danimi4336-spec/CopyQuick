const fs = require('fs');
const path = require('path');
const { resolveDatabasePath, resolvePersistentDataDir, isWithinDirectory } = require('./databasePath');
const { writeOperationalEvent } = require('./operationalLogger');

const CONTROL_VERSION = 1;
const RUNNING = 'running';
const PAUSED = 'paused';

function configured(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveGenerationControlPath(env = process.env) {
  const databasePath = resolveDatabasePath(env);
  const databaseDirectory = path.dirname(databasePath);
  const explicitPath = configured(env.GENERATION_CONTROL_STATE_PATH);
  const statePath = path.resolve(explicitPath || path.join(databaseDirectory, '.generation-control-state.json'));
  const protectedDatabasePaths = new Set([
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
    `${databasePath}.runtime-lock`
  ]);
  if (protectedDatabasePaths.has(statePath)) {
    const error = new Error('Generation control state cannot overlap database storage artifacts.');
    error.code = 'GENERATION_CONTROL_PATH_UNSAFE';
    throw error;
  }
  if (env.NODE_ENV === 'production') {
    const persistentRoot = resolvePersistentDataDir(env);
    if (!isWithinDirectory(statePath, persistentRoot)) {
      const error = new Error('Generation control state must use persistent production storage.');
      error.code = 'GENERATION_CONTROL_PATH_UNSAFE';
      throw error;
    }
  }
  return statePath;
}

function safeDefaultState(statePath) {
  return Object.freeze({ version: CONTROL_VERSION, mode: RUNNING, code: 'GENERATION_CONTROL_DEFAULT', statePath });
}

function parseControlState(value, statePath) {
  if (!value || value.version !== CONTROL_VERSION || ![RUNNING, PAUSED].includes(value.mode)) {
    return Object.freeze({ version: CONTROL_VERSION, mode: PAUSED, code: 'GENERATION_CONTROL_INVALID', statePath });
  }
  return Object.freeze({
    version: CONTROL_VERSION,
    mode: value.mode,
    code: value.mode === PAUSED ? 'GENERATION_PAUSED' : 'GENERATION_CONTROL_ACTIVE',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    statePath
  });
}

function getGenerationControlState({ env = process.env, fsApi = fs, statePath } = {}) {
  let resolvedPath = statePath;
  try {
    resolvedPath = resolvedPath || resolveGenerationControlPath(env);
    return parseControlState(JSON.parse(fsApi.readFileSync(resolvedPath, 'utf8')), resolvedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return safeDefaultState(resolvedPath);
    return Object.freeze({ version: CONTROL_VERSION, mode: PAUSED, code: 'GENERATION_CONTROL_UNAVAILABLE', statePath: resolvedPath || null });
  }
}

function setGenerationControlMode(mode, {
  env = process.env,
  fsApi = fs,
  statePath = resolveGenerationControlPath(env),
  now = () => new Date()
} = {}) {
  if (![RUNNING, PAUSED].includes(mode)) {
    const error = new Error('Generation control mode is invalid.');
    error.code = 'GENERATION_CONTROL_MODE_INVALID';
    throw error;
  }
  const parentDirectory = path.dirname(statePath);
  fsApi.accessSync(parentDirectory, fs.constants.W_OK);
  const state = { version: CONTROL_VERSION, mode, updatedAt: now().toISOString() };
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fsApi.writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fsApi.renameSync(temporaryPath, statePath);
  } catch (error) {
    try { fsApi.unlinkSync(temporaryPath); } catch (_) {}
    throw error;
  }
  return parseControlState(state, statePath);
}

function createRequireGenerationAvailable({
  readState = () => getGenerationControlState(),
  logger = writeOperationalEvent
} = {}) {
  return function requireGenerationAvailable(req, res, next) {
    let state;
    try {
      state = readState();
    } catch (_) {
      state = { mode: PAUSED, code: 'GENERATION_CONTROL_UNAVAILABLE' };
    }
    if (state.mode === RUNNING) return next();
    logger({ event: 'generation_control_blocked', operation: 'generation_intake', code: state.code });
    res.set('Retry-After', '60');
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(503).json({ error: 'Generation is temporarily paused.', code: 'GENERATION_PAUSED' });
    }
    return res.status(503).send('Generation is temporarily paused. Please try again later.');
  };
}

const requireGenerationAvailable = createRequireGenerationAvailable();

module.exports = {
  CONTROL_VERSION,
  PAUSED,
  RUNNING,
  createRequireGenerationAvailable,
  getGenerationControlState,
  requireGenerationAvailable,
  resolveGenerationControlPath,
  setGenerationControlMode
};
