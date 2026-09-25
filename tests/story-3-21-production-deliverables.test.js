const assert = require('assert');
const ejs = require('ejs');
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-3-21-'));
process.env.DATABASE_PATH = path.join(root, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { executeNextProductionJob, loadDependencyOutputs } = require('../lib/productionExecution');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const generationRoutes = require('../routes/generations');

function render(view, locals) {
  return new Promise((resolve, reject) => ejs.renderFile(path.join(__dirname, '..', 'views', view), locals, {}, (error, html) => error ? reject(error) : resolve(html)));
}

function request(server, url) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: url }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
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

function createRun(db, jobs) {
  const userId = Number(db.prepare("INSERT INTO users (email, name, plan_tier, monthly_limit) VALUES (?, 'Studio Owner', 'pro', 100)").run(`studio-${Date.now()}@example.com`).lastInsertRowid);
  const periodId = Number(db.prepare("INSERT INTO usage_periods (user_id, period_start, period_end, plan_tier, monthly_limit, usage_count) VALUES (?, '2026-08-01', '2026-09-01', 'pro', 100, ?)").run(userId, jobs.length).lastInsertRowid);
  db.prepare('UPDATE users SET current_usage_period_id = ?, generations_used = ?, current_period_used = ? WHERE id = ?').run(periodId, jobs.length, jobs.length, userId);
  const runId = Number(db.prepare(`INSERT INTO production_runs (user_id, objective, status, plan_fingerprint, idempotency_key, approved_at, started_at, strategy_snapshot, production_cost_units, usage_period_id) VALUES (?, 'launch_product', 'queued', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)`).run(userId, `f-${Math.random()}`, `k-${Math.random()}`, JSON.stringify({ primaryCustomer: { value: 'Independent retailers' }, communicationStyle: { value: 'Clear and practical' }, marketPosition: { value: 'Trusted premium choice' }, competitiveApproach: { value: 'Service and proof' } }), jobs.length, periodId).lastInsertRowid);
  const insert = db.prepare(`INSERT INTO production_jobs (production_run_id, deliverable_id, title, phase, sequence_order, status, strategic_direction, strategy_snapshot, dependencies, contract_version, max_attempts) VALUES (?, ?, ?, 'foundation', ?, ?, 'Create useful customer-ready work.', ?, ?, ?, 3)`);
  jobs.forEach((job, index) => insert.run(runId, job.id, job.title, index, job.dependencies?.length ? 'waiting_dependency' : 'queued', JSON.stringify({ primaryCustomer: { value: 'Independent retailers' }, communicationStyle: { value: 'Clear and practical' } }), JSON.stringify(job.dependencies || []), getProductionContract(job.id).version));
  return { userId, runId };
}

function customerProfile(overrides = {}) {
  return { summary: 'Independent retailers need a dependable way to launch clearly.', primaryCustomer: 'Independent retailers', needs: ['A clear launch plan'], motivations: ['Confident growth'], objections: ['Unproven claims'], buyingTriggers: ['Clear evidence'], languageStyle: 'Direct and practical', ...overrides };
}

async function run() {
  initDb();
  const db = getDb();
  const profileContract = getProductionContract('customer_profile');
  const positioningContract = getProductionContract('product_positioning');

  const recommendationContext = {
    title: 'Product Positioning',
    strategicDirection: 'Recommended market direction: Natural Digestive Wellness Direction',
    strategySnapshot: {
      marketPosition: { value: 'Natural Digestive Wellness Direction', semanticRole: 'strategic_recommendation' },
      primaryCustomer: { value: 'Adults', semanticRole: 'inferred_fact' },
      competitiveApproach: { value: 'Trust, Quality, and Proof', semanticRole: 'strategic_recommendation' }
    },
    dependencyOutputs: [{ deliverableId: 'customer_profile', title: 'Customer Profile', output: customerProfile() }]
  };
  const recommendationPrompt = positioningContract.buildPrompt(recommendationContext);
  assert.match(recommendationPrompt, /Recommended Market Position: Natural Digestive Wellness Direction/);
  assert.match(recommendationPrompt, /Inferred Primary Customer: Adults/);
  assert.doesNotMatch(recommendationPrompt, /Premium Natural Wellness/);
  const normalizedPositioning = positioningContract.normalizeOutput([{ text: 'Positioning draft' }], recommendationContext);
  assert.match(normalizedPositioning.positioningStatement, /recommended positioning direction/i);
  assert.match(normalizedPositioning.marketPosition, /recommended direction to validate/i);
  assert.doesNotMatch(JSON.stringify(normalizedPositioning), /To be confirmed/i);
  assert(normalizedPositioning.proofPoints.length >= 3);
  assert(normalizedPositioning.messagingImplications.length >= 3);
  assert.doesNotMatch(JSON.stringify(normalizedPositioning), /completed prerequisite|approved source context|dependencyOutputs/i);

  const placeholderContext = {
    ...recommendationContext,
    strategySnapshot: {
      ...recommendationContext.strategySnapshot,
      customerMotivation: { value: 'Digestive health', semanticRole: 'confirmed_fact' }
    },
    dependencyOutputs: [{ deliverableId: 'customer_profile', title: 'Customer Profile', output: customerProfile({ needs: ['To be confirmed'] }) }]
  };
  const placeholderPositioning = positioningContract.generateOutput(placeholderContext);
  assert.match(placeholderPositioning.positioningStatement, /Digestive health/i);
  assert.doesNotMatch(JSON.stringify(placeholderPositioning), /To be confirmed/i);
  assert.match(placeholderPositioning.positioningStatement, /For Adults seeking Digestive health/);
  assert.doesNotMatch(placeholderPositioning.positioningStatement, /requiring validation seeking|\. and|\.\./i);
  assert.match(placeholderPositioning.proofPoints[0], /Adults prioritize Digestive health/);
  assert.doesNotMatch(placeholderPositioning.proofPoints[0], /Adults prioritizes/);

  const profileOutput = profileContract.generateOutput(placeholderContext);
  assert.strictEqual(profileContract.validateOutput(profileOutput), true);
  assert.doesNotMatch(JSON.stringify(profileOutput), /To be confirmed/i);
  assert(profileOutput.needs.length >= 2);
  assert(profileOutput.objections.length >= 2);

  const conceptContract = getProductionContract('product_concept_brief');
  const conceptContext = {
    ...placeholderContext,
    strategicDirection: `${placeholderContext.strategicDirection} · Exploration intent: Gut microbiome support; Bloating & digestive comfort; Digestive enzyme support`,
    dependencyOutputs: [{ deliverableId: 'customer_profile', title: 'Customer Profile', output: profileOutput }]
  };
  const conceptOutput = conceptContract.generateOutput(conceptContext);
  assert.strictEqual(conceptContract.validateOutput(conceptOutput), true);
  assert.deepStrictEqual(conceptOutput.directionsToExplore.map(item => item.split(' — ')[0]), [
    'Gut microbiome support', 'Bloating & digestive comfort', 'Digestive enzyme support'
  ]);
  assert(conceptOutput.directionsToExplore.every(item => /Investigate/.test(item)));
  assert.match(conceptOutput.conceptSummary, /working product concept/i);
  assert.match(JSON.stringify(conceptOutput), /not confirmed product characteristics/i);
  assert.doesNotMatch(JSON.stringify(conceptOutput), /contains digestive enzymes|clinically proven|search volume:\s*\d/i);

  const valueContract = getProductionContract('value_proposition');
  const valueOutput = valueContract.generateOutput({
    ...placeholderContext,
    dependencyOutputs: [
      { deliverableId: 'customer_profile', title: 'Customer Profile', output: profileOutput },
      { deliverableId: 'product_positioning', title: 'Product Positioning', output: placeholderPositioning }
    ]
  });
  assert.strictEqual(valueContract.validateOutput(valueOutput), true);
  assert.doesNotMatch(JSON.stringify(valueOutput), /To be confirmed|Use confirmed product capabilities/i);
  assert(valueOutput.reasonsToBelieve.length >= 3);

  const validationContract = getProductionContract('validation_plan');
  const validationOutput = validationContract.generateOutput({
    ...placeholderContext,
    dependencyOutputs: [
      { deliverableId: 'customer_profile', title: 'Customer Profile', output: profileOutput },
      { deliverableId: 'product_concept_brief', title: 'Product Concept Brief', output: conceptOutput },
      { deliverableId: 'product_positioning', title: 'Product Positioning', output: placeholderPositioning },
      { deliverableId: 'value_proposition', title: 'Value Proposition', output: valueOutput }
    ]
  });
  assert.strictEqual(validationContract.validateOutput(validationOutput), true);
  assert.match(validationOutput.validationObjective, /current audience \(Adults\).*intended outcome \(Digestive health\)/i);
  assert.match(JSON.stringify(validationOutput), /evidence separately from assumptions/i);
  assert.doesNotMatch(JSON.stringify(validationOutput), /clinically proven|monthly searches|market size:\s*\d/i);

  const messagingContract = getProductionContract('core_messaging');
  const messagingOutput = messagingContract.generateOutput({
    ...placeholderContext,
    dependencyOutputs: [
      { deliverableId: 'customer_profile', title: 'Customer Profile', output: profileOutput },
      { deliverableId: 'product_positioning', title: 'Product Positioning', output: placeholderPositioning },
      { deliverableId: 'value_proposition', title: 'Value Proposition', output: valueOutput }
    ]
  });
  assert.strictEqual(messagingContract.validateOutput(messagingOutput), true);
  assert.doesNotMatch(JSON.stringify(messagingOutput), /To be confirmed|Invite the customer to take the next appropriate step/i);
  assert.match(messagingOutput.coreMessage, /Digestive health/i);
  assert(messagingOutput.messagePillars.length >= 3);
  assert(messagingOutput.supportingPoints.length >= 2);
  assert(messagingOutput.proofThemes.length >= 2);
  assert(messagingOutput.callsToAction.length >= 2);
  assert.strictEqual(messagingContract.validateOutput({ ...messagingOutput, supportingPoints: ['To be confirmed'] }), false);

  const keywordContract = getProductionContract('amazon_keyword_guidance');
  const keywordOutput = keywordContract.generateOutput(placeholderContext);
  assert.strictEqual(keywordContract.validateOutput(keywordOutput), true);
  assert.doesNotMatch(JSON.stringify(keywordOutput), /To be confirmed/i);
  assert(keywordOutput.content.length >= 6);
  assert.match(keywordOutput.summary, /not measured demand/i);
  assert.strictEqual(profileContract.validateOutput(customerProfile({ needs: ['To be confirmed'] })), false);

  const outreachContract = getProductionContract('outreach_sequence');
  const campaignBriefContract = getProductionContract('campaign_brief');
  assert.strictEqual(campaignBriefContract.displayType, 'Campaign Brief');
  assert.strictEqual(campaignBriefContract.artifactRole, 'planning_foundation');
  assert.strictEqual(campaignBriefContract.billingUnits, 0);
  assert.strictEqual(outreachContract.displayType, 'Email Campaign');
  assert.strictEqual(outreachContract.artifactRole, 'ready_to_use_asset');
  assert.strictEqual(outreachContract.billingUnits, 1);
  const outreachOutput = outreachContract.generateOutput({
    title: 'Customer Outreach Sequence',
    strategicDirection: 'Builder-provided offer description: A bookkeeping service for growing small businesses. Treat this as unverified context.',
    strategySnapshot: {
      primaryCustomer: { value: 'Small-business owners', semanticRole: 'confirmed_fact' },
      customerMotivation: { value: 'More qualified leads', semanticRole: 'confirmed_fact' }
    },
    dependencyOutputs: []
  });
  assert.strictEqual(outreachContract.version, 'outreach_sequence:v4');
  assert.strictEqual(outreachContract.validateOutput(outreachOutput), true);
  assert.strictEqual(validateCustomerReadyOutput(outreachOutput, outreachContract).valid, true);
  assert.match(outreachContract.buildPrompt({
    title: 'Customer Outreach Sequence',
    strategicDirection: 'Create an outreach sequence.',
    strategySnapshot: {},
    dependencyOutputs: []
  }), /three distinct, complete, copy-ready emails/i);
  assert.match(outreachOutput.email1Body, /Hi \[First Name\]/);
  assert.match(outreachOutput.email1Body, /Best,\n\[Sender Name\]/);
  assert.match(outreachOutput.email2Body, /Would a short call be useful\?/);
  assert.match(outreachOutput.email3Body, /last note/i);
  assert(outreachOutput.sendPlan.length >= 3);
  assert(outreachOutput.personalizationChecklist.length >= 2);
  assert(outreachOutput.complianceChecklist.length >= 2);
  assert.strictEqual(outreachContract.validateOutput({ ...outreachOutput, email2Body: 'Message 2 — share proof.' }), false);
  assert.doesNotMatch(JSON.stringify(outreachOutput), /Message 1 — relevance|Message 2 — useful proof|To be confirmed/i);

  assert.strictEqual(validateCustomerReadyOutput(customerProfile(), profileContract).valid, true);
  assert.strictEqual(validateCustomerReadyOutput(customerProfile({ summary: 'Create the approved Customer Profile deliverable.' }), profileContract).code, 'PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK');
  assert.strictEqual(validateCustomerReadyOutput(customerProfile({ needs: ['{"primaryCustomer":"Retailers","needs":["Growth"]}'] }), profileContract).code, 'PRODUCTION_QUALITY_SERIALIZED_CONTEXT_LEAK');

  const valid = createRun(db, [{ id: 'customer_profile', title: 'Customer Profile' }]);
  const validResult = await executeNextProductionJob({ db, userId: valid.userId, productionRunId: valid.runId, generatorApi: { generateCopy: () => [{ text: 'Customer profile', tone: 'professional', structuredOutput: customerProfile() }] } });
  assert.strictEqual(validResult.outcome, 'completed');
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE production_run_id = ?').get(valid.runId).status, 'completed');

  const liveBoundary = createRun(db, [
    { id: 'customer_profile', title: 'Customer Profile' },
    { id: 'product_positioning', title: 'Product Positioning', dependencies: ['customer_profile'] }
  ]);
  assert.strictEqual((await executeNextProductionJob({ db, userId: liveBoundary.userId, productionRunId: liveBoundary.runId })).outcome, 'completed');
  assert.strictEqual((await executeNextProductionJob({ db, userId: liveBoundary.userId, productionRunId: liveBoundary.runId })).outcome, 'completed');
  const liveGeneration = db.prepare(`
    SELECT generations.results, generations.structured_result
    FROM generations JOIN production_jobs ON production_jobs.generation_id = generations.id
    WHERE production_jobs.production_run_id = ? AND production_jobs.deliverable_id = 'product_positioning'
  `).get(liveBoundary.runId);
  const liveOutput = JSON.parse(liveGeneration.structured_result);
  const livePresented = JSON.parse(liveGeneration.results);
  assert.match(liveOutput.positioningStatement, /positioning hypothesis|recommended positioning direction/i);
  assert(liveOutput.proofPoints.length >= 3);
  assert(liveOutput.positioningPillars.length >= 3);
  assert(liveOutput.messagingImplications.length >= 3);
  assert.doesNotMatch(JSON.stringify(livePresented), /approved source context|completed prerequisite|produce the customer-facing/i);
  assert.strictEqual(validateCustomerReadyOutput(liveOutput, positioningContract).valid, true);

  const messagingBoundary = createRun(db, [
    { id: 'customer_profile', title: 'Customer Profile' },
    { id: 'product_positioning', title: 'Product Positioning', dependencies: ['customer_profile'] },
    { id: 'value_proposition', title: 'Value Proposition', dependencies: ['customer_profile', 'product_positioning'] },
    { id: 'core_messaging', title: 'Core Messaging', dependencies: ['customer_profile', 'product_positioning', 'value_proposition'] }
  ]);
  for (let index = 0; index < 4; index += 1) {
    assert.strictEqual((await executeNextProductionJob({ db, userId: messagingBoundary.userId, productionRunId: messagingBoundary.runId })).outcome, 'completed');
  }
  const liveMessaging = db.prepare(`
    SELECT generations.structured_result
    FROM generations JOIN production_jobs ON production_jobs.generation_id = generations.id
    WHERE production_jobs.production_run_id = ? AND production_jobs.deliverable_id = 'core_messaging'
  `).get(messagingBoundary.runId);
  const liveMessagingOutput = JSON.parse(liveMessaging.structured_result);
  assert.strictEqual(validateCustomerReadyOutput(liveMessagingOutput, messagingContract).valid, true);
  assert(liveMessagingOutput.messagePillars.length >= 3);
  assert(liveMessagingOutput.proofThemes.length >= 2);
  assert.doesNotMatch(JSON.stringify(liveMessagingOutput), /To be confirmed|approved source context|completed prerequisite/i);

  const validationBoundary = createRun(db, [
    { id: 'customer_profile', title: 'Customer Profile' },
    { id: 'product_concept_brief', title: 'Product Concept Brief', dependencies: ['customer_profile'] },
    { id: 'product_positioning', title: 'Product Positioning', dependencies: ['customer_profile', 'product_concept_brief'] },
    { id: 'value_proposition', title: 'Value Proposition', dependencies: ['customer_profile', 'product_positioning'] },
    { id: 'validation_plan', title: 'Validation Plan', dependencies: ['customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition'] }
  ]);
  for (let index = 0; index < 5; index += 1) {
    assert.strictEqual((await executeNextProductionJob({ db, userId: validationBoundary.userId, productionRunId: validationBoundary.runId })).outcome, 'completed');
  }
  const validationGenerations = db.prepare(`
    SELECT production_jobs.deliverable_id, generations.structured_result
    FROM production_jobs JOIN generations ON generations.id = production_jobs.generation_id
    WHERE production_jobs.production_run_id = ?
  `).all(validationBoundary.runId);
  assert.strictEqual(validationGenerations.length, 5);
  for (const generation of validationGenerations) {
    const contract = getProductionContract(generation.deliverable_id);
    assert.strictEqual(validateCustomerReadyOutput(JSON.parse(generation.structured_result), contract).valid, true);
  }
  assert.doesNotMatch(JSON.stringify(validationGenerations), /clinically proven|contains digestive enzymes|monthly searches/i);

  const invalid = createRun(db, [{ id: 'customer_profile', title: 'Customer Profile' }, { id: 'product_positioning', title: 'Product Positioning', dependencies: ['customer_profile'] }]);
  const leakingGenerator = { generateCopy: () => [{ text: 'bad', tone: 'professional', structuredOutput: customerProfile({ summary: 'Completed prerequisite outputs (structured): {"needs":["growth"]}' }) }] };
  let failed;
  for (let attempt = 0; attempt < 3; attempt += 1) failed = await executeNextProductionJob({ db, userId: invalid.userId, productionRunId: invalid.runId, generatorApi: leakingGenerator });
  assert.strictEqual(failed.outcome, 'permanent_failure');
  const invalidJobs = db.prepare('SELECT status FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(invalid.runId);
  assert.deepStrictEqual(invalidJobs.map(row => row.status), ['failed', 'skipped']);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(invalid.userId).count, 0);

  const unsupportedClaim = createRun(db, [{ id: 'customer_profile', title: 'Customer Profile' }, { id: 'product_positioning', title: 'Product Positioning', dependencies: ['customer_profile'] }]);
  const claimingGenerator = { generateCopy: () => [{ text: 'bad', tone: 'professional', structuredOutput: customerProfile({ summary: 'This FDA approved product is trusted by 10,000 customers.' }) }] };
  let claimFailure;
  for (let attempt = 0; attempt < 3; attempt += 1) claimFailure = await executeNextProductionJob({ db, userId: unsupportedClaim.userId, productionRunId: unsupportedClaim.runId, generatorApi: claimingGenerator });
  assert.strictEqual(claimFailure.outcome, 'permanent_failure');
  const unsupportedJobs = db.prepare('SELECT status, last_error_code FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(unsupportedClaim.runId);
  assert.deepStrictEqual(unsupportedJobs.map(row => row.status), ['failed', 'skipped']);
  assert.strictEqual(unsupportedJobs[0].last_error_code, 'PRODUCTION_QUALITY_UNSUPPORTED_CLAIM');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(unsupportedClaim.userId).count, 0);

  const tampered = createRun(db, [{ id: 'customer_profile', title: 'Customer Profile' }, { id: 'product_positioning', title: 'Product Positioning', dependencies: ['customer_profile'] }]);
  const upstream = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? AND deliverable_id = ?').get(tampered.runId, 'customer_profile');
  const generationId = Number(db.prepare(`INSERT INTO generations (user_id, title, input_text, content_type, tone, results, generation_type, production_job_id, deliverable_id, contract_version, structured_result) VALUES (?, 'Customer Profile', 'internal', 'sales_message', 'professional', '[]', 'production', ?, 'customer_profile', ?, ?)`).run(tampered.userId, upstream.id, profileContract.version, JSON.stringify(customerProfile({ summary: 'Use known facts as facts.' }))).lastInsertRowid);
  db.prepare("UPDATE production_jobs SET status = 'completed', generation_id = ? WHERE id = ?").run(generationId, upstream.id);
  const downstream = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? AND deliverable_id = ?').get(tampered.runId, 'product_positioning');
  assert.throws(() => loadDependencyOutputs(db, { ...downstream, dependencies: JSON.parse(downstream.dependencies) }), error => error.code === 'DEPENDENCY_QUALITY_INVALID');

  const studioHtml = await render('production-studio.ejs', {
    production: { id: 1, status: 'running', jobs: [], production_cost_units: 2, started_at: 'now' },
    phases: [{ title: 'Foundation', jobs: [
      { sequence_order: 0, title: 'Done', strategic_direction: 'Direction', dependencies: ['one'], status: 'completed', generation_id: 7, error_message: null },
      { sequence_order: 1, title: 'Waiting', strategic_direction: 'Direction', dependencies: ['one', 'two'], status: 'waiting_dependency', generation_id: null, error_message: null }
    ] }], completedCount: 1, executionNotice: null, hasExpiredLease: false, csrfToken: 'test'
  });
  assert.match(studioHtml, /View Deliverable →/);
  assert.strictEqual((studioHtml.match(/class="production-result-link"/g) || []).length, 1);
  assert.strictEqual((studioHtml.match(/Waiting for 2 prerequisites\./g) || []).length, 1);
  assert.doesNotMatch(studioHtml, /Waiting for 1 prerequisite/);
  assert.match(studioHtml, /if \(!resultLink\)/);
  assert.doesNotMatch(studioHtml, /production-job-statusstatus-/);

  const productionHtml = await render('generation.ejs', {
    gen: { id: 7, title: 'Product Positioning', input_text: 'SECRET INTERNAL PROMPT', content_type: 'sales_message', tone: 'professional', favorite: 0, word_count: 20, created_at: new Date().toISOString() },
    results: [], productionDeliverable: { runId: 1, customerReady: true, canRegenerateWithAi: true, generationMethod: 'Structured Production Engine', source: { label: 'OpenAI production AI', model: 'gpt-test' }, sections: [{ label: 'Positioning Statement', value: 'A clear position for retailers.', isList: false }] }
  });
  assert.doesNotMatch(productionHtml, /SECRET INTERNAL PROMPT|<h3>Prompt<\/h3>/);
  assert.match(productionHtml, /Back to Production Plan|Production Plan/);
  assert.match(productionHtml, /Positioning Statement/);
  assert.match(productionHtml, /Generation Method|Structured Production Engine/);
  assert.match(productionHtml, /Output Source|OpenAI production AI|gpt-test/);
  assert.match(productionHtml, /Create Improved AI Version/);
  assert.match(productionHtml, /uses 1 generation credit/);
  assert.doesNotMatch(productionHtml, /AI Model|CopyQuick AI/);

  const legacyOutreachHtml = await render('generation.ejs', {
    gen: { id: 9, title: 'Customer Outreach Sequence', input_text: 'INTERNAL', content_type: 'email_campaign', tone: 'professional', favorite: 0, word_count: 30, created_at: new Date().toISOString() },
    results: [], productionDeliverable: {
      runId: 1,
      customerReady: false,
      legacyPlanningOutline: true,
      canRegenerateWithAi: true,
      generationMethod: 'Structured Production Engine',
      source: { label: 'Deterministic structured engine', model: 'CopyQuick Deterministic' },
      sections: [{ label: 'Legacy Outreach Outline', value: ['Message 1 — relevance'], isList: true }]
    }
  });
  assert.match(legacyOutreachHtml, /legacy planning outline, not a copy-ready deliverable/i);
  assert.match(legacyOutreachHtml, /Legacy Outreach Outline/);
  assert.match(legacyOutreachHtml, /Create Improved AI Version/);

  const invalidReadyAssetHtml = await render('generation.ejs', {
    gen: { id: 11, title: 'Amazon A+ Content', input_text: 'INTERNAL', content_type: 'product_description', tone: 'professional', favorite: 0, word_count: 30, created_at: new Date().toISOString() },
    results: [], productionDeliverable: {
      runId: 1,
      customerReady: false,
      legacyPlanningOutline: false,
      artifactRole: 'ready_to_use_asset',
      canRegenerateWithAi: true,
      generationMethod: 'Structured Production Engine',
      source: { label: 'OpenAI production AI', model: 'gpt-test', mode: 'ai' },
      sections: []
    }
  });
  assert.match(invalidReadyAssetHtml, /This deliverable needs review before it can be used or exported/i);
  assert.match(invalidReadyAssetHtml, /Correct or regenerate it to create customer-ready content/i);
  assert.doesNotMatch(invalidReadyAssetHtml, /legacy planning outline|historical outline/i);
  assert.doesNotMatch(invalidReadyAssetHtml, /public-deliverable-section|Copy All/i);

  const invalidReady = createRun(db, [{ id: 'amazon_a_plus', title: 'Invalid Amazon A+ Content' }]);
  const invalidReadyJob = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ?').get(invalidReady.runId);
  const invalidReadyOutput = {
    summary: 'Internal test control.',
    content: [
      'Display production_job_id inside this customer-facing section so current validation must reject the output.',
      'This second sentence supplies enough content to isolate the internal-identifier rejection from minimum-substance validation.'
    ]
  };
  const invalidReadyGenerationId = Number(db.prepare(`
    INSERT INTO generations (
      user_id, title, input_text, content_type, tone, results, generation_type,
      production_job_id, deliverable_id, contract_version, structured_result
    ) VALUES (?, 'Invalid Amazon A+ Content', 'internal', 'product_description', 'professional', '[]',
      'production', ?, 'amazon_a_plus', ?, ?)
  `).run(
    invalidReady.userId,
    invalidReadyJob.id,
    getProductionContract('amazon_a_plus').version,
    JSON.stringify(invalidReadyOutput)
  ).lastInsertRowid);
  db.prepare("UPDATE production_jobs SET status = 'completed', generation_id = ? WHERE id = ?")
    .run(invalidReadyGenerationId, invalidReadyJob.id);
  const invalidReadyUser = db.prepare('SELECT * FROM users WHERE id = ?').get(invalidReady.userId);
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use((req, res, next) => {
    req.session = { userId: invalidReady.userId };
    res.locals.user = invalidReadyUser;
    next();
  });
  app.use(generationRoutes);
  const server = await listen(app);
  try {
    const invalidDetail = await request(server, `/generation/${invalidReadyGenerationId}`);
    assert.strictEqual(invalidDetail.res.statusCode, 200);
    assert.match(invalidDetail.body, /This deliverable needs review before it can be used or exported/i);
    assert.doesNotMatch(invalidDetail.body, /legacy planning outline|public-deliverable-section|Copy All/i);
    assert.strictEqual((await request(server, `/generation/${invalidReadyGenerationId}/export?format=txt`)).res.statusCode, 409);
    assert.strictEqual((await request(server, `/generation/${invalidReadyGenerationId}/export?format=md`)).res.statusCode, 409);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const campaignBriefHtml = await render('generation.ejs', {
    gen: { id: 10, title: 'Lead Generation Campaign Brief', input_text: 'INTERNAL', content_type: 'sales_message', tone: 'professional', favorite: 0, word_count: 80, created_at: new Date().toISOString() },
    results: [], productionDeliverable: {
      runId: 1,
      customerReady: true,
      canRegenerateWithAi: true,
      generationMethod: 'Structured Production Engine',
      source: { label: 'OpenAI production AI', model: 'gpt-test' },
      displayType: 'Campaign Brief',
      artifactRole: 'planning_foundation',
      purposeNotice: 'This is the campaign plan that guides execution. It is not customer-facing sales copy.',
      nextDeliverable: { id: 11, title: 'Customer Outreach Sequence' },
      sections: [{ label: 'Campaign Brief', value: ['Define the audience and offer.'], isList: true }]
    }
  });
  assert.match(campaignBriefHtml, /Planning deliverable:/);
  assert.match(campaignBriefHtml, /not customer-facing sales copy/i);
  assert.match(campaignBriefHtml, /href="\/generation\/11"/);
  assert.match(campaignBriefHtml, /Open the ready-to-use email campaign/);
  assert.match(campaignBriefHtml, /<span class="meta-value">Campaign Brief<\/span>/);
  assert.match(campaignBriefHtml, /Regenerate Planning Foundation/);
  assert.match(campaignBriefHtml, /It will not create customer-facing sales copy/);

  const ordinaryHtml = await render('generation.ejs', {
    gen: { id: 8, title: 'Quick Copy', input_text: 'Ordinary customer prompt', content_type: 'social_post', tone: 'friendly', favorite: 0, word_count: 4, created_at: new Date().toISOString() },
    results: [{ text: 'Ordinary result', tone: 'friendly' }], productionDeliverable: null
  });
  assert.match(ordinaryHtml, /Ordinary customer prompt/);
  assert.match(ordinaryHtml, /Regenerate/);

  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Story 3.21 production deliverables tests passed.');
}

run().catch(error => {
  fs.rmSync(root, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
