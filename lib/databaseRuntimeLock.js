const fs = require('fs');

function getRuntimeLockPath(databasePath) {
  return `${databasePath}.runtime-lock`;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readRuntimeLock(databasePath, fsApi = fs) {
  const lockPath = getRuntimeLockPath(databasePath);
  if (!fsApi.existsSync(lockPath)) return { active: false, lockPath };
  try {
    const payload = JSON.parse(fsApi.readFileSync(lockPath, 'utf8'));
    return { active: processIsAlive(Number(payload.pid)), lockPath, pid: Number(payload.pid) };
  } catch (_) {
    return { active: true, lockPath, unreadable: true };
  }
}

function acquireRuntimeLock(databasePath, fsApi = fs) {
  const lockPath = getRuntimeLockPath(databasePath);
  const existing = readRuntimeLock(databasePath, fsApi);
  if (existing.active) throw new Error('The configured database is already in use by an application process.');
  if (fsApi.existsSync(lockPath)) fsApi.unlinkSync(lockPath);
  const descriptor = fsApi.openSync(lockPath, 'wx', 0o600);
  fsApi.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fsApi.closeSync(descriptor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const current = readRuntimeLock(databasePath, fsApi);
      if (current.pid === process.pid || current.unreadable) fsApi.unlinkSync(lockPath);
    } catch (_) { /* a stale marker is safe and detected at next startup */ }
  };
}

module.exports = { acquireRuntimeLock, getRuntimeLockPath, processIsAlive, readRuntimeLock };
