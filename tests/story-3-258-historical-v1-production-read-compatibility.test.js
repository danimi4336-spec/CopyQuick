const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-historical-v1-read-'));
process.env.DATABASE_URL = path.join(root, 'copyquick.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'historical-v1-read-test';
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_PRODUCTION_ENABLED = 'false';
process.env.RESEARCH_ENABLED = 'false';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const generationRoutes = require('../routes/generations');
const { generateDeliverable } = require('../lib/generationService');
const { executeNextProductionJob } = require('../lib/productionExecution');
const { getProductionContract } = require('../lib/productionContracts');
const {
  resolveProductionReadArtifact,
  supportedHistoricalProductionPairs
} = require('../lib/productionHistoricalReadCompatibility');

const ORDER = Object.freeze([
  'customer_profile', 'product_positioning', 'value_proposition', 'core_messaging',
  'product_image_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign'
]);

const DEPENDENCIES = Object.freeze({
  customer_profile: [],
  product_positioning: ['customer_profile'],
  value_proposition: ['customer_profile', 'product_positioning'],
  core_messaging: ['customer_profile', 'product_positioning', 'value_proposition'],
  product_image_guidance: ['product_positioning'],
  launch_announcement: ['core_messaging'],
  educational_content: ['core_messaging'],
  social_launch_campaign: ['core_messaging', 'launch_announcement']
});

const TITLES = Object.freeze({
  customer_profile: 'Customer Profile',
  product_positioning: 'Product Positioning',
  value_proposition: 'Value Proposition',
  core_messaging: 'Core Messaging',
  product_image_guidance: 'Product Image Guidance',
  launch_announcement: 'Launch Announcement',
  educational_content: 'Educational Launch Content',
  social_launch_campaign: 'Social Launch Campaign'
});

function safeOutput(id) {
  const outputs = {
    customer_profile: {
      summary: 'Independent shop owners need practical launch guidance that connects a clear offer with everyday customer decisions.',
      primaryCustomer: 'Independent shop owners preparing a new seasonal product for existing customers',
      needs: ['A clear explanation of the product purpose and the practical reason a customer might consider it'],
      motivations: ['Introduce the product with language that feels useful, direct, and consistent with the established business'],
      objections: ['Customers may need more context before deciding whether the product fits their needs'],
      buyingTriggers: ['A concrete explanation of intended use and an honest invitation to learn more'],
      languageStyle: 'Clear, practical language that avoids hype and separates known facts from ideas to validate'
    },
    product_positioning: {
      positioningStatement: 'A practical seasonal product presented for independent retailers who value clear information and thoughtful choices.',
      marketPosition: 'A straightforward option within the retailer’s existing assortment, described without unsupported comparisons.',
      differentiation: 'The positioning emphasizes understandable purpose and careful communication rather than unverified performance claims.',
      proofPoints: ['Confirm product details and customer feedback before adding specific evidence to public copy'],
      positioningPillars: ['Clear purpose', 'Practical context', 'Evidence-aware communication'],
      messagingImplications: ['Explain confirmed information and give readers a simple next step for learning more']
    },
    value_proposition: {
      primaryValueProposition: 'Give customers a clear way to understand the seasonal product and decide whether it belongs in their routine.',
      customerProblemOrDesire: 'Customers want concise information that connects product purpose with a practical use context.',
      promisedOutcome: 'The message helps customers evaluate the offer using clear information rather than exaggerated promises.',
      reasonsToBelieve: ['Use confirmed product details and approved customer evidence when those materials are available'],
      differentiators: ['Direct explanation', 'Practical customer context', 'Restraint around unconfirmed claims'],
      supportingMessages: ['Lead with purpose', 'Clarify who the offer is for', 'Invite an informed next step']
    },
    core_messaging: {
      coreMessage: 'Understand the product’s intended role, the customer context it addresses, and the next step for learning more.',
      messagePillars: ['Practical purpose', 'Relevant customer context', 'Clear next step'],
      supportingPoints: ['Describe confirmed details plainly', 'Answer likely customer questions', 'Avoid unsupported outcome language'],
      toneGuidance: 'Use calm, direct, professional language that informs before it promotes.',
      proofThemes: ['Confirmed product facts', 'Approved customer evidence', 'Transparent limits'],
      callsToAction: ['Learn more about the product details', 'Review the available information']
    },
    product_image_guidance: {
      summary: 'Use a simple visual sequence that helps customers recognize the product and understand its intended context.',
      content: [
        'Start with a clean product image on an uncluttered background, then add a contextual image that reflects the confirmed customer use case.',
        'Keep labels readable and avoid badges, charts, or visual claims unless the supporting information has been confirmed for public use.'
      ]
    },
    launch_announcement: {
      summary: 'Introduce the seasonal product with a direct explanation of what it is and why the intended customer may want to learn more.',
      content: [
        'A new seasonal product is joining our assortment. It is presented for independent-shop customers who want clear product information and a practical way to decide whether it fits their needs.',
        'Review the confirmed product details, consider how the offer fits your routine, and contact the shop if you need clarification before deciding.'
      ]
    },
    educational_content: {
      summary: 'Help readers evaluate a seasonal product by separating confirmed details from questions that still need evidence.',
      content: [
        'Begin with the product’s intended purpose and the audience it was designed to serve. Then compare those details with the customer’s actual situation.',
        'Use a short checklist: identify confirmed features, note unanswered questions, avoid assuming outcomes, and request clarification when a decision depends on missing information.'
      ]
    },
    social_launch_campaign: {
      summary: 'Use a short sequence that introduces the product, explains its practical context, and invites an informed next step.',
      content: [
        'Post one: introduce the seasonal product and state its confirmed purpose in plain language without promising a result.',
        'Post two: explain the customer context it may suit and share a practical question readers can use when evaluating fit.',
        'Post three: recap confirmed details and invite readers to review the product information or ask the shop for clarification.'
      ]
    }
  };
  return outputs[id];
}

function request(server, url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port,
      method: options.method || 'GET', path: url,
      headers: { Accept: options.accept || 'text/html', ...(options.headers || {}) }
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function createUser(db, name) {
  return Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit)
    VALUES (?, ?, 'free', 20)
  `).run(`${name}-${Date.now()}-${Math.random()}@example.com`, name).lastInsertRowid);
}

function createRun(db, userId, suffix) {
  return Number(db.prepare(`
    INSERT INTO production_runs (
      user_id, objective, status, plan_fingerprint, idempotency_key, approved_at,
      started_at, completed_at, strategy_snapshot, production_cost_units
    ) VALUES (?, 'launch_product', 'completed', ?, ?, CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}', 8)
  `).run(userId, `historical-${suffix}`, `historical-${suffix}-${Math.random()}`).lastInsertRowid);
}

function insertArtifact(db, { userId, runId, id, output = safeOutput(id), version = `${id}:v1`, dependencies = DEPENDENCIES[id] || [] }) {
  const jobId = Number(db.prepare(`
    INSERT INTO production_jobs (
      production_run_id, deliverable_id, title, phase, sequence_order, status,
      strategic_direction, strategy_snapshot, dependencies, contract_version,
      completed_at
    ) VALUES (?, ?, ?, 'create', ?, 'completed', 'Historical saved direction', '{}', ?, ?, CURRENT_TIMESTAMP)
  `).run(runId, id, TITLES[id] || id, ORDER.indexOf(id), JSON.stringify(dependencies), version).lastInsertRowid);
  const generationId = Number(db.prepare(`
    INSERT INTO generations (
      user_id, title, input_text, content_type, tone, ai_model, results,
      generation_type, production_job_id, deliverable_id, contract_version, structured_result
    ) VALUES (?, ?, 'PRIVATE_PROMPT_SENTINEL', 'sales_message', 'professional',
      'Historical CopyQuick', '[{"text":"PRIVATE_RESULT_SENTINEL"}]', 'production', ?, ?, ?, ?)
  `).run(userId, TITLES[id] || id, jobId, id, version, JSON.stringify(output)).lastInsertRowid);
  db.prepare('UPDATE production_jobs SET generation_id = ? WHERE id = ?').run(generationId, jobId);
  return { jobId, generationId };
}

function createGraph(db, userId, suffix = 'complete') {
  const runId = createRun(db, userId, suffix);
  const artifacts = {};
  for (const id of ORDER) artifacts[id] = insertArtifact(db, { userId, runId, id });
  return { runId, artifacts };
}

function createApp(userId) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = { userId };
    res.locals.user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
    next();
  });
  app.use(generationRoutes);
  return app;
}

function assertPublicOnly(text) {
  assert.doesNotMatch(text, /PRIVATE_PROMPT_SENTINEL|PRIVATE_RESULT_SENTINEL|PRIVATE_TITLE_SENTINEL/);
  assert.doesNotMatch(text, /production_job_id|contract_version|strategy_snapshot|dependency payload/i);
}

async function run() {
  initDb();
  const db = getDb();
  const userId = createUser(db, 'Historical Owner');
  const otherUserId = createUser(db, 'Other Tenant');
  const graph = createGraph(db, userId);
  const currentContract = getProductionContract('customer_profile');
  const compatibleRows = [];
  for (const version of ['customer_profile:v2', currentContract.version]) {
    const runId = createRun(db, userId, `compatible-${version}`);
    compatibleRows.push(insertArtifact(db, { userId, runId, id: 'customer_profile', version }));
  }

  assert.deepStrictEqual(supportedHistoricalProductionPairs(), ORDER.map(id => `${id}:v1`));
  for (const id of ORDER) {
    assert.strictEqual(getProductionContract(id).acceptsVersion(`${id}:v1`), false, `${id} execution must reject v1`);
    const generation = db.prepare('SELECT * FROM generations WHERE id = ?').get(graph.artifacts[id].generationId);
    const artifact = resolveProductionReadArtifact(db, { userId, generation, output: safeOutput(id) });
    assert.strictEqual(artifact.supported, true, id);
    assert.strictEqual(artifact.historical, true, id);
    assert.strictEqual(artifact.quality.valid, true, `${id}: ${artifact.quality.code} ${JSON.stringify(artifact.quality.details || {})}`);
    assert(artifact.sections.length >= 2, id);
    assert(artifact.sections.every(section => section.internal === false), id);
  }
  db.prepare('UPDATE generations SET title = ? WHERE id = ?')
    .run('production_job_id PRIVATE_TITLE_SENTINEL', graph.artifacts.launch_announcement.generationId);
  db.prepare("UPDATE production_jobs SET title = 'contract_version PRIVATE_TITLE_SENTINEL', last_error_code = 'PRIVATE_ERROR', error_message = 'PRIVATE_RESULT_SENTINEL' WHERE production_run_id = ?")
    .run(graph.runId);

  const server = await listen(createApp(userId));
  try {
    for (const id of ORDER) {
      const generationId = graph.artifacts[id].generationId;
      const detail = await request(server, `/generation/${generationId}`);
      assert.strictEqual(detail.res.statusCode, 200, id);
      assert.match(detail.body, /Historical asset:/i, id);
      assert.match(detail.body, /Copy All/i, id);
      assertPublicOnly(detail.body);
    }

    const launchId = graph.artifacts.launch_announcement.generationId;
    const detail = await request(server, `/generation/${launchId}`);
    assert.match(detail.body, /A new seasonal product is joining our assortment/i);
    assert.doesNotMatch(detail.body, /Subject Line|Preheader/);

    const txt = await request(server, `/generation/${launchId}/export?format=txt`);
    assert.strictEqual(txt.res.statusCode, 200);
    assert.match(txt.body, /^Overview\n/m);
    assert.match(txt.body, /Launch Announcement\n/);
    assertPublicOnly(txt.body);
    assertPublicOnly(String(txt.res.headers['content-disposition'] || ''));

    const markdown = await request(server, `/generation/${launchId}/export?format=md`);
    assert.strictEqual(markdown.res.statusCode, 200);
    assert.match(markdown.body, /^# Launch Announcement$/m);
    assert.match(markdown.body, /^## Overview$/m);
    assert.match(markdown.body, /^## Launch Announcement$/m);
    assertPublicOnly(markdown.body);
    assertPublicOnly(String(markdown.res.headers['content-disposition'] || ''));

    for (const row of compatibleRows) {
      const compatibleDetail = await request(server, `/generation/${row.generationId}`);
      assert.strictEqual(compatibleDetail.res.statusCode, 200);
      assert.match(compatibleDetail.body, /Copy All/i);
      assert.doesNotMatch(compatibleDetail.body, /Historical asset:/i);
      assert.strictEqual((await request(server, `/generation/${row.generationId}/export?format=txt`)).res.statusCode, 200);
      assert.strictEqual((await request(server, `/generation/${row.generationId}/export?format=md`)).res.statusCode, 200);
    }

    const beforeRequests = db.prepare('SELECT COUNT(*) AS count FROM generation_requests').get().count;
    const regenerate = await request(server, `/generation/${launchId}/regenerate-production`, {
      method: 'POST', accept: 'application/json', headers: { 'Idempotency-Key': 'historical-v1-block' }
    });
    assert.strictEqual(regenerate.res.statusCode, 409);
    assert.match(regenerate.body, /historical Production artifact cannot be regenerated/i);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generation_requests').get().count, beforeRequests);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const malformed = createGraph(db, userId, 'malformed');
  db.prepare('UPDATE generations SET structured_result = ? WHERE id = ?').run(
    JSON.stringify({ summary: 'Only one field is present.' }), malformed.artifacts.launch_announcement.generationId
  );
  const unsafe = createGraph(db, userId, 'unsafe');
  db.prepare('UPDATE generations SET structured_result = ? WHERE id = ?').run(JSON.stringify({
    summary: 'This output asks the public reader to inspect production_job_id before deciding what to do.',
    content: ['The rest of this historical copy is long enough to satisfy substance checks, but the internal identifier must still fail closed.']
  }), unsafe.artifacts.launch_announcement.generationId);
  const empty = createGraph(db, userId, 'empty');
  db.prepare('UPDATE generations SET structured_result = ? WHERE id = ?').run(JSON.stringify({
    summary: '', content: []
  }), empty.artifacts.launch_announcement.generationId);
  const lowSubstance = createGraph(db, userId, 'low-substance');
  db.prepare('UPDATE generations SET structured_result = ? WHERE id = ?').run(JSON.stringify({
    summary: 'New product.', content: ['Learn more.']
  }), lowSubstance.artifacts.launch_announcement.generationId);
  const unsafeMarkup = createGraph(db, userId, 'unsafe-markup');
  db.prepare('UPDATE generations SET structured_result = ? WHERE id = ?').run(JSON.stringify({
    summary: '<img src=x onerror=alert(1)>',
    content: ['This otherwise substantive text must not make unsafe stored markup eligible for detail or export presentation.']
  }), unsafeMarkup.artifacts.launch_announcement.generationId);

  for (const fixture of [malformed, unsafe, empty, lowSubstance, unsafeMarkup]) {
    const fixtureServer = await listen(createApp(userId));
    try {
      const id = fixture.artifacts.launch_announcement.generationId;
      const fixtureDetail = await request(fixtureServer, `/generation/${id}`);
      assert.strictEqual(fixtureDetail.res.statusCode, 200);
      assert.match(fixtureDetail.body, /needs review before it can be used or exported/i);
      assert.doesNotMatch(fixtureDetail.body, /Copy All/i);
      assert.strictEqual((await request(fixtureServer, `/generation/${id}/export?format=txt`)).res.statusCode, 409);
      assert.strictEqual((await request(fixtureServer, `/generation/${id}/export?format=md`)).res.statusCode, 409);
    } finally {
      await new Promise(resolve => fixtureServer.close(resolve));
    }
  }

  const incompleteRunId = createRun(db, userId, 'incomplete');
  insertArtifact(db, { userId, runId: incompleteRunId, id: 'core_messaging' });
  const incompleteLaunch = insertArtifact(db, { userId, runId: incompleteRunId, id: 'launch_announcement' });
  const incompleteGeneration = db.prepare('SELECT * FROM generations WHERE id = ?').get(incompleteLaunch.generationId);
  const incompleteArtifact = resolveProductionReadArtifact(db, {
    userId, generation: incompleteGeneration, output: safeOutput('launch_announcement')
  });
  assert.strictEqual(incompleteArtifact.quality.valid, false);
  assert.strictEqual(incompleteArtifact.quality.code, 'HISTORICAL_READ_DEPENDENCY_MISSING');

  const wrongRunId = createRun(db, userId, 'wrong-run');
  const wrongRunLaunch = insertArtifact(db, { userId, runId: wrongRunId, id: 'launch_announcement' });
  const wrongRunGeneration = db.prepare('SELECT * FROM generations WHERE id = ?').get(wrongRunLaunch.generationId);
  assert.strictEqual(resolveProductionReadArtifact(db, {
    userId, generation: wrongRunGeneration, output: safeOutput('launch_announcement')
  }).quality.code, 'HISTORICAL_READ_DEPENDENCY_MISSING');

  const mismatchedRunId = createRun(db, userId, 'mismatch');
  const mismatched = insertArtifact(db, {
    userId, runId: mismatchedRunId, id: 'customer_profile', version: 'product_positioning:v1'
  });
  const mismatchedGeneration = db.prepare('SELECT * FROM generations WHERE id = ?').get(mismatched.generationId);
  assert.strictEqual(resolveProductionReadArtifact(db, {
    userId, generation: mismatchedGeneration, output: safeOutput('customer_profile')
  }).supported, false);

  const unknownRunId = createRun(db, userId, 'unknown');
  const unknown = insertArtifact(db, { userId, runId: unknownRunId, id: 'launch_announcement', version: 'launch_announcement:v99' });
  const unknownGeneration = db.prepare('SELECT * FROM generations WHERE id = ?').get(unknown.generationId);
  assert.strictEqual(resolveProductionReadArtifact(db, {
    userId, generation: unknownGeneration, output: safeOutput('launch_announcement')
  }).supported, false);

  const unknownIdRun = createRun(db, userId, 'unknown-id');
  const unknownId = insertArtifact(db, {
    userId, runId: unknownIdRun, id: 'retired_launch_asset', version: 'retired_launch_asset:v1',
    output: { summary: 'Retired historical output.', content: ['This unsupported identifier must remain unavailable.'] }
  });
  const unknownIdGeneration = db.prepare('SELECT * FROM generations WHERE id = ?').get(unknownId.generationId);
  assert.strictEqual(resolveProductionReadArtifact(db, {
    userId, generation: unknownIdGeneration,
    output: { summary: 'Retired historical output.', content: ['This unsupported identifier must remain unavailable.'] }
  }).supported, false);

  const tenantServer = await listen(createApp(otherUserId));
  try {
    const foreign = await request(tenantServer, `/generation/${graph.artifacts.launch_announcement.generationId}`);
    assert.strictEqual(foreign.res.statusCode, 404);
    const foreignTxt = await request(tenantServer, `/generation/${graph.artifacts.launch_announcement.generationId}/export?format=txt`);
    assert.strictEqual(foreignTxt.res.statusCode, 404);
  } finally {
    await new Promise(resolve => tenantServer.close(resolve));
  }

  let providerCalls = 0;
  await assert.rejects(generateDeliverable({
    handler: getProductionContract('launch_announcement'),
    productionRun: { objective: 'launch_product', strategySnapshot: {} },
    job: {
      deliverable_id: 'launch_announcement', contract_version: 'launch_announcement:v1',
      title: 'Launch Announcement', strategic_direction: 'Historical', strategySnapshot: {}
    },
    dependencyOutputs: {},
    generatorApi: { async generateCopy() { providerCalls += 1; return []; } }
  }), error => error.code === 'CONTRACT_VERSION_UNSUPPORTED' && error.permanent === true);
  assert.strictEqual(providerCalls, 0);

  const executionGraph = createGraph(db, userId, 'execution-block');
  const executionJob = executionGraph.artifacts.customer_profile;
  db.prepare(`
    UPDATE production_jobs SET status = 'queued', generation_id = NULL,
      completed_at = NULL, provider_started_at = NULL, attempt_count = 0
    WHERE id = ?
  `).run(executionJob.jobId);
  db.prepare("UPDATE production_runs SET status = 'queued', completed_at = NULL WHERE id = ?")
    .run(executionGraph.runId);
  const usagePeriodId = Number(db.prepare(`
    INSERT INTO usage_periods (
      user_id, period_start, period_end, plan_tier, monthly_limit, usage_count
    ) VALUES (?, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'free', 20, 0)
  `).run(userId).lastInsertRowid);
  const usageEventId = Number(db.prepare(`
    INSERT INTO usage_events (
      user_id, usage_period_id, production_run_id, event_type, units, source_route, metadata
    ) VALUES (?, ?, ?, 'production_charge', 0, 'historical-read-test', ?)
  `).run(userId, usagePeriodId, executionGraph.runId, JSON.stringify({
    costingModel: 'ready_to_use_asset_unit'
  })).lastInsertRowid);
  db.prepare('UPDATE production_runs SET usage_period_id = ?, usage_event_id = ? WHERE id = ?')
    .run(usagePeriodId, usageEventId, executionGraph.runId);
  const usageBefore = db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count;
  const executionResult = await executeNextProductionJob({
    db, userId, productionRunId: executionGraph.runId,
    generatorApi: { async generateCopy() { providerCalls += 1; return []; } },
    now: new Date('2026-10-10T12:00:00.000Z')
  });
  assert.strictEqual(executionResult.outcome, 'permanent_failure');
  const rejectedJob = db.prepare('SELECT status, last_error_code, provider_started_at FROM production_jobs WHERE id = ?')
    .get(executionJob.jobId);
  assert.strictEqual(rejectedJob.status, 'failed');
  assert.strictEqual(rejectedJob.last_error_code, 'CONTRACT_VERSION_UNSUPPORTED');
  assert.strictEqual(rejectedJob.provider_started_at, null);
  assert.strictEqual(providerCalls, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count, usageBefore);

  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Story 3.258 historical v1 Production read compatibility tests passed.');
}

run().catch(error => {
  try { getDb().close(); } catch (_) {}
  fs.rmSync(root, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
