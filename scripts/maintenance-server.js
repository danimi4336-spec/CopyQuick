'use strict';

const http = require('node:http');

const MAINTENANCE_MESSAGE = 'CopyQuick is temporarily unavailable for maintenance. Please try again shortly.\n';

function parsePort(value = process.env.PORT) {
  const port = Number(value || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return port;
}

function createMaintenanceServer() {
  return http.createServer((_request, response) => {
    response.writeHead(503, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(MAINTENANCE_MESSAGE),
      'Retry-After': '300'
    });
    response.end(MAINTENANCE_MESSAGE);
  });
}

function startMaintenanceServer(options = {}) {
  const port = options.port === undefined ? parsePort() : parsePort(options.port);
  const host = options.host || '0.0.0.0';
  const server = createMaintenanceServer();
  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort = address && typeof address === 'object' ? address.port : port;
    console.log(`Maintenance server listening on ${host}:${listeningPort}`);
  });
  return server;
}

if (require.main === module) {
  const server = startMaintenanceServer();
  let shuttingDown = false;

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => process.exit(0));
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  }

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = {
  MAINTENANCE_MESSAGE,
  createMaintenanceServer,
  parsePort,
  startMaintenanceServer
};
