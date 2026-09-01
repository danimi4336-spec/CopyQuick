const assert = require('assert');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
const runbook = fs.readFileSync(path.join(__dirname, '..', 'docs', 'TRANSACTIONAL_EMAIL_DELIVERY.md'), 'utf8');

assert.match(env, /EMAIL_DELIVERY_DRAIN_TIMEOUT_MS=15000/);
assert.match(env, /HTTP_SHUTDOWN_TIMEOUT_MS=25000/);
assert.match(runbook, /stops accepting new HTTP requests first/i);
assert.match(runbook, /EMAIL_DELIVERY_DRAIN_TIMEOUT_MS/);
assert.match(runbook, /HTTP_SHUTDOWN_TIMEOUT_MS/);
assert.match(runbook, /not a durable queue/i);
assert.doesNotMatch(runbook, /guarantee(?:d)? delivery/i);

console.log('Story 3.98 Shutdown Configuration tests passed');
