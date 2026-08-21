const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { buildStrategy } = require('../lib/strategyEngine');
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function completeUnderstanding(overrides = {}) {
  return {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    targetAudience: confirmed('health-conscious adults', 'Health-conscious adults'),
    customerMotivation: confirmed('solve_problem', 'It solves a clear problem'),
    salesChannel: confirmed('amazon', 'Amazon'),
    competitiveDifferentiation: confirmed('partial', 'It is different in a few ways'),
    launchStage: confirmed('development', 'In development'),
    ...overrides
  };
}

function build(overrides = {}) {
  const understanding = overrides.understanding || completeUnderstanding();
  return buildStrategy({
    objective: 'launch_product',
    understanding,
    answers: overrides.answers || { initial_description: 'Organic turmeric supplement' },
    confirmedUnderstanding: overrides.confirmedUnderstanding || understanding
  });
}

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
    const req = http.request({
      hostname: '127.0.0.1',
      port: agent.server.address().port,
      method,
      path: url,
      headers
    }, (res) => {
      const cookies = res.headers['set-cookie'];
      if (cookies) agent.cookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function readySession(confirmedReflection) {
  const understanding = completeUnderstanding();
  const answers = {
    initial_description: 'Organic turmeric supplement',
    target_audience: 'health-conscious adults',
    customer_motivation: 'solve_problem',
    sales_channel: 'amazon',
    competitive_differentiation: 'partial',
    launch_stage: 'development'
  };
  const intelligence = analyzeDiscovery({
    objective: 'launch_product',
    understanding,
    unknowns: ['brand', 'budget', 'timeline'],
    answers
  });
  return {
    objective: 'launch_product',
    answers,
    understanding,
    unknowns: ['brand', 'budget', 'timeline'],
    completedQuestions: Object.keys(answers),
    planningReadiness: intelligence.planningReadiness,
    reflectionStartedAt: new Date().toISOString(),
    planningConfirmedAt: confirmedReflection ? new Date().toISOString() : null,
    strategyResult: confirmedReflection ? build() : null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function run() {
  const amazon = build();
  assert.strictEqual(amazon.strategy.marketPosition.value, 'Premium Natural Wellness');
  assert.strictEqual(amazon.strategy.communicationStyle.value, 'Evidence-Based and Reassuring');
  assert.match(amazon.strategy.marketingFocus.value, /Marketplace/);
  assert(Object.values(amazon.strategy).every((item) => item.explanation));
  assert(Object.values(amazon.strategy).every((item) => ['High Confidence', 'Moderate Confidence', 'Needs Confirmation'].includes(item.confidence)));
  assert(amazon.assumptions.some((item) => item.includes('Amazon')));
  assert(amazon.recommendations.length > 0);
  assert(amazon.recommendations.every((item) => item.recommendation && item.reason));

  const websiteUnderstanding = completeUnderstanding({
    salesChannel: confirmed('own_website', 'Shopify / my own website')
  });
  const website = build({ understanding: websiteUnderstanding });
  assert.notStrictEqual(website.strategy.marketingFocus.value, amazon.strategy.marketingFocus.value);
  assert.strictEqual(website.strategy.primarySalesChannel.value, 'Shopify / my own website');

  const serviceUnderstanding = completeUnderstanding({
    businessType: confirmed('service', 'Service Business'),
    industry: confirmed('home_services', 'Home Services'),
    category: confirmed('plumbing', 'Plumbing'),
    targetAudience: confirmed('local_customers', 'Local customers'),
    salesChannel: confirmed('own_website', 'My website')
  });
  const service = build({
    understanding: serviceUnderstanding,
    answers: { initial_description: 'Local plumbing service' }
  });
  assert.strictEqual(service.strategy.marketPosition.value, 'Reliable Local Expert');
  assert.strictEqual(service.strategy.communicationStyle.value, 'Direct, Trustworthy, and Responsive');
  assert.notStrictEqual(service.strategy.marketPosition.value, amazon.strategy.marketPosition.value);

  const unknown = buildStrategy({
    objective: 'launch_product',
    understanding: {},
    answers: { initial_description: 'Nova' },
    confirmedUnderstanding: {}
  });
  assert.strictEqual(unknown.strategy.marketPosition.value, 'Unknown');
  assert.strictEqual(unknown.strategy.primaryCustomer.value, 'Unknown');
  assert.strictEqual(unknown.strategy.primarySalesChannel.value, 'Unknown');
  assert.strictEqual(unknown.confidence, 'Needs Confirmation');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-5-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate-ready', async (req, res) => {
    req.session.userId = 35;
    req.session.discoverySession = await readySession(false);
    res.redirect('/discovery/reflection');
  });
  app.get('/test/authenticate-confirmed', async (req, res) => {
    req.session.userId = 35;
    req.session.discoverySession = await readySession(true);
    res.redirect('/discovery/strategy');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.use(discoveryRoutes);

  const server = await listen(app);
  const anonymous = { server, cookie: '' };
  const ready = { server, cookie: '' };
  const confirmedAgent = { server, cookie: '' };
  try {
    const denied = await request(anonymous, 'GET', '/discovery/strategy');
    assert.strictEqual(denied.res.statusCode, 302);
    assert.strictEqual(denied.res.headers.location, '/login');

    await request(ready, 'GET', '/test/authenticate-ready');
    const premature = await request(ready, 'GET', '/discovery/strategy');
    assert.strictEqual(premature.res.statusCode, 302);
    assert.strictEqual(premature.res.headers.location, '/discovery/reflection');

    const reflection = await request(ready, 'GET', '/discovery/reflection');
    const token = reflection.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const missingCsrf = await request(ready, 'POST', '/discovery/reflection/plan');
    assert.strictEqual(missingCsrf.res.statusCode, 403);
    const generated = await request(ready, 'POST', '/discovery/reflection/plan', { _csrf: token });
    assert.strictEqual(generated.res.statusCode, 303);
    assert.strictEqual(generated.res.headers.location, '/discovery/strategy');
    const stored = JSON.parse((await request(ready, 'GET', '/test/session')).body);
    assert(stored.planningConfirmedAt);
    assert.strictEqual(stored.confirmedUnderstanding.salesChannel.value, 'amazon');
    assert.strictEqual(stored.strategyResult.strategy.marketPosition.value, 'Premium Natural Wellness');

    await request(confirmedAgent, 'GET', '/test/authenticate-confirmed');
    const page = await request(confirmedAgent, 'GET', '/discovery/strategy');
    assert.strictEqual(page.res.statusCode, 200);
    assert.match(page.body, /Recommended Business Strategy/);
    assert.match(page.body, /Premium Natural Wellness/);
    assert.match(page.body, /Evidence-Based and Reassuring/);
    assert.match(page.body, /Areas that may improve your strategy/);
    assert.match(page.body, /Edit Business Understanding/);
    assert.match(page.body, /Continue to Build Plan/);
    assert.doesNotMatch(page.body, /\d+%/);

    console.log('Story 3.5 Strategy Engine tests passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
