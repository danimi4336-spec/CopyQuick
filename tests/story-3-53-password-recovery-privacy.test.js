const assert = require('assert');
const http = require('http');
const express = require('express');
const Database = require('better-sqlite3');
const {
  DEFAULT_REQUEST_RESPONSE_DELAY_MS,
  GENERIC_REQUEST_MESSAGE,
  createPasswordRecoveryRouter
} = require('../routes/passwordRecovery');

function request(server, email) {
  const body = new URLSearchParams({ email }).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: '/forgot-password', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function run() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT, google_id TEXT)');
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(53, 'owner@example.com', 'password-hash', null);

  const waits = [];
  const deliveries = [];
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', require('path').join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    res.locals.csrfToken = 'story-3-53-test-token';
    next();
  });
  app.use(createPasswordRecoveryRouter({
    getDb: () => db,
    env: { NODE_ENV: 'test', SESSION_SECRET: 'story-3-53-secret' },
    publicOrigin: 'https://copyquick.example',
    responseDelayMs: 750,
    sleep: async milliseconds => { waits.push(milliseconds); },
    sendPasswordResetEmail: async payload => { deliveries.push(payload); }
  }));

  const server = await listen(app);
  try {
    const unknown = await request(server, 'unknown@example.com');
    const known = await request(server, 'owner@example.com');
    assert.strictEqual(unknown.res.statusCode, 200);
    assert.strictEqual(known.res.statusCode, 200);
    assert(unknown.body.includes(GENERIC_REQUEST_MESSAGE));
    assert(known.body.includes(GENERIC_REQUEST_MESSAGE));
    assert.deepStrictEqual(waits, [750, 750], 'known and unknown requests use the same response delay');
    assert.strictEqual(deliveries.length, 1);
    assert.strictEqual(deliveries[0].email, 'owner@example.com');
    assert(deliveries[0].resetUrl.startsWith('https://copyquick.example/reset-password?token='));
    assert.strictEqual(DEFAULT_REQUEST_RESPONSE_DELAY_MS, 750);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }

  console.log('Story 3.53 password recovery privacy tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
