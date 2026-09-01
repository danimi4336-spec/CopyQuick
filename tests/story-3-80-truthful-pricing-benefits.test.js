const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'pricing.ejs'), 'utf8');

function render(user = null) {
  return ejs.render(template, {
    user,
    csrfToken: 'test-csrf-token',
    checkoutKeys: { pro: 'pro-key', unlimited: 'unlimited-key' }
  });
}

const publicPricing = render();
assert.match(publicPricing, /10 generations \/ mo/);
assert.match(publicPricing, /200 generations \/ mo/);
assert.match(publicPricing, /Unlimited monthly generation allowance/);
assert.match(publicPricing, /Access to current creation workflows/);
assert.match(publicPricing, /Saved generation history/);

for (const unsupportedBenefit of [
  'Tone customization',
  'Team sharing',
  'API access',
  '24/7 Priority support',
  'Priority support'
]) {
  assert(!publicPricing.includes(unsupportedBenefit), `pricing must not promise unsupported benefit: ${unsupportedBenefit}`);
}

const freePricing = render({ plan_tier: 'free' });
assert.match(freePricing, /name="price" value="pro"/);
assert.match(freePricing, /name="price" value="unlimited"/);
assert.match(freePricing, /name="checkoutKey" value="pro-key"/);
assert.match(freePricing, /name="checkoutKey" value="unlimited-key"/);
assert.match(freePricing, /name="_csrf" value="test-csrf-token"/);

const paidPricing = render({ plan_tier: 'pro' });
assert.match(paidPricing, /Current Plan/);
assert.match(paidPricing, /action="\/manage" method="POST"/);

console.log('Story 3.80 Truthful Pricing Benefits tests passed');
