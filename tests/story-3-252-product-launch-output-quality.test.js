const assert = require('assert');

const { understandBusiness } = require('../lib/businessUnderstanding');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const description = 'We are launching a premium organic Ceylon cinnamon supplement for adults interested in supporting healthy metabolism and everyday wellness. We plan to sell it online through our website and Amazon. We need help positioning the product and preparing the marketing for launch.';
const product = 'Premium liposomal true Ceylon cinnamon (Cinnamomum verum), 120 softgels';
const forbidden = /recommended positioning direction|validate the direction|customer claim|investigate the product direction|confirmed product information|approved strategy|builder-provided context|planning foundation|invite the customer/i;
const dangerousClaims = /clinically proven|superior absorption|reduces? blood glucose|treats? diabetes|FDA approved|certified organic|third-party tested|customers love|guaranteed results/i;

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function strategySnapshot() {
  return {
    primaryCustomer: { value: 'Adults interested in supporting healthy metabolism and everyday wellness', semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Healthy metabolic function and everyday wellness', semanticRole: 'confirmed_fact' },
    marketPosition: { value: 'Premium wellness product', semanticRole: 'strategic_recommendation' },
    competitiveApproach: { value: 'Lead with established product details', semanticRole: 'strategic_recommendation' },
    communicationStyle: { value: 'Clear, grounded, and reassuring', semanticRole: 'strategic_recommendation' },
    marketingFocus: { value: 'Education, credibility, and customer understanding', semanticRole: 'strategic_recommendation' },
    launchApproach: { value: 'Education before promotion', semanticRole: 'strategic_recommendation' }
  };
}

function launchContext(productDescription = product, audience = 'Adults interested in supporting healthy metabolism and everyday wellness') {
  return {
    objective: 'launch_product',
    strategicDirection: `Builder-provided offer description: ${description} Treat this as unverified context, not proof of performance, demand, differentiation, claims, or substantiation. · Builder-provided product context: ${productDescription}. Treat this as unverified context, not proof of ingredients, efficacy, claims, or substantiation.`,
    strategySnapshot: { ...strategySnapshot(), primaryCustomer: { value: audience, semanticRole: 'confirmed_fact' } },
    dependencyOutputs: [
      { deliverableId: 'product_positioning', output: { positioningStatement: 'For the selected audience, explore a recommended positioning direction and validate the direction before treating it as a customer claim.' } },
      { deliverableId: 'core_messaging', output: { coreMessage: 'Investigate the product direction.', supportingPoints: ['Review the confirmed product information.'], callsToAction: ['Invite the customer to review the confirmed product information.'] } }
    ]
  };
}

function output(id, context = launchContext()) {
  const contract = getProductionContract(id);
  const result = contract.generateOutput(context);
  assert.strictEqual(contract.validateOutput(result, context), true, `${id} schema`);
  assert.deepStrictEqual(validateCustomerReadyOutput(result, contract, context), { valid: true, code: null }, `${id} quality`);
  return { contract, result };
}

async function run() {
  const interpreted = await understandBusiness({ objective: 'launch_product', answer: description, env: {} });
  assert.strictEqual(interpreted.understanding.businessType.value, 'physical_product');
  assert.strictEqual(interpreted.understanding.category.value, 'dietary_supplement');
  assert.strictEqual(interpreted.understanding.salesChannel.value, 'multiple');
  assert.strictEqual(interpreted.understanding.salesChannel.label, 'Our website and Amazon');

  const differentiationFollowUp = analyzeDiscovery({
    objective: 'launch_product',
    understanding: {
      businessType: confirmed('physical_product'), category: confirmed('dietary_supplement'),
      intendedOutcome: confirmed('metabolic_wellness'), conceptMaturity: confirmed('finalized'),
      existingProductDefinition: { ...confirmed(product), semanticRole: 'builder_provided_product_context' },
      targetAudience: confirmed('Adults interested in supporting healthy metabolism and everyday wellness'),
      launchStage: confirmed('ready'), salesChannel: confirmed('multiple', 'Our website and Amazon'),
      competitiveDifferentiation: confirmed('clear', 'It has clear, meaningful differences')
    },
    answers: { competitive_differentiation: 'clear' }
  });
  assert.strictEqual(differentiationFollowUp.nextQuestion.id, 'competitive_differentiation_details');
  assert.strictEqual(differentiationFollowUp.nextQuestion.type, 'free_text');

  const facts = {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    intendedOutcome: confirmed('metabolic_wellness', 'Metabolic health & wellness'),
    conceptMaturity: confirmed('finalized', 'Product finalized'),
    existingProductDefinition: { ...confirmed(product), semanticRole: 'builder_provided_product_context' },
    targetAudience: confirmed('Adults interested in supporting healthy metabolism and everyday wellness'),
    launchStage: confirmed('ready', 'Ready to launch'),
    salesChannel: confirmed('multiple', 'Our website and Amazon'),
    competitiveDifferentiation: confirmed('clear', 'It has clear, meaningful differences'),
    competitiveDifferentiationDetails: confirmed('True Ceylon cinnamon (Cinnamomum verum), liposomal formulation, and a 120-softgel package')
  };
  const strategy = buildStrategy({ objective: 'launch_product', understanding: facts, confirmedUnderstanding: facts, answers: { initial_description: description } });
  const plan = buildPlan({ objective: 'launch_product', confirmedUnderstanding: facts, strategyResult: strategy, answers: { initial_description: description } });
  const ids = plan.phases.flatMap(phase => phase.deliverables.map(item => item.id));
  for (const id of ['amazon_listing', 'amazon_bullet_points', 'ecommerce_product_page', 'ecommerce_trust_faq', 'ecommerce_conversion_copy', 'product_image_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign']) {
    assert(ids.includes(id), `${id} should be offered for the confirmed website + Amazon launch`);
  }

  for (const id of ['product_image_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign']) {
    const { contract, result } = output(id);
    const publicText = contract.publicFieldKeys.map(key => result[key]).flat(Infinity).join(' ');
    assert.match(publicText, /Ceylon cinnamon|Cinnamomum verum|120 softgels/i, `${id} should use established product context`);
    assert.doesNotMatch(publicText, forbidden, `${id} must not expose planning language`);
    assert.doesNotMatch(publicText, dangerousClaims, `${id} must remain claim-safe`);
  }

  const image = output('product_image_guidance').result;
  assert.match(JSON.stringify(image.requiredShots), /Amazon-ready/);
  assert.match(JSON.stringify(image.requiredShots), /Website hero/);

  const badAnnouncement = {
    subjectLine: 'A recommended positioning direction', previewText: 'Validate the direction before use.',
    headline: 'Meet the new offer', body: 'Invite the customer to review the confirmed product information. '.repeat(4),
    keyBenefits: ['Investigate the product direction.', 'Treat this as a customer claim.'], callToAction: 'Invite the customer'
  };
  const announcement = getProductionContract('launch_announcement');
  const rejected = validateCustomerReadyOutput(badAnnouncement, announcement, launchContext());
  assert.strictEqual(rejected.valid, false);
  assert.strictEqual(rejected.code, 'LIFECYCLE_QUALITY_FAILED');

  const genericProduct = 'A modular recycled-aluminum desk organizer with four removable trays';
  for (const id of ['product_image_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign']) {
    const { contract, result } = output(id, launchContext(genericProduct, 'Home-office customers who want a flexible desktop setup'));
    const publicText = contract.publicFieldKeys.map(key => result[key]).flat(Infinity).join(' ');
    assert.match(publicText, /recycled-aluminum desk organizer|removable trays/i);
    assert.doesNotMatch(publicText, /Ceylon|softgel|clinical|health outcome/i);
  }

  console.log('Story 3.252 Product Launch Output Quality tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
