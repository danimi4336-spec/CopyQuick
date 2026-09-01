const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PAUSED,
  RUNNING,
  createRequireGenerationAvailable,
  getGenerationControlState,
  resolveGenerationControlPath,
  setGenerationControlMode
} = require('../lib/generationControls');
const { createProviderRuntime } = require('../lib/providerRuntime');
const { createProductionWorker } = require('../lib/productionWorker');

function middlewareResponse() {
  return {
    statusCode: 200, headers: {}, body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-generation-control-'));
  const databasePath = path.join(root, 'copyquick.db');
  const statePath = path.join(root, 'generation-control.json');
  const env = { NODE_ENV: 'test', DATABASE_PATH: databasePath, GENERATION_CONTROL_STATE_PATH: statePath };

  assert.strictEqual(getGenerationControlState({ env }).mode, RUNNING, 'missing control state must preserve normal operation');
  const paused = setGenerationControlMode(PAUSED, { env, now: () => new Date('2026-08-31T12:00:00.000Z') });
  assert.strictEqual(paused.mode, PAUSED);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), {
    version: 1, mode: PAUSED, updatedAt: '2026-08-31T12:00:00.000Z'
  });
  assert.strictEqual(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.strictEqual(getGenerationControlState({ env }).code, 'GENERATION_PAUSED');
  assert.strictEqual(setGenerationControlMode(RUNNING, { env }).mode, RUNNING);

  fs.writeFileSync(statePath, '{broken');
  assert.strictEqual(getGenerationControlState({ env }).mode, PAUSED, 'malformed state must fail closed');
  assert.strictEqual(getGenerationControlState({ env }).code, 'GENERATION_CONTROL_UNAVAILABLE');

  const unsafeProductionEnv = {
    NODE_ENV: 'production', DATABASE_PATH: path.join(root, 'data', 'copyquick.db'),
    PERSISTENT_DATA_DIR: path.join(root, 'data'), GENERATION_CONTROL_STATE_PATH: path.join(root, 'outside.json')
  };
  assert.throws(() => resolveGenerationControlPath(unsafeProductionEnv), error => error.code === 'GENERATION_CONTROL_PATH_UNSAFE');
  assert.strictEqual(getGenerationControlState({ env: unsafeProductionEnv }).mode, PAUSED);
  assert.throws(() => resolveGenerationControlPath({
    NODE_ENV: 'test', DATABASE_PATH: databasePath, GENERATION_CONTROL_STATE_PATH: databasePath
  }), error => error.code === 'GENERATION_CONTROL_PATH_UNSAFE');

  const logs = [];
  let advanced = false;
  const middleware = createRequireGenerationAvailable({
    readState: () => ({ mode: PAUSED, code: 'GENERATION_PAUSED' }),
    logger: event => logs.push(event)
  });
  const response = middlewareResponse();
  middleware({ xhr: true, headers: { accept: 'application/json' } }, response, () => { advanced = true; });
  assert.strictEqual(advanced, false);
  assert.strictEqual(response.statusCode, 503);
  assert.strictEqual(response.headers['Retry-After'], '60');
  assert.deepStrictEqual(response.body, { error: 'Generation is temporarily paused.', code: 'GENERATION_PAUSED' });
  assert.deepStrictEqual(logs[0], { event: 'generation_control_blocked', operation: 'generation_intake', code: 'GENERATION_PAUSED' });
  const failedReaderResponse = middlewareResponse();
  createRequireGenerationAvailable({ readState: () => { throw new Error('private'); }, logger: () => {} })(
    { headers: {} }, failedReaderResponse, () => { throw new Error('must not advance'); }
  );
  assert.strictEqual(failedReaderResponse.statusCode, 503, 'control read failures must fail closed');

  let invoked = false;
  const providerLogs = [];
  const runtime = createProviderRuntime({
    controlReader: () => ({ mode: PAUSED }), logger: event => providerLogs.push(event)
  });
  await assert.rejects(
    () => runtime.run({ input: {}, invoke: async () => { invoked = true; } }),
    error => error.code === 'GENERATION_PAUSED' && error.safeToRetry === true
  );
  assert.strictEqual(invoked, false);
  assert(providerLogs.some(event => event.event === 'provider_request_blocked'));

  let controlMode = PAUSED;
  let cycles = 0;
  const workerLogs = [];
  const worker = createProductionWorker({
    db: {}, controlReader: () => ({ mode: controlMode, code: 'GENERATION_PAUSED' }),
    runCycle: async () => { cycles += 1; return { workPerformed: 0 }; }, logger: event => workerLogs.push(event)
  });
  assert.deepStrictEqual(await worker.cycle(), { paused: true, workPerformed: 0 });
  assert.strictEqual(cycles, 0);
  controlMode = RUNNING;
  await worker.cycle();
  assert.strictEqual(cycles, 1);
  assert(workerLogs.some(event => event.event === 'production_worker_paused'));
  assert(workerLogs.some(event => event.event === 'production_worker_resumed'));

  const generationsRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
  const productionRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'production.js'), 'utf8');
  assert.match(generationsRoute, /dashboard\/generate', requireAuth, requireGenerationAvailable, generationActionRateLimit/);
  assert.match(generationsRoute, /generation\/:id\/regenerate', requireAuth, requireGenerationAvailable, generationActionRateLimit/);
  assert.match(productionRoute, /production\/start', requireAuth, requireGenerationAvailable, generationActionRateLimit/);
  assert.match(productionRoute, /production\/:id\/run-next', requireAuth, requireGenerationAvailable, generationActionRateLimit/);

  const cliEnv = { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath, GENERATION_CONTROL_STATE_PATH: statePath };
  let cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'generation-control.js'), '--pause'], { env: cliEnv, encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.deepStrictEqual(Object.keys(JSON.parse(cli.stdout)).sort(), ['code', 'mode', 'updatedAt']);
  cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'generation-control.js'), '--resume'], { env: cliEnv, encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.strictEqual(JSON.parse(cli.stdout).mode, RUNNING);
  assert(!cli.stdout.includes(statePath), 'operator output must not expose storage paths');
  cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'generation-control.js'), '--pause', '--typo'], { env: cliEnv, encoding: 'utf8' });
  assert.strictEqual(cli.status, 2, 'unknown CLI arguments must not change control state');
  assert.strictEqual(getGenerationControlState({ env: cliEnv }).mode, RUNNING);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('Story 3.30 Generation Emergency Controls tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
