const crypto = require('crypto');
const express = require('express');
const { requireAuth } = require('./auth');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { DISCOVERY_POLICY_VERSION, isMeaningfullyReady } = require('../lib/discoveryRequirements');
const { applyReflectionEdit, buildBusinessReflection } = require('../lib/businessReflection');
const { STRATEGY_POLICY_VERSION, isRenderableStrategyResult } = require('../lib/strategyEngine');
const { buildStrategyWithAI } = require('../lib/aiStrategySynthesis');
const { buildPlan } = require('../lib/buildPlanEngine');
const { getDb } = require('../db/database');
const { getCurrentUsageSnapshotReadOnly } = require('../lib/subscriptions');
const { buildProductionBatchStatus } = require('../lib/productionBatchPlanning');
const { validateApprovedProductionSession } = require('../lib/productionInitialization');
const { getSavedPlanReadOnly, saveBuildPlan, validateWorkflowState } = require('../lib/savedBuildPlans');
const { getAvailableObjective } = require('../lib/businessJourneys');
const { parsePositiveIntegerId } = require('../lib/httpIdentifiers');
const {
  buildUnderstandingPresentation,
  projectCurrentDiscoverySummary,
  projectProductionDiscoverySummary,
  projectSavedDiscoverySummary
} = require('../lib/discoverySummary');
const { backfillLegacyBrandBrain, explicitCurrentInput, guardObjectiveSubjectResolution, memoryUnderstanding, mergeCurrentWithMemory, promoteObjectiveMemory, reconcileMemory, resolveObjectiveSubjects } = require('../lib/businessMemory');
const { isPlanningFoundation, isReadyToUseAsset } = require('../lib/productionArtifactPolicy');
const {
  buildApprovalView,
  createDefaultSelection,
  createApprovedProductionSet,
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
const ACQUISITION_EXAMPLE_PROMPTS = [
  'A bookkeeping service that wants more qualified small-business leads',
  'An online store that wants more repeat customers through email',
  'A local dental practice that wants more booked appointments',
  'A SaaS company that needs a predictable pipeline of trial users'
];
const CONVERSION_EXAMPLE_PROMPTS = [
  'A SaaS pricing page that should turn more qualified visitors into trial users',
  'A local service landing page that should generate more booked consultations',
  'An ecommerce product page receiving paid traffic but producing few purchases'
];
const SEARCH_EXAMPLE_PROMPTS = [
  'A local accounting firm that wants qualified small-business owners to find its service pages',
  'An ecommerce store that wants educational content to support product discovery',
  'A SaaS website that wants to organize content around customer problems and search intent'
];
const BRAND_EXAMPLE_PROMPTS = [
  'A bookkeeping studio that wants a clear, modern brand for independent retailers',
  'A sustainable home-goods company that needs positioning, voice, and messaging pillars',
  'An established consultancy that wants to clarify its brand story without losing existing equity'
];
const SERVICE_EXAMPLE_PROMPTS = [
  'A fractional finance service for growing agencies that need reliable monthly reporting',
  'A local home-organizing service that wants more consultation bookings',
  'A leadership coach promoting a structured program to first-time executives'
];
const IDEA_EXAMPLE_PROMPTS = [
  'A scheduling assistant for independent contractors who lose time coordinating appointments',
  'A reusable lunch container concept for parents packing school meals',
  'A workshop that may help new managers prepare for difficult conversations'
];

function activeObjective(req) {
  const sessionObjective = req.session.discoverySession?.objective;
  if (getAvailableObjective(sessionObjective)) return sessionObjective;
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const goal = db.prepare('SELECT builder_goal FROM users WHERE id = ?').get(userId)?.builder_goal;
  return getAvailableObjective(goal)?.id || 'launch_product';
}

function getInitialAnswer(discoverySession) {
  return discoverySession?.answers?.initial_description
    || discoverySession?.whatBuilding
    || '';
}

function captureDiscoveryStep(discoverySession) {
  const snapshot = { ...discoverySession };
  delete snapshot.stepHistory;
  delete snapshot.editingInitialDescription;
  return JSON.parse(JSON.stringify(snapshot));
}

function appendDiscoveryStepHistory(discoverySession) {
  return (Array.isArray(discoverySession.stepHistory) ? discoverySession.stepHistory : [])
    .concat(captureDiscoveryStep(discoverySession))
    .slice(-30);
}

function renderDiscovery(req, res, options = {}) {
  const discoverySession = Object.prototype.hasOwnProperty.call(options, 'discoverySession')
    ? options.discoverySession
    : req.session.discoverySession || null;
  const understandingPresentation = buildUnderstandingPresentation(discoverySession);
  const objective = getAvailableObjective(discoverySession?.objective)?.id || activeObjective(req);
  const acquisition = objective === 'get_more_customers';
  const conversion = objective === 'increase_conversion_rates';
  const search = objective === 'improve_search_rankings';
  const brand = objective === 'build_brand';
  const service = objective === 'promote_service';
  const validateIdea = objective === 'validate_idea';
  res.status(options.status || 200).render('discovery', {
    title: "Let's Build Something Amazing - CopyQuick",
    currentPage: 'discovery',
    answer: options.answer ?? getInitialAnswer(discoverySession),
    selectedChoice: options.selectedChoice || '',
    selectedChoices: options.selectedChoices || [],
    otherAnswer: options.otherAnswer || '',
    additionalDetail: options.additionalDetail || '',
    error: options.error || null,
    objective,
    initialPrompt: acquisition ? 'Tell us about the business you want to grow.' : conversion ? 'What conversion journey do you want to improve?' : search ? 'What should people find through search?' : brand ? 'What brand do you want to build or strengthen?' : service ? 'What service do you want to promote?' : validateIdea ? 'What idea do you want to validate?' : 'What are you building?',
    initialPlaceholder: acquisition ? 'Describe your offer, ideal customer, and how customers find you today...' : conversion ? 'Describe the offer, audience, page or funnel, traffic, and action you want visitors to take...' : search ? 'Describe the website, offer, audience, existing content, and search outcome you want...' : brand ? 'Describe the business, audience, existing brand, and what should become clearer...' : service ? 'Describe the service, ideal client, proof, offer, and how clients find you...' : validateIdea ? 'Describe the idea, proposed customer, problem, and evidence you have so far...' : 'Describe the product you want to bring to market...',
    examplePrompts: acquisition ? ACQUISITION_EXAMPLE_PROMPTS : conversion ? CONVERSION_EXAMPLE_PROMPTS : search ? SEARCH_EXAMPLE_PROMPTS : brand ? BRAND_EXAMPLE_PROMPTS : service ? SERVICE_EXAMPLE_PROMPTS : validateIdea ? IDEA_EXAMPLE_PROMPTS : EXAMPLE_PROMPTS,
    discoverySession,
    editingInitialDescription: Boolean(discoverySession?.editingInitialDescription),
    understandingSummary: understandingPresentation.understandingSummary,
    openInputsSummary: understandingPresentation.openInputsSummary,
    nextQuestion: discoverySession?.nextQuestion || null
  });
}

function validationError(req, res, error, options = {}) {
  const discoverySession = Object.prototype.hasOwnProperty.call(options, 'discoverySession')
    ? options.discoverySession
    : projectDiscoveryPolicy(req.session.discoverySession);
  return renderDiscovery(req, res, { status: 400, error, ...options, discoverySession });
}

function applyIntelligenceResult(discoverySession, intelligenceResult) {
  discoverySession.completion = intelligenceResult.completion;
  discoverySession.knowledgeDomains = intelligenceResult.knowledgeDomains;
  discoverySession.nextQuestion = intelligenceResult.nextQuestion;
  discoverySession.reasoning = intelligenceResult.reasoning;
  discoverySession.remainingKnowledgeGaps = intelligenceResult.remainingKnowledgeGaps;
  discoverySession.planningReadiness = intelligenceResult.planningReadiness;
  discoverySession.discoveryCompleteForNow = intelligenceResult.discoveryCompleteForNow;
  discoverySession.discoveryPolicyVersion = DISCOVERY_POLICY_VERSION;
}

function applyDurableMemory(req, objective, initialDescription, understandingResult, discoverySession = null) {
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const explicit = explicitCurrentInput(objective, initialDescription);
  Object.assign(understandingResult.understanding, explicit);
  understandingResult.unknowns = (understandingResult.unknowns || []).filter(key => !explicit[key]);
  const remembered = memoryUnderstanding(db, { userId, objective, initialDescription, subjectId: discoverySession?.memorySubjectIds?.offer });
  const merged = mergeCurrentWithMemory(understandingResult.understanding, remembered);
  understandingResult.understanding = merged.understanding;
  understandingResult.unknowns = (understandingResult.unknowns || []).filter(field => {
    const value = merged.understanding[field];
    return !value || value.value === null || value.value === 'unsure' || value.source === 'unknown';
  });
  if (discoverySession) {
    discoverySession.memorySources = { ...(discoverySession.memorySources || {}), ...merged.sources };
    const resolved = new Set((discoverySession.memoryResolvedRecordIds || []).map(String));
    discoverySession.memoryConflicts = merged.conflicts.filter(item => !resolved.has(String(item.recordId)));
  }
  return merged;
}

async function initializeDiscovery(req, objective, answer, subjectResolution) {
  const understandingResult = await understandBusiness({ objective, answer });
  const guardedResolution = guardObjectiveSubjectResolution(subjectResolution, {
    initialDescription: answer,
    understanding: understandingResult.understanding
  });
  const memorySubjectIds = { business: guardedResolution.business?.id || null, offer: guardedResolution.offer?.id || null };
  const memoryContext = guardedResolution.offer ? {
    offerLabel: guardedResolution.offer.displayLabel || guardedResolution.offer.label,
    selection: guardedResolution.selection
  } : null;
  const shell = { objective, memorySubjectIds };
  const memoryMerge = applyDurableMemory(req, objective, answer, understandingResult, shell);
  const answers = { initial_description: answer };
  const intelligenceResult = analyzeDiscovery({ objective, understanding: understandingResult.understanding, unknowns: understandingResult.unknowns, answers });
  const now = new Date().toISOString();
  req.session.discoverySession = {
    objective, answers, understanding: understandingResult.understanding, unknowns: understandingResult.unknowns,
    interpretation: understandingResult.interpretation, memorySources: memoryMerge.sources, memoryConflicts: memoryMerge.conflicts,
    memorySubjectIds, memoryContext, completedQuestions: ['initial_description'], completion: intelligenceResult.completion,
    knowledgeDomains: intelligenceResult.knowledgeDomains, nextQuestion: intelligenceResult.nextQuestion,
    reasoning: intelligenceResult.reasoning, remainingKnowledgeGaps: intelligenceResult.remainingKnowledgeGaps,
    planningReadiness: intelligenceResult.planningReadiness, discoveryCompleteForNow: intelligenceResult.discoveryCompleteForNow,
    discoveryPolicyVersion: DISCOVERY_POLICY_VERSION, stepHistory: [], startedAt: req.session.discoverySession?.startedAt || now, updatedAt: now
  };
}

function canViewReflection(discoverySession) {
  return Boolean(discoverySession?.planningReadiness?.discoveryCompleteForNow || discoverySession?.reflectionStartedAt);
}

function clearUnapprovedPlanningArtifacts(discoverySession) {
  if (discoverySession?.approvedProductionSet) return;
  discoverySession.planningConfirmedAt = null;
  discoverySession.confirmedUnderstanding = null;
  discoverySession.strategyResult = null;
  discoverySession.strategyUpdatedAt = null;
  discoverySession.buildPlan = null;
  discoverySession.buildPlanUpdatedAt = null;
  discoverySession.buildPlanSource = null;
  discoverySession.buildPlanFingerprint = null;
  discoverySession.buildPlanSelection = null;
}

function refreshDiscoveryPolicy(discoverySession) {
  if (!discoverySession?.objective || !discoverySession?.understanding || !discoverySession?.answers) return;
  const previousVersion = discoverySession.discoveryPolicyVersion;
  const intelligenceResult = analyzeDiscovery({
    objective: discoverySession.objective,
    understanding: discoverySession.understanding,
    unknowns: discoverySession.unknowns || [],
    answers: discoverySession.answers
  });
  applyIntelligenceResult(discoverySession, intelligenceResult);
  if (previousVersion !== DISCOVERY_POLICY_VERSION && !isMeaningfullyReady(intelligenceResult.planningReadiness)) {
    clearUnapprovedPlanningArtifacts(discoverySession);
  }
  if (discoverySession.strategyResult
    && discoverySession.strategyResult.policyVersion !== STRATEGY_POLICY_VERSION
    && !discoverySession.approvedProductionSet) {
    clearUnapprovedPlanningArtifacts(discoverySession);
  }
}

function projectDiscoveryPolicy(discoverySession) {
  if (!discoverySession) return null;
  const projection = JSON.parse(JSON.stringify(discoverySession));
  refreshDiscoveryPolicy(projection);
  return projection;
}

function hasCurrentStrategyState(discoverySession) {
  if (!getAvailableObjective(discoverySession?.objective)
    || !discoverySession?.planningConfirmedAt
    || !discoverySession?.confirmedUnderstanding
    || JSON.stringify(canonicalValue(discoverySession.understanding))
      !== JSON.stringify(canonicalValue(discoverySession.confirmedUnderstanding))
    || !discoverySession?.strategyResult
    || !discoverySession?.strategyUpdatedAt
    || !isRenderableStrategyResult(discoverySession.strategyResult)) return false;

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

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce(function(result, key) {
    if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
    return result;
  }, {});
}

function strategyPreparationToken(req, discoverySession) {
  const sessionSecret = req.session?.csrfSecret;
  if (!sessionSecret || !hasCurrentStrategyState(discoverySession)) return null;
  const source = canonicalValue({
    objective: discoverySession.objective,
    answers: discoverySession.answers,
    planningConfirmedAt: discoverySession.planningConfirmedAt,
    confirmedUnderstanding: discoverySession.confirmedUnderstanding,
    strategyResult: discoverySession.strategyResult,
    strategyUpdatedAt: discoverySession.strategyUpdatedAt
  });
  return crypto.createHmac('sha256', sessionSecret).update(JSON.stringify(source)).digest('hex');
}

function preparationTokensMatch(submittedToken, expectedToken) {
  if (typeof submittedToken !== 'string'
    || typeof expectedToken !== 'string'
    || !/^[a-f0-9]{64}$/.test(submittedToken)
    || !/^[a-f0-9]{64}$/.test(expectedToken)) return false;
  return crypto.timingSafeEqual(Buffer.from(submittedToken), Buffer.from(expectedToken));
}

function hasStoredBuildPlanArtifacts(discoverySession) {
  return [
    'buildPlan', 'buildPlanUpdatedAt', 'buildPlanSource', 'buildPlanFingerprint',
    'buildPlanSelection', 'approvedProductionSet'
  ].some(function(key) { return discoverySession?.[key] !== null && discoverySession?.[key] !== undefined; });
}

function hasCanonicalBuildPlanSource(discoverySession) {
  const source = discoverySession?.buildPlanSource;
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && typeof source.planningConfirmedAt === 'string'
    && typeof source.strategyUpdatedAt === 'string');
}

function hasValidStoredBuildPlan(discoverySession) {
  try {
    return hasCanonicalBuildPlanSource(discoverySession)
      && typeof discoverySession?.buildPlanUpdatedAt === 'string'
      && typeof discoverySession?.buildPlanFingerprint === 'string'
      && validateWorkflowState(discoverySession, discoverySession.buildPlanFingerprint);
  } catch (_) {
    return false;
  }
}

function renderBuildPlan(req, res, options = {}) {
  const discoverySession = options.discoverySession || req.session.discoverySession;
  const productionNotice = discoverySession.productionNotice || null;
  const buildPlanNotice = discoverySession.buildPlanNotice || null;
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session?.userId || req.session?.passport?.user;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const usageSnapshot = user ? getCurrentUsageSnapshotReadOnly(db, user) : { used: 0, monthlyLimit: 0, remaining: 0 };
  const affordability = buildProductionBatchStatus({
    db, userId, plan: discoverySession.buildPlan,
    selection: discoverySession.buildPlanSelection, usageSnapshot, mode: 'full'
  });
  return res.status(options.status || 200).render('build-plan', {
    title: 'Your Personalized Build Plan - CopyQuick',
    currentPage: 'discovery',
    plan: discoverySession.buildPlan,
    approval: buildApprovalView(discoverySession.buildPlan, discoverySession.buildPlanSelection),
    affordability,
    notice: buildPlanNotice,
    error: options.error || productionNotice
  });
}

function renderStrategy(req, res, options = {}) {
  const discoverySession = options.discoverySession || req.session.discoverySession;
  const strategyResult = options.strategyResult || discoverySession.strategyResult;
  return res.status(options.status || 200).render('business-strategy', {
    title: 'Recommended Business Strategy - CopyQuick',
    currentPage: 'discovery',
    strategyResult,
    objective: discoverySession.objective,
    canBuildPlan: hasCurrentStrategyState(discoverySession),
    strategyPreparationToken: strategyPreparationToken(req, discoverySession),
    error: options.error || null
  });
}

function renderReflection(req, res, options = {}) {
  const discoverySession = options.discoverySession || req.session.discoverySession;
  const productionNotice = discoverySession.productionNotice || null;
  const reflection = buildBusinessReflection({
    objective: discoverySession.objective,
    answers: discoverySession.answers,
    understanding: discoverySession.understanding,
    planningReadiness: discoverySession.planningReadiness,
    memorySources: discoverySession.memorySources,
    memoryConflicts: discoverySession.memoryConflicts
  });
  return res.status(options.status || 200).render('business-reflection', {
    title: 'Business Reflection - CopyQuick',
    currentPage: 'discovery',
    reflection,
    objective: discoverySession.objective,
    planningReadiness: discoverySession.planningReadiness,
    error: options.error || productionNotice,
    confirmed: Boolean(discoverySession.planningConfirmedAt)
  });
}

function renderDiscoverySummary(res, summary, status = 200) {
  return res.status(status).render('discovery-summary', {
    title: 'Discovery Summary - CopyQuick',
    currentPage: 'discovery',
    summary
  });
}

function renderSummaryNotFound(res) {
  return res.status(404).render('error', {
    title: 'Discovery Summary Not Found - CopyQuick',
    currentPage: 'discovery',
    message: 'Discovery summary not found.'
  });
}

router.get('/discovery/summary', requireAuth, (req, res) => {
  return renderDiscoverySummary(res, projectCurrentDiscoverySummary(req.session.discoverySession));
});

router.get('/discovery/summary/saved/:objective', requireAuth, (req, res) => {
  const objective = getAvailableObjective(req.params.objective)?.id;
  if (!objective) return renderSummaryNotFound(res);
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const result = getSavedPlanReadOnly(db, { userId, objective });
  if (!result.found) return renderSummaryNotFound(res);
  if (result.status === 'unsupported_version') {
    return renderDiscoverySummary(res, {
      ...projectSavedDiscoverySummary(null),
      notices: ['This historical saved plan was created by a version that cannot be summarized safely.']
    }, 409);
  }
  if (result.status !== 'valid') return renderDiscoverySummary(res, projectSavedDiscoverySummary(null), 409);
  return renderDiscoverySummary(res, projectSavedDiscoverySummary(result.plan));
});

router.get('/discovery/summary/production/:runId', requireAuth, (req, res) => {
  const runId = parsePositiveIntegerId(req.params.runId);
  if (!runId) return renderSummaryNotFound(res);
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const run = db.prepare(`
    SELECT id, objective, status, approved_at, started_at, completed_at,
           created_at, updated_at, strategy_snapshot, production_plan_snapshot
    FROM production_runs
    WHERE id = ? AND user_id = ?
  `).get(runId, userId);
  if (!run) return renderSummaryNotFound(res);
  const summary = projectProductionDiscoverySummary(run);
  return renderDiscoverySummary(res, summary, summary.available ? 200 : 409);
});

router.get('/discovery', requireAuth, (req, res) => {
  const discoverySession = projectDiscoveryPolicy(req.session.discoverySession);
  if (canViewReflection(discoverySession)) {
    return res.redirect('/discovery/reflection');
  }
  renderDiscovery(req, res, { discoverySession });
});

router.post('/discovery', requireAuth, async (req, res) => {
  const questionId = typeof req.body.questionId === 'string' ? req.body.questionId : 'initial_description';

  if (questionId === 'offer_subject_selection') {
    const pending = req.session.discoverySession;
    if (!pending?.offerSelectionPending || !pending.pendingInitialDescription) return res.redirect(303, '/discovery');
    const db = req.app.locals.copyquickDb || getDb();
    const userId = req.session.userId || req.session.passport?.user;
    const choice = String(req.body.offerSubjectId || '');
    const resolution = resolveObjectiveSubjects(db, { userId, initialDescription: pending.pendingInitialDescription, selectedOfferId: choice === 'new' ? null : choice, newOffer: choice === 'new' });
    if (resolution.invalid || (!resolution.offer && choice !== 'new')) return validationError(req, res, 'Choose a remembered offer or a different/new offer.');
    await initializeDiscovery(req, pending.objective, pending.pendingInitialDescription, resolution);
    return res.redirect(303, '/discovery');
  }

  if (questionId === 'initial_description') {
    const answer = typeof req.body.whatBuilding === 'string' ? req.body.whatBuilding.trim() : '';
    if (!answer) {
      return validationError(req, res, 'Tell us what you are building to continue.', { answer: '' });
    }
    if (answer.length > MAX_ANSWER_LENGTH || answer.includes('\0')) {
      return validationError(req, res, `Keep your answer under ${MAX_ANSWER_LENGTH} characters.`, { answer });
    }

    const now = new Date().toISOString();
    const objective = activeObjective(req);
    const db = req.app.locals.copyquickDb || getDb();
    const userId = req.session.userId || req.session.passport?.user;
    backfillLegacyBrandBrain(db, { userId });
    const resolution = resolveObjectiveSubjects(db, { userId, initialDescription: answer });
    if (resolution.requiresSelection) {
      req.session.discoverySession = { objective, offerSelectionPending: true, pendingInitialDescription: answer, rememberedOffers: resolution.offers, startedAt: req.session.discoverySession?.startedAt || now };
      return res.redirect(303, '/discovery');
    }
    await initializeDiscovery(req, objective, answer, resolution);
    return res.redirect(303, '/discovery');
  }

  const discoverySession = req.session.discoverySession;
  const projectedDiscoverySession = projectDiscoveryPolicy(discoverySession);
  const currentQuestion = projectedDiscoverySession?.nextQuestion;
  if (!currentQuestion || currentQuestion.id !== questionId) {
    return validationError(req, res, 'That discovery question is no longer active. Please answer the question shown below.');
  }

  if (currentQuestion.type === 'multi_choice') {
    const submitted = Array.isArray(req.body.choices)
      ? req.body.choices
      : typeof req.body.choices === 'string' ? [req.body.choices] : [];
    const submittedSet = new Set(submitted);
    const selectedOptions = currentQuestion.options.filter(function(option) {
      return submittedSet.has(option.value);
    });
    const selectedChoices = selectedOptions.map(function(option) { return option.value; });
    const additionalDetail = typeof req.body.additionalDetail === 'string'
      ? req.body.additionalDetail
      : '';
    const invalidSelection = submitted.some(function(value) {
      return !currentQuestion.options.some(function(option) { return option.value === value; });
    });
    const renderMultiError = function(message) {
      return validationError(req, res, message, { selectedChoices, additionalDetail });
    };
    if (submitted.length > currentQuestion.options.length) {
      return renderMultiError('Choose only the product directions shown below.');
    }
    if (invalidSelection) return renderMultiError('Choose only the product directions shown below.');
    if (!selectedChoices.length) return renderMultiError('Choose at least one direction to continue.');
    if (selectedChoices.length > currentQuestion.maxSelections) {
      return renderMultiError(`Choose no more than ${currentQuestion.maxSelections} directions.`);
    }
    if (selectedChoices.includes('unsure') && selectedChoices.length > 1) {
      return renderMultiError('Choose “I’m not sure yet” by itself, or select the directions you want to explore.');
    }
    if (additionalDetail.length > MAX_ANSWER_LENGTH || additionalDetail.includes('\0')) {
      return renderMultiError(`Keep your additional idea under ${MAX_ANSWER_LENGTH} characters.`);
    }

    const unsure = selectedChoices.length === 1 && selectedChoices[0] === 'unsure';
    const labels = selectedOptions.map(function(option) { return option.label; });
    const confirmedUnderstanding = {
      ...discoverySession.understanding,
      [currentQuestion.understandingField]: {
        value: unsure ? 'unsure' : selectedChoices,
        label: labels.join('; '),
        labels,
        additionalDetail,
        confidence: 1,
        source: 'user_confirmed',
        semanticRole: 'exploration_intent'
      }
    };
    const updatedAnswers = {
      ...discoverySession.answers,
      [currentQuestion.id]: { values: selectedChoices, additionalDetail }
    };
    const understandingResult = await understandBusiness({
      objective: discoverySession.objective,
      answer: discoverySession.answers.initial_description,
      existingUnderstanding: confirmedUnderstanding
    });
    refreshDiscoveryPolicy(discoverySession);
    applyDurableMemory(req, discoverySession.objective, discoverySession.answers.initial_description, understandingResult, discoverySession);
    const intelligenceResult = analyzeDiscovery({
      objective: discoverySession.objective,
      understanding: understandingResult.understanding,
      unknowns: understandingResult.unknowns,
      answers: updatedAnswers
    });
    const stepHistory = appendDiscoveryStepHistory(discoverySession);
    discoverySession.answers = updatedAnswers;
    discoverySession.understanding = understandingResult.understanding;
    discoverySession.unknowns = understandingResult.unknowns;
    discoverySession.interpretation = understandingResult.interpretation;
    discoverySession.completedQuestions = Array.from(new Set(
      discoverySession.completedQuestions.concat(currentQuestion.id)
    ));
    discoverySession.stepHistory = stepHistory;
    applyIntelligenceResult(discoverySession, intelligenceResult);
    discoverySession.updatedAt = new Date().toISOString();
    if (intelligenceResult.discoveryCompleteForNow) {
      discoverySession.reflectionStartedAt = new Date().toISOString();
      return res.redirect(303, '/discovery/reflection');
    }
    return res.redirect(303, '/discovery');
  }

  if (currentQuestion.type === 'free_text') {
    const freeTextAnswer = typeof req.body.freeTextAnswer === 'string' ? req.body.freeTextAnswer.trim() : '';
    const unsure = currentQuestion.allowsUnsure && req.body.unsure === 'unsure';
    const rerender = message => validationError(req, res, message, { otherAnswer: freeTextAnswer });
    if (unsure && freeTextAnswer) return rerender('Choose “I’m not sure yet” or describe the product, but not both.');
    if (!unsure && !freeTextAnswer) return rerender('Describe what you know so far, or choose “I’m not sure yet.”');
    if (freeTextAnswer.length > MAX_ANSWER_LENGTH || freeTextAnswer.includes('\0')) {
      return rerender(`Keep your answer under ${MAX_ANSWER_LENGTH} characters.`);
    }

    const confirmedUnderstanding = {
      ...discoverySession.understanding,
      [currentQuestion.understandingField]: {
        value: unsure ? 'unsure' : freeTextAnswer,
        label: unsure ? "I'm not sure yet" : freeTextAnswer,
        confidence: 1,
        source: 'user_confirmed',
        semanticRole: 'builder_provided_product_context'
      }
    };
    const updatedAnswers = {
      ...discoverySession.answers,
      [currentQuestion.id]: unsure ? 'unsure' : { value: freeTextAnswer }
    };
    const understandingResult = await understandBusiness({
      objective: discoverySession.objective,
      answer: discoverySession.answers.initial_description,
      existingUnderstanding: confirmedUnderstanding
    });
    refreshDiscoveryPolicy(discoverySession);
    applyDurableMemory(req, discoverySession.objective, discoverySession.answers.initial_description, understandingResult, discoverySession);
    const intelligenceResult = analyzeDiscovery({
      objective: discoverySession.objective,
      understanding: understandingResult.understanding,
      unknowns: understandingResult.unknowns,
      answers: updatedAnswers
    });
    const stepHistory = appendDiscoveryStepHistory(discoverySession);
    discoverySession.answers = updatedAnswers;
    discoverySession.understanding = understandingResult.understanding;
    discoverySession.unknowns = understandingResult.unknowns;
    discoverySession.interpretation = understandingResult.interpretation;
    discoverySession.completedQuestions = Array.from(new Set(
      discoverySession.completedQuestions.concat(currentQuestion.id)
    ));
    discoverySession.stepHistory = stepHistory;
    applyIntelligenceResult(discoverySession, intelligenceResult);
    discoverySession.updatedAt = new Date().toISOString();
    if (intelligenceResult.discoveryCompleteForNow) {
      discoverySession.reflectionStartedAt = new Date().toISOString();
      return res.redirect(303, '/discovery/reflection');
    }
    return res.redirect(303, '/discovery');
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
  if (otherAnswer.length > MAX_ANSWER_LENGTH || otherAnswer.includes('\0')) {
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
  refreshDiscoveryPolicy(discoverySession);
  applyDurableMemory(req, discoverySession.objective, discoverySession.answers.initial_description, understandingResult, discoverySession);
  const intelligenceResult = analyzeDiscovery({
    objective: discoverySession.objective,
    understanding: understandingResult.understanding,
    unknowns: understandingResult.unknowns,
    answers: updatedAnswers
  });

  const stepHistory = appendDiscoveryStepHistory(discoverySession);
  discoverySession.answers = updatedAnswers;
  discoverySession.understanding = understandingResult.understanding;
  discoverySession.unknowns = understandingResult.unknowns;
  discoverySession.interpretation = understandingResult.interpretation;
  discoverySession.completedQuestions = Array.from(new Set(
    discoverySession.completedQuestions.concat(currentQuestion.id)
  ));
  discoverySession.stepHistory = stepHistory;
  applyIntelligenceResult(discoverySession, intelligenceResult);
  discoverySession.updatedAt = new Date().toISOString();

  if (intelligenceResult.discoveryCompleteForNow) {
    discoverySession.reflectionStartedAt = new Date().toISOString();
    return res.redirect(303, '/discovery/reflection');
  }
  return res.redirect(303, '/discovery');
});

router.post('/discovery/back', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!discoverySession?.answers?.initial_description) return res.redirect(303, '/welcome');

  const history = Array.isArray(discoverySession.stepHistory) ? discoverySession.stepHistory : [];
  if (history.length) {
    const remainingHistory = history.slice(0, -1);
    req.session.discoverySession = {
      ...history[history.length - 1],
      stepHistory: remainingHistory,
      updatedAt: new Date().toISOString()
    };
  } else {
    discoverySession.editingInitialDescription = true;
    discoverySession.updatedAt = new Date().toISOString();
  }
  return res.redirect(303, '/discovery');
});

router.get('/discovery/reflection', requireAuth, (req, res) => {
  const discoverySession = projectDiscoveryPolicy(req.session.discoverySession);
  if (!canViewReflection(discoverySession)) {
    return res.redirect('/discovery');
  }
  return renderReflection(req, res, { discoverySession });
});

router.post('/discovery/reflection/edit', requireAuth, async (req, res) => {
  const discoverySession = req.session.discoverySession;
  refreshDiscoveryPolicy(discoverySession);
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
  applyDurableMemory(req, discoverySession.objective, edit.answers.initial_description, understandingResult, discoverySession);
  const intelligenceResult = analyzeDiscovery({
    objective: discoverySession.objective,
    understanding: understandingResult.understanding,
    unknowns: understandingResult.unknowns,
    answers: edit.answers
  });

  discoverySession.answers = edit.answers;
  discoverySession.understanding = understandingResult.understanding;
  discoverySession.unknowns = understandingResult.unknowns;
  discoverySession.interpretation = understandingResult.interpretation;
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

router.post('/discovery/reflection/plan', requireAuth, async (req, res) => {
  const discoverySession = projectDiscoveryPolicy(req.session.discoverySession);
  if (!canViewReflection(discoverySession)) {
    return res.redirect('/discovery');
  }
  if (!isMeaningfullyReady(discoverySession.planningReadiness)) {
    return renderReflection(req, res, {
      status: 409,
      error: 'Complete the required business understanding before building your plan.'
    });
  }

  const confirmedUnderstanding = JSON.parse(JSON.stringify(discoverySession.understanding));
  if (hasCurrentStrategyState(discoverySession)
    && JSON.stringify(canonicalValue(discoverySession.confirmedUnderstanding))
      === JSON.stringify(canonicalValue(confirmedUnderstanding))) {
    return res.redirect(303, '/discovery/strategy');
  }

  let strategyResult;
  try {
    strategyResult = await buildStrategyWithAI({
      objective: discoverySession.objective,
      understanding: discoverySession.understanding,
      answers: discoverySession.answers,
      confirmedUnderstanding
    });
  } catch (_) {
    return renderReflection(req, res, {
      status: 409,
      error: 'The Strategy could not be prepared safely. Review the current understanding and try again.'
    });
  }
  if (!isRenderableStrategyResult(strategyResult)) {
    return renderReflection(req, res, {
      status: 409,
      error: 'The Strategy could not be prepared safely. Review the current understanding and try again.'
    });
  }

  const preparedAt = new Date().toISOString();
  req.session.discoverySession = {
    ...discoverySession,
    confirmedUnderstanding,
    strategyResult,
    planningConfirmedAt: preparedAt,
    strategyUpdatedAt: preparedAt,
    updatedAt: preparedAt,
    buildPlan: null,
    buildPlanUpdatedAt: null,
    buildPlanSource: null,
    buildPlanFingerprint: null,
    buildPlanSelection: null,
    buildPlanSavedAt: null,
    buildPlanNotice: null,
    approvedProductionSet: null
  };
  return res.redirect(303, '/discovery/strategy');
});

router.get('/discovery/strategy', requireAuth, (req, res) => {
  const discoverySession = projectDiscoveryPolicy(req.session.discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness) || !discoverySession?.planningConfirmedAt) {
    return res.redirect('/discovery/reflection');
  }
  if (!hasCurrentStrategyState(discoverySession)) {
    return res.redirect('/discovery/reflection');
  }
  return renderStrategy(req, res, {
    discoverySession,
    error: discoverySession.productionNotice || null
  });
});

router.post('/discovery/build-plan/prepare', requireAuth, (req, res) => {
  const discoverySession = projectDiscoveryPolicy(req.session.discoverySession);
  if (!getAvailableObjective(discoverySession?.objective)
    || !isMeaningfullyReady(discoverySession?.planningReadiness)
    || !discoverySession?.planningConfirmedAt
    || !discoverySession?.confirmedUnderstanding) {
    return res.redirect('/discovery/reflection');
  }
  if (!hasCurrentStrategyState(discoverySession)) {
    return res.redirect('/discovery/reflection');
  }

  const submittedToken = typeof req.body.strategyPreparationToken === 'string'
    ? req.body.strategyPreparationToken
    : '';
  if (!preparationTokensMatch(submittedToken, strategyPreparationToken(req, discoverySession))) {
    return renderStrategy(req, res, {
      status: 409,
      error: 'This Strategy changed in another step. Review the current Strategy before preparing its Build Plan.'
    });
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

  const fingerprint = planFingerprint(plan);
  const source = {
    planningConfirmedAt: discoverySession.planningConfirmedAt,
    strategyUpdatedAt: discoverySession.strategyUpdatedAt
  };
  const hasStoredArtifacts = hasStoredBuildPlanArtifacts(discoverySession);
  if (hasStoredArtifacts && !hasValidStoredBuildPlan(discoverySession)) {
    return renderStrategy(req, res, {
      status: 409,
      error: 'The saved Build Plan state is inconsistent. Review your Strategy before preparing a new plan.'
    });
  }

  const sameSource = hasStoredArtifacts
    && discoverySession.buildPlanSource.planningConfirmedAt === source.planningConfirmedAt
    && discoverySession.buildPlanSource.strategyUpdatedAt === source.strategyUpdatedAt;
  const samePlan = hasStoredArtifacts
    && discoverySession.buildPlanFingerprint === fingerprint
    && JSON.stringify(discoverySession.buildPlan) === JSON.stringify(plan);

  let candidateState = req.session.discoverySession;
  if (!sameSource || !samePlan) {
    const now = new Date().toISOString();
    const preserveSelection = samePlan && discoverySession.buildPlanSelection;
    const selection = preserveSelection
      ? discoverySession.buildPlanSelection
      : createDefaultSelection(plan);
    candidateState = {
      ...discoverySession,
      buildPlan: plan,
      buildPlanUpdatedAt: now,
      buildPlanSource: source,
      buildPlanFingerprint: fingerprint,
      buildPlanSelection: selection,
      approvedProductionSet: null
    };
    if (!validateWorkflowState(candidateState, fingerprint)) {
      return renderStrategy(req, res, {
        status: 409,
        error: 'This Build Plan could not be prepared safely. Review the current Strategy and try again.'
      });
    }
  }
  req.session.discoverySession = candidateState;
  return res.redirect(303, '/discovery/build-plan');
});

router.get('/discovery/build-plan', requireAuth, (req, res) => {
  const discoverySession = projectDiscoveryPolicy(req.session.discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness) || !discoverySession?.planningConfirmedAt) {
    return res.redirect('/discovery/reflection');
  }
  if (!hasCurrentStrategyState(discoverySession)) {
    return res.redirect('/discovery/reflection');
  }
  if (!hasCurrentBuildPlanState(discoverySession) || !hasValidStoredBuildPlan(discoverySession)) {
    return res.redirect('/discovery/strategy');
  }
  return renderBuildPlan(req, res, { discoverySession });
});

router.post('/discovery/build-plan/selection', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  refreshDiscoveryPolicy(discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness) || !hasCurrentBuildPlanState(discoverySession)) {
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
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session?.userId || req.session?.passport?.user;
  try {
    const saved = saveBuildPlan(db, {
      userId,
      discoverySession: { ...discoverySession, buildPlanSelection: result.selection }
    });
    const approval = buildApprovalView(discoverySession.buildPlan, result.selection);
    discoverySession.buildPlanSelection = result.selection;
    discoverySession.approvedProductionSet = null;
    discoverySession.buildPlanSavedAt = saved.savedAt;
    discoverySession.buildPlanNotice = approval.counts.productionUnits === 0
      ? 'Plan saved. No Production credits were used. Resume it anytime from Start an Objective → Saved Plan.'
      : 'Plan saved. No Production credits are used until you start Production. Resume it anytime from Start an Objective → Saved Plan.';
  } catch (_) {
    return renderBuildPlan(req, res, {
      status: 409,
      error: 'This plan could not be saved safely. Review it and try again.'
    });
  }
  return res.redirect(303, '/discovery/build-plan');
});

router.post('/discovery/build-plan/save-later', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  refreshDiscoveryPolicy(discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness) || !hasCurrentBuildPlanState(discoverySession)) {
    return res.redirect(303, '/discovery/build-plan');
  }

  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session?.userId || req.session?.passport?.user;
  try {
    const saved = saveBuildPlan(db, { userId, discoverySession });
    discoverySession.buildPlanSavedAt = saved.savedAt;
    discoverySession.buildPlanNotice = 'Plan saved. Resume it anytime from Start an Objective → Saved Plan.';
  } catch (_) {
    return renderBuildPlan(req, res, {
      status: 409,
      error: 'This plan could not be saved safely. Review it and try again.'
    });
  }
  return res.redirect(303, '/discovery/build-plan');
});

router.post('/discovery/build-plan/approve', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  refreshDiscoveryPolicy(discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness) || !hasCurrentBuildPlanState(discoverySession)) {
    return res.redirect('/discovery/build-plan');
  }
  const result = createApprovedProductionSet({
    plan: discoverySession.buildPlan,
    selection: discoverySession.buildPlanSelection,
    strategyResult: discoverySession.strategyResult,
    confirmedUnderstanding: discoverySession.confirmedUnderstanding,
    batchMode: req.body.batchMode
  });
  if (!result.valid) {
    return renderBuildPlan(req, res, { status: 409, error: result.error });
  }

  discoverySession.buildPlanSelection.approvedAt = result.approvedAt;
  discoverySession.buildPlanSelection.updatedAt = result.approvedAt;
  discoverySession.approvedProductionSet = result.productionSet;
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const promotion = promoteObjectiveMemory(db, {
    userId,
    objective: discoverySession.objective,
    understanding: discoverySession.confirmedUnderstanding || discoverySession.understanding,
    answers: discoverySession.answers,
    referenceId: result.productionSet.planFingerprint,
    subjectIds: discoverySession.memorySubjectIds || {},
    correctionFields: Object.keys(discoverySession.answers?.reflection_edits || {})
  });
  discoverySession.memorySubjectIds = {
    business: promotion.subjects.business?.id || null,
    offer: promotion.subjects.offer?.id || null
  };
  discoverySession.approvedProductionSet.strategySnapshot.memorySubjects = discoverySession.memorySubjectIds;
  discoverySession.memoryPromotion = promotion.results.map(item => ({ field: item.field, outcome: item.outcome }));
  return res.redirect(303, '/discovery/production-ready');
});

router.post('/discovery/reflection/memory/:recordId', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  if (!discoverySession) return res.redirect(303, '/discovery');
  const conflict = (discoverySession.memoryConflicts || []).find(item => String(item.recordId) === String(req.params.recordId));
  if (!conflict) return res.status(404).send('Not found');
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const action = String(req.body.action || 'objective_only');
  const outcome = reconcileMemory(db, { userId, recordId: req.params.recordId, action, value: conflict.currentValue, label: conflict.currentValue });
  if (!outcome.valid) return res.status(404).send('Not found');
  if (action === 'keep') {
    discoverySession.understanding[conflict.field] = {
      value: conflict.rememberedValue, label: conflict.rememberedValue, confidence: 1,
      source: 'remembered_confirmed', memoryRecordId: conflict.recordId
    };
  }
  discoverySession.memoryConflicts = (discoverySession.memoryConflicts || []).filter(item => item !== conflict);
  discoverySession.memoryResolvedRecordIds = (discoverySession.memoryResolvedRecordIds || []).concat(String(conflict.recordId));
  refreshDiscoveryPolicy(discoverySession);
  return res.redirect(303, '/discovery/reflection');
});

router.get('/discovery/production-ready', requireAuth, (req, res) => {
  const discoverySession = projectDiscoveryPolicy(req.session.discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness)
    || !hasValidStoredBuildPlan(discoverySession)
    || !hasCurrentBuildPlanState(discoverySession)) {
    return res.redirect('/discovery/build-plan');
  }
  const approval = validateApprovedProductionSession(discoverySession);
  if (!approval.valid) return res.redirect(approval.redirect || '/discovery/build-plan');

  const productionSet = approval.approvedProductionSet;
  const db = getDb();
  const userId = req.session?.userId || req.session?.passport?.user;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const usageSnapshot = user ? getCurrentUsageSnapshotReadOnly(db, user) : { used: 0, monthlyLimit: 0, remaining: 0 };
  const batch = buildProductionBatchStatus({
    db, userId, plan: discoverySession.buildPlan,
    selection: discoverySession.buildPlanSelection, usageSnapshot,
    mode: productionSet.batchMode || 'full'
  });
  if (!batch.valid || !batch.productionNow.length) return res.redirect('/discovery/build-plan');
  const phases = discoverySession.buildPlan.phases.map(function(phase) {
    return {
      id: phase.id,
      title: phase.title,
      deliverables: batch.productionNow.filter(function(item) {
        return item.phase === phase.id;
      })
    };
  }).filter(function(phase) { return phase.deliverables.length; });
  const planningFoundation = batch.productionNow.filter(isPlanningFoundation);
  const readyToUseAssets = batch.productionNow.filter(isReadyToUseAsset);
  return res.render('production-ready', {
    title: 'Your Production Plan Is Ready - CopyQuick',
    currentPage: 'discovery',
    productionSet,
    batch,
    phases,
    planningFoundation,
    readyToUseAssets
  });
});

module.exports = router;
