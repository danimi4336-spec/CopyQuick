const assert = require('assert');
const Database = require('better-sqlite3');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createPasswordRecoveryRouter, GENERIC_REQUEST_MESSAGE } = require('../routes/passwordRecovery');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'passwordRecovery.js'), 'utf8');

assert.match(source, /event: 'password_reset_delivery_failed'/);
assert.match(source, /code: 'PASSWORD_RESET_DELIVERY_FAILED'/);
assert.match(source, /requestId: req\.requestId/);
assert.match(source, /route: req\.route\?\.path \|\| 'unmatched'/);
assert.match(source, /emailDeliveryTracker\.track\('password_reset', delivery\)\.catch\(\(\) => \{\s*logDeliveryFailure\(req\)/);
assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
assert.doesNotMatch(source, /err\.(?:message|stack)/);

async function run() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT, google_id TEXT)');
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(139, 'owner@example.com', 'hash', null);
  const events = [];
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.requestId = '00000000-0000-4000-8000-000000000139';
    res.locals.csrfToken = 'test';
    next();
  });
  app.use(createPasswordRecoveryRouter({
    getDb: () => db,
    env: { NODE_ENV: 'test', SESSION_SECRET: 'story-3-139-secret' },
    publicOrigin: 'https://copyquick.example',
    responseDelayMs: 0,
    sleep: async () => {},
    sendPasswordResetEmail: async () => { throw new Error('sensitive provider failure'); },
    emailDeliveryTracker: { track: (operation, promise) => promise },
    operationalLogger: event => events.push(event)
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  try {
    const body = new URLSearchParams({ email: 'owner@example.com' }).toString();
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, path: '/forgot-password', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let output = '';
        res.on('data', chunk => { output += chunk; });
        res.on('end', () => resolve({ res, output }));
      });
      req.on('error', reject);
      req.end(body);
    });
    assert.strictEqual(response.res.statusCode, 200);
    assert.match(response.output, new RegExp(GENERIC_REQUEST_MESSAGE));
    assert.deepStrictEqual(events, [{
      event: 'password_reset_delivery_failed',
      requestId: '00000000-0000-4000-8000-000000000139',
      method: 'POST',
      route: '/forgot-password',
      statusCode: 500,
      code: 'PASSWORD_RESET_DELIVERY_FAILED'
    }]);
    assert(!JSON.stringify(events).includes('owner@example.com'));
    assert(!JSON.stringify(events).includes('sensitive provider failure'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
  console.log('Story 3.139 password reset delivery diagnostics tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
