const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan, derivePlanningStage } = require('../lib/buildPlanEngine');
const { createApprovedProductionSet, createDefaultSelection } = require('../lib/buildPlanApproval');
const { getProductionContract } = require('../lib/productionContracts');
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function understanding(overrides = {}) {
  return {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    intendedOutcome: confirmed('everyday_wellness', 'Everyday wellness'),
    conceptMaturity: confirmed('formula_in_mind', 'Ingredients or formula in mind'),
    targetAudience: confirmed('health-conscious adults', 'Health-conscious adults'),
    customerMotivation: confirmed('solve_problem', 'It solves a clear problem'),
    salesChannel: confirmed('amazon', 'Amazon'),
    competitiveDifferentiation: confirmed('partial', 'It is different in a few ways'),
    launchStage: confirmed('ready', 'Ready to launch'),
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
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'idea_only', launchStage: 'idea' }), 'validate');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'direction_no_formula', launchStage: 'idea' }), 'validate');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'in_development', launchStage: 'development' }), 'develop');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'finalized', launchStage: 'ready' }), 'prepare_launch');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'finalized', launchStage: 'selling' }), 'optimize');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'finalized', launchStage: 'idea' }), 'validate');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'idea_only', launchStage: 'ready' }), 'validate');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'in_development', launchStage: 'ready' }), 'develop');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'formula_in_mind', launchStage: 'ready' }), 'prepare_launch');
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'unsure', launchStage: 'ready' }), null);
  assert.strictEqual(derivePlanningStage({ conceptMaturity: 'formula_in_mind', launchStage: null }), null);

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
  assert(deliverables(amazonPlan).some((item) => /Recommended market direction: Everyday Wellness Direction/.test(item.strategicDirection)));
  assert(!JSON.stringify(amazonPlan).includes('Premium Natural Wellness'));
  assert(deliverables(amazonPlan).every((item) => ['essential', 'recommended', 'optional'].includes(item.recommendationLevel)));

  const foundation = amazonPlan.phases[0].deliverables;
  const foundationIds = foundation.map((item) => item.id);
  assert(foundationIds.indexOf('customer_profile') < foundationIds.indexOf('product_positioning'));
  assert(foundationIds.indexOf('product_positioning') < foundationIds.indexOf('value_proposition'));
  assert(foundationIds.indexOf('value_proposition') < foundationIds.indexOf('core_messaging'));
  assert.deepStrictEqual(foundation.find((item) => item.id === 'core_messaging').dependencies, [
    'customer_profile', 'product_positioning', 'value_proposition'
  ]);

  const exploration = {
    value: ['microbiome_support', 'bloating_comfort', 'explore_digestive_enzyme_support'],
    label: 'Gut microbiome support; Bloating & digestive comfort; Digestive enzyme support',
    confidence: 1,
    source: 'user_confirmed',
    semanticRole: 'exploration_intent'
  };
  const validateFacts = understanding({
    intendedOutcome: confirmed('digestive_wellness', 'Digestive health'),
    conceptMaturity: confirmed('idea_only', 'I only have the product idea'),
    launchStage: { value: 'idea', label: 'Idea or early concept', confidence: 0.85, source: 'inference' },
    targetAudience: { value: 'adults', label: 'Adults', confidence: 0.85, source: 'inference' },
    competitiveDifferentiation: undefined,
    brand: undefined,
    productExplorationDirections: exploration
  });
  const validateStrategy = strategyFor(validateFacts, 'An herbal dietary supplement for adults that I plan to sell on Amazon.');
  const validatePlan = planFor(validateFacts, validateStrategy, 'An herbal dietary supplement for adults that I plan to sell on Amazon.');
  assert.strictEqual(validatePlan.readiness.ready, true);
  assert.strictEqual(validatePlan.planningStage, 'validate');
  assert.deepStrictEqual(validatePlan.phases.map((phase) => phase.title), ['Define & Validate', 'Explore Market Entry']);
  assert.deepStrictEqual(ids(validatePlan), [
    'customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition', 'validation_plan', 'amazon_keyword_guidance'
  ]);
  assert.strictEqual(validatePlan.summary.deliverableCount, 6);
  assert.match(validatePlan.summary.whyThisPlan, /validates the opportunity before launch execution/i);
  assert.match(validatePlan.summary.whyThisPlan, /search directions worth investigating/i);
  const validateItems = deliverables(validatePlan);
  assert.strictEqual(validateItems.find((item) => item.id === 'customer_profile').recommendationLevel, 'essential');
  const conceptBrief = validateItems.find((item) => item.id === 'product_concept_brief');
  assert.strictEqual(conceptBrief.recommendationLevel, 'essential');
  assert.deepStrictEqual(conceptBrief.dependencies, ['customer_profile']);
  assert.match(conceptBrief.strategicDirection, /Exploration intent: Gut microbiome support; Bloating & digestive comfort; Digestive enzyme support/);
  assert.strictEqual(validateItems.find((item) => item.id === 'product_positioning').recommendationLevel, 'recommended');
  assert.match(validateItems.find((item) => item.id === 'product_positioning').reason, /provisional|hypothesis/i);
  assert.deepStrictEqual(validateItems.find((item) => item.id === 'product_positioning').dependencies, ['customer_profile', 'product_concept_brief']);
  assert.strictEqual(validateItems.find((item) => item.id === 'value_proposition').recommendationLevel, 'recommended');
  assert.match(validateItems.find((item) => item.id === 'value_proposition').reason, /hypothesis/i);
  const validationPlan = validateItems.find((item) => item.id === 'validation_plan');
  assert.strictEqual(validationPlan.recommendationLevel, 'recommended');
  assert.deepStrictEqual(validationPlan.dependencies, ['customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition']);
  const validateKeyword = validateItems.find((item) => item.id === 'amazon_keyword_guidance');
  assert.deepStrictEqual(validateKeyword.dependencies, ['product_concept_brief', 'product_positioning']);
  assert.match(validateKeyword.reason, /hypotheses to investigate/i);
  assert.match(validateKeyword.strategicDirection, /not measured demand or competition data/i);
  assert.match(validateKeyword.strategicDirection, /Recommended market direction: Natural Digestive Wellness Direction/);
  assert(!JSON.stringify(validatePlan).includes('Premium Natural Wellness'));
  [
    'core_messaging', 'amazon_listing', 'amazon_bullet_points', 'product_image_guidance',
    'launch_announcement', 'educational_content', 'social_launch_campaign'
  ].forEach((id) => assert(!ids(validatePlan).includes(id), `${id} must be deferred at validate stage`));
  const validateSelection = createDefaultSelection(validatePlan);
  assert.deepStrictEqual(validateSelection.selectedDeliverableIds, ids(validatePlan));
  assert(!validateSelection.selectedDeliverableIds.includes('amazon_listing'));
  const validateApproval = createApprovedProductionSet({
    plan: validatePlan,
    selection: validateSelection,
    strategyResult: validateStrategy
  });
  assert.strictEqual(validateApproval.valid, true);
  assert.deepStrictEqual(validateApproval.productionSet.productionOrder, [
    'customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition', 'validation_plan', 'amazon_keyword_guidance'
  ]);
  assert(validateApproval.productionSet.selectedDeliverables.every((item) =>
    item.dependencies.every((dependency) => validateSelection.selectedDeliverableIds.includes(dependency))
  ));
  assert.match(validateStrategy.strategy.launchApproach.value, /Validate Demand Before Scaling/);

  const directionPlan = planFor(understanding({
    conceptMaturity: confirmed('direction_no_formula', 'Direction, but no formula'),
    launchStage: { value: 'idea', label: 'Idea or early concept', confidence: 0.85, source: 'inference' }
  }));
  assert.strictEqual(directionPlan.planningStage, 'validate');
  assert(!ids(directionPlan).includes('amazon_listing'));

  const developFacts = understanding({
    conceptMaturity: confirmed('in_development', 'A formula or product is already being developed'),
    launchStage: { value: 'development', label: 'In development', confidence: 0.85, source: 'inference' }
  });
  const developPlan = planFor(developFacts);
  assert.strictEqual(developPlan.planningStage, 'develop');
  assert.deepStrictEqual(ids(developPlan), [
    'customer_profile', 'product_positioning', 'value_proposition', 'core_messaging', 'amazon_keyword_guidance'
  ]);
  assert.deepStrictEqual(deliverables(developPlan).find((item) => item.id === 'amazon_keyword_guidance').dependencies, ['product_positioning']);
  assert(!ids(developPlan).includes('launch_announcement'));
  assert(!ids(developPlan).includes('product_image_guidance'));

  assert.strictEqual(amazonPlan.planningStage, 'prepare_launch');
  const sellingPlan = planFor(understanding({ launchStage: confirmed('selling', 'Already selling') }));
  assert.strictEqual(sellingPlan.planningStage, 'optimize');
  assert(ids(sellingPlan).includes('amazon_listing'));
  assert(ids(sellingPlan).includes('launch_announcement'));

  const unresolvedFacts = understanding({ launchStage: confirmed('unsure', "I'm not sure yet") });
  const unresolvedPlan = planFor(unresolvedFacts);
  assert.strictEqual(unresolvedPlan.readiness.ready, false);
  assert.deepStrictEqual(unresolvedPlan.phases, []);

  const keywordContract = getProductionContract('amazon_keyword_guidance');
  const keywordPrompt = keywordContract.buildPrompt({
    title: 'Amazon Search & Keyword Guidance',
    objective: 'launch_product',
    strategySnapshot: validateStrategy.strategy,
    strategicDirection: validateKeyword.strategicDirection,
    dependencyOutputs: []
  });
  assert.match(keywordPrompt, /hypotheses to investigate/i);
  assert.match(keywordPrompt, /do not claim or invent search volume/i);
  assert.match(keywordPrompt, /competition levels, demand metrics, ranking difficulty, keyword scores/i);
  assert.strictEqual(keywordContract.validateOutput({ summary: 'Themes to investigate', content: ['Digestive wellness'] }), true);
  assert.strictEqual(keywordContract.validateOutput({ summary: 'Measured result', content: ['Search volume: 12000'] }), false);

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
