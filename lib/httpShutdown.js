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

module.exports = { DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS, closeHttpServer, shutdownTimeoutMs };
