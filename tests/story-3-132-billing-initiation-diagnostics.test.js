const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pricing.js'), 'utf8');

for (const [event, code] of [
  ['billing_checkout_redirect_failed', 'STRIPE_CHECKOUT_REDIRECT_INVALID'],
  ['billing_checkout_failed', 'STRIPE_CHECKOUT_SESSION_FAILED'],
  ['billing_portal_redirect_failed', 'STRIPE_PORTAL_REDIRECT_INVALID'],
  ['billing_portal_failed', 'STRIPE_PORTAL_SESSION_FAILED']
]) {
  assert.match(route, new RegExp(`'${event}', '${code}'`));
}

assert.match(route, /requestId: req\.requestId/);
assert.match(route, /route: req\.route\?\.path \|\| 'unmatched'/);
assert.doesNotMatch(route, /console\.(?:log|warn|error)/);
assert.doesNotMatch(route, /err\.(?:message|stack)/);

console.log('Story 3.132 billing initiation diagnostics tests passed');
