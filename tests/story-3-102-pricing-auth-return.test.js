const assert = require('assert');
const express = require('express');
const http = require('http');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const { createCsrfProtection } = require('../lib/csrf');
const { authSuccessPath, normalizeAuthReturnPath } = require('../lib/authReturnPath');
const { createAuthRouter } = require('../routes/auth');

assert.strictEqual(normalizeAuthReturnPath('/pricing'), '/pricing');
for (const unsafe of ['https://evil.example', '//evil.example', '/dashboard', '/pricing?next=evil', '', null]) {
  assert.strictEqual(normalizeAuthReturnPath(unsafe), null);
}
assert.strictEqual(authSuccessPath({ builder_goal: 'launch_product' }, '/pricing'), '/pricing');
assert.strictEqual(authSuccessPath({ builder_goal: 'launch_product' }, 'https://evil.example'), '/dashboard');
assert.strictEqual(authSuccessPath({ builder_goal: null }, null), '/welcome');

const pricing = fs.readFileSync(path.join(__dirname, '..', 'views', 'pricing.ejs'), 'utf8');
const home = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
assert.match(pricing, /\/signup\?next=%2Fpricing/);
assert.doesNotMatch(home, /\/subscribe\?price=/);
assert.match(home, /\/signup\?next=%2Fpricing/);

function request(server, method, route, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body ? new URLSearchParams(options.body).toString() : '';
    const headers = options.cookie ? { Cookie: options.cookie } : {};
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path: route, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ res, body, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] || options.cookie }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function database() {
  return {
    prepare(sql) {
      if (/SELECT \* FROM users WHERE email/i.test(sql)) return { get: () => ({ id: 102, password_hash: 'hash' }) };
      if (/SELECT builder_goal FROM users/i.test(sql)) return { get: () => ({ builder_goal: 'launch_product' }) };
      if (/INSERT INTO users/i.test(sql)) return { run: () => ({ lastInsertRowid: 103 }) };
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

async function run() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-102-secret', resave: false, saveUninitialized: true }));
  app.use(createCsrfProtection());
  app.use((req, res, next) => {
    res.render = (_view, options) => res.json(options);
    next();
  });
  app.get('/session', (req, res) => res.json({ csrfToken: req.csrfToken() }));
  app.use(createAuthRouter({
    getDb: database,
    bcrypt: { compare: async () => true, hash: async () => 'hash' }
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const loginPage = await request(server, 'GET', '/login?next=%2Fpricing');
    assert.strictEqual(JSON.parse(loginPage.body).returnTo, '/pricing');
    const loginSession = await request(server, 'GET', '/session', { cookie: loginPage.cookie });
    const login = await request(server, 'POST', '/login', {
      cookie: loginSession.cookie,
      body: { _csrf: JSON.parse(loginSession.body).csrfToken, email: 'owner@example.com', password: 'valid-password', next: '/pricing' }
    });
    assert.strictEqual(login.res.headers.location, '/pricing');

    const unsafePage = await request(server, 'GET', '/login?next=https%3A%2F%2Fevil.example');
    assert.strictEqual(JSON.parse(unsafePage.body).returnTo, null);
    const unsafeSession = await request(server, 'GET', '/session', { cookie: unsafePage.cookie });
    const unsafeLogin = await request(server, 'POST', '/login', {
      cookie: unsafeSession.cookie,
      body: { _csrf: JSON.parse(unsafeSession.body).csrfToken, email: 'owner@example.com', password: 'valid-password', next: 'https://evil.example' }
    });
    assert.strictEqual(unsafeLogin.res.headers.location, '/dashboard');

    const signupPage = await request(server, 'GET', '/signup?next=%2Fpricing');
    const signupSession = await request(server, 'GET', '/session', { cookie: signupPage.cookie });
    const signup = await request(server, 'POST', '/signup', {
      cookie: signupSession.cookie,
      body: { _csrf: JSON.parse(signupSession.body).csrfToken, name: 'New Owner', email: 'new@example.com', password: 'long-enough-password', next: '/pricing' }
    });
    assert.strictEqual(signup.res.headers.location, '/pricing');

    console.log('Story 3.102 Pricing Auth Return tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
