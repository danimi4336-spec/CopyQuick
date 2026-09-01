const { runOrchestratorCycle } = require('./productionOrchestrator');
const { writeOperationalEvent } = require('./operationalLogger');
const { getGenerationControlState, RUNNING } = require('./generationControls');

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createProductionWorker({
  db,
  generatorApi,
  concurrency = process.env.PRODUCTION_MAX_CONCURRENCY,
  idleDelayMs = process.env.PRODUCTION_WORKER_IDLE_MS,
  busyDelayMs = process.env.PRODUCTION_WORKER_BUSY_MS,
  leaseDurationSeconds = process.env.PRODUCTION_JOB_LEASE_SECONDS,
  retryBaseSeconds = process.env.PRODUCTION_RETRY_BASE_SECONDS,
  controlReader = () => getGenerationControlState(),
  runCycle = runOrchestratorCycle,
  logger = writeOperationalEvent,
  onError = function(error) {
    writeOperationalEvent({
      event: 'production_worker_cycle_failed',
      code: typeof error?.code === 'string' ? error.code : 'PRODUCTION_WORKER_FAILED'
    });
  }
}) {
  const idleMs = positiveInteger(idleDelayMs, 2000);
  const busyMs = positiveInteger(busyDelayMs, 100);
  let timer = null;
  let running = false;
  let stopping = false;
  let activeCycle = null;
  let lastControlMode = null;

  async function cycle() {
    if (running || stopping) return null;
    let controlState;
    try {
      controlState = controlReader();
    } catch (_) {
      controlState = { mode: 'paused', code: 'GENERATION_CONTROL_UNAVAILABLE' };
    }
    if (controlState.mode !== RUNNING) {
      if (lastControlMode !== controlState.mode) {
        logger({ event: 'production_worker_paused', code: controlState.code });
      }
      lastControlMode = controlState.mode;
      return { paused: true, workPerformed: 0 };
    }
    if (lastControlMode && lastControlMode !== RUNNING) {
      logger({ event: 'production_worker_resumed' });
    }
    lastControlMode = RUNNING;
    running = true;
    try {
      const result = await runCycle({
        db, generatorApi, concurrency, leaseDurationSeconds, retryBaseSeconds
      });
      return result;
    } catch (err) {
      onError(err);
      return null;
    } finally {
      running = false;
    }
  }

  function schedule(delay) {
    if (stopping) return;
    timer = setTimeout(async function tick() {
      activeCycle = cycle();
      const result = await activeCycle;
      activeCycle = null;
      schedule(result?.workPerformed ? busyMs : idleMs);
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function start() {
    if (timer || running || stopping) return;
    schedule(0);
  }

  async function stop(options = {}) {
    stopping = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (!activeCycle) return { drained: true };
    const graceMs = positiveInteger(options.graceMs || process.env.PRODUCTION_SHUTDOWN_GRACE_MS, 10000);
    let timeout;
    const drained = await Promise.race([
      activeCycle.then(function() { return true; }),
      new Promise(function(resolve) { timeout = setTimeout(function() { resolve(false); }, graceMs); })
    ]);
    if (timeout) clearTimeout(timeout);
    return { drained };
  }

  return { cycle, start, stop, isRunning: function() { return running; } };
}

module.exports = { createProductionWorker };
