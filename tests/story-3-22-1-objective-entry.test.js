const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const session = require('express-session');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-3-22-1-'));
process.env.DATABASE_PATH = path.join(root, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const builderRoutes = require('../routes/builder');
const discoveryRoutes = require('../routes/discovery');

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function request(agent, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : '';
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (agent.cookie) headers.Cookie = agent.cookie;
    const req = http.request({ hostname: '127.0.0.1', port: agent.server.address().port, method, path: url, headers }, (res) => {
      if (res.headers['set-cookie']) agent.cookie = res.headers['set-cookie'].map((item) => item.split(';')[0]).join('; ');
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function run() {
  initDb();
  const db = getDb();
  const userId = Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, builder_goal)
    VALUES ('story-3-22-1@example.com', 'Returning Builder', 'free', 5, 'launch_product')
  `).run().lastInsertRowid);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-22-1-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate', (req, res) => {
    req.session.userId = userId;
    req.session.discoverySession = {
      objective: 'launch_product',
      reflectionStartedAt: new Date().toISOString(),
      answers: { initial_description: 'Old blocked idea' },
      understanding: {},
      planningReadiness: { ready: false, discoveryCompleteForNow: true }
    };
    req.session.unrelatedState = { preserveMe: true };
    res.redirect('/welcome');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json({
    userId: req.session.userId,
    discoverySession: req.session.discoverySession || null,
    unrelatedState: req.session.unrelatedState || null
  }));
  app.use(builderRoutes);
  app.use(discoveryRoutes);

  const server = await listen(app);
  const agent = { server, cookie: '' };
  try {
    await request(agent, 'GET', '/test/authenticate');
    const welcome = await request(agent, 'GET', '/welcome');
    assert.strictEqual(welcome.res.statusCode, 200, 'a returning user with builder_goal must still see /welcome');
    assert.match(welcome.body, /type="radio" name="goal"[^>]+value="launch_product"/);
    assert.match(welcome.body, /Start This Objective/);
    assert.match(welcome.body, /value="get_more_customers"/);
    assert.doesNotMatch(welcome.body, /value="get_more_customers"[^>]+disabled/);
    assert.match(welcome.body, /Get More Customers[\s\S]*?Planned/);

    const preselected = await request(agent, 'GET', '/welcome?goal=launch_product');
    assert.strictEqual(preselected.res.statusCode, 200);
    assert.match(preselected.body, /value="launch_product" checked/);
    assert.doesNotMatch(welcome.body, /button type="submit" name="goal"/, 'objective cards must select rather than submit');
    const token = welcome.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    assert(token);

    const missing = await request(agent, 'POST', '/welcome', { _csrf: token });
    assert.strictEqual(missing.res.statusCode, 400);
    assert.match(missing.body, /Choose an available business objective to continue/);
    assert.strictEqual(db.prepare('SELECT builder_goal FROM users WHERE id = ?').get(userId).builder_goal, 'launch_product');

    const invalid = await request(agent, 'POST', '/welcome', { _csrf: token, goal: '../invalid' });
    assert.strictEqual(invalid.res.statusCode, 400);
    assert.match(invalid.body, /Choose an available business objective to continue/);

    const unavailable = await request(agent, 'POST', '/welcome', { _csrf: token, goal: 'build_brand' });
    assert.strictEqual(unavailable.res.statusCode, 400);
    assert.match(unavailable.body, /Choose an available business objective to continue/);
    assert.strictEqual(db.prepare('SELECT builder_goal FROM users WHERE id = ?').get(userId).builder_goal, 'launch_product');

    const missingCsrf = await request(agent, 'POST', '/welcome', { goal: 'launch_product' });
    assert.strictEqual(missingCsrf.res.statusCode, 403);

    const currentBefore = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert(currentBefore.discoverySession);
    assert.deepStrictEqual(currentBefore.unrelatedState, { preserveMe: true });
    assert.strictEqual(db.prepare('SELECT id FROM brand_brain WHERE user_id = ?').get(userId), undefined, 'Brand Brain must not be a prerequisite');

    const valid = await request(agent, 'POST', '/welcome', { _csrf: token, goal: 'launch_product' });
    assert.strictEqual(valid.res.statusCode, 302);
    assert.strictEqual(valid.res.headers.location, '/discovery');
    assert.strictEqual(db.prepare('SELECT builder_goal FROM users WHERE id = ?').get(userId).builder_goal, 'launch_product');

    const currentAfter = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert.strictEqual(currentAfter.userId, userId);
    assert.strictEqual(currentAfter.discoverySession, null, 'only prior discovery state should be removed');
    assert.deepStrictEqual(currentAfter.unrelatedState, { preserveMe: true });

    const freshDiscovery = await request(agent, 'GET', '/discovery');
    assert.strictEqual(freshDiscovery.res.statusCode, 200);
    assert.match(freshDiscovery.body, /What are you building\?/);
    assert.doesNotMatch(freshDiscovery.body, /Old blocked idea/);
    assert.strictEqual(
      db.prepare('SELECT id FROM brand_brain WHERE user_id = ?').get(userId),
      undefined,
      'starting Discovery must not create unrelated Brand Brain state'
    );

    console.log('Story 3.22.1 Reliable Objective Entry tests passed');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
