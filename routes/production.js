const express = require('express');
const { requireAuth } = require('./auth');
const { getDb } = require('../db/database');
const { getProductionReview, getProductionRun, initializeProduction } = require('../lib/productionInitialization');
const { executeNextProductionJob } = require('../lib/productionExecution');
const { generationActionRateLimit } = require('../lib/generationProtection');
const { requireGenerationAvailable } = require('../lib/generationControls');
const { parsePositiveIntegerId } = require('../lib/httpIdentifiers');
const { writeOperationalEvent } = require('../lib/operationalLogger');
const { buildProductionSynthesis } = require('../lib/productionSynthesis');
const {
  buildProductionPlanProgress,
  resolveProductionProgressSet,
  serializeProductionPlanProgress
} = require('../lib/productionPlanProgress');
const { productionPlanName } = require('../lib/productionPlanIdentity');
const { listProductionHistoryPage } = require('../lib/productionResume');
const { buildProductionDelivery } = require('../lib/productionResultsPresentation');
const {
  customerPurpose,
  customerReadiness,
  customerStatusLabel,
  getProductionArtifactPolicy,
  isPlanningFoundation,
  isReadyToUseAsset
} = require('../lib/productionArtifactPolicy');

const router = express.Router();

function getUser(req, db) {
  const userId = req.session?.userId || req.session?.passport?.user;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function groupApprovedPhases(approvedProductionSet) {
  const phases = [];
  approvedProductionSet.selectedDeliverables.forEach(function(item) {
    let phase = phases.find(function(existing) { return existing.id === item.phase; });
    if (!phase) {
      phase = { id: item.phase, title: item.phaseTitle || item.phase, deliverables: [] };
      phases.push(phase);
    }
    phase.deliverables.push(item);
  });
  return phases;
}

const PRODUCTION_JOB_DESCRIPTIONS = Object.freeze({
  customer_profile: 'Clarifies the current customer hypothesis, needs, objections, and evidence to validate.',
  product_concept_brief: 'Defines the working concept, open decisions, evidence boundaries, and next definition steps.',
  product_specification_brief: 'Organizes unresolved product requirements and the tests needed before supplier or prototype decisions.',
  product_positioning: 'Frames a provisional position to validate without claiming unsupported differentiation.',
  value_proposition: 'Defines a customer-value hypothesis and the evidence required to support it.',
  validation_plan: 'Turns the largest assumptions into practical evidence-gathering actions and decision criteria.',
  prototype_sample_validation_plan: 'Defines consistent prototype and sample tests before inventory commitment.',
  sourcing_manufacturer_brief: 'Provides supplier evaluation and RFQ criteria without inventing vendors or commercial terms.',
  compliance_evidence_checklist: 'Scopes questions, documents, and claims that require qualified review.',
  unit_economics_pricing_model: 'Provides the input model needed to evaluate price, landed cost, and contribution margin.',
  packaging_shipping_requirements: 'Defines packaging, labeling, protection, measurement, and shipping decisions.',
  inventory_fulfillment_plan: 'Plans receiving, storage, replenishment, fulfillment, returns, and operational readiness.',
  amazon_keyword_guidance: 'Provides unmeasured marketplace search hypotheses to investigate before keyword decisions.'
});

function productionJobDescription(job) {
  return PRODUCTION_JOB_DESCRIPTIONS[job.deliverable_id]
    || `Review the completed ${String(job.title || 'deliverable').toLowerCase()} and its supporting evidence before using it downstream.`;
}

function redirectInvalid(req, res, result) {
  if (req.session?.discoverySession) req.session.discoverySession.productionNotice = result.reason;
  return res.redirect(result.redirect || '/discovery/build-plan');
}

function renderReview(res, review, options = {}) {
  const productionNowSet = { selectedDeliverables: review.batch.productionNow };
  return res.status(options.status || 200).render('production-review', {
    title: 'Review Production - CopyQuick',
    currentPage: 'production',
    productionSet: review.approvedProductionSet,
    phases: groupApprovedPhases(productionNowSet),
    cost: review.cost,
    batch: review.batch,
    planningFoundation: review.batch.productionNow.filter(isPlanningFoundation),
    readyToUseAssets: review.batch.productionNow.filter(isReadyToUseAsset),
    error: options.error || null
  });
}

function getProductionSynthesis(db, userId, productionRunId) {
  const rows = db.prepare(`
    SELECT generations.deliverable_id, generations.structured_result
    FROM generations
    JOIN production_jobs ON production_jobs.generation_id = generations.id
    JOIN production_runs ON production_runs.id = production_jobs.production_run_id
    WHERE production_runs.id = ? AND production_runs.user_id = ?
      AND production_jobs.status = 'completed' AND generations.is_deleted = 0
  `).all(productionRunId, userId);
  const outputs = rows.map(function(row) {
    try {
      return { deliverableId: row.deliverable_id, output: JSON.parse(row.structured_result || 'null') };
    } catch (_) {
      return null;
    }
  }).filter(item => item?.output);
  return buildProductionSynthesis(outputs);
}

router.get('/production', requireAuth, (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');
  const history = listProductionHistoryPage(db, user.id, {
    page: req.query.page,
    status: req.query.status
  });
  return res.render('production-history', {
    title: 'Production Plans - CopyQuick',
    currentPage: 'production',
    productionRuns: history.items,
    history
  });
});

router.get('/production/review', requireAuth, (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');
  const review = getProductionReview({ db, user, discoverySession: req.session.discoverySession });
  if (!review.valid) return redirectInvalid(req, res, review);
  return renderReview(res, review);
});

router.post('/production/start', requireAuth, requireGenerationAvailable, generationActionRateLimit, (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');

  let result;
  try {
    result = initializeProduction({ db, user, discoverySession: req.session.discoverySession });
  } catch (err) {
    writeOperationalEvent({
      event: 'production_initialization_failed',
      requestId: req.requestId,
      method: req.method,
      route: req.route?.path || 'unmatched',
      statusCode: 500,
      code: 'PRODUCTION_INITIALIZATION_FAILED'
    });
    return res.status(500).render('error', {
      title: 'Production Error - CopyQuick',
      currentPage: 'production',
      message: 'Production could not be initialized. No production work was started.'
    });
  }
  if (!result.valid && result.insufficientAllowance) {
    const review = getProductionReview({ db, user: getUser(req, db), discoverySession: req.session.discoverySession });
    return renderReview(res, review, { status: 409, error: result.reason });
  }
  if (!result.valid) return redirectInvalid(req, res, result);

  req.session.lastProductionRunId = result.productionRunId;
  return res.redirect(303, `/production/${result.productionRunId}`);
});

router.post('/production/:id/run-next', requireAuth, requireGenerationAvailable, generationActionRateLimit, async (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');
  const runId = parsePositiveIntegerId(req.params.id);
  if (!runId) return res.status(404).send('Production run not found.');

  const result = await executeNextProductionJob({ db, userId: user.id, productionRunId: runId });
  if (result.outcome === 'not_found') return res.status(404).send('Production run not found.');
  const messages = {
    completed: 'One production deliverable was completed successfully.',
    retry_scheduled: 'A production attempt could not be completed. It is ready for a safe retry.',
    permanent_failure: "We couldn't complete one asset after multiple attempts. Blocked dependent work was safely handled.",
    recovery_required: 'An interrupted production attempt needs safe verification before it can continue.',
    no_runnable_job: 'There are no runnable production jobs at this time.'
  };
  req.session.productionExecutionNotice = messages[result.outcome] || 'Production status was refreshed.';
  return res.redirect(303, `/production/${runId}`);
});

router.get('/production/:id', requireAuth, (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');
  const runId = parsePositiveIntegerId(req.params.id);
  const production = runId ? getProductionRun(db, user.id, runId) : null;
  if (!production) {
    return res.status(404).render('error', {
      title: 'Production Not Found - CopyQuick',
      currentPage: 'production',
      message: 'Production run not found.'
    });
  }

  const phases = [];
  production.jobs.forEach(function(job) {
    let structured = null;
    if (job.generation_id) {
      const generation = db.prepare('SELECT structured_result FROM generations WHERE id = ? AND user_id = ? AND is_deleted = 0').get(job.generation_id, user.id);
      try { structured = JSON.parse(generation?.structured_result || 'null'); } catch (_) { structured = null; }
    }
    job.display_description = customerPurpose(job.deliverable_id, job.title) || productionJobDescription(job);
    job.artifactPolicy = getProductionArtifactPolicy(job.deliverable_id);
    job.readiness = customerReadiness({ deliverableId: job.deliverable_id, status: job.status, valid: Boolean(structured) || job.status !== 'completed', essentialEvidenceMissing: Boolean(structured?.essentialEvidenceMissing) });
    job.customer_status = customerStatusLabel(job.readiness, job.status);
    job.researchSummary = job.deliverable_id === 'research_evidence_pack' && structured ? {
      status: Number(structured.questionsNeedingEvidence) > 0 && structured.researchStatus === 'No research needed' ? 'Research limited' : structured.researchStatus || '', sources: Number(structured.sourcesUsedCount) || 0,
      lastCheckedAt: structured.lastCheckedAt || '', limitation: structured.limitationNote || ''
    } : null;
    let phase = phases.find(function(existing) { return existing.id === job.phase; });
    if (!phase) {
      phase = { id: job.phase, title: job.phase_title || job.phase, jobs: [] };
      phases.push(phase);
    }
    phase.jobs.push(job);
  });
  const completedCount = production.jobs.filter(function(job) { return job.status === 'completed'; }).length;
  const delivery = {
    ...buildProductionDelivery(production.jobs),
    terminal: ['completed', 'partially_completed', 'failed', 'blocked', 'canceled'].includes(production.status)
  };
  const executionNotice = req.session.productionExecutionNotice || null;
  req.session.productionExecutionNotice = null;
  const hasExpiredLease = production.jobs.some(function(job) {
    return job.status === 'running' && job.lease_expires_at
      && Date.parse(job.lease_expires_at) <= Date.now();
  });
  const approved = req.session?.discoverySession?.approvedProductionSet;
  const progressSet = resolveProductionProgressSet({
    db, userId: user.id, production, approvedProductionSet: approved
  });
  const planProgress = buildProductionPlanProgress({
    db, userId: user.id, production, approvedProductionSet: progressSet
  });
  return res.render('production-studio', {
    title: 'Production Studio - CopyQuick',
    currentPage: 'production',
    production,
    phases,
    completedCount,
    planName: productionPlanName(production, progressSet),
    planProgress,
    synthesis: getProductionSynthesis(db, user.id, production.id),
    delivery,
    executionNotice,
    hasExpiredLease
  });
});

router.get('/production/:id/status', requireAuth, (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');
  const runId = parsePositiveIntegerId(req.params.id);
  const production = runId ? getProductionRun(db, user.id, runId) : null;
  if (!production) return res.status(404).json({ error: 'Production run not found.' });
  const completedCount = production.jobs.filter(function(job) { return job.status === 'completed'; }).length;
  const planProgress = buildProductionPlanProgress({
    db,
    userId: user.id,
    production,
    approvedProductionSet: req.session?.discoverySession?.approvedProductionSet
  });
  return res.json({
    runStatus: production.status,
    completedCount,
    totalCount: production.jobs.length,
    planProgress: serializeProductionPlanProgress(planProgress),
    jobs: production.jobs.map(function(job) {
      return {
        sequenceOrder: job.sequence_order,
        title: job.title,
        phase: job.phase,
        status: job.status,
        message: ['failed', 'skipped', 'recovery_required'].includes(job.status) ? job.error_message : null,
        resultUrl: job.status === 'completed' && job.generation_id ? `/generation/${job.generation_id}` : null
      };
    })
  });
});

module.exports = router;
