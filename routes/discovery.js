const express = require('express');
const { requireAuth } = require('./auth');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');

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

router.get('/discovery', requireAuth, (req, res) => {
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
  discoverySession.completion = intelligenceResult.completion;
  discoverySession.knowledgeDomains = intelligenceResult.knowledgeDomains;
  discoverySession.nextQuestion = intelligenceResult.nextQuestion;
  discoverySession.reasoning = intelligenceResult.reasoning;
  discoverySession.remainingKnowledgeGaps = intelligenceResult.remainingKnowledgeGaps;
  discoverySession.updatedAt = new Date().toISOString();

  return res.redirect(303, '/discovery');
});

module.exports = router;
