const express = require('express');
const { requireAuth } = require('./auth');
const { getDb } = require('../db/database');
const { getProductionReview, getProductionRun, initializeProduction } = require('../lib/productionInitialization');
const { executeNextProductionJob } = require('../lib/productionExecution');

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

function redirectInvalid(req, res, result) {
  if (req.session?.discoverySession) req.session.discoverySession.productionNotice = result.reason;
  return res.redirect(result.redirect || '/discovery/build-plan');
}

function renderReview(res, review, options = {}) {
  return res.status(options.status || 200).render('production-review', {
    title: 'Review Production - CopyQuick',
    currentPage: 'production',
    productionSet: review.approvedProductionSet,
    phases: groupApprovedPhases(review.approvedProductionSet),
    cost: review.cost,
    error: options.error || null
  });
}

router.get('/production/review', requireAuth, (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');
  const review = getProductionReview({ db, user, discoverySession: req.session.discoverySession });
  if (!review.valid) return redirectInvalid(req, res, review);
  return renderReview(res, review);
});

router.post('/production/start', requireAuth, (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');

  let result;
  try {
    result = initializeProduction({ db, user, discoverySession: req.session.discoverySession });
  } catch (err) {
    console.error('Production initialization failed.');
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

router.post('/production/:id/run-next', requireAuth, async (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');
  const runId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(runId)) return res.status(404).send('Production run not found.');

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
  const runId = Number.parseInt(req.params.id, 10);
  const production = Number.isInteger(runId) ? getProductionRun(db, user.id, runId) : null;
  if (!production) {
    return res.status(404).render('error', {
      title: 'Production Not Found - CopyQuick',
      currentPage: 'production',
      message: 'Production run not found.'
    });
  }

  const phases = [];
  production.jobs.forEach(function(job) {
    let phase = phases.find(function(existing) { return existing.id === job.phase; });
    if (!phase) {
      phase = { id: job.phase, title: job.phase_title || job.phase, jobs: [] };
      phases.push(phase);
    }
    phase.jobs.push(job);
  });
  const completedCount = production.jobs.filter(function(job) { return job.status === 'completed'; }).length;
  const executionNotice = req.session.productionExecutionNotice || null;
  req.session.productionExecutionNotice = null;
  const hasExpiredLease = production.jobs.some(function(job) {
    return job.status === 'running' && job.lease_expires_at
      && Date.parse(job.lease_expires_at) <= Date.now();
  });
  return res.render('production-studio', {
    title: 'Production Studio - CopyQuick',
    currentPage: 'production',
    production,
    phases,
    completedCount,
    executionNotice,
    hasExpiredLease
  });
});

router.get('/production/:id/status', requireAuth, (req, res) => {
  const db = getDb();
  const user = getUser(req, db);
  if (!user) return res.redirect('/login');
  const runId = Number.parseInt(req.params.id, 10);
  const production = Number.isInteger(runId) ? getProductionRun(db, user.id, runId) : null;
  if (!production) return res.status(404).json({ error: 'Production run not found.' });
  const completedCount = production.jobs.filter(function(job) { return job.status === 'completed'; }).length;
  return res.json({
    runStatus: production.status,
    completedCount,
    totalCount: production.jobs.length,
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
