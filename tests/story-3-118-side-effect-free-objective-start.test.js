const assert = require('assert');
const fs = require('fs');
const path = require('path');

const builder = fs.readFileSync(path.join(__dirname, '..', 'routes', 'builder.js'), 'utf8');
const welcomeStart = builder.indexOf("router.post('/welcome'");
const brandBrainStart = builder.indexOf("router.get('/brand-brain'", welcomeStart);
const welcomeHandler = builder.slice(welcomeStart, brandBrainStart);

assert.match(welcomeHandler, /UPDATE users SET builder_goal/);
assert.match(welcomeHandler, /delete req\.session\.discoverySession/);
assert.match(welcomeHandler, /res\.redirect\('\/discovery'\)/);
assert.doesNotMatch(welcomeHandler, /INSERT INTO brand_brain|UPDATE brand_brain|SELECT id FROM brand_brain/);

// The explicit Brand Brain workflow still owns creating and updating its row.
assert.match(builder.slice(brandBrainStart), /INSERT INTO brand_brain/);
assert.match(builder.slice(brandBrainStart), /UPDATE brand_brain/);

console.log('Story 3.118 side-effect-free objective start tests passed');
