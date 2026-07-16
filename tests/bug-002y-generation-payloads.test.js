const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002y-test.sqlite');
process.env.SESSION_SECRET = 'bug-002y-session-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const { generateCopy, normalizeContentType, normalizeTone } = require('../lib/generator');
const { bundleAssets } = require('../lib/generatorModes');
const generationRoutes = require('../routes/generations');

function request(agent, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || null;
    const payload = body ? new URLSearchParams(body).toString() : '';
    const headers = { ...(options.headers || {}) };
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
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
      if (setCookie?.length) agent.cookie = setCookie.map((cookie) => cookie.split(';')[0]).join('; ');
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

function createUser(db, overrides = {}) {
  return db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    overrides.email || `bug-002y-${Date.now()}-${Math.random()}@example.com`,
    overrides.name || 'Generation User',
    overrides.plan_tier || 'free',
    overrides.monthly_limit ?? 20,
    overrides.generations_used ?? 0
  ).lastInsertRowid;
}

function createApp(userId) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    const db = getDb();
    req.session.userId = userId;
    res.locals.user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    next();
  });
  app.use(createCsrfProtection());
  app.get('/csrf-token', (req, res) => res.json({ csrfToken: req.csrfToken() }));
  app.use(generationRoutes);
  return app;
}

async function withServer(userId, fn) {
  const server = await listen(createApp(userId));
  const agent = { server, cookie: '' };
  try {
    await fn(agent);
  } finally {
    server.close();
  }
}

async function getToken(agent) {
  const response = await request(agent, 'GET', '/csrf-token');
  assert.strictEqual(response.res.statusCode, 200);
  return parseJson(response).csrfToken;
}

async function postGenerate(agent, token, body, headers = {}) {
  return request(agent, 'POST', '/dashboard/generate', {
    headers: {
      Accept: 'application/json',
      'X-CSRF-Token': token,
      ...headers
    },
    body
  });
}

function snapshot(db, userId) {
  return {
    generations: db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(userId).count,
    usageEvents: db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count,
    usageCount: db.prepare('SELECT COALESCE(SUM(usage_count), 0) AS count FROM usage_periods WHERE user_id = ?').get(userId).count,
    legacy: db.prepare('SELECT generations_used FROM users WHERE id = ?').get(userId).generations_used
  };
}

function assertNoUndefinedValues(results) {
  const text = JSON.stringify(results);
  assert(!/\bundefined\b/i.test(text), 'generated results should not contain undefined');
  assert(!/\bnull\b/i.test(text), 'generated results should not contain null');
  assert(!/\[object Object\]/.test(text), 'generated results should not contain object stringification');
}

function bundleBody(assetValues) {
  return {
    productDescription: 'Turmeric Curcumin and Ginger',
    targetAudience: 'Professionals',
    tone: 'Professional',
    assets: assetValues.join(','),
    generationType: 'bundle'
  };
}

function quickBody(overrides = {}) {
  return {
    productDescription: overrides.productDescription || 'Turmeric Curcumin and Ginger',
    contentType: overrides.contentType || 'product_description',
    tone: overrides.tone || 'Professional',
    generationType: 'quick'
  };
}

async function run() {
  initDb();
  const db = getDb();

  assert.strictEqual(normalizeTone('Professional'), 'professional');
  assert.strictEqual(normalizeTone('Luxury'), 'professional');
  assert.strictEqual(normalizeContentType('Product Descriptions'), 'product_description');
  assert.strictEqual(normalizeContentType('Product Description'), 'product_description');
  assert.strictEqual(normalizeContentType('Ad copy'), 'ad_headline');

  const quickResults = generateCopy(quickBody());
  assert.strictEqual(quickResults.length, 5);
  assertNoUndefinedValues(quickResults);
  quickResults.forEach((result) => {
    assert.strictEqual(result.tone, 'professional');
    assert(result.text.includes('Turmeric Curcumin and Ginger'));
    assert(result.text.length > 120, 'product descriptions should be substantive, not slogan fragments');
    assert(!/Engineered for undefined|Made for undefined|choice for undefined|Perfect for undefined/i.test(result.text));
  });

  const socialResults = generateCopy({ productDescription: 'Reusable bottle', contentType: 'Social Media Posts', tone: 'Friendly' });
  assert.strictEqual(socialResults[0].tone, 'casual');
  assertNoUndefinedValues(socialResults);

  const allPresentedAssets = bundleAssets.map((asset) => `${asset.id}:${asset.label}`);
  const productionSelection = [
    'amazon_listing:Amazon Listing',
    'landing_page:Landing Page',
    'product_description:Product Description',
    'blog_article:Blog Article',
    'social_post:Facebook Post'
  ];
  const representativeSelection = [
    'email_campaign:Email Campaign',
    'facebook_ad:Facebook Ad',
    'google_search_ad:Google Search Ad',
    'seo_package:SEO Package',
    'video_package:Video Package'
  ];

  const bundleUserId = createUser(db, { monthly_limit: 20 });
  await withServer(bundleUserId, async (agent) => {
    const token = await getToken(agent);
    const before = snapshot(db, bundleUserId);
    const response = await postGenerate(agent, token, bundleBody(productionSelection));
    assert.strictEqual(response.res.statusCode, 200);
    const body = parseJson(response);
    assert.strictEqual(body.results.length, 25);
    assertNoUndefinedValues(body.results);
    assert.deepStrictEqual(
      [...new Set(body.results.map((result) => result.assetLabel))].sort(),
      ['Amazon Listing', 'Blog Article', 'Facebook Post', 'Landing Page', 'Product Description'].sort()
    );
    assert.deepStrictEqual(snapshot(db, bundleUserId), {
      generations: before.generations + 1,
      usageEvents: before.usageEvents + 1,
      usageCount: before.usageCount + 1,
      legacy: before.legacy + 1
    });
  });

  const allAssetsUserId = createUser(db, { monthly_limit: 20 });
  await withServer(allAssetsUserId, async (agent) => {
    const token = await getToken(agent);
    for (const assetValue of allPresentedAssets) {
      const response = await postGenerate(agent, token, bundleBody([assetValue]));
      assert.strictEqual(response.res.statusCode, 200, `${assetValue} should be supported`);
      assert.strictEqual(parseJson(response).results.length, 5);
    }
  });

  const comboUserId = createUser(db, { monthly_limit: 20 });
  await withServer(comboUserId, async (agent) => {
    const token = await getToken(agent);
    const response = await postGenerate(agent, token, bundleBody(representativeSelection));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(parseJson(response).results.length, 25);
  });

  const malformedUserId = createUser(db, { monthly_limit: 20 });
  await withServer(malformedUserId, async (agent) => {
    const token = await getToken(agent);
    const before = snapshot(db, malformedUserId);
    const response = await postGenerate(agent, token, bundleBody(['unsupported_asset:Unsupported Asset']));
    assert.strictEqual(response.res.statusCode, 400);
    assert.strictEqual(parseJson(response).error, 'Invalid generation request');
    assert.deepStrictEqual(snapshot(db, malformedUserId), before);
  });

  const csrfUserId = createUser(db, { monthly_limit: 20 });
  await withServer(csrfUserId, async (agent) => {
    const before = snapshot(db, csrfUserId);
    const response = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json' },
      body: quickBody()
    });
    assert.strictEqual(response.res.statusCode, 403);
    assert.deepStrictEqual(snapshot(db, csrfUserId), before);
  });

  const triggerUserId = createUser(db, { monthly_limit: 20 });
  await withServer(triggerUserId, async (agent) => {
    const token = await getToken(agent);
    const before = snapshot(db, triggerUserId);
    db.exec(`
      CREATE TRIGGER fail_002y_generation_insert
      BEFORE INSERT ON generations
      BEGIN
        SELECT RAISE(FAIL, 'forced generation insert failure');
      END;
    `);
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    try {
      const response = await postGenerate(agent, token, quickBody());
      assert.strictEqual(response.res.statusCode, 500);
      assert.strictEqual(parseJson(response).error, 'Generation failed');
    } finally {
      console.error = originalError;
      db.exec('DROP TRIGGER IF EXISTS fail_002y_generation_insert');
    }
    assert.deepStrictEqual(snapshot(db, triggerUserId), before);
    assert(logs.some((line) => line.includes('Dashboard generation failed.')));
    assert(!logs.join('\n').includes('Turmeric Curcumin and Ginger'));
  });
}

run()
  .then(() => {
    console.log('BUG-002Y generation payload tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
