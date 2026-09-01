const assert = require('assert');
const {
  BILLING_RATE_LIMIT_ERROR,
  DEFAULT_BILLING_MAX_ACTIONS,
  DEFAULT_BILLING_WINDOW_MS,
  createBillingActionRateLimiter
} = require('../lib/billingRateLimit');

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; }
  };
}

let currentTime = 1000;
const events = [];
const limiter = createBillingActionRateLimiter({
  windowMs: 10000,
  maxActions: 2,
  maxKeys: 10,
  now: () => currentTime,
  logger: event => events.push(event)
});
const request = { session: { userId: 177 }, requestId: 'request-177' };
for (let attempt = 0; attempt < 2; attempt += 1) {
  let continued = false;
  limiter.middleware(request, response(), () => { continued = true; });
  assert.strictEqual(continued, true);
}
const limited = response();
let continued = false;
limiter.middleware(request, limited, () => { continued = true; });
assert.strictEqual(continued, false);
assert.strictEqual(limited.statusCode, 429);
assert.strictEqual(limited.body, BILLING_RATE_LIMIT_ERROR);
assert.strictEqual(limited.headers['Retry-After'], '10');
assert.deepStrictEqual(events, [{
  event: 'billing_action_rate_limited', requestId: 'request-177', code: 'BILLING_ACTION_RATE_LIMITED'
}]);

let otherContinued = false;
limiter.middleware({ session: { userId: 178 } }, response(), () => { otherContinued = true; });
assert.strictEqual(otherContinued, true, 'one account must not consume another account\'s billing allowance');
currentTime += 10001;
continued = false;
limiter.middleware(request, response(), () => { continued = true; });
assert.strictEqual(continued, true, 'the bounded window must recover automatically');

const defaults = createBillingActionRateLimiter({ windowMs: 'invalid', maxActions: 9999 });
assert.deepStrictEqual(defaults.config, {
  windowMs: DEFAULT_BILLING_WINDOW_MS,
  maxActions: DEFAULT_BILLING_MAX_ACTIONS
});

const pricingSource = require('fs').readFileSync(require.resolve('../routes/pricing'), 'utf8');
for (const route of ["router.get('/billing/return'", "router.post('/subscribe'", "router.post('/manage'"]) {
  const line = pricingSource.slice(pricingSource.indexOf(route), pricingSource.indexOf(route) + 130);
  assert.match(line, /requireAuth, billingActionRateLimit/);
}

console.log('Story 3.177 Billing Provider Rate Limit tests passed');
