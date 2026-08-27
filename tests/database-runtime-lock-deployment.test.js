const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  acquireRuntimeLock,
  getRuntimeLockPath,
  readRuntimeLock,
  startRuntimeLockHeartbeat
} = require('../lib/databaseRuntimeLock');

function identity(pid, hostname, processStartId, processStartedAt) {
  return { pid, hostname, processStartId, processStartedAt };
}

async function signalCleanup(projectRoot, databasePath, signal) {
  const child = spawn(process.execPath, ['-e', `
    const {acquireRuntimeLock}=require('./lib/databaseRuntimeLock');
    const release=acquireRuntimeLock(process.env.TEST_DATABASE_PATH);
    process.on('${signal}',()=>{const result=release();process.exit(result.released?0:2)});
    process.stdout.write('ready\\n'); setInterval(()=>{},1000);
  `], { cwd: projectRoot, env: { ...process.env, TEST_DATABASE_PATH: databasePath }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`child exited early: ${code}`)));
  });
  assert(readRuntimeLock(databasePath).active);
  child.kill(signal);
  await new Promise(resolve => child.once('exit', resolve));
  assert.strictEqual(fs.existsSync(getRuntimeLockPath(databasePath)), false);
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-runtime-lock-'));
  const projectRoot = path.join(__dirname, '..');
  try {
    const databasePath = path.join(root, 'copyquick.db');
    fs.writeFileSync(databasePath, 'fixture');
    let currentTime = Date.parse('2026-08-27T12:00:00.000Z');
    const firstIdentity = identity(101, 'render-a', 'boot-a:100', '2026-08-27T11:59:59.000Z');
    const activeProcesses = new Map([[101, { alive: true, processStartId: 'boot-a:100' }]]);
    const options = {
      now: () => currentTime,
      identity: firstIdentity,
      hostname: 'render-a',
      inspectProcess: pid => activeProcesses.get(pid) || { alive: false, processStartId: null }
    };

    fs.writeFileSync(getRuntimeLockPath(databasePath), JSON.stringify({
      pid: 101,
      startedAt: '2026-08-27T10:00:00.000Z'
    }), { mode: 0o600 });
    assert.strictEqual(readRuntimeLock(databasePath, options).active, false,
      'a legacy marker must not treat a reused current PID as its prior owner');
    const legacyRecovered = acquireRuntimeLock(databasePath, options);
    assert.strictEqual(legacyRecovered().released, true);

    const first = acquireRuntimeLock(databasePath, options);
    assert.strictEqual(readRuntimeLock(databasePath, options).active, true);
    assert.throws(() => acquireRuntimeLock(databasePath, {
      ...options,
      identity: identity(102, 'render-a', 'boot-a:200', '2026-08-27T12:00:01.000Z')
    }), /already in use/);

    assert.strictEqual(first.renew(), true);
    const graceful = first();
    assert.strictEqual(graceful.released, true);
    assert.strictEqual(fs.existsSync(getRuntimeLockPath(databasePath)), false);
    const restarted = acquireRuntimeLock(databasePath, options);
    assert.strictEqual(restarted().released, true);

    const crashed = acquireRuntimeLock(databasePath, options);
    activeProcesses.set(101, { alive: false, processStartId: null });
    const recovered = acquireRuntimeLock(databasePath, {
      ...options,
      identity: identity(103, 'render-a', 'boot-a:300', '2026-08-27T12:01:00.000Z')
    });
    assert(recovered.owner.token !== crashed.owner.token);
    assert.strictEqual(crashed().ownershipLost, true);
    assert.strictEqual(recovered().released, true);

    activeProcesses.set(101, { alive: true, processStartId: 'boot-a:reused' });
    const reusedPidOldOwner = acquireRuntimeLock(databasePath, options);
    const ownerPath = path.join(getRuntimeLockPath(databasePath), 'owner.json');
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    owner.processStartId = 'boot-a:old-process';
    fs.writeFileSync(ownerPath, JSON.stringify(owner));
    const reusedPidRecovery = acquireRuntimeLock(databasePath, options);
    assert(reusedPidRecovery.owner.token !== reusedPidOldOwner.owner.token, 'PID reuse must not establish ownership');
    assert.strictEqual(reusedPidRecovery().released, true);

    const foreignOwner = acquireRuntimeLock(databasePath, options);
    const foreignPath = path.join(getRuntimeLockPath(databasePath), 'owner.json');
    const foreignPayload = JSON.parse(fs.readFileSync(foreignPath, 'utf8'));
    foreignPayload.hostname = 'render-old-instance';
    foreignPayload.heartbeatAt = new Date(currentTime).toISOString();
    fs.writeFileSync(foreignPath, JSON.stringify(foreignPayload));
    assert.strictEqual(readRuntimeLock(databasePath, { ...options, hostname: 'render-new-instance' }).active, true);
    const foreignRecovery = acquireRuntimeLock(databasePath, {
      ...options,
      hostname: 'render-new-instance',
      identity: identity(201, 'render-new-instance', 'boot-b:10', '2026-08-27T12:00:31.000Z'),
      waitForStaleMs: 31_000,
      sleep: milliseconds => { currentTime += milliseconds; }
    });
    assert.strictEqual(foreignOwner().ownershipLost, true);
    assert.strictEqual(foreignRecovery().released, true);

    const cleanupFs = Object.create(fs);
    cleanupFs.rmSync = () => { throw Object.assign(new Error('cleanup blocked'), { code: 'EACCES' }); };
    const cleanupLock = acquireRuntimeLock(databasePath, { ...options, fsApi: cleanupFs });
    const cleanupResult = cleanupLock();
    assert.strictEqual(cleanupResult.released, true);
    assert.strictEqual(cleanupResult.cleanupFailed, true);
    assert.strictEqual(fs.existsSync(getRuntimeLockPath(databasePath)), false, 'released quarantine must not masquerade as an active app');

    let intervalCallback;
    let intervalCleared = false;
    activeProcesses.set(101, { alive: true, processStartId: 'boot-a:100' });
    const heartbeatLock = acquireRuntimeLock(databasePath, options);
    const stopHeartbeat = startRuntimeLockHeartbeat(heartbeatLock, {
      setIntervalFn: callback => { intervalCallback = callback; return { unref() {} }; },
      clearIntervalFn: () => { intervalCleared = true; }
    });
    currentTime += 1000;
    intervalCallback();
    assert.strictEqual(heartbeatLock.owner.token, readRuntimeLock(databasePath, options).token);
    stopHeartbeat();
    assert.strictEqual(intervalCleared, true);
    assert.strictEqual(heartbeatLock().released, true);

    await signalCleanup(projectRoot, path.join(root, 'sigterm.db'), 'SIGTERM');
    await signalCleanup(projectRoot, path.join(root, 'sigint.db'), 'SIGINT');

    console.log('Database runtime lock deployment tests passed.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exit(1); });
