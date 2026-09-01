const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
const failureHandler = route.slice(route.indexOf("logGenerationFailure(req, 'dashboard_generation_failed'"));

assert.match(failureHandler, /res\.status\(failureStatus\)\.render\('dashboard'/);

console.log('Story 3.136 truthful generation failure status tests passed');
