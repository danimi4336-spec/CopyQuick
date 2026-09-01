const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { buildBusinessReflection } = require('../lib/businessReflection');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { validateApprovedProductionSession } = require('../lib/productionInitialization');
const { buildStrategy } = require('../lib/strategyEngine');
const discoveryRoutes = require('../routes/discovery');

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function request(agent, method, url, body) {
  return new Promise((resolve, reject) => {
    const parameters = new URLSearchParams();
    Object.entries(body || {}).forEach(function([key, value]) {
      if (Array.isArray(value)) value.forEach(function(item) { parameters.append(key, item); });
      else parameters.append(key, value);
    });
    const payload = parameters.toString();
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

async function sessionState(agent) {
  return JSON.parse((await request(agent, 'GET', '/test/session')).body);
}

async function answerCurrent(agent, choice, otherAnswer) {
  const page = await request(agent, 'GET', '/discovery');
  const token = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  const state = await sessionState(agent);
  assert(state.nextQuestion, 'an active discovery question is required');
  return request(agent, 'POST', '/discovery', {
    _csrf: token,
    questionId: state.nextQuestion.id,
    choice,
    ...(otherAnswer ? { otherAnswer } : {})
  });
}

async function answerFreeText(agent, freeTextAnswer, unsure = false) {
  const page = await request(agent, 'GET', '/discovery');
  const token = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  const state = await sessionState(agent);
  assert.strictEqual(state.nextQuestion?.type, 'free_text');
  return request(agent, 'POST', '/discovery', {
    _csrf: token,
    questionId: state.nextQuestion.id,
    ...(freeTextAnswer ? { freeTextAnswer } : {}),
    ...(unsure ? { unsure: 'unsure' } : {})
  });
}

async function begin(agent, description = 'an herbal supplement') {
  await request(agent, 'GET', '/test/authenticate');
  const page = await request(agent, 'GET', '/discovery');
  const token = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  await request(agent, 'POST', '/discovery', {
    _csrf: token,
    questionId: 'initial_description',
    whatBuilding: description
  });
  return sessionState(agent);
}

async function run() {
  const inferredOnly = analyzeDiscovery({
    objective: 'launch_product',
    understanding: {
      businessType: { value: 'physical_product', label: 'Physical Product', confidence: 0.95, source: 'inference' },
      category: { value: 'dietary_supplement', label: 'Dietary Supplement', confidence: 0.96, source: 'inference' }
    },
    answers: { initial_description: 'an herbal supplement' }
  });
  assert.strictEqual(inferredOnly.nextQuestion.id, 'supplement_intended_outcome');
  assert.strictEqual(inferredOnly.planningReadiness.ready, false);

  function known(value, label = value) {
    return { value, label, confidence: 1, source: 'user_confirmed' };
  }

  const establishedSupplement = {
    businessType: known('physical_product', 'Physical Product'),
    category: known('dietary_supplement', 'Dietary Supplement'),
    intendedOutcome: known('digestive_wellness', 'Digestive health'),
    targetAudience: known('adults', 'Adults'),
    salesChannel: known('amazon', 'Amazon'),
    competitiveDifferentiation: known('unsure', "I'm not sure yet")
  };
  const maturityCases = ['direction_no_formula', 'formula_in_mind', 'in_development', 'finalized', 'unsure'];
  maturityCases.forEach(function(conceptMaturity) {
    const result = analyzeDiscovery({
      objective: 'launch_product',
      understanding: { ...establishedSupplement, conceptMaturity: known(conceptMaturity), launchStage: known('idea', 'Idea or early concept') },
      answers: {}
    });
    assert.notStrictEqual(result.nextQuestion?.id, 'supplement_digestive_product_exploration');
  });
  const nonDigestiveIdea = analyzeDiscovery({
    objective: 'launch_product',
    understanding: {
      ...establishedSupplement,
      intendedOutcome: known('energy_focus', 'Energy & focus'),
      conceptMaturity: known('idea_only'),
      launchStage: known('idea', 'Idea or early concept')
    },
    answers: {}
  });
  assert.notStrictEqual(nonDigestiveIdea.nextQuestion?.id, 'supplement_digestive_product_exploration');
  for (const conceptMaturity of ['formula_in_mind', 'finalized']) {
    const ambiguous = analyzeDiscovery({
      objective: 'launch_product',
      understanding: { ...establishedSupplement, conceptMaturity: known(conceptMaturity) },
      answers: {}
    });
    assert.strictEqual(ambiguous.nextQuestion.id, conceptMaturity === 'formula_in_mind'
      ? 'supplement_formula_context'
      : 'supplement_finalized_context');
    assert.strictEqual(ambiguous.nextQuestion.type, 'free_text');
  }

  const nonSupplement = analyzeDiscovery({
    objective: 'launch_product',
    understanding: {
      businessType: known('physical_product', 'Physical Product'),
      customerMotivation: known('solve_problem', 'It solves a clear problem'),
      targetAudience: known('consumers', 'Individual consumers'),
      salesChannel: known('amazon', 'Amazon')
    },
    answers: {}
  });
  assert.strictEqual(nonSupplement.nextQuestion.id, 'launch_stage');
  assert.strictEqual(nonSupplement.nextQuestion.prompt, 'What stage is the product in today?');

  for (const [maturity, expectedStage, expectedApproach] of [
    ['idea_only', 'idea', 'Validate Demand Before Scaling'],
    ['in_development', 'development', 'Build Proof and Audience Before Release']
  ]) {
    const derived = await understandBusiness({
      objective: 'launch_product',
      answer: 'An herbal supplement for adults sold on Amazon',
      existingUnderstanding: {
        intendedOutcome: known('digestive_wellness', 'Digestive health'),
        conceptMaturity: known(maturity),
        targetAudience: known('adults', 'Adults')
      }
    });
    assert.strictEqual(derived.understanding.launchStage.value, expectedStage);
    const strategy = buildStrategy({
      objective: 'launch_product',
      understanding: derived.understanding,
      answers: { initial_description: 'An herbal supplement for adults sold on Amazon' }
    });
    assert.strictEqual(strategy.strategy.launchApproach.value, expectedApproach);
    const reflection = buildBusinessReflection({
      answers: {}, understanding: derived.understanding, planningReadiness: {}
    });
    const launchField = reflection.groups
      .flatMap((group) => group.fields)
      .find((field) => field.key === 'launchStage');
    assert.strictEqual(launchField.value, derived.understanding.launchStage.label);
    assert.notStrictEqual(launchField.confidenceMessage, 'You confirmed this.');
  }

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-22-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate', (req, res) => { req.session.userId = 322; res.redirect('/discovery'); });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.get('/test/invalidate-essential-readiness', (req, res) => {
    req.session.discoverySession.understanding.intendedOutcome = { value: 'unsure', label: "I'm not sure yet", confidence: 1, source: 'user_confirmed' };
    req.session.discoverySession.answers.supplement_intended_outcome = 'unsure';
    req.session.discoverySession.answers.supplement_outcome_exploration = 'unsure';
    req.session.discoverySession.planningReadiness = { ready: true };
    res.sendStatus(204);
  });
  app.get('/test/stale-strategy', (req, res) => {
    req.session.discoverySession.strategyResult.policyVersion = 1;
    res.sendStatus(204);
  });
  app.use(discoveryRoutes);
  const server = await listen(app);

  try {
    const blocked = { server, cookie: '' };
    let state = await begin(blocked);
    assert.strictEqual(state.nextQuestion.id, 'supplement_intended_outcome');
    assert.strictEqual(state.understanding.intendedOutcome, undefined, 'suggested directions must not become facts before selection');

    const intendedOutcomePage = await request(blocked, 'GET', '/discovery');
    assert.match(intendedOutcomePage.body, /What is the primary wellness goal this supplement is intended to support\?/);
    assert.match(intendedOutcomePage.body, /Choose the closest direction for now\. You can refine it later\./);
    for (const value of ['everyday_wellness', 'energy_focus', 'digestive_wellness', 'sleep_stress_support', 'mobility_active_lifestyle', 'immune_health', 'healthy_aging']) {
      assert.match(intendedOutcomePage.body, new RegExp(`value="${value}"`));
    }

    await answerCurrent(blocked, 'unsure');
    state = await sessionState(blocked);
    assert.strictEqual(state.answers.supplement_intended_outcome, 'unsure');
    assert.strictEqual(state.nextQuestion.id, 'supplement_outcome_exploration');
    assert.strictEqual(state.nextQuestion.guidedExploration, true);
    assert.strictEqual(state.nextQuestion.prompt, 'Which wellness goal feels most useful to explore first?');
    assert(state.nextQuestion.options.some((option) => option.value === 'immune_wellness_exploration'));
    assert(state.nextQuestion.options.some((option) => option.value === 'healthy_aging_exploration'));

    await answerCurrent(blocked, 'unsure');
    state = await sessionState(blocked);
    assert.strictEqual(state.understanding.intendedOutcome.value, 'unsure');
    assert.notStrictEqual(state.nextQuestion.id, 'supplement_outcome_exploration');
    assert.strictEqual(state.nextQuestion.id, 'supplement_concept_maturity');

    await answerCurrent(blocked, 'idea_only');
    assert.strictEqual((await sessionState(blocked)).nextQuestion.id, 'target_audience');
    await answerCurrent(blocked, 'consumers');
    state = await sessionState(blocked);
    assert.strictEqual(state.understanding.launchStage.value, 'idea');
    assert.strictEqual(state.understanding.launchStage.label, 'Idea or early concept');
    assert.strictEqual(state.understanding.launchStage.source, 'inference');
    assert.strictEqual(state.nextQuestion.id, 'sales_channel');
    const completed = await answerCurrent(blocked, 'amazon');
    assert.strictEqual(completed.res.headers.location, '/discovery/reflection');
    state = await sessionState(blocked);
    assert.strictEqual(state.nextQuestion, null);
    assert.strictEqual(state.discoveryCompleteForNow, true);
    assert.strictEqual(state.planningReadiness.ready, false);
    assert(state.planningReadiness.unresolvedBlockingRequirements.some((item) => item.id === 'intended_outcome'));
    assert(!state.answers.competitive_differentiation, 'differentiation must be deferred without a known product purpose');

    const reflection = await request(blocked, 'GET', '/discovery/reflection');
    assert.strictEqual(reflection.res.statusCode, 200);
    assert.match(reflection.body, /Intended Customer Outcome/);
    assert.match(reflection.body, /Concept \/ Formulation Stage/);
    assert.match(reflection.body, /Launch Stage/);
    assert.match(reflection.body, /Idea or early concept/);
    assert.match(reflection.body, /I’m highly confident in this understanding\./);
    assert.match(reflection.body, /important decision is still open/);
    assert.doesNotMatch(reflection.body, /We know enough to build a useful strategy/);
    assert.match(reflection.body, /disabled aria-disabled="true"/);
    const reflectionToken = reflection.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    assert.strictEqual((await request(blocked, 'POST', '/discovery/reflection/plan', { _csrf: reflectionToken })).res.statusCode, 409);
    assert.strictEqual((await request(blocked, 'GET', '/discovery/strategy')).res.headers.location, '/discovery/reflection');
    assert.strictEqual((await request(blocked, 'GET', '/discovery/build-plan')).res.headers.location, '/discovery/reflection');
    assert.strictEqual(validateApprovedProductionSession(state).valid, false);

    const explorer = { server, cookie: '' };
    await begin(explorer, 'An herbal dietary supplement for adults that I plan to sell on Amazon.');
    await answerCurrent(explorer, 'digestive_wellness');
    await answerCurrent(explorer, 'idea_only');
    state = await sessionState(explorer);
    assert.strictEqual(state.nextQuestion.id, 'supplement_digestive_product_exploration');
    assert.strictEqual(state.nextQuestion.type, 'multi_choice');
    assert.strictEqual(state.nextQuestion.prompt, 'What should this digestive supplement focus on?');
    assert.strictEqual(state.understanding.productExplorationDirections, undefined);
    assert.deepStrictEqual(state.nextQuestion.options.map((option) => option.value), [
      'microbiome_support', 'digestive_balance', 'bloating_comfort',
      'everyday_digestive_wellness', 'food_specific_digestion', 'fiber_support',
      'occasional_digestive_discomfort', 'explore_digestive_enzyme_support', 'unsure'
    ]);
    const explorationPage = await request(explorer, 'GET', '/discovery');
    assert.match(explorationPage.body, /type="checkbox" name="choices"/);
    assert.match(explorationPage.body, /Anything else you want this product to have or do\?/);
    assert.match(explorationPage.body, /Select everything that fits your idea\. If you&#39;re still deciding, choose the directions you want CopyQuick to explore with you\./);
    const explorationToken = explorationPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];

    const tampered = await request(explorer, 'POST', '/discovery', {
      _csrf: explorationToken,
      questionId: 'supplement_digestive_product_exploration',
      choices: ['bloating_comfort', 'tampered_value'],
      additionalDetail: 'Herbal capsule idea'
    });
    assert.strictEqual(tampered.res.statusCode, 400);
    assert.match(tampered.body, /Choose only the product directions shown below/);
    assert.match(tampered.body, /value="bloating_comfort" checked/);
    assert.match(tampered.body, /Herbal capsule idea/);

    const oversizedChoiceList = await request(explorer, 'POST', '/discovery', {
      _csrf: explorationToken,
      questionId: 'supplement_digestive_product_exploration',
      choices: Array(10).fill('digestive_balance')
    });
    assert.strictEqual(oversizedChoiceList.res.statusCode, 400);
    assert.match(oversizedChoiceList.body, /Choose only the product directions shown below/);

    const conflicting = await request(explorer, 'POST', '/discovery', {
      _csrf: explorationToken,
      questionId: 'supplement_digestive_product_exploration',
      choices: ['unsure', 'digestive_balance']
    });
    assert.strictEqual(conflicting.res.statusCode, 400);
    assert.match(conflicting.body, /by itself/);

    const emptyExploration = await request(explorer, 'POST', '/discovery', {
      _csrf: explorationToken,
      questionId: 'supplement_digestive_product_exploration',
      additionalDetail: 'Text alone does not replace a selection'
    });
    assert.strictEqual(emptyExploration.res.statusCode, 400);

    const oversizedDetail = await request(explorer, 'POST', '/discovery', {
      _csrf: explorationToken,
      questionId: 'supplement_digestive_product_exploration',
      choices: 'digestive_balance',
      additionalDetail: 'x'.repeat(2001)
    });
    assert.strictEqual(oversizedDetail.res.statusCode, 400);
    assert.match(oversizedDetail.body, /under 2000 characters/);

    const extraIdea = 'Herbal capsule using ginger and traditional botanicals.';
    const explored = await request(explorer, 'POST', '/discovery', {
      _csrf: explorationToken,
      questionId: 'supplement_digestive_product_exploration',
      choices: ['digestive_balance', 'bloating_comfort', 'digestive_balance'],
      additionalDetail: extraIdea
    });
    assert.strictEqual(explored.res.statusCode, 303);
    assert.strictEqual(explored.res.headers.location, '/discovery/reflection');
    state = await sessionState(explorer);
    assert.deepStrictEqual(state.answers.supplement_digestive_product_exploration, {
      values: ['digestive_balance', 'bloating_comfort'], additionalDetail: extraIdea
    });
    assert.deepStrictEqual(state.understanding.productExplorationDirections.value, [
      'digestive_balance', 'bloating_comfort'
    ]);
    assert.strictEqual(state.understanding.productExplorationDirections.additionalDetail, extraIdea);
    assert.strictEqual(state.understanding.productExplorationDirections.semanticRole, 'exploration_intent');
    assert.strictEqual(state.understanding.productExplorationDirections.source, 'user_confirmed');
    assert.strictEqual(state.planningReadiness.ready, true);
    assert(state.planningReadiness.knownRequirements.includes('product_exploration'));
    assert(state.planningReadiness.optionalKnowledgeGaps.includes('Competitive Context'));
    assert(!state.answers.competitive_differentiation);

    const explorationReflection = await request(explorer, 'GET', '/discovery/reflection');
    assert.match(explorationReflection.body, /Product Exploration/);
    assert.match(explorationReflection.body, /Guided exploration/);
    assert.match(explorationReflection.body, /Regularity &amp; digestive balance/);
    assert.match(explorationReflection.body, /Bloating &amp; digestive comfort/);
    assert.match(explorationReflection.body, /Herbal capsule using ginger and traditional botanicals\./);
    assert.match(explorationReflection.body, /not confirmed formulation details or product claims/);
    assert.doesNotMatch(explorationReflection.body, /name="field" value="productExplorationDirections"/);
    assert.doesNotMatch(explorationReflection.body, /digestive_balance/);
    const explorationPlanToken = explorationReflection.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    await request(explorer, 'POST', '/discovery/reflection/plan', { _csrf: explorationPlanToken });
    state = await sessionState(explorer);
    assert.strictEqual(state.strategyResult.strategy.marketPosition.value, 'Natural Digestive Wellness Direction');
    assert.strictEqual(state.strategyResult.strategy.marketPosition.semanticRole, 'strategic_recommendation');
    assert.strictEqual(state.strategyResult.strategy.primaryCustomer.value, 'Adults');
    assert.strictEqual(state.strategyResult.strategy.primaryCustomer.semanticRole, 'inferred_fact');
    assert.strictEqual(state.strategyResult.status, 'Strategy Ready — Open Decisions');
    assert(state.strategyResult.recommendations.some((item) => /Further segment the primary customer/.test(item.recommendation)));
    assert(state.strategyResult.recommendations.some((item) => /Explore a digestive-wellness concept/.test(item.recommendation)));
    assert(state.strategyResult.assumptions.some((item) => /directions to investigate/.test(item)));
    assert(!JSON.stringify(state.strategyResult).includes('contains digestive enzymes'));
    assert(!JSON.stringify(state.strategyResult).includes('clinically proven'));

    await request(explorer, 'GET', '/test/stale-strategy');
    assert.strictEqual((await request(explorer, 'GET', '/discovery/strategy')).res.headers.location, '/discovery/reflection');
    state = await sessionState(explorer);
    assert.strictEqual(state.strategyResult, null);
    assert.strictEqual(state.buildPlan, null);

    const uncertainExplorer = { server, cookie: '' };
    await begin(uncertainExplorer, 'An herbal dietary supplement for adults that I plan to sell on Amazon.');
    await answerCurrent(uncertainExplorer, 'digestive_wellness');
    await answerCurrent(uncertainExplorer, 'idea_only');
    const uncertainPage = await request(uncertainExplorer, 'GET', '/discovery');
    const uncertainToken = uncertainPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const uncertainResult = await request(uncertainExplorer, 'POST', '/discovery', {
      _csrf: uncertainToken,
      questionId: 'supplement_digestive_product_exploration',
      choices: 'unsure'
    });
    assert.strictEqual(uncertainResult.res.headers.location, '/discovery/reflection');
    state = await sessionState(uncertainExplorer);
    assert.strictEqual(state.understanding.productExplorationDirections.value, 'unsure');
    assert.strictEqual(state.planningReadiness.ready, true);
    assert.strictEqual(state.nextQuestion, null);
    assert(state.planningReadiness.unresolvedNonBlockingRequirements.some((item) => item.id === 'product_exploration'));
    const uncertainReflection = await request(uncertainExplorer, 'GET', '/discovery/reflection');
    const uncertainPlanToken = uncertainReflection.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    await request(uncertainExplorer, 'POST', '/discovery/reflection/plan', { _csrf: uncertainPlanToken });
    state = await sessionState(uncertainExplorer);
    assert(state.strategyResult.recommendations.some((item) => /Define the digestive product direction/.test(item.recommendation)));

    const customOutcome = { server, cookie: '' };
    await begin(customOutcome);
    const emptyCustomOutcome = await answerCurrent(customOutcome, 'other');
    assert.strictEqual(emptyCustomOutcome.res.statusCode, 400);
    state = await sessionState(customOutcome);
    assert.strictEqual(state.nextQuestion.id, 'supplement_intended_outcome');
    await answerCurrent(customOutcome, 'other', 'Menopause wellness support');
    state = await sessionState(customOutcome);
    assert.deepStrictEqual(state.answers.supplement_intended_outcome, {
      value: 'other', detail: 'Menopause wellness support'
    });
    assert.strictEqual(state.understanding.intendedOutcome.value, 'Menopause wellness support');
    assert.strictEqual(state.understanding.intendedOutcome.label, 'Menopause wellness support');
    assert.strictEqual(state.nextQuestion.id, 'supplement_concept_maturity');

    const ready = { server, cookie: '' };
    await begin(ready);
    await answerCurrent(ready, 'digestive_wellness');
    state = await sessionState(ready);
    assert.strictEqual(state.understanding.intendedOutcome.value, 'digestive_wellness');
    assert.strictEqual(state.understanding.intendedOutcome.label, 'Digestive health');
    assert.strictEqual(state.nextQuestion.id, 'supplement_concept_maturity');
    await answerCurrent(ready, 'direction_no_formula');
    await answerCurrent(ready, 'consumers');
    const directionComplete = await answerCurrent(ready, 'amazon');
    state = await sessionState(ready);
    assert.strictEqual(directionComplete.res.headers.location, '/discovery/reflection');
    assert.strictEqual(state.nextQuestion, null);
    assert.strictEqual(state.answers.competitive_differentiation, undefined);
    state = await sessionState(ready);
    assert.strictEqual(state.planningReadiness.ready, true, 'nonessential differentiation uncertainty must not block planning');
    assert(state.planningReadiness.knownRequirements.includes('launch_stage'));
    assert(state.planningReadiness.optionalKnowledgeGaps.includes('Competitive Context'));
    assert.strictEqual(state.understanding.ingredients, undefined);
    assert.strictEqual(state.understanding.claimsEvidence, undefined);

    const readyReflection = await request(ready, 'GET', '/discovery/reflection');
    assert.match(readyReflection.body, /We know enough to build a useful strategy/);
    assert.match(readyReflection.body, /Intended Customer Outcome/);
    assert.match(readyReflection.body, /Digestive health/);
    assert.doesNotMatch(readyReflection.body, /digestive_wellness/);
    const readyToken = readyReflection.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const planned = await request(ready, 'POST', '/discovery/reflection/plan', { _csrf: readyToken });
    assert.strictEqual(planned.res.statusCode, 303);
    assert.strictEqual(planned.res.headers.location, '/discovery/strategy');
    assert.strictEqual((await request(ready, 'GET', '/discovery/strategy')).res.statusCode, 200);
    const buildPlanPage = await request(ready, 'GET', '/discovery/build-plan');
    assert.strictEqual(buildPlanPage.res.statusCode, 200);
    const approvalToken = buildPlanPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    await request(ready, 'GET', '/test/invalidate-essential-readiness');
    const blockedApproval = await request(ready, 'POST', '/discovery/build-plan/approve', { _csrf: approvalToken });
    assert.strictEqual(blockedApproval.res.headers.location, '/discovery/build-plan');
    assert.strictEqual(Boolean((await sessionState(ready)).approvedProductionSet), false);

    const existingProduct = { server, cookie: '' };
    await begin(existingProduct, 'An herbal dietary supplement for adults that I plan to sell on Amazon.');
    await answerCurrent(existingProduct, 'digestive_wellness');
    await answerCurrent(existingProduct, 'finalized');
    state = await sessionState(existingProduct);
    assert.strictEqual(state.nextQuestion.id, 'supplement_finalized_context');
    assert.strictEqual(state.nextQuestion.type, 'free_text');
    assert.strictEqual(state.planningReadiness.ready, false);
    const definitionPage = await request(existingProduct, 'GET', '/discovery');
    assert.match(definitionPage.body, /What is the finished supplement product\?/);
    assert.match(definitionPage.body, /name="freeTextAnswer"/);
    assert.match(definitionPage.body, /name="unsure"/);
    assert.strictEqual((await answerFreeText(existingProduct, '')).res.statusCode, 400);
    const productDescription = 'A shelf-ready herbal capsule with a finalized label and packaging.';
    await answerFreeText(existingProduct, productDescription);
    state = await sessionState(existingProduct);
    assert.strictEqual(state.understanding.existingProductDefinition.value, productDescription);
    assert.strictEqual(state.understanding.existingProductDefinition.semanticRole, 'builder_provided_product_context');
    assert.strictEqual(state.understanding.ingredients, undefined);
    assert.strictEqual(state.understanding.claimsEvidence, undefined);
    assert.strictEqual(state.nextQuestion.id, 'supplement_launch_stage');
    await answerCurrent(existingProduct, 'ready');
    state = await sessionState(existingProduct);
    assert.strictEqual(state.nextQuestion.id, 'competitive_differentiation');
    await answerCurrent(existingProduct, 'unsure');
    const existingReflection = await request(existingProduct, 'GET', '/discovery/reflection');
    assert.match(existingReflection.body, /Builder-Provided Product Context/);
    assert.match(existingReflection.body, /not independent verification/);
    assert.doesNotMatch(existingReflection.body, /name="field" value="existingProductDefinition"/);
    const existingToken = existingReflection.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    await request(existingProduct, 'POST', '/discovery/reflection/plan', { _csrf: existingToken });
    await request(existingProduct, 'GET', '/discovery/build-plan');
    state = await sessionState(existingProduct);
    assert(state.strategyResult.assumptions.some(item => /builder-provided context/.test(item)));
    assert(JSON.stringify(state.buildPlan).includes('Builder-provided product context'));
    assert(JSON.stringify(state.buildPlan).includes('not proof of ingredients, efficacy, claims, or substantiation'));

    for (const [maturity, questionId] of [
      ['formula_in_mind', 'supplement_formula_context'],
      ['in_development', 'supplement_development_context'],
      ['finalized', 'supplement_finalized_context']
    ]) {
      const evaluation = analyzeDiscovery({
        objective: 'launch_product',
        understanding: { ...establishedSupplement, conceptMaturity: known(maturity) },
        answers: {}
      });
      assert.strictEqual(evaluation.nextQuestion.id, questionId);
      assert.strictEqual(evaluation.planningReadiness.ready, false);
    }
    const unresolvedExistingProduct = analyzeDiscovery({
      objective: 'launch_product',
      understanding: {
        ...establishedSupplement,
        conceptMaturity: known('finalized'),
        launchStage: known('ready', 'Ready to launch'),
        existingProductDefinition: known('unsure', "I'm not sure yet")
      },
      answers: { supplement_finalized_context: 'unsure' }
    });
    assert.strictEqual(unresolvedExistingProduct.nextQuestion, null);
    assert.strictEqual(unresolvedExistingProduct.discoveryCompleteForNow, true);
    assert.strictEqual(unresolvedExistingProduct.planningReadiness.ready, false);
    assert(unresolvedExistingProduct.planningReadiness.unresolvedBlockingRequirements
      .some(item => item.id === 'existing_product_definition'));

    console.log('Story 3.22 Adaptive Product Discovery & Meaningful Readiness tests passed');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
