const assert = require('assert');
const express = require('express');
const http = require('http');
const session = require('express-session');

process.env.SESSION_SECRET = 'story-3-34-session-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

const { createCsrfProtection } = require('../lib/csrf');
const { createAuthRouter } = require('../routes/auth');

function cookieValue(setCookie) {
  return setCookie?.[0]?.split(';')[0] || '';
}

function request(server, method, route, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body ? new URLSearchParams(options.body).toString() : '';
    const headers = { ...(options.cookie ? { Cookie: options.cookie } : {}) };
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path: route,
      headers
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ res, body, cookie: cookieValue(res.headers['set-cookie']) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createDatabase() {
  return {
    prepare(sql) {
      if (/SELECT \* FROM users WHERE email/i.test(sql)) {
        return { get: () => ({ id: 734, email: 'owner@example.com', password_hash: 'valid-hash' }) };
      }
      if (/SELECT builder_goal FROM users/i.test(sql)) {
        return { get: () => ({ builder_goal: null }) };
      }
      if (/INSERT INTO users/i.test(sql)) {
        return { run: () => ({ lastInsertRowid: 735 }) };
      }
      throw new Error(`Unexpected SQL in Story 3.34 test: ${sql}`);
    }
  };
}

async function run() {
  const store = new session.MemoryStore();
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    store,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
  }));
  app.use(createCsrfProtection());
  app.use((req, res, next) => {
    res.render = (_view, options = {}) => res.status(200).send(options.error || 'rendered');
    next();
  });
  app.get('/test/session', (req, res) => res.json({
    sessionId: req.sessionID,
    userId: req.session.userId || null,
    csrfToken: req.csrfToken()
  }));
  app.use(createAuthRouter({
    getDb: createDatabase,
    bcrypt: {
      compare: async () => true,
      hash: async () => 'new-hash'
    }
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const anonymous = await request(server, 'GET', '/test/session');
    const anonymousState = JSON.parse(anonymous.body);
    const anonymousCookie = anonymous.cookie;

    const login = await request(server, 'POST', '/login', {
      cookie: anonymousCookie,
      body: {
        _csrf: anonymousState.csrfToken,
        email: 'owner@example.com',
        password: 'correct-password'
      }
    });
    assert.strictEqual(login.res.statusCode, 302);
    assert.strictEqual(login.res.headers.location, '/welcome');
    assert(login.cookie, 'successful login must issue a replacement session cookie');
    assert.notStrictEqual(login.cookie, anonymousCookie, 'login must rotate the anonymous session ID');

    const authenticated = await request(server, 'GET', '/test/session', { cookie: login.cookie });
    const authenticatedState = JSON.parse(authenticated.body);
    assert.strictEqual(authenticatedState.userId, 734);
    assert.notStrictEqual(authenticatedState.sessionId, anonymousState.sessionId);

    const attacker = await request(server, 'GET', '/test/session', { cookie: anonymousCookie });
    assert.strictEqual(JSON.parse(attacker.body).userId, null, 'pre-login cookie must not authenticate');

    const logout = await request(server, 'POST', '/logout', {
      cookie: login.cookie,
      body: { _csrf: authenticatedState.csrfToken }
    });
    assert.strictEqual(logout.res.statusCode, 302);
    assert.strictEqual(logout.res.headers.location, '/');
    assert.match((logout.res.headers['set-cookie'] || []).join(';'), /connect\.sid=;/);

    const replayed = await request(server, 'GET', '/test/session', { cookie: login.cookie });
    assert.strictEqual(JSON.parse(replayed.body).userId, null, 'logged-out cookie must not authenticate');

    const signupStart = await request(server, 'GET', '/test/session');
    const signupState = JSON.parse(signupStart.body);
    const signup = await request(server, 'POST', '/signup', {
      cookie: signupStart.cookie,
      body: {
        _csrf: signupState.csrfToken,
        name: 'New Owner',
        email: 'new-owner@example.com',
        password: 'long-enough-password'
      }
    });
    assert.strictEqual(signup.res.statusCode, 302);
    assert.strictEqual(signup.res.headers.location, '/welcome');
    assert.notStrictEqual(signup.cookie, signupStart.cookie, 'signup must rotate the anonymous session ID');
    const signedUp = await request(server, 'GET', '/test/session', { cookie: signup.cookie });
    assert.strictEqual(JSON.parse(signedUp.body).userId, 735);

    console.log('Story 3.34 auth session lifecycle tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
