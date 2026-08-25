const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function understanding(overrides = {}) {
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

function strategyFor(facts, description = 'Organic turmeric supplement') {
  return buildStrategy({
    objective: 'launch_product',
    understanding: facts,
    confirmedUnderstanding: facts,
    answers: { initial_description: description }
  });
}

function planFor(facts, strategyResult = strategyFor(facts), description = 'Organic turmeric supplement') {
  return buildPlan({
    objective: 'launch_product',
    confirmedUnderstanding: facts,
    strategyResult,
    answers: { initial_description: description }
  });
}

function deliverables(plan) {
  return plan.phases.flatMap(function(phase) { return phase.deliverables; });
}

function ids(plan) {
  return deliverables(plan).map(function(item) { return item.id; });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function request(agent, method, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
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
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sessionState(mode) {
  const facts = understanding();
  const now = new Date().toISOString();
  const state = {
    objective: 'launch_product',
    answers: { initial_description: 'Organic turmeric supplement' },
    understanding: facts,
    planningReadiness: { ready: true },
    reflectionStartedAt: now,
    startedAt: now,
    updatedAt: now
  };
  if (mode !== 'unconfirmed') {
    state.planningConfirmedAt = now;
    state.confirmedUnderstanding = facts;
  }
  if (!['unconfirmed', 'missing_strategy'].includes(mode)) {
    state.strategyResult = strategyFor(facts);
    state.strategyUpdatedAt = mode === 'stale'
      ? new Date(Date.now() - 60000).toISOString()
      : now;
  }
  return state;
}

async function run() {
  const amazonFacts = understanding();
  const amazonPlan = planFor(amazonFacts);
  assert.strictEqual(amazonPlan.readiness.ready, true);
  assert.deepStrictEqual(amazonPlan.phases.map((phase) => phase.id), ['foundation', 'sales_channel', 'launch']);
  assert.strictEqual(amazonPlan.summary.deliverableCount, deliverables(amazonPlan).length);
  assert.strictEqual(amazonPlan.summary.estimatedCredits, null);
  assert.strictEqual(amazonPlan.summary.estimatedTime, null);
  assert.match(amazonPlan.summary.whyThisPlan, /Amazon/);

  const amazonIds = ids(amazonPlan);
  assert(amazonIds.includes('amazon_listing'));
  assert(amazonIds.includes('amazon_bullet_points'));
  assert(amazonIds.includes('amazon_keyword_guidance'));
  assert(!amazonIds.includes('ecommerce_product_page'));
  assert(!amazonIds.includes('abandoned_cart_email'));
  assert(amazonPlan.exclusions.some((item) => item.id === 'ecommerce_product_page' && item.reason));
  assert(deliverables(amazonPlan).every((item) => item.reason && item.strategicDirection));
  assert(deliverables(amazonPlan).every((item) => ['essential', 'recommended', 'optional'].includes(item.recommendationLevel)));

  const foundation = amazonPlan.phases[0].deliverables;
  const foundationIds = foundation.map((item) => item.id);
  assert(foundationIds.indexOf('customer_profile') < foundationIds.indexOf('product_positioning'));
  assert(foundationIds.indexOf('product_positioning') < foundationIds.indexOf('value_proposition'));
  assert(foundationIds.indexOf('value_proposition') < foundationIds.indexOf('core_messaging'));
  assert.deepStrictEqual(foundation.find((item) => item.id === 'core_messaging').dependencies, [
    'customer_profile', 'product_positioning', 'value_proposition'
  ]);

  const shopifyFacts = understanding({ salesChannel: confirmed('own_website', 'Shopify / my own website') });
  const shopifyPlan = planFor(shopifyFacts);
  const shopifyIds = ids(shopifyPlan);
  assert(shopifyIds.includes('ecommerce_product_page'));
  assert(shopifyIds.includes('ecommerce_trust_faq'));
  assert(shopifyIds.includes('abandoned_cart_email'));
  assert(!shopifyIds.some((id) => id.startsWith('amazon_')));
  assert(shopifyPlan.exclusions.some((item) => item.id === 'amazon_listing' && /not the confirmed/.test(item.reason)));
  assert.match(shopifyPlan.summary.whyThisPlan, /Shopify/);

  const unknownChannelFacts = understanding({ salesChannel: confirmed('unsure', "I'm not sure yet") });
  const unknownPlan = planFor(unknownChannelFacts);
  assert(!ids(unknownPlan).some((id) => id.startsWith('amazon_')));
  assert(!ids(unknownPlan).some((id) => id.startsWith('ecommerce_')));
  assert(!ids(unknownPlan).includes('abandoned_cart_email'));
  assert.match(unknownPlan.summary.whyThisPlan, /channel-neutral/);

  const localFacts = understanding({
    businessType: confirmed('service', 'Service Business'),
    industry: confirmed('home_services', 'Home Services'),
    category: confirmed('plumbing', 'Plumbing'),
    targetAudience: confirmed('local_customers', 'Local customers'),
    salesChannel: confirmed('own_website', 'My website')
  });
  const localPlan = planFor(localFacts, strategyFor(localFacts, 'Local plumbing service'), 'Local plumbing service');
  assert(ids(localPlan).includes('google_business_profile'));
  assert(ids(localPlan).includes('service_page'));
  assert(!ids(localPlan).some((id) => id.startsWith('amazon_')));
  assert(!ids(localPlan).includes('ecommerce_product_page'));
  assert(!ids(localPlan).includes('product_image_guidance'));

  const valueStrategy = JSON.parse(JSON.stringify(strategyFor(amazonFacts)));
  valueStrategy.strategy.competitiveApproach.value = 'Value, Convenience, and Bundles';
  valueStrategy.strategy.communicationStyle.value = 'Simple and Practical';
  valueStrategy.strategy.marketingFocus.value = 'Ease of Purchase and Everyday Value';
  const valuePlan = planFor(amazonFacts, valueStrategy, 'Everyday household product');
  const premiumDirection = deliverables(amazonPlan).find((item) => item.id === 'amazon_listing').strategicDirection;
  const valueDirection = deliverables(valuePlan).find((item) => item.id === 'amazon_listing').strategicDirection;
  assert.notStrictEqual(valueDirection, premiumDirection);
  assert.match(premiumDirection, /Trust|Evidence|Marketplace/);
  assert.match(valueDirection, /Convenience|Everyday Value/);

  const invalidMissingUnderstanding = buildPlan({ objective: 'launch_product', strategyResult: strategyFor(amazonFacts) });
  assert.strictEqual(invalidMissingUnderstanding.readiness.ready, false);
  const invalidMissingStrategy = buildPlan({ objective: 'launch_product', confirmedUnderstanding: amazonFacts });
  assert.strictEqual(invalidMissingStrategy.readiness.ready, false);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-6-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:mode', (req, res) => {
    req.session.userId = 36;
    req.session.discoverySession = sessionState(req.params.mode);
    req.session.credits = 27;
    req.session.usageCount = 4;
    req.session.generations = ['existing-generation'];
    req.session.brandBrain = { name: 'Existing DNA' };
    req.session.billingState = { plan: 'existing-plan' };
    res.redirect('/discovery/strategy');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session));
  app.use(discoveryRoutes);

  const server = await listen(app);
  const anonymous = { server, cookie: '' };
  const unconfirmed = { server, cookie: '' };
  const missingStrategy = { server, cookie: '' };
  const stale = { server, cookie: '' };
  const valid = { server, cookie: '' };
  try {
    const denied = await request(anonymous, 'GET', '/discovery/build-plan');
    assert.strictEqual(denied.res.statusCode, 302);
    assert.strictEqual(denied.res.headers.location, '/login');

    await request(unconfirmed, 'GET', '/test/authenticate/unconfirmed');
    const unconfirmedPlan = await request(unconfirmed, 'GET', '/discovery/build-plan');
    assert.strictEqual(unconfirmedPlan.res.statusCode, 302);
    assert.strictEqual(unconfirmedPlan.res.headers.location, '/discovery/reflection');

    await request(missingStrategy, 'GET', '/test/authenticate/missing_strategy');
    const noStrategyPlan = await request(missingStrategy, 'GET', '/discovery/build-plan');
    assert.strictEqual(noStrategyPlan.res.statusCode, 302);
    assert.strictEqual(noStrategyPlan.res.headers.location, '/discovery/reflection');

    await request(stale, 'GET', '/test/authenticate/stale');
    const stalePlan = await request(stale, 'GET', '/discovery/build-plan');
    assert.strictEqual(stalePlan.res.statusCode, 302);
    assert.strictEqual(stalePlan.res.headers.location, '/discovery/reflection');

    await request(valid, 'GET', '/test/authenticate/valid');
    const strategyPage = await request(valid, 'GET', '/discovery/strategy');
    assert.strictEqual(strategyPage.res.statusCode, 200);
    assert.match(strategyPage.body, /href="\/discovery\/build-plan"/);

    const page = await request(valid, 'GET', '/discovery/build-plan');
    assert.strictEqual(page.res.statusCode, 200);
    assert.match(page.body, /Your Personalized Build Plan/);
    assert.match(page.body, /Why this plan\?/);
    assert.match(page.body, /Build Your Foundation/);
    assert.match(page.body, /Prepare Your Sales Channel/);
    assert.match(page.body, /Amazon Listing/);
    assert.match(page.body, /Strategic direction/);
    assert.doesNotMatch(page.body, /estimatedCredits|estimatedTime|\d+ credits|\d+ seconds/i);

    const stored = JSON.parse((await request(valid, 'GET', '/test/session')).body);
    assert.strictEqual(stored.discoverySession.buildPlan.objective, 'launch_product');
    assert(stored.discoverySession.buildPlanUpdatedAt);
    assert.strictEqual(stored.credits, 27);
    assert.strictEqual(stored.usageCount, 4);
    assert.deepStrictEqual(stored.generations, ['existing-generation']);
    assert.deepStrictEqual(stored.brandBrain, { name: 'Existing DNA' });
    assert.deepStrictEqual(stored.billingState, { plan: 'existing-plan' });

    console.log('Story 3.6 Build Plan Engine tests passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
