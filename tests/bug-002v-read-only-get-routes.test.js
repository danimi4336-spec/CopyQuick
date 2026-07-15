const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002v-test.sqlite');
process.env.SESSION_SECRET = 'bug-002v-session-secret';
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
      return [{ text: `Generated ${input.contentType || 'copy'}`, tone: input.tone || 'professional' }];
    },
    getContentTypes: () => ({ subject_line: 'Subject Lines', sales_message: 'Sales Message' }),
    getTones: () => ['professional', 'casual']
  }
};

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const builderRoutes = require('../routes/builder');
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

function parseJson(response) {
  return JSON.parse(response.body || '{}');
}

async function getToken(agent) {
  const response = await request(agent, 'GET', '/csrf-token');
  assert.strictEqual(response.res.statusCode, 200);
  return parseJson(response).csrfToken;
}

function createUser(db, overrides = {}) {
  return db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used, current_usage_period_id, current_period_used)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.email || `user-${Date.now()}-${Math.random()}@example.com`,
    overrides.name || 'Owner',
    overrides.plan_tier || 'free',
    overrides.monthly_limit ?? 10,
    overrides.generations_used ?? 0,
    overrides.current_usage_period_id ?? null,
    overrides.current_period_used ?? 0
  ).lastInsertRowid;
}

function currentCalendarPeriod() {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function insertUsagePeriod(db, userId, overrides = {}) {
  const period = currentCalendarPeriod();
  return db.prepare(`
    INSERT INTO usage_periods (user_id, subscription_id, period_start, period_end, plan_tier, monthly_limit, usage_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    overrides.subscription_id ?? null,
    overrides.period_start || period.periodStart,
    overrides.period_end || period.periodEnd,
    overrides.plan_tier || 'free',
    overrides.monthly_limit ?? 10,
    overrides.usage_count ?? 0
  ).lastInsertRowid;
}

function insertGeneration(db, userId, overrides = {}) {
  return db.prepare(`
    INSERT INTO generations (
      user_id, title, input_text, content_type, tone, results, word_count,
      is_deleted, generation_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    overrides.title || 'Original title',
    overrides.input_text || 'Original product',
    overrides.content_type || 'subject_line',
    overrides.tone || 'professional',
    overrides.results || JSON.stringify([{ text: 'Original copy', tone: 'professional' }]),
    overrides.word_count ?? 2,
    overrides.is_deleted || 0,
    overrides.generation_type || 'quick'
  ).lastInsertRowid;
}

function readState(db, userId) {
  return {
    brandBrain: db.prepare('SELECT * FROM brand_brain WHERE user_id = ? ORDER BY id').all(userId),
    usagePeriods: db.prepare('SELECT * FROM usage_periods WHERE user_id = ? ORDER BY id').all(userId),
    userMirror: db.prepare('SELECT current_usage_period_id, current_period_used FROM users WHERE id = ?').get(userId),
    subscriptions: db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id').all(userId)
  };
}

function normalizeState(state) {
  return JSON.parse(JSON.stringify(state));
}

function assertReadOnlyState(db, userId, before, label) {
  assert.deepStrictEqual(normalizeState(readState(db, userId)), normalizeState(before), label);
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
  app.use(builderRoutes);
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
    goal: overrides.goal || 'Increase Sales'
  };
}

async function run() {
  initDb();
  const db = getDb();

  const noBrainUser = createUser(db, { email: 'no-brain@example.com' });
  await withServer(noBrainUser, async (agent) => {
    const before = readState(db, noBrainUser);
    const response = await request(agent, 'GET', '/brand-brain');
    assert.strictEqual(response.res.statusCode, 200);
    assert.match(response.body, /Brand Brain/);
    assert.match(response.body, /value=""/);
    assertReadOnlyState(db, noBrainUser, before, 'GET /brand-brain without row should be read-only');
  });

  const existingBrainUser = createUser(db, { email: 'existing-brain@example.com' });
  db.prepare(`
    INSERT INTO brand_brain (user_id, business_name, industry, target_audience, brand_voice)
    VALUES (?, ?, ?, ?, ?)
  `).run(existingBrainUser, 'Existing Co', 'SaaS', 'Founders', 'friendly');
  await withServer(existingBrainUser, async (agent) => {
    const before = readState(db, existingBrainUser);
    const response = await request(agent, 'GET', '/brand-brain');
    assert.strictEqual(response.res.statusCode, 200);
    assert.match(response.body, /Existing Co/);
    assertReadOnlyState(db, existingBrainUser, before, 'GET /brand-brain with row should be read-only');
  });

  const postBrainUser = createUser(db, { email: 'post-brain@example.com' });
  await withServer(postBrainUser, async (agent) => {
    const blocked = await request(agent, 'POST', '/brand-brain', {
      body: { business_name: 'Blocked Co' }
    });
    assert.strictEqual(blocked.res.statusCode, 403);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM brand_brain WHERE user_id = ?').get(postBrainUser).count, 0);

    const token = await getToken(agent);
    const response = await request(agent, 'POST', '/brand-brain', {
      headers: { 'X-CSRF-Token': token },
      body: {
        business_name: 'Created Co',
        industry: 'Education',
        target_audience: 'Teachers',
        brand_voice: 'custom',
        brand_voice_custom: 'Clear and warm',
        unique_value: 'Fast planning',
        competitors: 'Manual templates',
        goals: 'Save time',
        key_messages: 'Simple and helpful'
      }
    });
    assert.strictEqual(response.res.statusCode, 302);
    const created = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(postBrainUser);
    assert.strictEqual(created.business_name, 'Created Co');
    assert.strictEqual(created.brand_voice, 'Clear and warm');
    assert.strictEqual(created.brand_voice_custom, 'Clear and warm');
  });

  const dashboardUser = createUser(db, { email: 'dashboard@example.com', current_period_used: 7 });
  await withServer(dashboardUser, async (agent) => {
    const before = readState(db, dashboardUser);
    const response = await request(agent, 'GET', '/dashboard');
    assert.strictEqual(response.res.statusCode, 200);
    assert.match(response.body, /AI Credits/);
    assert.match(response.body, /10 remaining|10 of 10 remaining/);
    assertReadOnlyState(db, dashboardUser, before, 'GET /dashboard without usage period should be read-only');
  });

  const profileUser = createUser(db, { email: 'profile@example.com', current_period_used: 5 });
  await withServer(profileUser, async (agent) => {
    const before = readState(db, profileUser);
    const response = await request(agent, 'GET', '/profile');
    assert.strictEqual(response.res.statusCode, 200);
    assert.match(response.body, /10 of 10 remaining/);
    assertReadOnlyState(db, profileUser, before, 'GET /profile without usage period should be read-only');
  });

  const existingUsageUser = createUser(db, { email: 'existing-usage@example.com', monthly_limit: 10 });
  const usagePeriodId = insertUsagePeriod(db, existingUsageUser, { usage_count: 3, monthly_limit: 10 });
  db.prepare('UPDATE users SET current_usage_period_id = ?, current_period_used = ? WHERE id = ?')
    .run(usagePeriodId, 3, existingUsageUser);
  await withServer(existingUsageUser, async (agent) => {
    const before = readState(db, existingUsageUser);
    const dashboard = await request(agent, 'GET', '/dashboard');
    assert.strictEqual(dashboard.res.statusCode, 200);
    assert.match(dashboard.body, /7 of 10 remaining/);
    assertReadOnlyState(db, existingUsageUser, before, 'GET /dashboard with usage period should be read-only');

    const profile = await request(agent, 'GET', '/profile');
    assert.strictEqual(profile.res.statusCode, 200);
    assert.match(profile.body, /7 of 10 remaining/);
    assertReadOnlyState(db, existingUsageUser, before, 'GET /profile with usage period should be read-only');

    const repeated = await request(agent, 'GET', '/dashboard');
    assert.strictEqual(repeated.res.statusCode, 200);
    assertReadOnlyState(db, existingUsageUser, before, 'Repeated GET /dashboard should remain read-only');
  });

  const generationUser = createUser(db, { email: 'generation@example.com', monthly_limit: 10 });
  await withServer(generationUser, async (agent) => {
    const token = await getToken(agent);
    const response = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      body: generationBody()
    });
    assert.strictEqual(response.res.statusCode, 200);
  });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(generationUser).count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(generationUser).count, 1);
  assert.strictEqual(db.prepare('SELECT SUM(usage_count) AS count FROM usage_periods WHERE user_id = ?').get(generationUser).count, 1);
  assert.strictEqual(db.prepare('SELECT current_period_used FROM users WHERE id = ?').get(generationUser).current_period_used, 1);

  const regenUser = createUser(db, { email: 'regen@example.com', monthly_limit: 10 });
  const sourceId = insertGeneration(db, regenUser);
  await withServer(regenUser, async (agent) => {
    const token = await getToken(agent);
    const response = await request(agent, 'POST', `/generation/${sourceId}/regenerate`, {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token }
    });
    assert.strictEqual(response.res.statusCode, 200);
  });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(regenUser).count, 1);
  assert.strictEqual(db.prepare('SELECT SUM(usage_count) AS count FROM usage_periods WHERE user_id = ?').get(regenUser).count, 1);
  assert.strictEqual(db.prepare('SELECT current_period_used FROM users WHERE id = ?').get(regenUser).current_period_used, 1);

  const rolloverUser = createUser(db, { email: 'rollover@example.com', monthly_limit: 2 });
  db.prepare(`
    INSERT INTO usage_periods (user_id, period_start, period_end, plan_tier, monthly_limit, usage_count)
    VALUES (?, ?, ?, 'free', 2, 2)
  `).run(rolloverUser, '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z');
  await withServer(rolloverUser, async (agent) => {
    const before = readState(db, rolloverUser);
    const dashboard = await request(agent, 'GET', '/dashboard');
    assert.strictEqual(dashboard.res.statusCode, 200);
    assertReadOnlyState(db, rolloverUser, before, 'GET /dashboard should not roll over periods by writing');

    const token = await getToken(agent);
    const response = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      body: generationBody({ productDescription: 'Rollover product' })
    });
    assert.strictEqual(response.res.statusCode, 200);
  });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_periods WHERE user_id = ?').get(rolloverUser).count, 2);
  assert.strictEqual(db.prepare(`
    SELECT usage_count FROM usage_periods
    WHERE user_id = ? AND datetime(period_end) > datetime('now')
  `).get(rolloverUser).usage_count, 1);

  const overLimitUser = createUser(db, { email: 'over-limit@example.com', monthly_limit: 1 });
  insertUsagePeriod(db, overLimitUser, { usage_count: 1, monthly_limit: 1 });
  await withServer(overLimitUser, async (agent) => {
    const token = await getToken(agent);
    const beforeCalls = generatorState.calls.length;
    const response = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      body: generationBody({ productDescription: 'Blocked product' })
    });
    assert.strictEqual(response.res.statusCode, 403);
    assert.strictEqual(generatorState.calls.length, beforeCalls);
  });

  const owner = createUser(db, { email: 'owner@example.com' });
  const other = createUser(db, { email: 'other@example.com' });
  db.prepare('INSERT INTO brand_brain (user_id, business_name) VALUES (?, ?)').run(other, 'Other Co');
  insertUsagePeriod(db, other, { usage_count: 6, monthly_limit: 10 });
  await withServer(owner, async (agent) => {
    const response = await request(agent, 'GET', '/brand-brain');
    assert.strictEqual(response.res.statusCode, 200);
    assert(!response.body.includes('Other Co'));
    const dashboard = await request(agent, 'GET', '/dashboard');
    assert.strictEqual(dashboard.res.statusCode, 200);
    assert(!dashboard.body.includes('4 of 10 remaining'));
  });
}

run()
  .then(() => {
    console.log('BUG-002V read-only GET route tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
