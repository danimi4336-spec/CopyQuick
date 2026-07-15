const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002w-test.sqlite');
process.env.SESSION_SECRET = 'bug-002w-session-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

const generatorState = { calls: [] };
const generatorModuleId = require.resolve('../lib/generator');
require.cache[generatorModuleId] = {
  id: generatorModuleId,
  filename: generatorModuleId,
  loaded: true,
  exports: {
    generateCopy: (input) => {
      generatorState.calls.push(input);
      return [{ text: `Generated ${input.contentType || 'copy'} for ${input.productDescription}`, tone: input.tone || 'professional' }];
    },
    getContentTypes: () => ({ subject_line: 'Subject Lines', sales_message: 'Sales Message' }),
    getTones: () => ['professional', 'casual']
  }
};

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const generationRoutes = require('../routes/generations');

function request(agent, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || null;
    const contentType = options.contentType || 'application/x-www-form-urlencoded';
    let payload = '';
    if (body && contentType === 'application/json') {
      payload = JSON.stringify(body);
    } else if (body) {
      payload = new URLSearchParams(body).toString();
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

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

async function getToken(agent) {
  const response = await request(agent, 'GET', '/csrf-token');
  assert.strictEqual(response.res.statusCode, 200);
  return JSON.parse(response.body).csrfToken;
}

function createUser(db, overrides = {}) {
  return db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    overrides.email || `user-${Date.now()}-${Math.random()}@example.com`,
    overrides.name || 'Owner',
    overrides.plan_tier || 'free',
    overrides.monthly_limit ?? 10,
    overrides.generations_used ?? 0
  ).lastInsertRowid;
}

function completeBrandBrain(db, userId) {
  db.prepare(`
    INSERT INTO brand_brain (
      user_id, business_name, industry, target_audience, brand_voice,
      unique_value, competitors, goals, key_messages
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    'Launch Co',
    'SaaS',
    'Founders',
    'friendly',
    'Fast copy',
    'Slow tools',
    'Launch faster',
    'Clear and useful'
  );
}

async function withServer(userId, fn) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
  }));
  app.use((req, res, next) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    req.session.userId = userId;
    res.locals.user = user;
    next();
  });
  app.use(createCsrfProtection());
  app.get('/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });
  app.use(generationRoutes);

  const server = await listen(app);
  const agent = { server, cookie: '' };
  try {
    await fn(agent);
  } finally {
    server.close();
  }
}

function generationBody(overrides = {}) {
  return {
    productDescription: overrides.productDescription || 'Acme product',
    targetAudience: overrides.targetAudience || 'busy founders',
    contentType: overrides.contentType || 'subject_line',
    tone: overrides.tone || 'professional',
    generationType: overrides.generationType || 'quick',
    assets: overrides.assets,
    goal: overrides.goal || 'Increase Sales',
    campaignSections: overrides.campaignSections
  };
}

async function postGenerate(agent, token, body) {
  return request(agent, 'POST', '/dashboard/generate', {
    headers: { Accept: 'application/json', 'X-CSRF-Token': token },
    body
  });
}

function readUsage(db, userId) {
  return {
    generations: db.prepare('SELECT generation_type, content_type, results FROM generations WHERE user_id = ? ORDER BY id').all(userId),
    usageEvents: db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count,
    usageCount: db.prepare('SELECT COALESCE(SUM(usage_count), 0) AS count FROM usage_periods WHERE user_id = ?').get(userId).count,
    legacyUsed: db.prepare('SELECT generations_used FROM users WHERE id = ?').get(userId).generations_used
  };
}

async function run() {
  initDb();
  const db = getDb();

  const uiUser = createUser(db, { email: 'ui@example.com', monthly_limit: 10 });
  completeBrandBrain(db, uiUser);
  await withServer(uiUser, async (agent) => {
    const dashboard = await request(agent, 'GET', '/dashboard');
    assert.strictEqual(dashboard.res.statusCode, 200);

    assert.match(dashboard.body, /Quick Generate/);
    assert.match(dashboard.body, /Marketing Bundle/);
    assert.match(dashboard.body, /Complete Campaign/);
    assert.match(dashboard.body, /id="mode-quick-trigger"/);
    assert.match(dashboard.body, /id="mode-bundle-trigger"/);
    assert.match(dashboard.body, /id="mode-campaign-trigger"/);
    assert.match(dashboard.body, /data-mode-trigger="quick"/);
    assert.match(dashboard.body, /data-mode-trigger="bundle"/);
    assert.match(dashboard.body, /data-mode-trigger="campaign"/);
    assert.match(dashboard.body, /class="gen-form" action="\/dashboard\/generate" method="POST" data-mode="quick"/);
    assert.match(dashboard.body, /class="gen-form" action="\/dashboard\/generate" method="POST" data-mode="bundle"/);
    assert.match(dashboard.body, /class="gen-form" action="\/dashboard\/generate" method="POST" data-mode="campaign"/);
    assert.match(dashboard.body, /Try Now/);
    assert.match(dashboard.body, /data-mode-trigger="quick"/);
    assert.match(dashboard.body, /function getJourneyMode/);
    assert.match(dashboard.body, /id==='build_brand'\|\|id==='promote_service'/);
    assert.match(dashboard.body, /Generate Marketing Bundle/);
    assert.doesNotMatch(dashboard.body, /bjCtaBtn\.textContent = brainPct >= 100 \? 'Build My Campaign'/);
    assert.match(dashboard.body, /<script src="\/js\/dashboardResults\.js"><\/script>/);
  });

  const generationUser = createUser(db, { email: 'modes@example.com', monthly_limit: 10 });
  completeBrandBrain(db, generationUser);
  await withServer(generationUser, async (agent) => {
    const missingCsrf = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json' },
      body: generationBody({ generationType: 'quick' })
    });
    assert.strictEqual(missingCsrf.res.statusCode, 403);
    assert.strictEqual(readUsage(db, generationUser).generations.length, 0);

    const token = await getToken(agent);
    const quick = await postGenerate(agent, token, generationBody({ generationType: 'quick', contentType: 'ad_headline' }));
    assert.strictEqual(quick.res.statusCode, 200);

    const bundle = await postGenerate(agent, token, generationBody({
      generationType: 'bundle',
      assets: 'subject_line:Email Subject Lines,social_post:Social Posts'
    }));
    assert.strictEqual(bundle.res.statusCode, 200);

    const campaign = await postGenerate(agent, token, generationBody({
      generationType: 'campaign',
      campaignSections: 'email',
      goal: 'Launch a product'
    }));
    assert.strictEqual(campaign.res.statusCode, 200);
  });

  const usage = readUsage(db, generationUser);
  assert.deepStrictEqual(usage.generations.map((g) => g.generation_type), ['quick', 'bundle', 'campaign']);
  assert.strictEqual(usage.generations[0].content_type, 'ad_headline');
  assert.strictEqual(usage.generations[1].content_type, 'bundle');
  assert.strictEqual(usage.generations[2].content_type, 'campaign');
  assert(usage.generations[2].results.includes('[Email Marketing]'), 'campaign mode should use campaign section output');
  assert.strictEqual(usage.usageEvents, 3);
  assert.strictEqual(usage.usageCount, 3);
  assert.strictEqual(usage.legacyUsed, 3);
  assert.strictEqual(generatorState.calls.filter((call) => call.contentType === 'ad_headline').length, 1);
  assert(generatorState.calls.some((call) => call.contentType === 'subject_line'));
  assert(generatorState.calls.some((call) => call.contentType === 'social_post'));
}

run()
  .then(() => {
    console.log('BUG-002W generation mode restoration tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
