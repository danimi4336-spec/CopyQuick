const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LOCK_VERSION = 2;
const DEFAULT_LEASE_MS = 30 * 1000;
const LEGACY_START_TOLERANCE_MS = 5 * 1000;

function getRuntimeLockPath(databasePath) { return `${databasePath}.runtime-lock`; }

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function linuxProcessStartId(pid, fsApi = fs) {
  try {
    const stat = fsApi.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const bootId = fsApi.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return fields[19] && bootId ? `${bootId}:${fields[19]}` : null;
  } catch (_) { return null; }
}

function processStartedAtFromProc(pid, fsApi = fs) {
  try { return fsApi.statSync(`/proc/${pid}`).ctime.toISOString(); }
  catch (_) { return null; }
}

function currentProcessStartedAt(now = Date.now) {
  return new Date(now() - Math.floor(process.uptime() * 1000)).toISOString();
}

function defaultIdentity({ fsApi = fs, now = Date.now } = {}) {
  return {
    pid: process.pid,
    hostname: os.hostname(),
    processStartId: linuxProcessStartId(process.pid, fsApi),
    processStartedAt: currentProcessStartedAt(now)
  };
}

function normalizeOptions(fsApiOrOptions) {
  if (fsApiOrOptions && typeof fsApiOrOptions.readFileSync === 'function') return { fsApi: fsApiOrOptions };
  return fsApiOrOptions || {};
}

function ownerFilePath(lockPath, fsApi) {
  try { return fsApi.statSync(lockPath).isDirectory() ? path.join(lockPath, 'owner.json') : lockPath; }
  catch (_) { return lockPath; }
}

function ownerIsActive(payload, options = {}) {
  const fsApi = options.fsApi || fs;
  const now = options.now || Date.now;
  const hostname = options.hostname || os.hostname();
  const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;
  const currentIdentity = options.currentIdentity || defaultIdentity({ fsApi, now });
  const inspectProcess = options.inspectProcess || ((pid) => ({
    alive: processIsAlive(pid),
    processStartId: linuxProcessStartId(pid, fsApi),
    processStartedAt: processStartedAtFromProc(pid, fsApi)
  }));
  const pid = Number(payload?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  const inspected = inspectProcess(pid) || {};

  if (payload.version === LOCK_VERSION && typeof payload.hostname === 'string' && typeof payload.token === 'string') {
    if (payload.hostname === hostname) {
      if (!inspected.alive) return false;
      if (payload.processStartId && inspected.processStartId) return payload.processStartId === inspected.processStartId;
      if (payload.processStartedAt && inspected.processStartedAt) {
        return Math.abs(Date.parse(payload.processStartedAt) - Date.parse(inspected.processStartedAt)) <= LEGACY_START_TOLERANCE_MS;
      }
      if (pid === currentIdentity.pid && payload.processStartedAt && currentIdentity.processStartedAt) {
        return Math.abs(Date.parse(payload.processStartedAt) - Date.parse(currentIdentity.processStartedAt)) <= LEGACY_START_TOLERANCE_MS;
      }
      return true;
    }
    const heartbeat = Date.parse(payload.heartbeatAt);
    return Number.isFinite(heartbeat) && now() - heartbeat <= leaseMs;
  }

  if (!inspected.alive) return false;
  if (payload.startedAt && inspected.processStartedAt) {
    const legacyStart = Date.parse(payload.startedAt);
    const inspectedStart = Date.parse(inspected.processStartedAt);
    if (Number.isFinite(legacyStart) && Number.isFinite(inspectedStart)) {
      return Math.abs(legacyStart - inspectedStart) <= LEGACY_START_TOLERANCE_MS;
    }
  }
  if (pid === currentIdentity.pid) {
    const legacyStart = Date.parse(payload.startedAt);
    const currentStart = Date.parse(currentIdentity.processStartedAt);
    return Number.isFinite(legacyStart) && Number.isFinite(currentStart) &&
      Math.abs(legacyStart - currentStart) <= LEGACY_START_TOLERANCE_MS;
  }
  return true;
}

function readRuntimeLock(databasePath, fsApiOrOptions = fs) {
  const options = normalizeOptions(fsApiOrOptions);
  const fsApi = options.fsApi || fs;
  const lockPath = getRuntimeLockPath(databasePath);
  if (!fsApi.existsSync(lockPath)) return { active: false, lockPath, exists: false };
  try {
    const payload = JSON.parse(fsApi.readFileSync(ownerFilePath(lockPath, fsApi), 'utf8'));
    return {
      active: ownerIsActive(payload, {
        ...options,
        fsApi,
        currentIdentity: options.currentIdentity || options.identity
      }), lockPath, exists: true,
      pid: Number(payload.pid), token: payload.token || null, owner: payload
    };
  } catch (_) {
    return { active: true, lockPath, exists: true, unreadable: true };
  }
}

function removeExactLockPath(target, fsApi = fs) {
  if (!fsApi.existsSync(target)) return;
  if (fsApi.statSync(target).isDirectory()) fsApi.rmSync(target, { recursive: true });
  else fsApi.unlinkSync(target);
}

function sleepSynchronously(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function acquireRuntimeLock(databasePath, fsApiOrOptions = fs) {
  const options = normalizeOptions(fsApiOrOptions);
  const fsApi = options.fsApi || fs;
  const now = options.now || Date.now;
  const identity = options.identity || defaultIdentity({ fsApi, now });
  const lockPath = getRuntimeLockPath(databasePath);
  const waitForStaleMs = Number.isFinite(options.waitForStaleMs) ? Math.max(0, options.waitForStaleMs) : 0;
  const sleep = options.sleep || sleepSynchronously;
  const deadline = now() + waitForStaleMs;
  let existing = readRuntimeLock(databasePath, { ...options, fsApi, currentIdentity: identity });
  while (existing.active && now() < deadline) {
    sleep(Math.min(250, Math.max(1, deadline - now())));
    existing = readRuntimeLock(databasePath, { ...options, fsApi, currentIdentity: identity });
  }
  if (existing.active) throw new Error('The configured database is already in use by an application process.');

  let quarantinedPath = null;
  if (existing.exists) {
    quarantinedPath = `${lockPath}.stale-${crypto.randomUUID()}`;
    try { fsApi.renameSync(lockPath, quarantinedPath); }
    catch (error) {
      if (error.code === 'ENOENT') return acquireRuntimeLock(databasePath, { ...options, fsApi, identity });
      throw error;
    }
  }
  try { fsApi.mkdirSync(lockPath, { mode: 0o700 }); }
  catch (error) {
    if (quarantinedPath && !fsApi.existsSync(lockPath) && fsApi.existsSync(quarantinedPath)) {
      try { fsApi.renameSync(quarantinedPath, lockPath); } catch (_) {}
    }
    if (error.code === 'EEXIST') throw new Error('The configured database is already in use by an application process.');
    throw error;
  }

  const token = crypto.randomUUID();
  const timestamp = new Date(now()).toISOString();
  const owner = {
    version: LOCK_VERSION, token, pid: identity.pid, hostname: identity.hostname,
    processStartId: identity.processStartId || null, processStartedAt: identity.processStartedAt,
    startedAt: timestamp, heartbeatAt: timestamp
  };
  try {
    fsApi.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    try { fsApi.rmdirSync(lockPath); } catch (_) {}
    if (quarantinedPath && !fsApi.existsSync(lockPath) && fsApi.existsSync(quarantinedPath)) {
      try { fsApi.renameSync(quarantinedPath, lockPath); } catch (_) {}
    }
    throw error;
  }
  if (quarantinedPath) {
    try { removeExactLockPath(quarantinedPath, fsApi); } catch (_) {}
  }

  let released = false;
  const release = () => {
    if (released) return { released: true, alreadyReleased: true };
    const current = readRuntimeLock(databasePath, { ...options, fsApi, currentIdentity: identity });
    if (current.token !== token) return { released: false, ownershipLost: true };
    const releasedPath = `${lockPath}.released-${token}`;
    try {
      fsApi.renameSync(lockPath, releasedPath);
      released = true;
      try {
        removeExactLockPath(releasedPath, fsApi);
        return { released: true };
      } catch (cleanupError) {
        return { released: true, cleanupFailed: true, code: cleanupError.code || 'RUNTIME_LOCK_CLEANUP_FAILED' };
      }
    } catch (error) {
      return { released: false, code: error.code || 'RUNTIME_LOCK_RELEASE_FAILED' };
    }
  };
  release.renew = () => {
    if (released) return false;
    const current = readRuntimeLock(databasePath, { ...options, fsApi, currentIdentity: identity });
    if (current.token !== token || !current.active) return false;
    const temporary = path.join(lockPath, `.owner-${token}.tmp`);
    try {
      fsApi.writeFileSync(temporary, JSON.stringify({ ...current.owner, heartbeatAt: new Date(now()).toISOString() }), { mode: 0o600, flag: 'wx' });
      const verify = readRuntimeLock(databasePath, { ...options, fsApi, currentIdentity: identity });
      if (verify.token !== token) return false;
      fsApi.renameSync(temporary, path.join(lockPath, 'owner.json'));
      return true;
    } catch (_) { return false; }
    finally {
      if (fsApi.existsSync(temporary)) {
        try { fsApi.unlinkSync(temporary); } catch (_) {}
      }
    }
  };
  release.owner = owner;
  return release;
}

function startRuntimeLockHeartbeat(lock, options = {}) {
  const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const onFailure = options.onFailure || (() => {});
  const timer = setIntervalFn(() => { if (!lock.renew()) onFailure(); }, Math.max(1000, Math.floor(leaseMs / 3)));
  if (timer && typeof timer.unref === 'function') timer.unref();
  return () => clearIntervalFn(timer);
}

module.exports = {
  DEFAULT_LEASE_MS, LOCK_VERSION, acquireRuntimeLock, getRuntimeLockPath,
  ownerIsActive, processIsAlive, readRuntimeLock, startRuntimeLockHeartbeat
};
