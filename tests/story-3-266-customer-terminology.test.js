const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const customerSurfaces = [
  'views/build-plan.ejs',
  'views/dashboard.ejs',
  'views/favorites.ejs',
  'views/generation.ejs',
  'views/history.ejs',
  'views/index.ejs',
  'views/pricing.ejs',
  'views/production-history.ejs',
  'views/production-ready.ejs',
  'views/production-review.ejs',
  'views/production-studio.ejs',
  'views/profile.ejs',
  'views/terms.ejs'
];

const combined = customerSurfaces.map(read).join('\n');

[
  /AI Credits/i,
  /Production credits?/i,
  /production-credit/i,
  /generation credits?/i,
  /CopyCredit Bank/i,
  /(?:^|[^-\w])ready assets?\b/i,
  /ready-to-use output deliverables?/i,
  /estimated[^\n<]*generations?/i,
  /Generation History/i,
  /favorite generations?/i
].forEach(pattern => {
  assert.doesNotMatch(combined, pattern, `customer terminology must exclude ${pattern}`);
});

const pricing = read('views/pricing.ejs');
assert.match(pricing, /monthly credit allowance/);
assert.match(pricing, /10 credits \/ mo/);
assert.match(pricing, /200 credits \/ mo/);
assert.match(pricing, /Unlimited monthly credits/);

const buildPlan = read('views/build-plan.ejs');
assert.match(buildPlan, /Ready-to-use assets/);
assert.match(buildPlan, /supporting document/);
assert.match(buildPlan, /no credits/);

const history = read('views/history.ejs');
assert.match(history, /Content History/);
assert.match(history, /saved item/);

const glossary = read('docs/CUSTOMER_TERMINOLOGY.md');
assert.match(glossary, /\*\*Credit\*\*/);
assert.match(glossary, /\*\*Production\*\*/);
assert.match(glossary, /\*\*Ready-to-use asset\*\*/);
assert.match(glossary, /\*\*Supporting document\*\*/);

console.log('Story 3.266 customer terminology tests passed');
