const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { getProductionContract } = require('../lib/productionContracts');
const { buildProductionSynthesis } = require('../lib/productionSynthesis');

async function run() {
  const cases = [
    ['A natural digestive supplement for adults on Amazon.', 'Adults', 'amazon'],
    ['A wellness product for busy parents through Shopify.', 'Busy parents', 'own_website'],
    ['A recovery product for runners sold through retail stores.', 'Runners', 'retail'],
    ['A wellness guide for adults managing busy family routines.', 'Adults managing busy family routines', null]
  ];
  for (const [description, audience, channel] of cases) {
    const result = await understandBusiness({ objective: 'launch_product', answer: description });
    assert.strictEqual(result.understanding.targetAudience?.label, audience, description);
    assert.strictEqual(result.understanding.salesChannel?.value || null, channel, description);
  }

  const context = {
    objective: 'launch_product',
    title: 'Product Concept Brief',
    strategySnapshot: {
      primaryCustomer: { value: 'Adults', semanticRole: 'inferred_fact' },
      customerMotivation: { value: 'Digestive health', semanticRole: 'confirmed_fact' },
      marketPosition: { value: 'Natural Digestive Wellness Direction', semanticRole: 'strategic_recommendation' }
    },
    strategicDirection: 'Exploration intent: Gut microbiome support; Bloating & digestive comfort; Digestive enzyme support',
    dependencyOutputs: []
  };
  const conceptContract = getProductionContract('product_concept_brief');
  const concept = conceptContract.generateOutput(context);
  assert.strictEqual(conceptContract.validateOutput(concept), true);
  assert.match(concept.directionsToExplore[0], /customer.*routine|gut-wellness routine/i);
  assert.match(concept.directionsToExplore[1], /customer.*comfort|occasional digestive comfort/i);
  assert.match(concept.directionsToExplore[2], /food-specific digestion support/i);

  const keywordContract = getProductionContract('amazon_keyword_guidance');
  const keywords = keywordContract.generateOutput({ ...context, title: 'Amazon Search & Keyword Guidance' });
  assert.strictEqual(keywordContract.validateOutput(keywords), true);
  assert.match(JSON.stringify(keywords), /Unmeasured seed terms to investigate/i);
  assert.match(JSON.stringify(keywords), /microbiome support supplement/i);
  assert.match(JSON.stringify(keywords), /digestive comfort supplement/i);
  assert.match(JSON.stringify(keywords), /digestive enzyme support/i);
  assert.doesNotMatch(JSON.stringify(keywords), /search volume:\s*\d|competition score|keyword score/i);

  assert.strictEqual(getProductionContract('product_positioning').sectionLabels.proofPoints, 'Evidence to Establish');
  assert.strictEqual(getProductionContract('value_proposition').sectionLabels.reasonsToBelieve, 'Evidence to Establish');

  const synthesis = buildProductionSynthesis([
    { deliverableId: 'product_concept_brief', output: concept },
    { deliverableId: 'validation_plan', output: {
      nextActions: ['Interview relevant prospective customers.', 'Record evidence separately.', 'Defer launch assets.'],
      evidenceToCollect: ['Customer language.', 'Concept comprehension.', 'Product-development requirements.']
    } }
  ]);
  assert.strictEqual(synthesis.currentStage, 'Idea validation');
  assert.deepStrictEqual(synthesis.conceptDirections, ['Gut microbiome support', 'Bloating & digestive comfort', 'Digestive enzyme support']);
  assert.strictEqual(synthesis.unlockConditions.length, 3);

  const root = path.join(__dirname, '..');
  const buildPlan = fs.readFileSync(path.join(root, 'views', 'build-plan.ejs'), 'utf8');
  const ready = fs.readFileSync(path.join(root, 'views', 'production-ready.ejs'), 'utf8');
  const review = fs.readFileSync(path.join(root, 'views', 'production-review.ejs'), 'utf8');
  assert.doesNotMatch(buildPlan, /<%= item\.strategicDirection %>/);
  assert.doesNotMatch(ready, /<%= item\.strategicDirection %>/);
  assert.doesNotMatch(review, /<%= item\.strategicDirection %>/);

  const studio = await ejs.renderFile(path.join(root, 'views', 'production-studio.ejs'), {
    production: { id: 1, status: 'completed', production_cost_units: 6, started_at: 'now', jobs: [] },
    phases: [], completedCount: 6, executionNotice: null, hasExpiredLease: false,
    synthesis, csrfToken: 'test'
  });
  assert.match(studio, /What to do next/);
  assert.match(studio, /Before Amazon listing and launch assets unlock/);
  assert.doesNotMatch(studio, /Adults on Amazon/);

  console.log('Story 3.194 Trustworthy Idea-Stage Product Guidance tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
