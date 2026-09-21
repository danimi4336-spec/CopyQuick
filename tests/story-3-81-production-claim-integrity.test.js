const assert = require('assert');

const { getProductionContract } = require('../lib/productionContracts');
const {
  containsUnsupportedClaim,
  validateCustomerReadyOutput
} = require('../lib/productionQuality');

function profile(summary) {
  return {
    summary,
    primaryCustomer: 'Adults',
    needs: ['Clear information'],
    motivations: ['Evaluate the product direction'],
    objections: ['Unproven claims'],
    buyingTriggers: ['Credible evidence'],
    languageStyle: 'Clear and practical'
  };
}

const contract = getProductionContract('customer_profile');
const rejected = [
  'This clinically proven supplement delivers results.',
  'The product is FDA approved.',
  'A certified organic formula for everyday use.',
  'This doctor-recommended option is trusted by professionals.',
  'It cures digestive discomfort.',
  'It is guaranteed to improve your routine.',
  'Users see 85% improvement.',
  '#1 choice for wellness shoppers.',
  'A best-selling product customers love.',
  'Rated 4.9 by verified buyers.',
  'Trusted by 10,000 customers.',
  'Formulated with ginger and digestive enzymes.'
];

for (const claim of rejected) {
  assert.strictEqual(containsUnsupportedClaim(claim), true, claim);
  const validation = validateCustomerReadyOutput(profile(claim), contract);
  assert.strictEqual(
    validation.code,
    'PRODUCTION_QUALITY_UNSUPPORTED_CLAIM',
    claim
  );
  assert.match(validation.details.unsupportedClaims[0].excerpt, /\S/, claim);
}

const allowedBoundaries = [
  'No clinically proven benefit has been established.',
  'Do not describe the product as FDA approved.',
  'Certified organic status requires validation.',
  'Explore ginger and digestive enzymes as hypotheses to investigate.',
  'Avoid guaranteed results and unsupported percentages.',
  'Customer demand and ratings remain unverified.'
];

for (const boundary of allowedBoundaries) {
  assert.strictEqual(containsUnsupportedClaim(boundary), false, boundary);
  assert.strictEqual(validateCustomerReadyOutput(profile(boundary), contract).valid, true, boundary);
}

console.log('Story 3.81 Production Claim Integrity tests passed');
