const assert = require('assert');
const fs = require('fs');
const path = require('path');

const terms = fs.readFileSync(path.join(__dirname, '..', 'views', 'terms.ejs'), 'utf8');

assert.doesNotMatch(terms, /team sharing/i);
assert.doesNotMatch(terms, /API access/i);
assert.doesNotMatch(terms, /authorized team members/i);

assert.match(terms, /Free Plan:<\/strong> 10 generations per month, access to current creation workflows, and saved generation history/);
assert.match(terms, /Pro Plan \(\$9\/month\):<\/strong> 200 generations per month, access to current creation workflows, and saved generation history/);
assert.match(terms, /Unlimited Plan \(\$29\/month\):<\/strong> An unlimited monthly generation allowance, access to current creation workflows, and saved generation history/);
assert.match(terms, /responsible for activity performed through your account/i);

console.log('Story 3.101 Truthful Subscription Terms tests passed');
