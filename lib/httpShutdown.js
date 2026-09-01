const DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS = 25 * 1000;

function shutdownTimeoutMs(value = process.env.HTTP_SHUTDOWN_TIMEOUT_MS) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 120 * 1000
    ? parsed
    : DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS;
}

function closeHttpServer(server, options = {}) {
  if (!server) return Promise.resolve({ drained: true, forced: false });
  const timeoutMs = shutdownTimeoutMs(options.timeoutMs);
  const setTimer = options.setTimeoutFn || setTimeout;
  const clearTimer = options.clearTimeoutFn || clearTimeout;
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve(result);
    };
    timer = setTimer(() => {
      server.closeAllConnections?.();
      finish({ drained: false, forced: true });
    }, timeoutMs);
    server.close(() => finish({ drained: true, forced: false }));
    server.closeIdleConnections?.();
  });
}

async function drainShutdownOperations(operations, logger = () => {}) {
  const entries = Object.entries(operations || {});
  const results = await Promise.allSettled(entries.map(([, operation]) => Promise.resolve(operation)));
  const failedComponents = [];
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const component = entries[index][0];
    failedComponents.push(component);
    logger({ event: 'shutdown_component_failed', component, code: 'SHUTDOWN_DRAIN_FAILED' });
  });
  return { drained: failedComponents.length === 0, failedComponents };
}

async function closeApplicationServices({ server, operations, logger = () => {}, httpOptions } = {}) {
  // Start HTTP closure first so no new request can enqueue work after worker
  // and scheduler drains have begun. Existing requests and components then
  // receive their bounded drain windows concurrently.
  const httpClosing = closeHttpServer(server, httpOptions);
  const componentsClosing = drainShutdownOperations(operations, logger);
  const [http, components] = await Promise.all([httpClosing, componentsClosing]);
  return { http, components };
}

module.exports = { closeApplicationServices, DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS, closeHttpServer, drainShutdownOperations, shutdownTimeoutMs };
