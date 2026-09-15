const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const session = require('express-session');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-3-78-'));
process.env.DATABASE_PATH = path.join(root, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const builderRoutes = require('../routes/builder');

function request(agent, url) {
  return new Promise((resolve, reject) => {
    const headers = agent.cookie ? { Cookie: agent.cookie } : {};
    const req = http.get({ hostname: '127.0.0.1', port: agent.server.address().port, path: url, headers }, (res) => {
      if (res.headers['set-cookie']) agent.cookie = res.headers['set-cookie'].map(item => item.split(';')[0]).join('; ');
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
  });
}

async function run() {
  initDb();
  const db = getDb();
  const userId = Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit)
    VALUES ('story-3-78@example.com', 'Campaign Builder', 'free', 5)
  `).run().lastInsertRowid);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(session({ secret: 'story-3-78-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate', (req, res) => {
    req.session.userId = userId;
    req.session.discoverySession = { preserve: true };
    req.session.unrelatedState = { preserve: true };
    res.redirect('/campaign-studio');
  });
  app.get('/login', (_req, res) => res.status(200).send('login'));
  app.get('/test/session', (req, res) => res.json({
    discoverySession: req.session.discoverySession || null,
    unrelatedState: req.session.unrelatedState || null
  }));
  app.use(builderRoutes);

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  const agent = { server, cookie: '' };

  try {
    const anonymous = await request(agent, '/campaign-studio');
    assert.strictEqual(anonymous.res.statusCode, 302);
    assert.match(anonymous.res.headers.location, /^\/login/);

    await request(agent, '/test/authenticate');
    const legacy = await request(agent, '/campaign-studio');
    assert.strictEqual(legacy.res.statusCode, 302);
    assert.strictEqual(legacy.res.headers.location, '/welcome?goal=launch_product');

    const state = JSON.parse((await request(agent, '/test/session')).body);
    assert.deepStrictEqual(state.discoverySession, { preserve: true });
    assert.deepStrictEqual(state.unrelatedState, { preserve: true });

    const layout = fs.readFileSync(path.join(__dirname, '..', 'views', 'layout.ejs'), 'utf8');
    assert.match(layout, /href="\/welcome"/);
    assert.match(layout, />\s*Start an Objective\s*</);
    assert.doesNotMatch(layout, /href="\/campaign-studio"/);

    console.log('Story 3.78 Guided Campaign Entry tests passed');
  } finally {
    server.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
