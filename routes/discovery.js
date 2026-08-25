const express = require('express');
const { requireAuth } = require('./auth');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { applyReflectionEdit, buildBusinessReflection } = require('../lib/businessReflection');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const {
  buildApprovalView,
  createApprovedProductionSet,
  initializeSelection,
  planFingerprint,
  updateSelection
} = require('../lib/buildPlanApproval');

const router = express.Router();
const MAX_ANSWER_LENGTH = 2000;
const EXAMPLE_PROMPTS = [
  'A natural skincare line for people with sensitive skin',
  'A project management app for independent consultants',
  'An online course that helps first-time founders validate ideas',
  'A premium meal-planning service for busy families',
  'A sustainable home goods brand for modern apartments'
];

function getInitialAnswer(req) {
  return req.session.discoverySession?.answers?.initial_description
    || req.session.discoverySession?.whatBuilding
    || '';
}

function getUnderstandingSummary(session) {
  return Object.values(session?.understanding || {}).filter(function(field) {
    return field && field.source !== 'unknown' && field.value !== null && field.label;
  });
}

function renderDiscovery(req, res, options = {}) {
  const discoverySession = req.session.discoverySession || null;
  res.status(options.status || 200).render('discovery', {
    title: "Let's Build Something Amazing - CopyQuick",
    currentPage: 'discovery',
    answer: options.answer ?? getInitialAnswer(req),
    selectedChoice: options.selectedChoice || '',
    otherAnswer: options.otherAnswer || '',
    error: options.error || null,
    examplePrompts: EXAMPLE_PROMPTS,
    discoverySession,
    understandingSummary: getUnderstandingSummary(discoverySession),
    nextQuestion: discoverySession?.nextQuestion || null
  });
}

function validationError(req, res, error, options = {}) {
  return renderDiscovery(req, res, { status: 400, error, ...options });
}

function applyIntelligenceResult(discoverySession, intelligenceResult) {
  discoverySession.completion = intelligenceResult.completion;
  discoverySession.knowledgeDomains = intelligenceResult.knowledgeDomains;
  discoverySession.nextQuestion = intelligenceResult.nextQuestion;
  discoverySession.reasoning = intelligenceResult.reasoning;
  discoverySession.remainingKnowledgeGaps = intelligenceResult.remainingKnowledgeGaps;
  discoverySession.planningReadiness = intelligenceResult.planningReadiness;
}

function canViewReflection(discoverySession) {
  return Boolean(discoverySession?.planningReadiness?.ready || discoverySession?.reflectionStartedAt);
}

function hasCurrentStrategyState(discoverySession) {
  if (!discoverySession?.planningConfirmedAt
    || !discoverySession?.confirmedUnderstanding
    || !discoverySession?.strategyResult
    || !discoverySession?.strategyUpdatedAt) return false;

  const confirmedAt = Date.parse(discoverySession.planningConfirmedAt);
  const strategyAt = Date.parse(discoverySession.strategyUpdatedAt);
  return Number.isFinite(confirmedAt) && Number.isFinite(strategyAt) && strategyAt >= confirmedAt;
}

function hasCurrentBuildPlanState(discoverySession) {
  if (!hasCurrentStrategyState(discoverySession)
    || !discoverySession?.buildPlan
    || !discoverySession?.buildPlanUpdatedAt
    || !discoverySession?.buildPlanSource
    || !discoverySession?.buildPlanFingerprint) return false;

  return discoverySession.buildPlanSource.planningConfirmedAt === discoverySession.planningConfirmedAt
    && discoverySession.buildPlanSource.strategyUpdatedAt === discoverySession.strategyUpdatedAt
    && discoverySession.buildPlanFingerprint === planFingerprint(discoverySession.buildPlan);
}

function renderBuildPlan(req, res, options = {}) {
  const discoverySession = req.session.discoverySession;
  const productionNotice = discoverySession.productionNotice || null;
  discoverySession.productionNotice = null;
  discoverySession.buildPlanSelection = initializeSelection(
    discoverySession.buildPlan,
    discoverySession.buildPlanSelection
  );
  return res.status(options.status || 200).render('build-plan', {
    title: 'Your Personalized Build Plan - CopyQuick',
    currentPage: 'discovery',
    plan: discoverySession.buildPlan,
    approval: buildApprovalView(discoverySession.buildPlan, discoverySession.buildPlanSelection),
    error: options.error || productionNotice
  });
}

function renderReflection(req, res, options = {}) {
  const discoverySession = req.session.discoverySession;
  const productionNotice = discoverySession.productionNotice || null;
  discoverySession.productionNotice = null;
  const reflection = buildBusinessReflection({
    answers: discoverySession.answers,
    understanding: discoverySession.understanding,
    planningReadiness: discoverySession.planningReadiness
  });
  return res.status(options.status || 200).render('business-reflection', {
    title: 'Business Reflection - CopyQuick',
    currentPage: 'discovery',
    reflection,
    planningReadiness: discoverySession.planningReadiness,
    error: options.error || productionNotice,
    confirmed: Boolean(discoverySession.planningConfirmedAt)
  });
}

router.get('/discovery', requireAuth, (req, res) => {
  if (req.session.discoverySession?.planningReadiness?.ready || req.session.discoverySession?.reflectionStartedAt) {
    return res.redirect('/discovery/reflection');
  }
  renderDiscovery(req, res);
});

router.post('/discovery', requireAuth, async (req, res) => {
  const questionId = typeof req.body.questionId === 'string' ? req.body.questionId : 'initial_description';

  if (questionId === 'initial_description') {
    const answer = typeof req.body.whatBuilding === 'string' ? req.body.whatBuilding.trim() : '';
    if (!answer) {
      return validationError(req, res, 'Tell us what you are building to continue.', { answer: '' });
    }
    if (answer.length > MAX_ANSWER_LENGTH) {
      return validationError(req, res, `Keep your answer under ${MAX_ANSWER_LENGTH} characters.`, { answer });
    }

    const now = new Date().toISOString();
    const understandingResult = await understandBusiness({ objective: 'launch_product', answer });
    const answers = { initial_description: answer };
    const intelligenceResult = analyzeDiscovery({
      objective: 'launch_product',
      understanding: understandingResult.understanding,
      unknowns: understandingResult.unknowns,
      answers
    });
    req.session.discoverySession = {
      objective: 'launch_product',
      answers,
      understanding: understandingResult.understanding,
      unknowns: understandingResult.unknowns,
      completedQuestions: ['initial_description'],
      completion: intelligenceResult.completion,
      knowledgeDomains: intelligenceResult.knowledgeDomains,
      nextQuestion: intelligenceResult.nextQuestion,
      reasoning: intelligenceResult.reasoning,
      remainingKnowledgeGaps: intelligenceResult.remainingKnowledgeGaps,
      planningReadiness: intelligenceResult.planningReadiness,
      startedAt: req.session.discoverySession?.startedAt || now,
      updatedAt: now
    };
    return res.redirect(303, '/discovery');
  }

  const discoverySession = req.session.discoverySession;
  const currentQuestion = discoverySession?.nextQuestion;
  if (!currentQuestion || currentQuestion.id !== questionId) {
    return validationError(req, res, 'That discovery question is no longer active. Please answer the question shown below.');
  }

  const selectedChoice = typeof req.body.choice === 'string' ? req.body.choice : '';
  const selectedOption = currentQuestion.options.find(function(option) {
    return option.value === selectedChoice;
  });
  if (!selectedOption) {
    return validationError(req, res, 'Choose an option to continue.', { selectedChoice });
  }

  const otherAnswer = typeof req.body.otherAnswer === 'string' ? req.body.otherAnswer.trim() : '';
  if (selectedOption.allowsText && !otherAnswer) {
    return validationError(req, res, 'Tell us a little more about your “Other” choice.', { selectedChoice });
  }
  if (otherAnswer.length > MAX_ANSWER_LENGTH) {
    return validationError(req, res, `Keep your answer under ${MAX_ANSWER_LENGTH} characters.`, {
      selectedChoice,
      otherAnswer
    });
  }

  const confirmedUnderstanding = {
    ...discoverySession.understanding,
    [currentQuestion.understandingField]: {
      value: selectedOption.allowsText ? otherAnswer : selectedOption.value,
      label: selectedOption.allowsText ? otherAnswer : selectedOption.label,
      confidence: 1,
      source: 'user_confirmed'
    }
  };
  const updatedAnswers = {
    ...discoverySession.answers,
    [currentQuestion.id]: selectedOption.allowsText
      ? { value: selectedOption.value, detail: otherAnswer }
      : selectedOption.value
  };
  const understandingResult = await understandBusiness({
    objective: discoverySession.objective,
    answer: discoverySession.answers.initial_description,
    existingUnderstanding: confirmedUnderstanding
  });
  const intelligenceResult = analyzeDiscovery({
    objective: discoverySession.objective,
    understanding: understandingResult.understanding,
    unknowns: understandingResult.unknowns,
    answers: updatedAnswers
  });

  discoverySession.answers = updatedAnswers;
  discoverySession.understanding = understandingResult.understanding;
  discoverySession.unknowns = understandingResult.unknowns;
  discoverySession.completedQuestions = Array.from(new Set(
    discoverySession.completedQuestions.concat(currentQuestion.id)
  ));
  applyIntelligenceResult(discoverySession, intelligenceResult);
  discoverySession.updatedAt = new Date().toISOString();

  if (intelligenceResult.planningReadiness.ready) {
    discoverySession.reflectionStartedAt = new Date().toISOString();
    return res.redirect(303, '/discovery/reflection');
  }
  return res.redirect(303, '/discovery');
});

router.get('/discovery/reflection', requireAuth, (req, res) => {
  if (!canViewReflection(req.session.discoverySession)) {
    return res.redirect('/discovery');
  }
  return renderReflection(req, res);
});

router.post('/discovery/reflection/edit', requireAuth, async (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!canViewReflection(discoverySession)) {
    return res.redirect('/discovery');
  }

  let edit;
  try {
    edit = applyReflectionEdit({
      answers: discoverySession.answers,
      understanding: discoverySession.understanding,
      field: req.body.field,
      value: req.body.value
    });
  } catch (err) {
    return renderReflection(req, res, { status: 400, error: err.message });
  }

  const understandingResult = await understandBusiness({
    objective: discoverySession.objective,
    answer: edit.answers.initial_description,
    existingUnderstanding: edit.existingUnderstanding
  });
  const intelligenceResult = analyzeDiscovery({
    objective: discoverySession.objective,
    understanding: understandingResult.understanding,
    unknowns: understandingResult.unknowns,
    answers: edit.answers
  });

  discoverySession.answers = edit.answers;
  discoverySession.understanding = understandingResult.understanding;
  discoverySession.unknowns = understandingResult.unknowns;
  applyIntelligenceResult(discoverySession, intelligenceResult);
  discoverySession.updatedAt = new Date().toISOString();
  discoverySession.planningConfirmedAt = null;
  discoverySession.confirmedUnderstanding = null;
  discoverySession.strategyResult = null;
  discoverySession.strategyUpdatedAt = null;
  discoverySession.buildPlan = null;
  discoverySession.buildPlanUpdatedAt = null;
  discoverySession.buildPlanSource = null;
  discoverySession.buildPlanFingerprint = null;
  discoverySession.buildPlanSelection = null;
  discoverySession.approvedProductionSet = null;

  return res.redirect(303, '/discovery/reflection');
});

router.post('/discovery/reflection/plan', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!canViewReflection(discoverySession)) {
    return res.redirect('/discovery');
  }
  if (!discoverySession.planningReadiness?.ready) {
    return renderReflection(req, res, {
      status: 409,
      error: 'Complete the required business understanding before building your plan.'
    });
  }

  discoverySession.confirmedUnderstanding = { ...discoverySession.understanding };
  discoverySession.strategyResult = buildStrategy({
    objective: discoverySession.objective,
    understanding: discoverySession.understanding,
    answers: discoverySession.answers,
    confirmedUnderstanding: discoverySession.confirmedUnderstanding
  });
  discoverySession.planningConfirmedAt = new Date().toISOString();
  discoverySession.strategyUpdatedAt = discoverySession.planningConfirmedAt;
  discoverySession.updatedAt = discoverySession.planningConfirmedAt;
  return res.redirect(303, '/discovery/strategy');
});

router.get('/discovery/strategy', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!discoverySession?.planningReadiness?.ready || !discoverySession?.planningConfirmedAt) {
    return res.redirect('/discovery/reflection');
  }

  const strategyResult = discoverySession.strategyResult || buildStrategy({
    objective: discoverySession.objective,
    understanding: discoverySession.understanding,
    answers: discoverySession.answers,
    confirmedUnderstanding: discoverySession.confirmedUnderstanding
  });
  const productionNotice = discoverySession.productionNotice || null;
  discoverySession.productionNotice = null;
  return res.render('business-strategy', {
    title: 'Recommended Business Strategy - CopyQuick',
    currentPage: 'discovery',
    strategyResult,
    canBuildPlan: hasCurrentStrategyState(discoverySession),
    error: productionNotice
  });
});

router.get('/discovery/build-plan', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!discoverySession?.planningReadiness?.ready || !discoverySession?.planningConfirmedAt) {
    return res.redirect('/discovery/reflection');
  }
  if (!hasCurrentStrategyState(discoverySession)) {
    return res.redirect('/discovery/reflection');
  }

  const plan = buildPlan({
    objective: discoverySession.objective,
    confirmedUnderstanding: discoverySession.confirmedUnderstanding,
    strategyResult: discoverySession.strategyResult,
    answers: discoverySession.answers
  });
  if (!plan.readiness.ready) {
    return res.redirect('/discovery/reflection');
  }

  discoverySession.buildPlan = plan;
  discoverySession.buildPlanUpdatedAt = new Date().toISOString();
  discoverySession.buildPlanSource = {
    planningConfirmedAt: discoverySession.planningConfirmedAt,
    strategyUpdatedAt: discoverySession.strategyUpdatedAt
  };
  discoverySession.buildPlanFingerprint = planFingerprint(plan);
  return renderBuildPlan(req, res);
});

router.post('/discovery/build-plan/selection', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!hasCurrentBuildPlanState(discoverySession)) {
    return res.redirect('/discovery/build-plan');
  }
  const requested = Array.isArray(req.body.selectedDeliverableIds)
    ? req.body.selectedDeliverableIds
    : req.body.selectedDeliverableIds ? [req.body.selectedDeliverableIds] : [];
  const result = updateSelection({
    plan: discoverySession.buildPlan,
    currentSelection: discoverySession.buildPlanSelection,
    requestedDeliverableIds: requested
  });
  if (!result.valid) {
    return renderBuildPlan(req, res, { status: 409, error: result.error });
  }
  discoverySession.buildPlanSelection = result.selection;
  discoverySession.approvedProductionSet = null;
  return res.redirect(303, '/discovery/build-plan');
});

router.post('/discovery/build-plan/approve', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!hasCurrentBuildPlanState(discoverySession)) {
    return res.redirect('/discovery/build-plan');
  }
  const result = createApprovedProductionSet({
    plan: discoverySession.buildPlan,
    selection: discoverySession.buildPlanSelection,
    strategyResult: discoverySession.strategyResult
  });
  if (!result.valid) {
    return renderBuildPlan(req, res, { status: 409, error: result.error });
  }

  discoverySession.buildPlanSelection.approvedAt = result.approvedAt;
  discoverySession.buildPlanSelection.updatedAt = result.approvedAt;
  discoverySession.approvedProductionSet = result.productionSet;
  return res.redirect(303, '/discovery/production-ready');
});

router.get('/discovery/production-ready', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!hasCurrentBuildPlanState(discoverySession)) {
    return res.redirect('/discovery/build-plan');
  }
  if (!discoverySession.approvedProductionSet
    || discoverySession.approvedProductionSet.planFingerprint !== discoverySession.buildPlanFingerprint) {
    return res.redirect('/discovery/build-plan');
  }

  const productionSet = discoverySession.approvedProductionSet;
  const phases = discoverySession.buildPlan.phases.map(function(phase) {
    return {
      id: phase.id,
      title: phase.title,
      deliverables: productionSet.selectedDeliverables.filter(function(item) {
        return item.phase === phase.id;
      })
    };
  }).filter(function(phase) { return phase.deliverables.length; });
  return res.render('production-ready', {
    title: 'Your Production Plan Is Ready - CopyQuick',
    currentPage: 'discovery',
    productionSet,
    phases,
    dependencyCount: discoverySession.buildPlanSelection.requiredDependencyIds.length
  });
});

module.exports = router;
