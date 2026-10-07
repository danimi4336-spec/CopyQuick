const assert = require('assert');

const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { canonicalProductContext } = require('../lib/productionProductContext');

const finishedProduct = 'A premium liposomal Ceylon cinnamon dietary supplement made with true Ceylon cinnamon (Cinnamomum verum). It comes in softgels and is formulated for adults interested in supporting healthy metabolic function and everyday wellness. The finished product contains 120 softgels per package and is intended to be sold through our website and Amazon.';
const differentiation = 'True Ceylon cinnamon / Cinnamomum verum, liposomal formulation, 120 softgels';

function fact(value, semanticRole = 'builder_provided_product_context') {
  return { value, label: value, semanticRole, source: 'user_confirmed' };
}

function context(product = finishedProduct, details = differentiation, extras = {}) {
  return {
    objective: 'launch_product',
    title: 'Story 3.254 fixture',
    strategicDirection: `Builder-provided product context: ${product}. Treat this as unverified context, not proof of ingredients, efficacy, claims, or substantiation. · Builder-provided differentiation details: ${details}. Treat these as product attributes supplied by the builder, not independent proof of efficacy, superiority, certification, or performance.`,
    strategySnapshot: {
      builderProductContext: fact(product),
      builderDifferentiationDetails: fact(details),
      primaryCustomer: fact('Adults interested in supporting healthy metabolism and everyday wellness', 'confirmed_fact'),
      customerMotivation: fact('Healthy metabolic function and everyday wellness', 'confirmed_fact'),
      primarySalesChannel: fact('Our website and Amazon', 'confirmed_fact'),
      communicationStyle: fact('Clear, grounded, and reassuring', 'strategic_recommendation'),
      ...extras
    },
    dependencyOutputs: []
  };
}

function generate(id, fixture = context()) {
  const contract = getProductionContract(id);
  const output = contract.generateOutput(fixture);
  assert.strictEqual(contract.validateOutput(output, fixture), true, `${id} schema`);
  assert.deepStrictEqual(validateCustomerReadyOutput(output, contract, fixture), { valid: true, code: null }, `${id} quality`);
  return { contract, output };
}

const canonical = canonicalProductContext(context());
assert.match(canonical.primaryIdentity, /Ceylon cinnamon supplement/i);
assert(canonical.primaryIdentity.length < 60);
assert.strictEqual(canonical.source.description, finishedProduct);
assert.strictEqual(canonical.source.differentiation, differentiation);
assert.strictEqual(canonical.byType.technical_identity[0].value, 'Cinnamomum verum');
assert.strictEqual(canonical.byType.formulation[0].value, 'liposomal formulation');
assert.strictEqual(canonical.byType.form_factor[0].value, 'softgels');
assert.strictEqual(canonical.byType.quantity[0].value, '120 softgels');
assert.strictEqual(canonical.byType.audience[0].provenance, 'confirmed_fact');
assert.deepStrictEqual(canonicalProductContext(context()), canonical, 'canonicalization must be idempotent');

const launch = generate('launch_announcement').output;
assert.match(launch.subjectLine, /Ceylon cinnamon supplement/i);
assert.doesNotMatch(launch.subjectLine, /;/, 'subject must not concatenate source descriptions');
assert(launch.subjectLine.length < 90, 'subject must use a concise identity');
assert.doesNotMatch(JSON.stringify(launch), /confirmed features|unsupported outcomes|builder-provided|claim substantiation|evidence state/i);

const ecommerce = generate('ecommerce_product_page').output;
assert(ecommerce.content.length >= 7, 'product page needs multiple substantive sections');
assert(ecommerce.content.join(' ').length >= 700, 'product page cannot be a thin generic shell');
assert.match(ecommerce.content.join(' '), /liposomal/i);
assert.match(ecommerce.content.join(' '), /120 softgels/i);

const amazon = generate('amazon_listing').output;
assert(amazon.content.length >= 5);
assert.doesNotMatch(amazon.content[0], /;/, 'Amazon title must not dump a composite descriptor');
assert(amazon.content.slice(1).every((item, index, items) => items.indexOf(item) === index));

const social = generate('social_launch_campaign').output;
assert(social.posts.length >= 3);
assert.strictEqual(new Set(social.posts.map(post => post.slice(0, 35).toLowerCase())).size, social.posts.length);
assert(social.posts.every(post => (post.match(/Ceylon cinnamon supplement/gi) || []).length <= 1));

const educational = generate('educational_content').output;
assert.doesNotMatch(educational.title, /;/);
assert(new Set(educational.keyLessons.map(item => item.slice(0, 30).toLowerCase())).size >= 3);

const image = generate('product_image_guidance').output;
assert.doesNotMatch(image.creativeDirection, /;/);
assert.match(image.requiredShots.join(' '), /Amazon-ready/);
assert.match(image.requiredShots.join(' '), /Website/);

const explicit = context('Arc Desk Organizer. A modular recycled-aluminum organizer with four trays for home-office desks.', 'Recycled aluminum, modular trays, four-piece set', {
  explicitProductName: fact('Arc Desk Organizer')
});
assert.match(generate('launch_announcement', explicit).output.subjectLine, /Arc Desk Organizer/);

const generic = context('A premium modular recycled-aluminum desk organizer with four removable trays for desk and home-office use.', 'Recycled aluminum, modular trays, four pieces', {
  primaryCustomer: fact('Home-office customers who want a flexible desktop setup', 'confirmed_fact'),
  customerMotivation: fact('A more adaptable and orderly workspace', 'confirmed_fact')
});
const genericLaunch = generate('launch_announcement', generic).output;
assert.match(genericLaunch.subjectLine, /desk organizer/i);
assert.doesNotMatch(JSON.stringify(genericLaunch), /Ceylon|softgel|wellness/i);

const bad = { ...launch, body: `${finishedProduct}; ${differentiation}. ${finishedProduct}; ${differentiation}.` };
assert.strictEqual(validateCustomerReadyOutput(bad, getProductionContract('launch_announcement'), context()).valid, false);

const thinPage = { summary: 'A product page.', content: ['Ceylon cinnamon supplement', 'Review the product.', 'See details.'] };
assert.strictEqual(validateCustomerReadyOutput(thinPage, getProductionContract('ecommerce_product_page'), context()).code, 'PRODUCTION_QUALITY_INSUFFICIENT_SUBSTANCE');
const policyLeak = { ...launch, body: 'Review the confirmed features and unsupported outcomes before deciding what fits your routine.' };
assert.strictEqual(validateCustomerReadyOutput(policyLeak, getProductionContract('launch_announcement'), context()).code, 'PRODUCTION_QUALITY_POLICY_LANGUAGE');
const repeatedSocial = { ...social, posts: Array(3).fill('Meet the complete premium product descriptor with every package detail and every product attribute repeated in the same customer message today.') };
assert.strictEqual(validateCustomerReadyOutput(repeatedSocial, getProductionContract('social_launch_campaign'), context()).valid, false);

const variants = canonicalProductContext(context('A cotton shirt available in black and navy, sizes S–XL.', 'Organic-cotton material, black and navy colors, sizes S–XL'));
assert.match(variants.byType.variants[0].value, /black and navy/i);
assert.match(variants.byType.sizes[0].value, /S.*XL/i);
assert.notStrictEqual(variants.byType.variants[0].value, variants.byType.sizes[0].value);

console.log('Story 3.254 Canonical Product Copy tests passed');
