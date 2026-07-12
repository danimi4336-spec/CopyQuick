const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002j-test.sqlite');

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function loadPassportWithGoogleEnv({ clientId, clientSecret }) {
  if (clientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = clientId;

  if (clientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = clientSecret;

  clearModule('passport');
  clearModule('../lib/passport');
  return require('../lib/passport');
}

function request(server, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path: url,
      headers: payload ? {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      } : undefined
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createAuthApp() {
  clearModule('../routes/auth');
  const { router } = require('../routes/auth');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = {};
    req.logIn = (user, done) => {
      req.user = user;
      done();
    };
    next();
  });
  app.use(router);
  return app;
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

async function run() {
  let passport = loadPassportWithGoogleEnv({ clientId: undefined, clientSecret: 'test-secret' });
  assert.strictEqual(passport.isGoogleOAuthConfigured(), false);
  assert.strictEqual(passport._strategy('google'), undefined);

  passport = loadPassportWithGoogleEnv({ clientId: 'test-client', clientSecret: undefined });
  assert.strictEqual(passport.isGoogleOAuthConfigured(), false);
  assert.strictEqual(passport._strategy('google'), undefined);

  passport = loadPassportWithGoogleEnv({ clientId: 'test-client', clientSecret: 'test-secret' });
  assert.strictEqual(passport.isGoogleOAuthConfigured(), true);
  assert(passport._strategy('google'), 'configured Google OAuth should register the google strategy');

  passport = loadPassportWithGoogleEnv({ clientId: undefined, clientSecret: undefined });
  const disabledServer = await listen(createAuthApp());
  try {
    const googleResponse = await request(disabledServer, 'GET', '/auth/google');
    assert.strictEqual(googleResponse.res.statusCode, 503);
    assert.match(googleResponse.body, /Google login is currently unavailable/);

    const callbackResponse = await request(disabledServer, 'GET', '/auth/google/callback');
    assert.strictEqual(callbackResponse.res.statusCode, 302);
    assert.strictEqual(callbackResponse.res.headers.location, '/login');
  } finally {
    disabledServer.close();
  }

  const { initDb } = require('../db/init');
  const { getDb } = require('../db/database');
  initDb();
  const db = getDb();
  const passwordHash = bcrypt.hashSync('correct-password', 10);
  const userId = db.prepare(`
    INSERT INTO users (email, password_hash, name, plan_tier, generations_used, monthly_limit, stripe_customer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('login@example.com', passwordHash, 'Login User', 'pro', 3, 200, 'cus_login_123').lastInsertRowid;

  await new Promise((resolve, reject) => {
    passport._deserializers[0](userId, (err, user) => {
      if (err) return reject(err);
      try {
        assert.strictEqual(user.email, 'login@example.com');
        assert.strictEqual(user.name, 'Login User');
        assert.strictEqual(user.plan_tier, 'pro');
        assert.strictEqual(user.generations_used, 3);
        assert.strictEqual(user.monthly_limit, 200);
        assert.strictEqual(user.stripe_customer_id, 'cus_login_123');
        resolve();
      } catch (assertionErr) {
        reject(assertionErr);
      }
    });
  });

  const emailServer = await listen(createAuthApp());
  try {
    const loginResponse = await request(emailServer, 'POST', '/login', {
      email: 'login@example.com',
      password: 'correct-password'
    });
    assert.strictEqual(loginResponse.res.statusCode, 302);
    assert.strictEqual(loginResponse.res.headers.location, '/welcome');
  } finally {
    emailServer.close();
  }
}

run()
  .then(() => {
    console.log('BUG-002J Google OAuth resilience tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
