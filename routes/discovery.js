const express = require('express');
const { requireAuth } = require('./auth');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { DISCOVERY_POLICY_VERSION, isMeaningfullyReady } = require('../lib/discoveryRequirements');
const { applyReflectionEdit, buildBusinessReflection } = require('../lib/businessReflection');
const { STRATEGY_POLICY_VERSION, buildStrategy } = require('../lib/strategyEngine');
const { buildStrategyWithAI } = require('../lib/aiStrategySynthesis');
const { buildPlan } = require('../lib/buildPlanEngine');
const { getDb } = require('../db/database');
const { getCurrentUsageSnapshotReadOnly } = require('../lib/subscriptions');
const { buildProductionBatchStatus } = require('../lib/productionBatchPlanning');
const { getSavedPlan, saveBuildPlan } = require('../lib/savedBuildPlans');
const { getAvailableObjective } = require('../lib/businessJourneys');
const { backfillLegacyBrandBrain, explicitCurrentInput, memoryUnderstanding, mergeCurrentWithMemory, promoteObjectiveMemory, reconcileMemory } = require('../lib/businessMemory');
const { isPlanningFoundation, isReadyToUseAsset } = require('../lib/productionArtifactPolicy');
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
  const discoverySession = req.session.discoverySession || null;
  const objective = activeObjective(req);
  const acquisition = objective === 'get_more_customers';
  const conversion = objective === 'increase_conversion_rates';
  const search = objective === 'improve_search_rankings';
  const brand = objective === 'build_brand';
  const service = objective === 'promote_service';
  const validateIdea = objective === 'validate_idea';
  res.status(options.status || 200).render('discovery', {
    title: "Let's Build Something Amazing - CopyQuick",
    currentPage: 'discovery',
    answer: options.answer ?? getInitialAnswer(req),
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
  discoverySession.discoveryCompleteForNow = intelligenceResult.discoveryCompleteForNow;
  discoverySession.discoveryPolicyVersion = DISCOVERY_POLICY_VERSION;
}

function applyDurableMemory(req, objective, initialDescription, understandingResult, discoverySession = null) {
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const explicit = explicitCurrentInput(objective, initialDescription);
  Object.assign(understandingResult.understanding, explicit);
  understandingResult.unknowns = (understandingResult.unknowns || []).filter(key => !explicit[key]);
  const remembered = memoryUnderstanding(db, { userId, objective, initialDescription });
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
  const buildPlanNotice = discoverySession.buildPlanNotice || null;
  discoverySession.productionNotice = null;
  discoverySession.buildPlanNotice = null;
  discoverySession.buildPlanSelection = initializeSelection(
    discoverySession.buildPlan,
    discoverySession.buildPlanSelection
  );
  const db = getDb();
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

function renderReflection(req, res, options = {}) {
  const discoverySession = req.session.discoverySession;
  const productionNotice = discoverySession.productionNotice || null;
  discoverySession.productionNotice = null;
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

router.get('/discovery', requireAuth, (req, res) => {
  refreshDiscoveryPolicy(req.session.discoverySession);
  if (canViewReflection(req.session.discoverySession)) {
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
    if (answer.length > MAX_ANSWER_LENGTH || answer.includes('\0')) {
      return validationError(req, res, `Keep your answer under ${MAX_ANSWER_LENGTH} characters.`, { answer });
    }

    const now = new Date().toISOString();
    const objective = activeObjective(req);
    const understandingResult = await understandBusiness({ objective, answer });
    const db = req.app.locals.copyquickDb || getDb();
    const userId = req.session.userId || req.session.passport?.user;
    backfillLegacyBrandBrain(db, { userId });
    const memoryMerge = applyDurableMemory(req, objective, answer, understandingResult);
    const answers = { initial_description: answer };
    const intelligenceResult = analyzeDiscovery({
      objective,
      understanding: understandingResult.understanding,
      unknowns: understandingResult.unknowns,
      answers
    });
    req.session.discoverySession = {
      objective,
      answers,
      understanding: understandingResult.understanding,
      unknowns: understandingResult.unknowns,
      interpretation: understandingResult.interpretation,
      memorySources: memoryMerge.sources,
      memoryConflicts: memoryMerge.conflicts,
      completedQuestions: ['initial_description'],
      completion: intelligenceResult.completion,
      knowledgeDomains: intelligenceResult.knowledgeDomains,
      nextQuestion: intelligenceResult.nextQuestion,
      reasoning: intelligenceResult.reasoning,
      remainingKnowledgeGaps: intelligenceResult.remainingKnowledgeGaps,
      planningReadiness: intelligenceResult.planningReadiness,
      discoveryCompleteForNow: intelligenceResult.discoveryCompleteForNow,
      discoveryPolicyVersion: DISCOVERY_POLICY_VERSION,
      stepHistory: [],
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
  refreshDiscoveryPolicy(req.session.discoverySession);
  if (!canViewReflection(req.session.discoverySession)) {
    return res.redirect('/discovery');
  }
  return renderReflection(req, res);
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
  const discoverySession = req.session.discoverySession;
  refreshDiscoveryPolicy(discoverySession);
  if (!canViewReflection(discoverySession)) {
    return res.redirect('/discovery');
  }
  if (!isMeaningfullyReady(discoverySession.planningReadiness)) {
    return renderReflection(req, res, {
      status: 409,
      error: 'Complete the required business understanding before building your plan.'
    });
  }

  discoverySession.confirmedUnderstanding = { ...discoverySession.understanding };
  discoverySession.strategyResult = await buildStrategyWithAI({
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
  refreshDiscoveryPolicy(discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness) || !discoverySession?.planningConfirmedAt) {
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
    objective: discoverySession.objective,
    canBuildPlan: hasCurrentStrategyState(discoverySession),
    error: productionNotice
  });
});

router.get('/discovery/build-plan', requireAuth, (req, res) => {
  const discoverySession = req.session.discoverySession;
  refreshDiscoveryPolicy(discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness) || !discoverySession?.planningConfirmedAt) {
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
  discoverySession.buildPlanSelection = result.selection;
  discoverySession.approvedProductionSet = null;
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session?.userId || req.session?.passport?.user;
  if (getSavedPlan(db, { userId, objective: discoverySession.objective })) saveBuildPlan(db, { userId, discoverySession });
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
    referenceId: result.productionSet.planFingerprint
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
  const discoverySession = req.session.discoverySession;
  refreshDiscoveryPolicy(discoverySession);
  if (!isMeaningfullyReady(discoverySession?.planningReadiness) || !hasCurrentBuildPlanState(discoverySession)) {
    return res.redirect('/discovery/build-plan');
  }
  if (!discoverySession.approvedProductionSet
    || discoverySession.approvedProductionSet.planFingerprint !== discoverySession.buildPlanFingerprint) {
    return res.redirect('/discovery/build-plan');
  }

  const productionSet = discoverySession.approvedProductionSet;
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
