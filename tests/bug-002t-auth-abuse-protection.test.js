const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'bug-002t-session-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

const dbPath = path.join('/tmp', 'copyquick-bug-002t-test.sqlite');
process.env.DATABASE_URL = dbPath;

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(dbPath + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const {
  AUTH_LIMIT_ERROR,
  LOGIN_FAILURE_ERROR,
  createExpiringBucketStore,
  createLoginRateLimiter,
  createSignupRateLimiter
} = require('../lib/authProtection');
const { createAuthRouter } = require('../routes/auth');

function request(agent, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    let payload = '';
    const contentType = options.contentType || 'application/x-www-form-urlencoded';
    if (options.body && contentType === 'application/json') {
      payload = JSON.stringify(options.body);
    } else if (options.body) {
      payload = new URLSearchParams(options.body).toString();
    }

    const headers = { ...(options.headers || {}) };
    if (payload) {
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (agent.cookie) headers.Cookie = agent.cookie;

    const req = http.request({
      hostname: '127.0.0.1',
      port: agent.server.address().port,
      method,
      path: url,
      headers
    }, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie?.length) {
        agent.cookie = setCookie.map((cookie) => cookie.split(';')[0]).join('; ');
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

async function createTestAgent(options = {}) {
  const loginLimiter = createLoginRateLimiter({
    maxIpFailures: options.maxIpFailures || 2,
    maxEmailFailures: options.maxEmailFailures || 2,
    windowMs: options.windowMs || 1000,
    now: options.now
  });
  const signupLimiter = createSignupRateLimiter({
    maxAttempts: options.maxSignupAttempts || 2,
    windowMs: options.windowMs || 1000,
    now: options.now
  });

  const calls = {
    compare: 0,
    hash: 0
  };
  const bcryptMock = {
    compare: async (password, hash) => {
      calls.compare += 1;
      return hash === `hash:${password}`;
    },
    hash: async (password) => {
      calls.hash += 1;
      return `hash:${password}`;
    }
  };

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
  }));
  app.use(createCsrfProtection());
  app.use((req, res, next) => {
    res.render = function render(view, renderOptions = {}) {
      const error = renderOptions.error || '';
      return this.send(`${view}:${error}`);
    };
    next();
  });
  app.get('/csrf-token', (req, res) => res.json({ csrfToken: req.csrfToken() }));
  app.use(createAuthRouter({
    bcrypt: bcryptMock,
    getDb,
    loginLimiter,
    signupLimiter
  }));

  const server = await listen(app);
  return {
    agent: { server, cookie: '' },
    calls,
    close: () => server.close()
  };
}

async function getToken(agent) {
  const response = await request(agent, 'GET', '/csrf-token');
  return JSON.parse(response.body).csrfToken;
}

async function postLogin(agent, csrfToken, overrides = {}, headers = {}) {
  return request(agent, 'POST', '/login', {
    headers,
    body: {
      _csrf: csrfToken,
      email: 'founder@example.com',
      password: 'correct-password',
      ...overrides
    }
  });
}

async function postSignup(agent, csrfToken, overrides = {}, headers = {}) {
  return request(agent, 'POST', '/signup', {
    headers,
    body: {
      _csrf: csrfToken,
      name: 'New Founder',
      email: `new-${Date.now()}-${Math.random()}@example.com`,
      password: 'signup-password',
      ...overrides
    }
  });
}

function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

async function run() {
  initDb();
  const db = getDb();
  db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run('founder@example.com', 'hash:correct-password', 'Founder');
  db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run('other@example.com', 'hash:other-password', 'Other');

  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  console.error = (...args) => logs.push(args.map(String).join(' '));

  try {
    const valid = await createTestAgent();
    const validToken = await getToken(valid.agent);
    const validLogin = await postLogin(valid.agent, validToken);
    assert.strictEqual(validLogin.res.statusCode, 302);
    assert.strictEqual(validLogin.res.headers.location, '/welcome');
    assert.strictEqual(valid.calls.compare, 1);
    valid.close();

    const failure = await createTestAgent({ maxIpFailures: 10, maxEmailFailures: 10 });
    const failureToken = await getToken(failure.agent);
    const wrongPassword = await postLogin(failure.agent, failureToken, { password: 'wrong-password' });
    const missingAccount = await postLogin(failure.agent, failureToken, { email: 'missing@example.com', password: 'wrong-password' });
    assert.strictEqual(wrongPassword.res.statusCode, 200);
    assert.strictEqual(missingAccount.res.statusCode, 200);
    assert(wrongPassword.body.includes(LOGIN_FAILURE_ERROR));
    assert.strictEqual(wrongPassword.body, missingAccount.body);
    failure.close();

    const ipLimited = await createTestAgent({ maxIpFailures: 2, maxEmailFailures: 10 });
    const ipToken = await getToken(ipLimited.agent);
    await postLogin(ipLimited.agent, ipToken, { password: 'bad-one' });
    await postLogin(ipLimited.agent, ipToken, { password: 'bad-two' });
    const beforeIpBlockedCompare = ipLimited.calls.compare;
    const ipBlocked = await postLogin(ipLimited.agent, ipToken, { password: 'bad-three' });
    assert.strictEqual(ipBlocked.res.statusCode, 429);
    assert(ipBlocked.body.includes(AUTH_LIMIT_ERROR));
    assert.strictEqual(ipLimited.calls.compare, beforeIpBlockedCompare);
    ipLimited.close();

    const emailLimited = await createTestAgent({ maxIpFailures: 10, maxEmailFailures: 2 });
    const emailToken = await getToken(emailLimited.agent);
    await postLogin(emailLimited.agent, emailToken, { password: 'bad-one' }, { 'X-Forwarded-For': '203.0.113.10' });
    await postLogin(emailLimited.agent, emailToken, { password: 'bad-two' }, { 'X-Forwarded-For': '203.0.113.11' });
    const beforeEmailBlockedCompare = emailLimited.calls.compare;
    const emailBlocked = await postLogin(emailLimited.agent, emailToken, { password: 'bad-three' }, { 'X-Forwarded-For': '203.0.113.12' });
    assert.strictEqual(emailBlocked.res.statusCode, 429);
    assert.strictEqual(emailLimited.calls.compare, beforeEmailBlockedCompare);
    const otherAccount = await postLogin(emailLimited.agent, emailToken, { email: 'other@example.com', password: 'bad' }, { 'X-Forwarded-For': '203.0.113.13' });
    assert.strictEqual(otherAccount.res.statusCode, 200);
    emailLimited.close();

    const reset = await createTestAgent({ maxIpFailures: 10, maxEmailFailures: 2 });
    const resetToken = await getToken(reset.agent);
    await postLogin(reset.agent, resetToken, { password: 'bad-one' });
    const resetSuccess = await postLogin(reset.agent, resetToken);
    assert.strictEqual(resetSuccess.res.statusCode, 302);
    await postLogin(reset.agent, resetToken, { password: 'bad-two' });
    const afterResetAttempt = await postLogin(reset.agent, resetToken, { password: 'bad-three' });
    assert.strictEqual(afterResetAttempt.res.statusCode, 200);
    reset.close();

    const csrf = await createTestAgent({ maxIpFailures: 1, maxEmailFailures: 1 });
    const missingCsrf = await postLogin(csrf.agent, 'missing-token', { password: 'bad' });
    assert.strictEqual(missingCsrf.res.statusCode, 403);
    assert.strictEqual(csrf.calls.compare, 0);
    const csrfToken = await getToken(csrf.agent);
    const afterCsrf = await postLogin(csrf.agent, csrfToken, { password: 'bad' });
    assert.strictEqual(afterCsrf.res.statusCode, 200);
    csrf.close();

    const signup = await createTestAgent({ maxSignupAttempts: 2 });
    const signupToken = await getToken(signup.agent);
    const initialUsers = countUsers(db);
    const signupSuccess = await postSignup(signup.agent, signupToken, { email: 'first-signup@example.com' });
    assert.strictEqual(signupSuccess.res.statusCode, 302);
    assert.strictEqual(signupSuccess.res.headers.location, '/welcome');
    assert.strictEqual(signup.calls.hash, 1);
    assert.strictEqual(countUsers(db), initialUsers + 1);
    await postSignup(signup.agent, signupToken, { email: 'second-signup@example.com' });
    const usersBeforeBlockedSignup = countUsers(db);
    const hashBeforeBlockedSignup = signup.calls.hash;
    const signupBlocked = await postSignup(signup.agent, signupToken, { email: 'third-signup@example.com' });
    assert.strictEqual(signupBlocked.res.statusCode, 429);
    assert.strictEqual(signup.calls.hash, hashBeforeBlockedSignup);
    assert.strictEqual(countUsers(db), usersBeforeBlockedSignup);
    signup.close();

    const signupIps = await createTestAgent({ maxSignupAttempts: 1 });
    const signupIpToken = await getToken(signupIps.agent);
    await postSignup(signupIps.agent, signupIpToken, { email: 'ip-one@example.com' }, { 'X-Forwarded-For': '198.51.100.1' });
    const otherIpSignup = await postSignup(signupIps.agent, signupIpToken, { email: 'ip-two@example.com' }, { 'X-Forwarded-For': '198.51.100.2' });
    assert.strictEqual(otherIpSignup.res.statusCode, 302);
    signupIps.close();

    let now = 1000;
    const expiry = await createTestAgent({ maxSignupAttempts: 1, windowMs: 100, now: () => now });
    const expiryToken = await getToken(expiry.agent);
    await postSignup(expiry.agent, expiryToken, { email: 'window-one@example.com' });
    const windowBlocked = await postSignup(expiry.agent, expiryToken, { email: 'window-two@example.com' });
    assert.strictEqual(windowBlocked.res.statusCode, 429);
    now += 101;
    const afterWindow = await postSignup(expiry.agent, expiryToken, { email: 'window-three@example.com' });
    assert.strictEqual(afterWindow.res.statusCode, 302);
    expiry.close();

    const store = createExpiringBucketStore({ windowMs: 10, maxKeys: 10, now: () => now });
    store.increment('stale-key');
    now += 11;
    store.prune();
    assert.strictEqual(store.buckets.has('stale-key'), false);

    const json = await createTestAgent({ maxIpFailures: 1, maxEmailFailures: 1 });
    const jsonToken = await getToken(json.agent);
    await request(json.agent, 'POST', '/login', {
      contentType: 'application/json',
      headers: { Accept: 'application/json' },
      body: { _csrf: jsonToken, email: 'founder@example.com', password: 'bad' }
    });
    const jsonBlocked = await request(json.agent, 'POST', '/login', {
      contentType: 'application/json',
      headers: { Accept: 'application/json' },
      body: { _csrf: jsonToken, email: 'founder@example.com', password: 'bad' }
    });
    assert.strictEqual(jsonBlocked.res.statusCode, 429);
    assert.deepStrictEqual(JSON.parse(jsonBlocked.body), { error: AUTH_LIMIT_ERROR });
    json.close();

    const oversized = await createTestAgent();
    const oversizedToken = await getToken(oversized.agent);
    const oversizedLogin = await postLogin(oversized.agent, oversizedToken, { email: 'x'.repeat(300) + '@example.com', password: 'bad' });
    assert.strictEqual(oversizedLogin.res.statusCode, 400);
    assert.strictEqual(oversized.calls.compare, 0);
    const oversizedSignup = await postSignup(oversized.agent, oversizedToken, { email: 'too-long@example.com', password: 'x'.repeat(2000) });
    assert.strictEqual(oversizedSignup.res.statusCode, 400);
    assert.strictEqual(oversized.calls.hash, 0);
    oversized.close();

    const combinedLogs = logs.join('\n');
    assert(!combinedLogs.includes('correct-password'));
    assert(!combinedLogs.includes('signup-password'));
    assert(!combinedLogs.includes('_csrf'));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  console.log('BUG-002T auth abuse protection tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
