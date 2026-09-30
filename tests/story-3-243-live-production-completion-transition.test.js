const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  createCompletionTransition
} = require('../public/js/productionCompletionTransition');

assert.deepStrictEqual(TERMINAL_RUN_STATUSES, ['completed', 'partially_completed', 'failed', 'blocked', 'canceled']);
['completed', 'partially_completed', 'failed', 'blocked', 'canceled'].forEach(status => {
  assert.strictEqual(isTerminalRunStatus(status), true, `${status} must transition`);
});
['queued', 'running', 'waiting_dependency', 'recovery_required', '', null].forEach(status => {
  assert.strictEqual(isTerminalRunStatus(status), false, `${status} must remain active until the server run is terminal`);
});

const events = [];
const transition = createCompletionTransition({
  targetUrl: '/production/42',
  stopPolling() { events.push('stop'); },
  navigate(url) { events.push(`navigate:${url}`); }
});
assert.strictEqual(transition('running'), false);
assert.deepStrictEqual(events, []);
assert.strictEqual(transition('completed'), true);
assert.deepStrictEqual(events, ['stop', 'navigate:/production/42']);
assert.strictEqual(transition('completed'), false);
assert.strictEqual(transition('failed'), false);
assert.deepStrictEqual(events, ['stop', 'navigate:/production/42'], 'terminal callbacks must cause exactly one transition');

const studio = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');
assert.match(studio, /productionCompletionTransition\.js/);
assert.match(studio, /window\.location\.replace\(url\)/);
assert.match(studio, /if \(transitionToCompletedResults\(state\.runStatus\)\) return;/);
assert.match(studio, /targetUrl: '\/production\/' \+ runId/);
assert.doesNotMatch(studio, /\/production\/start|run-next.*transitionToCompletedResults|regenerate.*transitionToCompletedResults/);

const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'production.js'), 'utf8');
assert.match(routes, /runStatus: production\.status/);
assert.match(routes, /terminal: \['completed', 'partially_completed', 'failed', 'blocked', 'canceled'\]\.includes\(production\.status\)/);

console.log('Story 3.243 Live Production Completion Transition tests passed');
