const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'webhook.js'), 'utf8');

for (const [event, code] of [
  ['stripe_webhook_signature_rejected', 'STRIPE_SIGNATURE_INVALID'],
  ['stripe_webhook_processing_failed', 'STRIPE_WEBHOOK_PROCESSING_FAILED'],
  ['stripe_webhook_user_unresolved', 'LOCAL_SUBSCRIPTION_MISSING'],
  ['stripe_subscription_sync_rejected', 'STRIPE_RECORD_INCOMPLETE']
]) {
  assert.match(route, new RegExp(`'${event}', '${code}'`));
}

assert.match(route, /writeOperationalEvent/);
assert.doesNotMatch(route, /console\.(?:log|warn|error)/);
assert.doesNotMatch(route, /err\.(?:message|stack)/);

console.log('Story 3.133 Stripe webhook diagnostics tests passed');
