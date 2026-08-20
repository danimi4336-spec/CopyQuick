const express = require('express');
const { requireAuth } = require('./auth');

const router = express.Router();
const MAX_BUILDING_ANSWER_LENGTH = 2000;
const EXAMPLE_PROMPTS = [
  'A natural skincare line for people with sensitive skin',
  'A project management app for independent consultants',
  'An online course that helps first-time founders validate ideas',
  'A premium meal-planning service for busy families',
  'A sustainable home goods brand for modern apartments'
];

function getSavedAnswer(req) {
  return req.session.discoverySession?.whatBuilding || '';
}

function renderDiscovery(req, res, options = {}) {
  res.status(options.status || 200).render('discovery', {
    title: "Let's Build Something Amazing - CopyQuick",
    currentPage: 'discovery',
    answer: options.answer ?? getSavedAnswer(req),
    error: options.error || null,
    examplePrompts: EXAMPLE_PROMPTS
  });
}

router.get('/discovery', requireAuth, (req, res) => {
  renderDiscovery(req, res);
});

router.post('/discovery', requireAuth, (req, res) => {
  const answer = typeof req.body.whatBuilding === 'string'
    ? req.body.whatBuilding.trim()
    : '';

  if (!answer) {
    return renderDiscovery(req, res, {
      status: 400,
      answer: '',
      error: 'Tell us what you are building to continue.'
    });
  }

  if (answer.length > MAX_BUILDING_ANSWER_LENGTH) {
    return renderDiscovery(req, res, {
      status: 400,
      answer,
      error: `Keep your answer under ${MAX_BUILDING_ANSWER_LENGTH} characters.`
    });
  }

  req.session.discoverySession = {
    objective: 'launch_product',
    whatBuilding: answer,
    currentStep: 1
  };

  res.redirect(303, '/discovery');
});

module.exports = router;
