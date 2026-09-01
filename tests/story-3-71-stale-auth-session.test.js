const assert = require('assert');
const express = require('express');
const http = require('http');
const session = require('express-session');

process.env.SESSION_SECRET = 'story-3-71-session-secret';
process.env.NODE_ENV = 'test';

const { createAuthenticatedUserMiddleware } = require('../lib/authUser');
const { requireAuth } = require('../routes/auth');

function request(server, path, cookie = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      headers: cookie ? { Cookie: cookie } : {}
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        location: res.headers.location,
        setCookie: res.headers['set-cookie'] || [],
        body
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const users = new Map([[41, { id: 41, email: 'valid@example.com', name: 'Valid User' }]]);
  let databaseFailure = false;
  const app = express();
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  }));
  app.get('/test/authenticate/:id', (req, res) => {
    req.session.userId = Number(req.params.id);
    res.send('authenticated');
  });
  app.use(createAuthenticatedUserMiddleware({
    env: { NODE_ENV: 'test' },
    getDb: () => ({
      prepare: () => ({
        get: (id) => {
          if (databaseFailure) throw new Error('database unavailable');
          return users.get(Number(id));
        }
      })
    })
  }));
  app.get('/protected', requireAuth, (req, res) => res.json({ userId: res.locals.user.id }));
  app.get('/public', (req, res) => res.json({ authenticated: Boolean(res.locals.user) }));
  app.use((err, _req, res, _next) => res.status(503).send(err.message));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const validLogin = await request(server, '/test/authenticate/41');
    const validCookie = validLogin.setCookie[0].split(';')[0];
    const valid = await request(server, '/protected', validCookie);
    assert.strictEqual(valid.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(valid.body), { userId: 41 });

    const staleLogin = await request(server, '/test/authenticate/999');
    const staleCookie = staleLogin.setCookie[0].split(';')[0];
    const staleProtected = await request(server, '/protected', staleCookie);
    assert.strictEqual(staleProtected.statusCode, 302);
    assert.strictEqual(staleProtected.location, '/login');
    assert.match(staleProtected.setCookie.join(';'), /connect\.sid=;/,
      'missing users must revoke the stale authenticated cookie');

    const stalePublic = await request(server, '/public', staleCookie);
    assert.strictEqual(stalePublic.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(stalePublic.body), { authenticated: false });

    databaseFailure = true;
    const transientLogin = await request(server, '/test/authenticate/41');
    const transientCookie = transientLogin.setCookie[0].split(';')[0];
    const transient = await request(server, '/protected', transientCookie);
    assert.strictEqual(transient.statusCode, 503);
    assert.doesNotMatch(transient.setCookie.join(';'), /connect\.sid=;/,
      'database failures must not revoke otherwise valid sessions');

    databaseFailure = false;
    const recovered = await request(server, '/protected', transientCookie);
    assert.strictEqual(recovered.statusCode, 200);

    console.log('Story 3.71 stale authenticated session tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
