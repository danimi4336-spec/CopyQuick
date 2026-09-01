function startHttpServer(app, { port, host = '0.0.0.0' } = {}) {
  if (!app || typeof app.listen !== 'function') {
    return Promise.reject(new Error('HTTP application is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    let server;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      server?.removeListener?.('error', onError);
      server?.removeListener?.('listening', onListening);
      callback(value);
    };
    const onError = error => finish(reject, error);
    const onListening = () => finish(resolve, server);
    try {
      server = app.listen(port, host);
      server.once('error', onError);
      server.once('listening', onListening);
      // Test doubles or alternate adapters may already be listening before
      // listeners are installed; Node's real Server sets `listening` first.
      if (server.listening === true) onListening();
    } catch (error) {
      finish(reject, error);
    }
  });
}

module.exports = { startHttpServer };
