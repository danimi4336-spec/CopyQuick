const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'views', 'index.ejs'), 'utf8');
const about = fs.readFileSync(path.join(root, 'views', 'about.ejs'), 'utf8');

assert.match(index, /Guided Objective/);
assert.match(index, /Adaptive Discovery/);
assert.match(index, /Evidence-Aware Strategy/);
assert.match(index, /Maturity-Aware Build Plan/);
assert.match(index, /Validated Production Deliverables/);
assert.match(index, /Email Drafts/);
assert.match(index, /Landing Page CTAs/);
assert.match(index, /SEO Article Introductions|Article Introductions/);
assert.match(index, /200 generations per month/);
assert.match(index, /10 generations per month/);

for (const unsupportedClaim of [
  'Premium Natural Wellness',
  'Team sharing &amp; API',
  'Dedicated account manager',
  'Publishing Calendar',
  'SEO Package',
  'Full email sequences',
  'Jessica M.',
  'David R.',
  'Sarah L.',
  'Trusted by Marketers'
]) {
  assert(!index.includes(unsupportedClaim), `public homepage must not claim unsupported evidence or capability: ${unsupportedClaim}`);
}

assert.doesNotMatch(index, /<blockquote>/, 'public marketing must not present unsourced customer quotations');
assert.doesNotMatch(about, /Full email sequences|ready-to-use variations instantly/);
assert.match(about, /five focused variations to review and refine/);

console.log('Story 3.79 Truthful Public Product Surface tests passed');
