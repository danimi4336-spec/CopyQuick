const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LOCK_VERSION = 1;
const DEFAULT_BACKUP_OPERATION_LEASE_MS = 5 * 60 * 1000;

class BackupOperationLockError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BackupOperationLockError';
    this.code = code;
  }
}

function getBackupOperationLockPath(backupDirectory) {
  return path.join(path.resolve(backupDirectory), '.backup-operation-lock');
}

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

function processStartedAt(pid, fsApi = fs) {
  try { return fsApi.statSync(`/proc/${pid}`).ctime.toISOString(); }
  catch (_) { return null; }
}

function currentIdentity({ fsApi = fs, now = Date.now } = {}) {
  return {
    pid: process.pid,
    hostname: os.hostname(),
    processStartId: linuxProcessStartId(process.pid, fsApi),
    processStartedAt: new Date(now() - Math.floor(process.uptime() * 1000)).toISOString()
  };
}

function readOwner(lockPath, fsApi = fs) {
  try { return JSON.parse(fsApi.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')); }
  catch (_) { return null; }
}

function ownerIsActive(owner, { fsApi = fs, now = Date.now, hostname = os.hostname(), leaseMs = DEFAULT_BACKUP_OPERATION_LEASE_MS, inspectProcess } = {}) {
  if (!owner || owner.version !== LOCK_VERSION || typeof owner.token !== 'string') return true;
  const heartbeat = Date.parse(owner.heartbeatAt);
  if (!Number.isFinite(heartbeat)) return true;
  if (owner.hostname !== hostname) return now() - heartbeat <= leaseMs;
  const inspect = inspectProcess || (pid => ({
    alive: processIsAlive(pid), processStartId: linuxProcessStartId(pid, fsApi),
    processStartedAt: processStartedAt(pid, fsApi)
  }));
  const observed = inspect(Number(owner.pid)) || {};
  if (!observed.alive) return false;
  if (owner.processStartId && observed.processStartId) return owner.processStartId === observed.processStartId;
  if (owner.processStartedAt && observed.processStartedAt) {
    return Math.abs(Date.parse(owner.processStartedAt) - Date.parse(observed.processStartedAt)) <= 5000;
  }
  // If PID identity cannot be proven, a fresh heartbeat remains conservative;
  // expiry prevents PID reuse from pinning the lease forever.
  return now() - heartbeat <= leaseMs;
}

function removeExactLock(target, fsApi = fs) {
  if (!fsApi.existsSync(target)) return;
  fsApi.rmSync(target, { recursive: true });
}

function inspectBackupOperationLock(backupDirectory, options = {}) {
  const fsApi = options.fsApi || fs;
  const lockPath = getBackupOperationLockPath(backupDirectory);
  if (!fsApi.existsSync(lockPath)) return { exists: false, active: false, lockPath, owner: null };
  const owner = readOwner(lockPath, fsApi);
  return { exists: true, active: ownerIsActive(owner, options), lockPath, owner, token: owner?.token || null };
}

function acquireBackupOperationLock(backupDirectory, options = {}) {
  const fsApi = options.fsApi || fs;
  const now = options.now || Date.now;
  const leaseMs = options.leaseMs || DEFAULT_BACKUP_OPERATION_LEASE_MS;
  const identity = options.identity || currentIdentity({ fsApi, now });
  const lockPath = getBackupOperationLockPath(backupDirectory);
  let existing = inspectBackupOperationLock(backupDirectory, { ...options, fsApi, now, leaseMs });
  if (existing.active) throw new BackupOperationLockError('Another backup operation is already running.', 'BACKUP_OPERATION_LOCKED');

  let stalePath = null;
  if (existing.exists) {
    stalePath = `${lockPath}.stale-${crypto.randomUUID()}`;
    try { fsApi.renameSync(lockPath, stalePath); }
    catch (error) {
      if (error.code === 'ENOENT') return acquireBackupOperationLock(backupDirectory, { ...options, fsApi, now, leaseMs, identity });
      throw error;
    }
  }
  try { fsApi.mkdirSync(lockPath, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new BackupOperationLockError('Another backup operation is already running.', 'BACKUP_OPERATION_LOCKED');
    throw error;
  }

  const token = crypto.randomUUID();
  const timestamp = new Date(now()).toISOString();
  const owner = {
    version: LOCK_VERSION, token, pid: identity.pid, hostname: identity.hostname,
    processStartId: identity.processStartId || null, processStartedAt: identity.processStartedAt || null,
    startedAt: timestamp, heartbeatAt: timestamp
  };
  try { fsApi.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(owner), { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    try { fsApi.rmdirSync(lockPath); } catch (_) {}
    throw error;
  }
  if (stalePath) { try { removeExactLock(stalePath, fsApi); } catch (_) {} }

  let released = false;
  function ownsCurrentLock() {
    return readOwner(lockPath, fsApi)?.token === token;
  }
  function renew() {
    if (released || !ownsCurrentLock()) return false;
    const temporary = path.join(lockPath, `.owner-${token}.tmp`);
    try {
      fsApi.writeFileSync(temporary, JSON.stringify({ ...owner, heartbeatAt: new Date(now()).toISOString() }), { mode: 0o600, flag: 'wx' });
      if (!ownsCurrentLock()) return false;
      fsApi.renameSync(temporary, path.join(lockPath, 'owner.json'));
      return true;
    } catch (_) { return false; }
    finally { if (fsApi.existsSync(temporary)) { try { fsApi.unlinkSync(temporary); } catch (_) {} } }
  }
  function release() {
    if (released) return { released: true, alreadyReleased: true };
    if (!ownsCurrentLock()) return { released: false, ownershipLost: true, code: 'BACKUP_LOCK_OWNERSHIP_LOST' };
    const releasedPath = `${lockPath}.released-${token}`;
    try {
      fsApi.renameSync(lockPath, releasedPath);
      released = true;
      try { removeExactLock(releasedPath, fsApi); return { released: true }; }
      catch (_) { return { released: true, cleanupFailed: true, code: 'BACKUP_LOCK_CLEANUP_FAILED' }; }
    } catch (_) { return { released: false, code: 'BACKUP_LOCK_RELEASE_FAILED' }; }
  }
  return { token, owner, renew, release, isOwner: ownsCurrentLock, leaseMs, lockPath };
}

function startBackupOperationHeartbeat(lock, options = {}) {
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const intervalMs = Math.max(1000, Math.floor((options.leaseMs || lock.leaseMs || DEFAULT_BACKUP_OPERATION_LEASE_MS) / 3));
  const timer = setIntervalFn(() => { if (!lock.renew() && options.onFailure) options.onFailure(); }, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return () => clearIntervalFn(timer);
}

module.exports = {
  BackupOperationLockError,
  DEFAULT_BACKUP_OPERATION_LEASE_MS,
  acquireBackupOperationLock,
  getBackupOperationLockPath,
  inspectBackupOperationLock,
  ownerIsActive,
  startBackupOperationHeartbeat
};
