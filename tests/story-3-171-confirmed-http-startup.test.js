const assert = require('assert');
const { EventEmitter } = require('events');
const { startHttpServer } = require('../lib/httpServerStartup');
const { startApplicationAfterMigrationGate } = require('../lib/applicationStartup');

function fakeApp(outcome) {
  let server;
  return {
    listen(port, host) {
      assert.strictEqual(port, 3000);
      assert.strictEqual(host, '127.0.0.1');
      server = new EventEmitter();
      server.listening = false;
      process.nextTick(() => {
        if (outcome === 'listening') {
          server.listening = true;
          server.emit('listening');
        } else {
          server.emit('error', Object.assign(new Error('bind failed'), { code: 'EADDRINUSE' }));
        }
      });
      return server;
    }
  };
}

async function run() {
  const server = await startHttpServer(fakeApp('listening'), { port: 3000, host: '127.0.0.1' });
  assert.strictEqual(server.listening, true);
  await assert.rejects(
    () => startHttpServer(fakeApp('error'), { port: 3000, host: '127.0.0.1' }),
    error => error.code === 'EADDRINUSE'
  );

  const calls = [];
  await assert.rejects(() => startApplicationAfterMigrationGate({
    databaseExists: true,
    getDatabase: () => ({}),
    gateMigrationState: () => ({ currentVersion: 4 }),
    initializeRuntimeDatabase: () => calls.push('runtime'),
    startHttp: () => startHttpServer(fakeApp('error'), { port: 3000, host: '127.0.0.1' }),
    startProductionWorker: () => calls.push('worker'),
    startOffsiteBackupScheduler: () => calls.push('scheduler'),
    startBackupHealthWatcher: () => calls.push('watcher')
  }), error => error.code === 'EADDRINUSE');
  assert.deepStrictEqual(calls, ['runtime']);

  console.log('Story 3.171 Confirmed HTTP Startup tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
